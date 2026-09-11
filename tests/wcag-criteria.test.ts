import { describe, expect, it } from 'vitest';
import { REQUIRED_MANUAL_CHECKS } from '../src/audit/manual-checks.js';
import { buildWcagCriterionLedger } from '../src/audit/wcag-criteria.js';
import type { Finding } from '../src/types.js';

function mappedFinding(classification: Finding['classification']): Finding {
  return {
    key: `criterion-semantics:${classification}`,
    ruleId: 'criterion-semantics',
    classification,
    severity: 'Serious',
    wcag: ['4.1.2'],
    summary: `${classification} result`,
    issue: 'A test result was recorded.',
    impact: 'The result needs the correct interpretation.',
    testing: 'Review the test evidence.',
    remediation: 'Resolve confirmed accessibility failures.',
    component: 'test component',
    componentName: 'Test component',
    urls: ['https://test.example/page'],
    viewports: ['desktop'],
    selectors: ['#test'],
    evidence: [{ kind: 'manual', pageUrl: 'https://test.example/page', detail: 'Classification evidence.' }],
    assignment: 'QA',
    effort: 'Small',
    translationRequired: 'No'
  };
}

describe('WCAG 2.2 criterion ledger', () => {
  it('contains every unique WCAG 2.2 success criterion', () => {
    const ledger = buildWcagCriterionLedger([], [], REQUIRED_MANUAL_CHECKS, false);

    expect(ledger).toHaveLength(86);
    expect(new Set(ledger.map((entry) => entry.criterion))).toHaveLength(86);
    expect(ledger[0]?.criterion).toBe('1.1.1');
    expect(ledger.at(-1)?.criterion).toBe('4.1.3');
    expect(ledger.every((entry) => entry.understandingUrl.startsWith('https://www.w3.org/WAI/WCAG22/Understanding/'))).toBe(true);
  });

  it('provides a dedicated human procedure and evidence prompt for every A/AA criterion', () => {
    const expected = buildWcagCriterionLedger([], [], [], false)
      .filter((entry) => entry.level !== 'AAA')
      .map((entry) => entry.criterion);
    const mapped = REQUIRED_MANUAL_CHECKS.flatMap((check) => check.wcag);

    expect(expected).toHaveLength(55);
    expect(REQUIRED_MANUAL_CHECKS).toHaveLength(55);
    expect(mapped).toHaveLength(55);
    expect(new Set(mapped)).toEqual(new Set(expected));
    expect(REQUIRED_MANUAL_CHECKS.every((check) => check.wcag.length === 1)).toBe(true);
    expect(REQUIRED_MANUAL_CHECKS.every((check) => Boolean(check.procedure && check.expectedEvidence))).toBe(true);
  });

  it('keeps AAA outside the AA target unless advisory checks are enabled', () => {
    const standard = buildWcagCriterionLedger([], [], REQUIRED_MANUAL_CHECKS, false);
    const advisory = buildWcagCriterionLedger([], [], REQUIRED_MANUAL_CHECKS, true);
    const standardAaa = standard.filter((entry) => entry.level === 'AAA');
    const advisoryAaa = advisory.filter((entry) => entry.level === 'AAA');

    expect(standardAaa.length).toBeGreaterThan(0);
    expect(standardAaa.every((entry) => entry.scope === 'advisory' && entry.status === 'not-applicable')).toBe(true);
    expect(advisoryAaa.every((entry) => entry.scope === 'advisory' && entry.status !== 'not-applicable')).toBe(true);
  });

  it('does not claim an automated pass when human review is still required', () => {
    const ledger = buildWcagCriterionLedger([], [], REQUIRED_MANUAL_CHECKS, true);

    expect(ledger.some((entry) => entry.status === 'manual-review-required')).toBe(true);
    expect(ledger.some((entry) => entry.status === 'inconclusive')).toBe(true);
    expect(ledger.some((entry) => entry.status === 'passed')).toBe(false);
  });

  it('only treats confirmed findings as criterion failures', () => {
    for (const classification of ['review', 'blocker'] as const) {
      const criterion = buildWcagCriterionLedger(
        [],
        [mappedFinding(classification)],
        REQUIRED_MANUAL_CHECKS,
        false
      ).find((entry) => entry.criterion === '4.1.2');

      expect(criterion?.status).toBe('inconclusive');
      expect(criterion?.findingIds).toHaveLength(1);
      expect(criterion?.detail).toContain('need qualified human review');
    }

    const failedCriterion = buildWcagCriterionLedger(
      [],
      [mappedFinding('confirmed')],
      REQUIRED_MANUAL_CHECKS,
      false
    ).find((entry) => entry.criterion === '4.1.2');

    expect(failedCriterion?.status).toBe('failed');
    expect(failedCriterion?.findingIds).toHaveLength(1);
  });
});
