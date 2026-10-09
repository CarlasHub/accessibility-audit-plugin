import { describe, expect, it } from 'vitest';
import { buildTopActions } from '../src/reporting/finding-actions.js';
import type { AuditSummary, Finding, FindingClassification, Severity } from '../src/types.js';

function finding(
  classification: FindingClassification,
  severity: Severity,
  index: number,
  urls = [`https://example.test/page-${index}`]
): Finding {
  return {
    key: `${classification}-${severity}-${index}`,
    ruleId: `rule-${index}`,
    classification,
    severity,
    wcag: ['1.1.1'],
    summary: `${classification} ${severity} ${index}`,
    issue: 'An accessibility issue needs attention.',
    impact: 'Some people may be unable to complete the task.',
    testing: `Test step ${index}.`,
    remediation: `Fix step ${index}.`,
    component: 'test component',
    urls,
    viewports: ['desktop'],
    selectors: [`#item-${index}`],
    evidence: [],
    assignment: 'Development',
    effort: 'Small',
    translationRequired: 'No'
  };
}

function summary(findings: Finding[]): AuditSummary {
  return {
    status: 'completed',
    generatedAt: '2026-10-08T12:00:00.000Z',
    auditor: 'CarlasHub',
    source: 'top-actions regression',
    wcagLevel: 'AA',
    landingPageUrl: 'https://example.test/',
    requestedUrls: ['https://example.test/'],
    auditedUrls: ['https://example.test/'],
    skippedUrls: [],
    pages: [],
    coverage: [],
    findings,
    manualChecks: [],
    limitations: []
  };
}

describe('top actions', () => {
  it('prioritises blockers, then confirmed severity, review, and manual work', () => {
    const findings = [
      finding('manual', 'Critical', 1),
      finding('confirmed', 'Serious', 2),
      finding('review', 'Critical', 3),
      finding('blocker', 'Minor', 4),
      finding('confirmed', 'Critical', 5)
    ];

    expect(buildTopActions(summary(findings), 5).map((action) => action.finding.key)).toEqual([
      'blocker-Minor-4',
      'confirmed-Critical-5',
      'confirmed-Serious-2',
      'review-Critical-3',
      'manual-Critical-1'
    ]);
  });

  it('preserves source finding identities, deduplicates page counts, and does not mutate input', () => {
    const findings = [
      finding('confirmed', 'Moderate', 1),
      finding('review', 'Moderate', 2),
      finding('blocker', 'Serious', 3, [
        'https://example.test/blocked',
        'https://example.test/blocked',
        'https://example.test/other'
      ])
    ];
    const originalOrder = findings.map((item) => item.key);
    const actions = buildTopActions(summary(findings));

    expect(actions[0]).toEqual(expect.objectContaining({
      id: 'A11Y003',
      sourceIndex: 2,
      affectedPageCount: 2,
      conciseClassificationLabel: 'Blocker',
      classificationLabel: 'Coverage blocker (not a conformance result)',
      priorityLabel: 'Coverage blocked'
    }));
    expect(findings.map((item) => item.key)).toEqual(originalOrder);
  });

  it('uses evidence-specific next steps and honours safe limits', () => {
    const findings = [
      finding('confirmed', 'Serious', 1),
      finding('review', 'Moderate', 2),
      finding('blocker', 'Moderate', 3),
      finding('manual', 'Moderate', 4)
    ];
    const actions = buildTopActions(summary(findings), 4);

    expect(actions.find((action) => action.finding.classification === 'confirmed')?.nextStep).toBe('Fix step 1.');
    expect(actions.find((action) => action.finding.classification === 'review')?.nextStep).toBe('Test step 2.');
    expect(actions.find((action) => action.finding.classification === 'blocker')?.nextStep).toBe('Fix step 3. Then rerun the affected scope.');
    expect(actions.find((action) => action.finding.classification === 'manual')?.nextStep).toBe('Test step 4.');
    expect(buildTopActions(summary(findings), 2)).toHaveLength(2);
    expect(buildTopActions(summary(findings), -1)).toEqual([]);
    expect(buildTopActions(summary(findings), Number.NaN)).toEqual([]);
    expect(buildTopActions(summary([]))).toEqual([]);
  });
});
