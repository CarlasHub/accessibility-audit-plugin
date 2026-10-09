import type {
  AuditCheckId,
  AuditQualityContractMetadata,
  AuditSummary,
  CollectionOutcome,
  Finding,
  PageAudit,
  ViewportAudit
} from '../types.js';

export const AUDIT_CHECK_IDS: AuditCheckId[] = [
  'navigation',
  'axe',
  'dom',
  'keyboard',
  'disclosures',
  'tabs',
  'responsive',
  'links',
  'journeys',
  'element-context',
  'screenshots'
];

type Guarantee = NonNullable<AuditQualityContractMetadata['guarantees']>[number];

function hasGuarantee(summary: AuditSummary, guarantee: Guarantee): boolean {
  return summary.qualityContract?.guarantees?.includes(guarantee) === true;
}

function outcomeErrors(outcome: CollectionOutcome, label: string): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(outcome.observationCount) || outcome.observationCount < 0) {
    errors.push(`${label} has an invalid observation count`);
  }
  if (outcome.status === 'completed' && (outcome.error || outcome.blockedBy)) {
    errors.push(`${label} is completed but also records an error or blocker`);
  }
  if (outcome.status === 'failed' && (!outcome.error?.trim() || outcome.blockedBy)) {
    errors.push(`${label} failed without exactly one explicit error`);
  }
  if (outcome.status === 'blocked' && (!outcome.blockedBy?.trim() || outcome.error)) {
    errors.push(`${label} is blocked without exactly one explicit dependency`);
  }
  if ((outcome.status === 'not-applicable' || outcome.status === 'not-run') && (outcome.error || outcome.blockedBy)) {
    errors.push(`${label} is ${outcome.status} but also records an error or blocker`);
  }
  if ((outcome.status === 'failed' || outcome.status === 'not-applicable' || outcome.status === 'not-run')
    && outcome.observationCount !== 0) {
    errors.push(`${label} is ${outcome.status} but records retained observations`);
  }
  return errors;
}

function collectionCompletenessErrors(pages: PageAudit[]): string[] {
  const errors: string[] = [];
  for (const page of pages) {
    if (!page.viewports.length) errors.push(`${page.url} has no collected viewports`);
    for (const viewport of page.viewports) {
      const label = `${page.url} ${viewport.viewport.name}`;
      const outcomes = viewport.collectionOutcomes;
      if (!outcomes) {
        errors.push(`${label} has no collector outcomes`);
        continue;
      }
      const ids = outcomes.map((outcome) => outcome.checkId);
      if (ids.length !== AUDIT_CHECK_IDS.length || new Set(ids).size !== AUDIT_CHECK_IDS.length
        || AUDIT_CHECK_IDS.some((checkId) => !ids.includes(checkId))) {
        errors.push(`${label} does not contain exactly one outcome for every collector`);
      }
      for (const outcome of outcomes) errors.push(...outcomeErrors(outcome, `${label} ${outcome.checkId}`));
      if (!viewport.cancelled && outcomes.some((outcome) => outcome.status === 'not-run')) {
        errors.push(`${label} completed with one or more collectors still not-run`);
      }
    }
  }
  return errors;
}

/** Enforces collection completeness before raw observations enter classification. */
export function assertCollectionCompleteness(pages: PageAudit[]): void {
  const errors = collectionCompletenessErrors(pages);
  if (errors.length) throw new Error(`Audit collection is incomplete: ${errors.join('; ')}.`);
}

function viewportKey(pageUrl: string, viewportName: string): string {
  return JSON.stringify([pageUrl, viewportName]);
}

function viewportIndex(summary: AuditSummary): Map<string, ViewportAudit> {
  const index = new Map<string, ViewportAudit>();
  for (const page of summary.pages) {
    for (const viewport of page.viewports) {
      for (const url of new Set([page.url, viewport.url, viewport.finalUrl])) {
        if (url) index.set(viewportKey(url, viewport.viewport.name), viewport);
      }
    }
  }
  return index;
}

