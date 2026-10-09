import type { AuditSummary, Finding } from '../types.js';

export interface ExecutiveSummary {
  headline: string;
  currentPosition: string;
  nextStep: string;
  confirmedFindings: number;
  seriousOrCriticalFindings: number;
  reviewCandidates: number;
  coverageBlockers: number;
  partialPages: number;
  skippedUrls: number;
  unresolvedCriteria: number;
  coverageIncomplete: boolean;
}

function findingCount(summary: AuditSummary, predicate: (finding: Finding) => boolean): number {
  return summary.findings.filter(predicate).length;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function buildExecutiveSummary(summary: AuditSummary): ExecutiveSummary {
  const confirmedFindings = findingCount(summary, (finding) => finding.classification === 'confirmed');
  const seriousOrCriticalFindings = findingCount(
    summary,
    (finding) => finding.classification === 'confirmed'
      && (finding.severity === 'Critical' || finding.severity === 'Serious')
  );
  const reviewCandidates = findingCount(summary, (finding) => finding.classification === 'review');
  const coverageBlockers = findingCount(summary, (finding) => finding.classification === 'blocker');
  const partialPages = summary.pages.filter((page) => page.partial).length;
  const skippedUrls = summary.skippedUrls.length;
  const unresolvedCriteria = (summary.criteria ?? []).filter(
    (criterion) => criterion.scope === 'standard'
      && ['manual-review-required', 'inconclusive'].includes(criterion.status)
  ).length;
  const unauditedUrls = Math.max(0, summary.requestedUrls.length - summary.auditedUrls.length);
  const coverageIncomplete = summary.status !== 'completed'
    || coverageBlockers > 0
    || partialPages > 0
    || skippedUrls > 0
    || unauditedUrls > 0;

  let headline: string;
  let nextStep: string;
  if (summary.status !== 'completed') {
    headline = 'The audit stopped before completion, so every result must be treated as partial.';
    nextStep = 'Resolve the interruption, confirm the approved scope, and rerun the audit before triage.';
  } else if (coverageIncomplete) {
    headline = 'Audit coverage is incomplete, so resolve the gaps before drawing conclusions from the results.';
    nextStep = 'Resolve coverage blockers, partial pages, and skipped or unaudited URLs, then rerun the affected scope.';
  } else if (seriousOrCriticalFindings > 0) {
    headline = `${plural(seriousOrCriticalFindings, 'confirmed barrier')} rated Serious or Critical ${seriousOrCriticalFindings === 1 ? 'requires' : 'require'} priority remediation.`;
    nextStep = 'Prioritise confirmed Serious and Critical barriers, assign owners and due dates, then retest the fixes.';
  } else if (confirmedFindings > 0) {
    headline = `${plural(confirmedFindings, 'confirmed barrier')} ${confirmedFindings === 1 ? 'requires' : 'require'} remediation and verification.`;
    nextStep = 'Assign the confirmed barriers for remediation, then retest each fix before human sign-off.';
  } else if (reviewCandidates > 0 || unresolvedCriteria > 0) {
    headline = 'No confirmed barriers were recorded, but unresolved evidence still requires qualified human review.';
    nextStep = 'Validate review candidates and unresolved WCAG criteria, recording evidence and a human verdict for each.';
  } else {
    headline = 'No confirmed barriers were recorded in the completed automated scope.';
    nextStep = 'Complete the applicable human checks and qualified sign-off before making any conformance claim.';
  }

  const currentPosition = [
    `Coverage reached ${summary.auditedUrls.length} of ${summary.requestedUrls.length} requested URLs`,
    `with ${plural(partialPages, 'partial page')} and ${plural(skippedUrls, 'skipped URL')}.`,
    `The report contains ${plural(confirmedFindings, 'confirmed finding')}, ${plural(reviewCandidates, 'review candidate')}, and ${plural(coverageBlockers, 'coverage blocker')}.`,
    'WCAG conformance remains not determined pending qualified human assessment.'
  ].join(' ');

  return {
    headline,
    currentPosition,
    nextStep,
    confirmedFindings,
    seriousOrCriticalFindings,
    reviewCandidates,
    coverageBlockers,
    partialPages,
    skippedUrls,
    unresolvedCriteria,
    coverageIncomplete
  };
}
