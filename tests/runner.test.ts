import { describe, expect, it } from 'vitest';
import {
  createBrowserLaunchOptions,
  needsFullPageScreenshotFallback,
  screenshotCandidatesForFindings
} from '../src/audit/runner.js';
import type { Finding } from '../src/types.js';

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

describe('screenshot evidence selection', () => {
  it('captures only selectors supplied by confirmed failures and blockers', () => {
    const base: Finding = {
      key: 'confirmed',
      ruleId: 'test',
      classification: 'confirmed',
      severity: 'Serious',
      wcag: ['1.1.1'],
      summary: 'Confirmed issue',
      issue: 'Issue',
      impact: 'Impact',
      testing: 'Testing',
      remediation: 'Fix it.',
      component: 'component',
      urls: ['https://preview.example.test/'],
      viewports: ['desktop'],
      selectors: ['#confirmed'],
      evidence: [],
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'No'
    };
    const blocker = { ...base, key: 'blocker', classification: 'blocker' as const, selectors: ['#blocker'] };
    const review = { ...base, key: 'review', classification: 'review' as const, selectors: ['#review'] };
    expect(screenshotCandidatesForFindings([base, blocker, review])).toEqual(['#confirmed', '#blocker']);
    expect(needsFullPageScreenshotFallback([base], [{ selector: '#confirmed', path: '/tmp/confirmed.png' }])).toBe(false);
    expect(needsFullPageScreenshotFallback([base], [])).toBe(true);
    expect(needsFullPageScreenshotFallback([{ ...blocker, selectors: [] }], [])).toBe(true);
    expect(needsFullPageScreenshotFallback([review], [])).toBe(false);
  });
});
