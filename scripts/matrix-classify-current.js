'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { classifyCurrentCrm } = require('../src/lib/matrixCrmAdapter');

function parseArgs(argv) {
  const parsed = { includePrivatePreview: false, output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--include-private-preview') parsed.includePrivatePreview = true;
    else if (arg === '--output') {
      if (!argv[index + 1]) throw new Error('--output requires a path');
      parsed.output = argv[index += 1];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function authenticatedLocalOperator(db) {
  const token = process.env.MATRIX_LOCAL_OPERATOR_TOKEN;
  const secret = process.env.JWT_SECRET;
  if (!token || !secret || secret === 'change-this-in-production') return false;
  try {
    const payload = jwt.verify(token, secret);
    const id = Number(payload.sub);
    if (!Number.isInteger(id) || id <= 0) return false;
    const hasUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    if (!hasUsers) return false;
    const user = db.prepare('SELECT id, role, status FROM users WHERE id = ?').get(id);
    return Boolean(user
      && user.status === 'active'
      && ['super_admin', 'foreign_trade_crm_admin'].includes(user.role));
  } catch {
    return false;
  }
}

function workspaceOutputPath(value) {
  const workspace = fs.realpathSync(path.resolve(__dirname, '..'));
  const output = path.resolve(process.cwd(), value);
  if (output !== workspace && !output.startsWith(`${workspace}${path.sep}`)) {
    throw new Error('--output must stay inside the workspace');
  }
  if (path.dirname(output) !== workspace) {
    throw new Error('--output must be a file in the workspace root');
  }
  const outputEntry = fs.lstatSync(output, { throwIfNoEntry: false });
  if (outputEntry && (!outputEntry.isFile() || outputEntry.nlink !== 1)) {
    throw new Error('--output must be a single-link regular file');
  }
  let ancestor = path.dirname(output);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('--output has no existing parent');
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync(ancestor);
  if (realAncestor !== workspace && !realAncestor.startsWith(`${workspace}${path.sep}`)) {
    throw new Error('--output parent must stay inside the workspace');
  }
  return output;
}

function writeWorkspaceOutput(output, content) {
  const target = workspaceOutputPath(output);
  const workspace = fs.realpathSync(path.resolve(__dirname, '..'));
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
  const temporary = path.join(workspace, `.matrix-output-${process.pid}-${crypto.randomBytes(12).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, flags, 0o600);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1) throw new Error('temporary output is not a single-link regular file');
    fs.writeFileSync(fd, content, { encoding: 'utf8' });
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    if (fs.realpathSync(path.dirname(target)) !== workspace) {
      throw new Error('--output parent changed during write');
    }
    const destination = fs.lstatSync(target, { throwIfNoEntry: false });
    if (destination && (!destination.isFile() || destination.nlink !== 1)) {
      throw new Error('--output changed to a non-regular or linked file');
    }
    const staged = fs.lstatSync(temporary);
    if (!staged.isFile() || staged.nlink !== 1) throw new Error('temporary output changed during write');

    fs.renameSync(temporary, target);
    const directoryFd = fs.openSync(workspace, fs.constants.O_RDONLY);
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, '..', 'data', 'app.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  let report;
  try {
    const authenticated = authenticatedLocalOperator(db);
    if (args.includePrivatePreview && !authenticated) {
      throw new Error('private preview requires an authenticated local CRM administrator context');
    }
    report = classifyCurrentCrm(db, {
      includePrivatePreview: args.includePrivatePreview,
      authenticatedLocalOperator: authenticated,
      now: new Date().toISOString().slice(0, 10)
    });
  } finally {
    db.close();
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) writeWorkspaceOutput(args.output, json);
  process.stdout.write(json);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