function validateFindingEvidence(finding: Finding, viewports: Map<string, ViewportAudit>): string[] {
  const label = finding.id ?? finding.key;
  const errors: string[] = [];
  if (!finding.evidence.length) return [`${label} has no retained evidence`];

  for (const [index, item] of finding.evidence.entries()) {
    const evidenceLabel = `${label} evidence ${index + 1}`;
    const provenance = item.provenance;
    if (!provenance) {
      errors.push(`${evidenceLabel} has no provenance`);
      continue;
    }
    for (const [field, value] of Object.entries({
      observationId: provenance.observationId,
      ruleId: provenance.ruleId,
      state: provenance.state,
      target: provenance.target,
      observed: provenance.observed,
      expected: provenance.expected
    })) {
      if (!value.trim()) errors.push(`${evidenceLabel} has an empty provenance ${field}`);
    }
    if (provenance.observed !== item.detail) {
      errors.push(`${evidenceLabel} observed value does not match its evidence detail`);
    }
    const viewportName = item.viewport ?? finding.viewports[0] ?? '';
    const viewport = viewports.get(viewportKey(item.pageUrl, viewportName));
    if (!viewport) {
      errors.push(`${evidenceLabel} does not map to a collected page and viewport`);
      continue;
    }
    const outcome = viewport.collectionOutcomes?.find((candidate) => candidate.checkId === provenance.checkId);
    if (!outcome) {
      errors.push(`${evidenceLabel} does not map to a collector outcome`);
      continue;
    }
    const allowed = outcome.status === 'completed'
      || (finding.classification === 'blocker' && (outcome.status === 'failed' || outcome.status === 'blocked'));
    if (!allowed) {
      errors.push(`${evidenceLabel} relies on a collector with status ${outcome.status}`);
    } else if (outcome.status === 'completed' && outcome.observationCount === 0) {
      errors.push(`${evidenceLabel} relies on a completed collector that recorded no observations`);
    }
  }
  return errors;
}

function validateJourneyResults(summary: AuditSummary): string[] {
  const errors: string[] = [];
  for (const page of summary.pages) {
    for (const viewport of page.viewports) {
      for (const journey of viewport.keyboard.journeys.filter((item) => item.source === 'configured')) {
        const label = `${page.url} ${viewport.viewport.name} journey ${journey.id}`;
        if (!journey.stepResults?.length) {
          errors.push(`${label} has no structured step results`);
          continue;
        }
        for (const [index, step] of journey.stepResults.entries()) {
          if (step.index !== index + 1) errors.push(`${label} has non-contiguous step indexes`);
          if (!step.target.trim() || !step.expected.trim() || !step.observed.trim()) {
            errors.push(`${label} step ${step.index} has incomplete evidence`);
          }
        }
        if (journey.status === 'failed' || journey.status === 'inconclusive') {
          const stoppedStep = journey.stepResults.find((step) => step.status === 'failed' || step.status === 'inconclusive');
          if (stoppedStep && journey.failureStep !== stoppedStep.index) {
            errors.push(`${label} does not identify its failure or incomplete step`);
          }
        }
      }
    }
  }
  return errors;
}

