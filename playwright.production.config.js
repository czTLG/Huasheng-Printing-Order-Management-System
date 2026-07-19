const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/production',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  outputDir: process.env.PRODUCTION_SMOKE_OUTPUT_DIR || '/tmp/matrix-production-smoke-results',
  use: {
    baseURL: process.env.PRODUCTION_BASE_URL || 'https://cahs.top/new/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome',
      args: ['--no-sandbox'],
    },
  },
  projects: [
    { name: 'production-desktop', use: { viewport: { width: 1440, height: 900 } } },
    {
      name: 'production-mobile',
      use: { viewport: { width: 393, height: 873 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    },
  ],
});
