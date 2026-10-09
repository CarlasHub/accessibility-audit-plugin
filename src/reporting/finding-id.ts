import { createHash } from 'node:crypto';
import type { Finding } from '../types.js';

export const FINDING_FINGERPRINT_VERSION = 'v1';

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function findingId(finding: Finding, index: number): string {
  return finding.id ?? `A11Y${String(index + 1).padStart(3, '0')}`;
}

/**
 * Returns an order-independent identity for a final report row. The fields
 * mirror consolidation's scope and root-cause boundaries so two rows cannot
 * collide merely because their collector-local keys match.
 */
export function findingFingerprint(finding: Finding): string {
  const identity = JSON.stringify({
    scope: finding.sharedComponentKey
      ? { sharedComponentKey: finding.sharedComponentKey }
      : { urls: uniqueSorted(finding.urls) },
    renderedComponent: {
      component: finding.component,
      name: finding.componentName ?? '',
      location: finding.componentLocation ?? ''
    },
    rootCause: {
      ruleId: finding.ruleId,
      classification: finding.classification,
      severity: finding.severity,
      wcag: uniqueSorted(finding.wcag),
      summary: finding.summary,
      issue: finding.issue,
      remediation: finding.remediation
    }
  });
  const digest = createHash('sha256')
    .update(`${FINDING_FINGERPRINT_VERSION}\0${identity}`)
    .digest('hex');
  return `a11y-fp-${FINDING_FINGERPRINT_VERSION}:${digest}`;
}

export function assignFindingIds(findings: Finding[]): Finding[] {
  return findings.map((finding, index) => ({
    ...finding,
    id: findingId(finding, index),
    fingerprint: findingFingerprint(finding)
  }));
}