function validateAuditHistory(summary: AuditSummary): string[] {
  const history = summary.history;
  if (!history) return [];
  const errors: string[] = [];
  if (history.kind !== 'audit-history') errors.push('history has an unsupported kind');
  if (history.points.length < 2) errors.push('history does not contain a prior audit and the current audit');
  if (history.limitations.some((limitation) => typeof limitation !== 'string' || !limitation.trim())) {
    errors.push('history contains an empty limitation');
  }

  let previousTime = Number.NEGATIVE_INFINITY;
  const sources = new Set<string>();
  for (const [index, point] of history.points.entries()) {
    const label = `history point ${index + 1}`;
    const time = Date.parse(point.generatedAt);
    if (!Number.isFinite(time)) errors.push(`${label} has an invalid timestamp`);
    if (time < previousTime) errors.push('history points are not chronological');
    previousTime = time;
    if (!point.source.trim() || /[\\/]/.test(point.source)) errors.push(`${label} has an invalid source label`);
    if (sources.has(point.source)) errors.push('history source labels are not unique');
    sources.add(point.source);
    if (point.status !== 'completed' && point.status !== 'cancelled') errors.push(`${label} has an invalid status`);
    if (point.browserEngine !== undefined && !['chromium', 'firefox', 'webkit'].includes(point.browserEngine)) {
      errors.push(`${label} has an invalid browser engine`);
    }
    for (const [name, count] of Object.entries({
      requestedPageCount: point.requestedPageCount,
      auditedPageCount: point.auditedPageCount,
      findingCount: point.findingCount,
      confirmedCount: point.confirmedCount,
      reviewCount: point.reviewCount,
      blockerCount: point.blockerCount,
      manualCount: point.manualCount,
      criticalConfirmedCount: point.criticalConfirmedCount,
      seriousConfirmedCount: point.seriousConfirmedCount
    })) {
      if (!Number.isInteger(count) || count < 0) errors.push(`${label} has an invalid ${name}`);
    }
    if (point.auditedPageCount > point.requestedPageCount) errors.push(`${label} audits more pages than requested`);
    if (point.confirmedCount + point.reviewCount + point.blockerCount + point.manualCount !== point.findingCount) {
      errors.push(`${label} classification counts do not equal its finding count`);
    }
    if (point.criticalConfirmedCount + point.seriousConfirmedCount > point.confirmedCount) {
      errors.push(`${label} severity counts exceed its confirmed finding count`);
    }

    const comparison = point.comparisonToPrevious;
    if (index === 0 && comparison) errors.push('the first history point has a comparison');
    if (index > 0 && !comparison) errors.push(`${label} has no comparison to its predecessor`);
    if (comparison) {
      if (comparison.coverage !== 'complete' && comparison.coverage !== 'partial') {
        errors.push(`${label} has invalid comparison coverage`);
      }
      for (const [name, count] of Object.entries(comparison)) {
        if (name !== 'coverage' && (!Number.isInteger(count) || (count as number) < 0)) {
          errors.push(`${label} has an invalid comparison ${name}`);
        }
      }
      const previous = history.points[index - 1];
      if (previous) {
        if (comparison.newCount + comparison.unchangedCount + comparison.indeterminateCurrentCount !== point.findingCount) {
          errors.push(`${label} comparison does not account for all current findings`);
        }
        if (comparison.resolvedCount + comparison.unchangedCount + comparison.unobservedPreviousCount !== previous.findingCount) {
          errors.push(`${label} comparison does not account for all previous findings`);
        }
        if (comparison.coverage === 'complete' && (
          comparison.indeterminateCurrentCount !== 0 || comparison.unobservedPreviousCount !== 0
        )) {
          errors.push(`${label} complete comparison contains scope-indeterminate findings`);
        }
        if (comparison.coverage === 'partial') {
          const hasScopeLimitation = history.limitations.some((limitation) => (
            typeof limitation === 'string'
            && /(scope|coverage|observ|unmatch)/i.test(limitation)
          ));
          if (!hasScopeLimitation) {
            errors.push(`${label} partial comparison has no scope limitation for its adjacent audits`);
          }
        }
      }
    }
  }

  const current = history.points.at(-1);
  if (current) {
    const findings = summary.findings;
    const expected = {
      source: 'Current audit',
      ...(summary.browserEngine ? { browserEngine: summary.browserEngine } : {}),
      generatedAt: summary.generatedAt,
      status: summary.status,
      requestedPageCount: summary.requestedUrls.length,
      auditedPageCount: summary.auditedUrls.length,
      findingCount: findings.length,
      confirmedCount: findings.filter((finding) => finding.classification === 'confirmed').length,
      reviewCount: findings.filter((finding) => finding.classification === 'review').length,
      blockerCount: findings.filter((finding) => finding.classification === 'blocker').length,
      manualCount: findings.filter((finding) => finding.classification === 'manual').length,
      criticalConfirmedCount: findings.filter((finding) => finding.classification === 'confirmed' && finding.severity === 'Critical').length,
      seriousConfirmedCount: findings.filter((finding) => finding.classification === 'confirmed' && finding.severity === 'Serious').length
    };
    for (const [name, value] of Object.entries(expected)) {
      if (current[name as keyof typeof current] !== value) errors.push(`current history point does not match audit ${name}`);
    }
  }
  return errors;
}

/** Rejects impossible or untraceable canonical results before any renderer sees them. */
export function assertCanonicalAuditSummary(summary: AuditSummary): void {
  const errors: string[] = [];
  if (summary.browserEngine !== undefined && !['chromium', 'firefox', 'webkit'].includes(summary.browserEngine)) {
    errors.push('browser engine is invalid');
  }
  const findingIds = summary.findings.map((finding) => finding.id ?? finding.key);
  if (new Set(findingIds).size !== findingIds.length) errors.push('finding identities are not unique');

  if (hasGuarantee(summary, 'failure-isolation')) {
    errors.push(...collectionCompletenessErrors(summary.pages));
  }

  if (hasGuarantee(summary, 'traceable-evidence')) {
    const viewports = viewportIndex(summary);
    for (const finding of summary.findings) errors.push(...validateFindingEvidence(finding, viewports));
    errors.push(...validateJourneyResults(summary));
  }

  if (summary.regressionSummary) {
    if (summary.regressionSummary.conformanceEvidence !== false) errors.push('regression summary is incorrectly marked as conformance evidence');
    if (summary.regressionSummary.fixtureCount < 0 || summary.regressionSummary.expectedFindingCount < 0) {
      errors.push('regression summary contains a negative count');
    }
  }

  errors.push(...validateAuditHistory(summary));

  if (errors.length) throw new Error(`Canonical audit result is invalid: ${errors.join('; ')}.`);
}
