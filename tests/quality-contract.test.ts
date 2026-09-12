import { describe, expect, it } from 'vitest';
import {
  applyConfirmedFindingConfidenceGate,
  assertAuditQualityContract,
  AUDIT_QUALITY_CONTRACT,
  WCAG_22_AA_CRITERION_COUNT
} from '../src/audit/quality-contract.js';
import { REQUIRED_MANUAL_CHECKS } from '../src/audit/manual-checks.js';
import { WCAG_CRITERIA_DEFINITIONS } from '../src/audit/wcag-criteria.js';
import type { AuditSummary, Finding } from '../src/types.js';

function confirmedFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'A11Y-001',
    key: 'button-name:one',
    ruleId: 'axe-button-name',
    classification: 'confirmed',
    severity: 'Serious',
    wcag: ['4.1.2'],
    summary: 'Button has no accessible name',
    issue: 'A visible button has no programmatic name.',
    impact: 'Screen-reader users cannot identify the button.',
    testing: 'Open the page, locate #save, and inspect its accessible name.',
    remediation: 'Give the button a concise accessible name.',
    component: '#save',
    urls: ['https://example.com/'],
    viewports: ['Desktop'],
    selectors: ['#save'],
    evidence: [{
      kind: 'axe',
      pageUrl: 'https://example.com/',
      viewport: 'Desktop',
      selector: '#save',
      detail: '<button id="save"></button>\nElement does not have text that is visible to screen readers'
    }],
    assignment: 'Development',
    effort: 'Small',
    translationRequired: 'No',
    ...overrides
  };
}

function compliantSummary(findings: Finding[] = []): AuditSummary {
  const criteria = WCAG_CRITERIA_DEFINITIONS
    .filter((criterion) => criterion.level === 'A' || criterion.level === 'AA')
    .map((criterion) => ({
      ...criterion,
      understandingUrl: `https://www.w3.org/WAI/WCAG22/Understanding/${criterion.slug}.html`,
      scope: 'standard' as const,
      status: 'manual-review-required' as const,
      findingIds: [] as string[],
      automatedEvidence: [] as string[],
      detail: 'Human assessment is required.'
    }));
  return {
    status: 'completed',
    generatedAt: '2026-09-12T12:00:00.000Z',
    auditor: 'Contract test',
    source: 'test',
    wcagLevel: 'AA',
    conformanceTarget: 'AA',
    humanAssessmentRequired: true,
    conformanceDecision: 'not-determined',
    qualityContract: { ...AUDIT_QUALITY_CONTRACT },
    landingPageUrl: 'https://example.com/',
    requestedUrls: ['https://example.com/'],
    auditedUrls: ['https://example.com/'],
    skippedUrls: [],
    pages: [],
    coverage: [],
    criteria,
    findings,
    manualChecks: REQUIRED_MANUAL_CHECKS,
    limitations: []
  };
}

describe('Audit Quality Contract', () => {
  it('defines all 55 WCAG 2.2 Level A and AA criteria', () => {
    const criteria = WCAG_CRITERIA_DEFINITIONS.filter((item) => item.level === 'A' || item.level === 'AA');
    expect(criteria).toHaveLength(WCAG_22_AA_CRITERION_COUNT);
    expect(new Set(REQUIRED_MANUAL_CHECKS.flatMap((check) => check.wcag)).size).toBe(WCAG_22_AA_CRITERION_COUNT);
  });

  it('keeps a confirmed result only when its evidence is reproducible', () => {
    expect(applyConfirmedFindingConfidenceGate([confirmedFinding()])[0]?.classification).toBe('confirmed');
  });

  it('downgrades a result that lacks evidence instead of reporting an honest failure', () => {
    const [finding] = applyConfirmedFindingConfidenceGate([confirmedFinding({ evidence: [] })]);
    expect(finding?.classification).toBe('review');
    expect(finding?.severity).toBe('Advisory');
    expect(finding?.testing).toContain('Confidence gate');
  });

  it('requires complete measured values before confirming text contrast', () => {
    const incomplete = confirmedFinding({
      ruleId: 'axe-color-contrast',
      wcag: ['1.4.3'],
      evidence: [{ kind: 'axe', pageUrl: 'https://example.com/', viewport: 'Desktop', detail: 'Potential contrast issue' }]
    });
    const complete = confirmedFinding({
      ruleId: 'axe-color-contrast',
      wcag: ['1.4.3'],
      evidence: [{
        kind: 'axe',
        pageUrl: 'https://example.com/',
        viewport: 'Desktop',
        detail: 'Element has insufficient color contrast of 2.5 (foreground color: #777777, background color: #ffffff, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1'
      }]
    });
    expect(applyConfirmedFindingConfidenceGate([incomplete])[0]?.classification).toBe('review');
    expect(applyConfirmedFindingConfidenceGate([complete])[0]?.classification).toBe('confirmed');
  });

  it('accepts a complete ledger and rejects missing criterion accountability', () => {
    const summary = compliantSummary();
    expect(() => assertAuditQualityContract(summary)).not.toThrow();
    summary.criteria = summary.criteria!.slice(1);
    expect(() => assertAuditQualityContract(summary)).toThrow(/instead of 55/);
  });
});
