import type { Finding } from '../types.js';

// Revised Section 508 E205.4 incorporates the WCAG 2.0 Level A and AA
// success criteria for covered electronic content. WCAG 2.1/2.2 additions
// must not be labelled as Section 508 requirements merely because they are
// part of this tool's WCAG 2.2 conformance target.
const SECTION_508_WCAG_20_AA = new Set([
  '1.1.1',
  '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5',
  '1.3.1', '1.3.2', '1.3.3',
  '1.4.1', '1.4.2', '1.4.3', '1.4.4', '1.4.5',
  '2.1.1', '2.1.2',
  '2.2.1', '2.2.2',
  '2.3.1',
  '2.4.1', '2.4.2', '2.4.3', '2.4.4', '2.4.5', '2.4.6', '2.4.7',
  '3.1.1', '3.1.2',
  '3.2.1', '3.2.2', '3.2.3', '3.2.4',
  '3.3.1', '3.3.2', '3.3.3', '3.3.4',
  '4.1.1', '4.1.2'
]);

const WCAG_CRITERION = /^\d\.\d\.\d{1,2}$/;

export function standardsForFinding(finding: Pick<Finding, 'ruleId' | 'wcag'>): string[] {
  const criteria = [...new Set(finding.wcag.filter((criterion) => WCAG_CRITERION.test(criterion)))].sort();
  const standards = criteria.map((criterion) => `W3C WCAG 2.2 ${criterion}`);
  for (const criterion of criteria) {
    if (SECTION_508_WCAG_20_AA.has(criterion)) {
      standards.push(`Section 508 E205.4 (WCAG 2.0 ${criterion})`);
    }
  }
  if (finding.ruleId.startsWith('axe-')) {
    standards.push(`Deque axe-core rule ${finding.ruleId.slice(4)}`);
  }
  return standards;
}
