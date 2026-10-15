import { describe, expect, it } from 'vitest';
import type { AuditSummary, Finding } from '../src/types.js';
import { buildExecutiveSummary } from '../src/reporting/executive-summary.js';

function summary(overrides: Partial<AuditSummary> = {}): AuditSummary {
  return {
    status: 'completed',
    generatedAt: '2026-10-08T12:00:00.000Z',
    auditor: 'Automated',
    source: 'test',
    wcagLevel: 'AA',
    landingPageUrl: 'https://example.test/',
    requestedUrls: ['https://example.test/'],
    auditedUrls: ['https://example.test/'],
    skippedUrls: [],
    pages: [],
    coverage: [],
    findings: [],
    manualChecks: [],
    limitations: [],
    ...overrides
  };
}

function finding(classification: Finding['classification'], severity: Finding['severity'], wcag = ['1.1.1']): Finding {
  return {
    key: `${classification}-${severity}`,
    ruleId: 'test-rule',
    classification,
    severity,
    wcag,
    summary: 'Test finding',
    issue: 'Test issue',
    impact: 'Test impact',
    testing: 'Test procedure',
    remediation: 'Test remediation',
    component: 'test component',
    urls: ['https://example.test/'],
    viewports: ['desktop'],
    selectors: ['main'],
    evidence: [],
    assignment: 'Development',
    effort: 'Small',
    translationRequired: 'No'
  };
}

describe('executive report summary', () => {
  it('prioritises incomplete coverage ahead of confirmed findings', () => {
    const result = buildExecutiveSummary(summary({
      findings: [finding('confirmed', 'Critical'), finding('blocker', 'Serious')],
      pages: [{ url: 'https://example.test/', partial: true, viewports: [] }]
    }));

    expect(result.coverageIncomplete).toBe(true);
    expect(result.headline).toContain('Audit coverage is incomplete');
    expect(result.nextStep).toContain('Resolve coverage blockers');
    expect(result.currentPosition).toContain('1 partial page');
  });

  it('prioritises serious and critical confirmed barriers when coverage is complete', () => {
    const result = buildExecutiveSummary(summary({
      findings: [finding('confirmed', 'Serious'), finding('confirmed', 'Critical')]
    }));

    expect(result.seriousOrCriticalFindings).toBe(2);
    expect(result.headline).toBe('2 confirmed barriers rated Serious or Critical require priority remediation.');
    expect(result.nextStep).toContain('assign owners and due dates');
  });

  it('retains the human conformance decision when no barriers are confirmed', () => {
    const result = buildExecutiveSummary(summary());

    expect(result.headline).toContain('No confirmed barriers');
    expect(result.currentPosition).toContain('WCAG conformance remains not determined');
    expect(result.nextStep).toContain('qualified sign-off');
  });

  it('requires a rerun when the audit is cancelled', () => {
    const result = buildExecutiveSummary(summary({ status: 'cancelled' }));

    expect(result.headline).toContain('stopped before completion');
    expect(result.nextStep).toContain('rerun the audit before triage');
  });

  it('keeps AAA-only advisory findings out of AA headline counts', () => {
    const result = buildExecutiveSummary(summary({
      findings: [
        finding('confirmed', 'Critical', ['1.4.6']),
        finding('review', 'Moderate', ['2.4.8'])
      ]
    }));

    expect(result.standardFindings).toBe(0);
    expect(result.coreFindings).toBe(0);
    expect(result.supplementalFindings).toBe(0);
    expect(result.advisoryFindings).toBe(2);
    expect(result.confirmedFindings).toBe(0);
    expect(result.seriousOrCriticalFindings).toBe(0);
    expect(result.reviewCandidates).toBe(0);
    expect(result.headline).toContain('No confirmed barriers');
    expect(result.currentPosition).toContain('2 AAA advisory items are reported separately');
  });

  it('keeps non-WCAG checks actionable without calling them conformance findings', () => {
    const result = buildExecutiveSummary(summary({
      findings: [
        finding('confirmed', 'Serious', ['Best Practice']),
        finding('review', 'Moderate', [])
      ]
    }));

    expect(result.coreFindings).toBe(2);
    expect(result.standardFindings).toBe(0);
    expect(result.supplementalFindings).toBe(2);
    expect(result.advisoryFindings).toBe(0);
    expect(result.confirmedFindings).toBe(1);
    expect(result.reviewCandidates).toBe(1);
    expect(result.currentPosition).toContain('0 findings map to the WCAG A/AA target');
    expect(result.currentPosition).toContain('2 supporting audit checks are reported without being represented as a WCAG conformance result');
  });

  it('keeps mixed A/AA and AAA mappings in the AA conformance target', () => {
    const result = buildExecutiveSummary(summary({
      findings: [finding('confirmed', 'Serious', ['1.4.3', '1.4.6'])]
    }));

    expect(result.standardFindings).toBe(1);
    expect(result.coreFindings).toBe(1);
    expect(result.advisoryFindings).toBe(0);
    expect(result.confirmedFindings).toBe(1);
  });
});
