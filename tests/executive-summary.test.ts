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

function finding(classification: Finding['classification'], severity: Finding['severity']): Finding {
  return {
    key: `${classification}-${severity}`,
    ruleId: 'test-rule',
    classification,
    severity,
    wcag: ['1.1.1'],
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
});
