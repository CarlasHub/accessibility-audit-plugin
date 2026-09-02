import { describe, expect, it } from 'vitest';
import { createBrowserLaunchOptions } from '../src/audit/runner.js';

describe('browser launch isolation', () => {
  it('keeps normal checks headless without surrendering graceful signal handling', () => {
    const normal = createBrowserLaunchOptions({ channel: 'chrome' }, true);

    expect(normal).toEqual(expect.objectContaining({
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      channel: 'chrome'
    }));
  });
});
