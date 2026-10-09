import type { AuditComparison, FindingComparisonRecord } from '../types.js';

export type ComparisonCategoryKey =
  | 'new'
  | 'unchanged'
  | 'resolved'
  | 'indeterminate-current'
  | 'unobserved-baseline';

export interface ComparisonCategory {
  key: ComparisonCategoryKey;
  label: string;
  shortLabel: string;
  explanation: string;
  records: FindingComparisonRecord[];
}

export const RESOLUTION_SCOPE_NOTE = 'Resolved means the finding was not observed when the same URL and viewport scope was successfully rerun; it does not establish WCAG conformance.';

function findingCount(count: number): string {
  return `${count} finding${count === 1 ? '' : 's'}`;
}

export function comparisonCategories(comparison: AuditComparison): ComparisonCategory[] {
  return [
    {
      key: 'new',
      label: 'New findings',
      shortLabel: 'New',
      explanation: 'Observed in the current audit but not in equivalent baseline scope.',
      records: comparison.newFindings
    },
    {
      key: 'unchanged',
      label: 'Unchanged findings',
      shortLabel: 'Unchanged',
      explanation: 'Observed in both the baseline and current audit in equivalent scope.',
      records: comparison.unchangedFindings
    },
    {
      key: 'resolved',
      label: 'Resolved findings',
      shortLabel: 'Resolved',
      explanation: 'Not observed after equivalent baseline scope was successfully rerun.',
      records: comparison.resolvedFindings
    },
    {
      key: 'indeterminate-current',
      label: 'Indeterminate current findings',
      shortLabel: 'Indeterminate current',
      explanation: 'Current findings outside scope that can be compared reliably with the baseline.',
      records: comparison.indeterminateCurrentFindings
    },
    {
      key: 'unobserved-baseline',
      label: 'Baseline findings not re-observed',
      shortLabel: 'Baseline not re-observed',
      explanation: 'Baseline findings whose URL and viewport scope was not successfully repeated.',
      records: comparison.unobservedBaselineFindings
    }
  ];
}

export function comparisonHeadline(comparison: AuditComparison): string {
  const established = `${findingCount(comparison.newFindings.length)} new, ${findingCount(comparison.unchangedFindings.length)} unchanged and ${findingCount(comparison.resolvedFindings.length)} resolved`;
  if (comparison.coverage === 'complete') return `Complete comparison: ${established}.`;
  return `Partial comparison: ${established} within equivalent observed scope; ${findingCount(comparison.indeterminateCurrentFindings.length)} current and ${findingCount(comparison.unobservedBaselineFindings.length)} baseline remain indeterminate.`;
}

export function comparisonPriorityLabel(record: FindingComparisonRecord): string {
  if (record.classification === 'confirmed') return record.severity;
  if (record.classification === 'review') return `Review priority: ${record.severity}`;
  if (record.classification === 'blocker') return 'Coverage blocked';
  return 'Human check';
}
