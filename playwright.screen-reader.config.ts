import { devices, type PlaywrightTestConfig } from '@playwright/test';
import { screenReaderConfig } from '@guidepup/playwright';

const screenReader = process.env.A11Y_SCREEN_READER?.toLowerCase();
const isNvda = screenReader === 'nvda';

const config: PlaywrightTestConfig = {
  ...screenReaderConfig,
  testDir: './tests/screen-reader',
  testMatch: isNvda ? 'nvda.spec.ts' : 'voiceover.spec.ts',
  timeout: 5 * 60 * 1000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'screen-reader-playwright-report', open: 'never' }]],
  projects: [
    {
      name: isNvda ? 'nvda-firefox' : 'voiceover-webkit',
      use: {
        ...(isNvda ? devices['Desktop Firefox'] : devices['Desktop Safari']),
        headless: false,
        trace: 'retain-on-failure'
      }
    }
  ]
};

export default config;
