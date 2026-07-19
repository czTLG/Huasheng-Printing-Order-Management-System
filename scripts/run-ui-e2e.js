const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-ui-e2e-'));
const port = Number(process.env.E2E_PORT || 19086);
const baseUrl = `http://127.0.0.1:${port}`;
let service;
let serviceLog = '';

function fail(message) {
  if (serviceLog) process.stderr.write(`\n--- service log ---\n${serviceLog}\n`);
  throw new Error(message);
}

async function waitForService(timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (service?.exitCode !== null) fail(`Test service exited with code ${service.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (_) {
      // The service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail('Timed out waiting for the test service');
}

async function main() {
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: path.join(root, 'frontend-next'),
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=2048' },
  });
  if (build.status !== 0) process.exit(build.status || 1);

  service = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(scratch, 'app.db'),
      DISABLE_CRON: '1',
      FORCE_HTTPS: '0',
      NODE_ENV: 'test',
      JWT_SECRET: 'matrix-ui-e2e-secret-with-sufficient-length-2026',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  for (const stream of [service.stdout, service.stderr]) {
    stream.on('data', (chunk) => {
      serviceLog += chunk.toString();
    });
  }

  await waitForService();
  const passwordMatch = serviceLog.match(/password=([^\s]+)/);
  if (!passwordMatch) fail('Could not discover the temporary admin password');

  const test = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['playwright', 'test', ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_BASE_URL: `${baseUrl}/new/`,
        E2E_USERNAME: 'admin',
        E2E_PASSWORD: passwordMatch[1],
        E2E_OUTPUT_DIR: path.join(scratch, 'results'),
      },
    },
  );
  process.exitCode = test.status || 0;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (service && service.exitCode === null) service.kill('SIGTERM');
    if (process.exitCode) {
      console.error(`E2E failure artifacts retained at ${scratch}`);
    } else {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
