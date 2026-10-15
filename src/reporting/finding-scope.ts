import type { Finding } from '../types.js';
import { WCAG_CRITERIA_DEFINITIONS } from '../audit/wcag-criteria.js';

export type FindingScope = 'standard' | 'supplemental' | 'advisory';

const AAA_CRITERIA = new Set(
  WCAG_CRITERIA_DEFINITIONS
    .filter((definition) => definition.level === 'AAA')
    .map((definition) => definition.criterion)
);
const STANDARD_CRITERIA = new Set(
  WCAG_CRITERIA_DEFINITIONS
    .filter((definition) => definition.level === 'A' || definition.level === 'AA')
    .map((definition) => definition.criterion)
);

/**
 * Keep A/AA-mapped findings in the conformance target, AAA-only findings in
 * advisory scope, and non-WCAG or unknown mappings in supporting audit scope.
 */
export function findingScope(finding: Finding): FindingScope {
  const criteria = [...new Set(finding.wcag.map((criterion) => criterion.trim()).filter(Boolean))];
  if (criteria.some((criterion) => STANDARD_CRITERIA.has(criterion))) return 'standard';
  if (criteria.length > 0 && criteria.every((criterion) => AAA_CRITERIA.has(criterion))) return 'advisory';
  return 'supplemental';
}

export function isStandardScopeFinding(finding: Finding): boolean {
  return findingScope(finding) === 'standard';
}

export function isCoreScopeFinding(finding: Finding): boolean {
  return findingScope(finding) !== 'advisory';
}

export function findingScopeLabel(finding: Finding): string {
  const scope = findingScope(finding);
  if (scope === 'standard') return 'WCAG A/AA target';
  if (scope === 'advisory') return 'WCAG AAA advisory';
  return 'Supporting audit check';
}
