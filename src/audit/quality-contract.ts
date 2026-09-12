import type { AuditQualityContractMetadata, AuditSummary, EvidenceItem, Finding } from '../types.js';

export const AUDIT_QUALITY_CONTRACT_VERSION = '1.0.0';
export const WCAG_22_AA_CRITERION_COUNT = 55 as const;

export const AUDIT_QUALITY_CONTRACT: AuditQualityContractMetadata = {
  version: AUDIT_QUALITY_CONTRACT_VERSION,
  standard: 'WCAG 2.2',
  conformanceTarget: 'A/AA',
  criterionCount: WCAG_22_AA_CRITERION_COUNT,
  findingPolicy: 'evidence-gated'
};

const WCAG_CRITERION = /^\d\.\d\.\d{1,2}$/;

function validEvidence(item: EvidenceItem): boolean {
  return Boolean(item.kind && item.pageUrl.trim() && item.detail.trim());
}

export function confirmedFindingConfidenceFailures(finding: Finding): string[] {
  if (finding.classification !== 'confirmed') return [];

  const failures: string[] = [];
  if (!finding.wcag.length || finding.wcag.some((criterion) => !WCAG_CRITERION.test(criterion))) {
    failures.push('a valid WCAG criterion mapping');
  }
  if (!finding.urls.some((url) => url.trim())) failures.push('an affected URL');
  if (!finding.viewports.some((viewport) => viewport.trim())) failures.push('a tested viewport');
  if (!finding.selectors.some((selector) => selector.trim())) failures.push('a reproducible locator');
  if (!finding.testing.trim()) failures.push('reproduction steps');
  if (!finding.evidence.length || finding.evidence.some((item) => !validEvidence(item))) {
    failures.push('complete observed evidence');
  }

  if (finding.ruleId === 'axe-color-contrast') {
    const evidence = finding.evidence.map((item) => item.detail).join('\n');
    const hasMeasuredRatio = /contrast of\s+[\d.]+/i.test(evidence);
    const hasRequiredRatio = /expected contrast ratio of\s+[\d.]+:1/i.test(evidence);
    const hasColours = /foreground color:/i.test(evidence) && /background color:/i.test(evidence);
    if (!hasMeasuredRatio || !hasRequiredRatio || !hasColours) {
      failures.push('measured foreground, background, actual ratio, and required ratio');
    }
  }

  return failures;
}

/**
 * A confirmed row is an assertion of an observed failure, so it must satisfy the
 * contract before criterion decisions and reports are created. Uncertain rows
 * remain visible as review candidates and can never silently become failures.
 */
export function applyConfirmedFindingConfidenceGate(findings: Finding[]): Finding[] {
  return findings.map((finding) => {
    const failures = confirmedFindingConfidenceFailures(finding);
    if (!failures.length) return finding;
    const gateNote = `Confidence gate: confirmation was withheld because the result lacks ${failures.join(', ')}. Verify it manually before treating it as a failure.`;
    return {
      ...finding,
      classification: 'review',
      severity: 'Advisory',
      effort: 'Review',
      testing: finding.testing.trim() ? `${finding.testing.trim()}\n${gateNote}` : gateNote
    };
  });
}

export function assertAuditQualityContract(summary: AuditSummary): void {
  const errors: string[] = [];
  const standardCriteria = (summary.criteria ?? []).filter((criterion) => criterion.scope === 'standard');
  const criterionIds = new Set(standardCriteria.map((criterion) => criterion.criterion));
  const manualCriterionIds = new Set(summary.manualChecks.flatMap((check) => check.wcag));

  if (summary.qualityContract?.version !== AUDIT_QUALITY_CONTRACT_VERSION) errors.push('quality-contract version is missing or incorrect');
  if (summary.qualityContract?.criterionCount !== WCAG_22_AA_CRITERION_COUNT) errors.push('quality-contract criterion count is not 55');
  if (summary.conformanceTarget !== 'AA') errors.push('conformance target is not WCAG 2.2 AA');
  if (summary.humanAssessmentRequired !== true) errors.push('mandatory human assessment is not declared');
  if (summary.conformanceDecision !== 'not-determined') errors.push('the automated run attempted a conformance decision');
  if (standardCriteria.length !== WCAG_22_AA_CRITERION_COUNT || criterionIds.size !== WCAG_22_AA_CRITERION_COUNT) {
    errors.push(`standard criterion ledger contains ${criterionIds.size} unique criteria instead of 55`);
  }
  if (manualCriterionIds.size !== WCAG_22_AA_CRITERION_COUNT) {
    errors.push(`manual test plan maps ${manualCriterionIds.size} unique criteria instead of 55`);
  }

  for (const finding of summary.findings) {
    const failures = confirmedFindingConfidenceFailures(finding);
    if (failures.length) errors.push(`${finding.id ?? finding.key} bypassed the confidence gate: ${failures.join(', ')}`);
  }

  const findingsById = new Map(summary.findings.map((finding) => [finding.id ?? finding.key, finding]));
  for (const criterion of standardCriteria) {
    if (criterion.status === 'passed') errors.push(`${criterion.criterion} was marked passed by an automated audit`);
    if (criterion.status === 'failed' && !criterion.findingIds.some((id) => findingsById.get(id)?.classification === 'confirmed')) {
      errors.push(`${criterion.criterion} was marked failed without a confirmed finding`);
    }
  }

  if (errors.length) throw new Error(`Audit Quality Contract ${AUDIT_QUALITY_CONTRACT_VERSION} failed: ${errors.join('; ')}.`);
}
