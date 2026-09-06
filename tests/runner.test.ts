import { describe, expect, it } from 'vitest';
import {
  browserLaunchCandidates,
  createBrowserLaunchOptions,
  isMissingBrowserExecutableError,
  needsFullPageScreenshotFallback,
  retainRepresentativeScreenshotPerFinding,
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

  it('tries bundled Chromium and supported system channels when no browser is explicit', () => {
    expect(browserLaunchCandidates({}, true)).toEqual([
      expect.objectContaining({ headless: true }),
      expect.objectContaining({ headless: true, channel: 'chrome' }),
      expect.objectContaining({ headless: true, channel: 'msedge' })
    ]);
  });

  it('does not silently replace an explicitly selected browser', () => {
    expect(browserLaunchCandidates({ channel: 'chrome' }, false)).toEqual([
      expect.objectContaining({ headless: false, channel: 'chrome' })
    ]);
  });

  it('distinguishes missing browser installations from unrelated launch failures', () => {
    expect(isMissingBrowserExecutableError(new Error("Executable doesn't exist at /browser/chromium"))).toBe(true);
    expect(isMissingBrowserExecutableError(new Error('Please run the following command to download new browsers: npx playwright install'))).toBe(true);
    expect(isMissingBrowserExecutableError(new Error("Chromium distribution 'chrome' is not found at /Applications/Google Chrome"))).toBe(true);
    expect(isMissingBrowserExecutableError(new Error('Target page, context or browser has been closed'))).toBe(false);
  });
});

describe('screenshot evidence selection', () => {
  it('prioritizes blockers, then confirmed failures, then review findings', () => {
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
    expect(screenshotCandidatesForFindings([base, blocker, review])).toEqual(['#blocker', '#confirmed', '#review']);
    expect(needsFullPageScreenshotFallback([base], [{ selector: '#confirmed', path: '/tmp/confirmed.png' }])).toBe(false);
    expect(needsFullPageScreenshotFallback([base], [])).toBe(false);
    expect(needsFullPageScreenshotFallback([{ ...blocker, selectors: [] }], [])).toBe(true);
    expect(needsFullPageScreenshotFallback([review], [])).toBe(false);
  });

  it('takes one representative component selector per finding and caps capture volume', () => {
    const findings = Array.from({ length: 15 }, (_, index): Finding => ({
      key: `review-${String(index).padStart(2, '0')}`,
      ruleId: 'review-rule',
      classification: 'review',
      severity: 'Moderate',
      wcag: ['Best Practice'],
      summary: 'Review issue',
      issue: 'Issue',
      impact: 'Impact',
      testing: 'Testing',
      remediation: 'Fix it.',
      component: `component-${index}`,
      urls: ['https://preview.example.test/'],
      viewports: ['desktop'],
      selectors: [`#component-${index}`, `#occurrence-${index}`],
      evidence: [],
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'No'
    }));

    expect(screenshotCandidatesForFindings(findings)).toEqual(
      Array.from({ length: 12 }, (_, index) => `#component-${index}`)
    );
  });

  it('retains at most one representative screenshot on each final reporting unit', () => {
    const finding: Finding = {
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
      viewports: ['desktop', 'mobile'],
      selectors: ['#first', '#second'],
      evidence: [
        { kind: 'dom', pageUrl: 'https://preview.example.test/', selector: '#first', detail: 'first', screenshot: '/tmp/first.png' },
        { kind: 'dom', pageUrl: 'https://preview.example.test/', selector: '#second', detail: 'second', screenshot: '/tmp/second.png' },
        { kind: 'dom', pageUrl: 'https://preview.example.test/', selector: '#third', detail: 'third' }
      ],
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'No'
    };

    retainRepresentativeScreenshotPerFinding([finding]);
    expect(finding.evidence.map((item) => item.screenshot)).toEqual(['/tmp/first.png', undefined, undefined]);
  });
});
