const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { db, initDb, now } = require('../src/db');

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parseArgs(argv) {
  const args = { pending: false, limit: 10, id: 0 };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--pending') { args.pending = true; continue; }
    if (key === '--limit' && next) { args.limit = Number(next) || 10; i += 1; continue; }
    if (key === '--id' && next) { args.id = Number(next) || 0; i += 1; continue; }
  }
  return args;
}

function findCodexCommand() {
  const variants = [
    ['codex', ['exec']],
    ['codex', []]
  ];
  for (const [cmd, args] of variants) {
    const probe = spawnSync(cmd, [...args, '--help'], { encoding: 'utf8' });
    if (probe.status === 0 || !probe.error) return { cmd, baseArgs: args };
  }
  return null;
}

function runPrompt(run, codexCommand) {
  const outputDir = path.join(__dirname, '..', 'data', 'email-ai-outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${run.run_code}.json`);
  const prompt = fs.readFileSync(run.prompt_path, 'utf8');
  const args = codexCommand.baseArgs.length
    ? [...codexCommand.baseArgs, '-', '--output-last-message', outputPath, '--cd', path.join(__dirname, '..')]
    : ['exec', '-', '--output-last-message', outputPath, '--cd', path.join(__dirname, '..')];
  const result = spawnSync(codexCommand.cmd, args, { encoding: 'utf8', input: prompt });
  if (result.status !== 0) {
    const message = text(result.stderr || result.stdout || result.error?.message || 'Codex CLI execution failed');
    throw new Error(message);
  }
  const output = text(fs.readFileSync(outputPath, 'utf8'));
  JSON.parse(output);
  return outputPath;
}

function main() {
  initDb();
  const args = parseArgs(process.argv);
  let runs = [];
  if (args.id > 0) {
    const row = db.prepare(`SELECT * FROM email_ai_analysis_runs WHERE id = ?`).get(args.id);
    if (row) runs = [row];
  } else if (args.pending) {
    runs = db.prepare(`
      SELECT * FROM email_ai_analysis_runs
      WHERE status = 'prompt_ready'
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(args.limit);
  }

  const codexCommand = findCodexCommand();
  if (!codexCommand) {
    console.log(JSON.stringify({
      ok: false,
      error: 'Codex CLI not available on this machine.',
      manual_commands: runs.map((run) => `codex exec --input ${run.prompt_path} > data/email-ai-outputs/${run.run_code}.json`)
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const completed = [];
  for (const run of runs) {
    const startedAt = now();
    db.prepare(`UPDATE email_ai_analysis_runs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`).run(startedAt, startedAt, run.id);
    try {
      const outputPath = runPrompt(run, codexCommand);
      const resultJson = fs.readFileSync(outputPath, 'utf8');
      db.prepare(`
        UPDATE email_ai_analysis_runs
        SET status = 'completed', output_path = ?, result_json = ?, finished_at = ?, updated_at = ?
        WHERE id = ?
      `).run(outputPath, resultJson, now(), now(), run.id);
      completed.push({ id: run.id, run_code: run.run_code, output_path: outputPath, status: 'completed' });
    } catch (err) {
      db.prepare(`
        UPDATE email_ai_analysis_runs
        SET status = 'failed', error_message = ?, finished_at = ?, updated_at = ?
        WHERE id = ?
      `).run(text(err.message), now(), now(), run.id);
      completed.push({ id: run.id, run_code: run.run_code, status: 'failed', error_message: text(err.message) });
    }
  }
  console.log(JSON.stringify({ ok: true, runs: completed }, null, 2));
}

main();
