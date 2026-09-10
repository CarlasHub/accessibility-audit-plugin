import { describe, expect, it } from 'vitest';
import { REQUIRED_MANUAL_CHECKS } from '../src/audit/manual-checks.js';
import { buildWcagCriterionLedger } from '../src/audit/wcag-criteria.js';

describe('WCAG 2.2 criterion ledger', () => {
  it('contains every unique WCAG 2.2 success criterion', () => {
    const ledger = buildWcagCriterionLedger([], [], REQUIRED_MANUAL_CHECKS, false);

    expect(ledger).toHaveLength(86);
    expect(new Set(ledger.map((entry) => entry.criterion))).toHaveLength(86);
    expect(ledger[0]?.criterion).toBe('1.1.1');
    expect(ledger.at(-1)?.criterion).toBe('4.1.3');
    expect(ledger.every((entry) => entry.understandingUrl.startsWith('https://www.w3.org/WAI/WCAG22/Understanding/'))).toBe(true);
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
});
