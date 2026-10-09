import type { AuditSummary, Finding } from '../types.js';
import { findingId } from './finding-id.js';

const SEVERITY_PRIORITY: Record<Finding['severity'], number> = {
  Critical: 0,
  Serious: 1,
  Moderate: 2,
  Minor: 3,
  Advisory: 4
};

const CLASSIFICATION_PRIORITY: Record<Finding['classification'], number> = {
  blocker: 0,
  confirmed: 1,
  review: 2,
  manual: 3
};

export interface TopAction {
  finding: Finding;
  sourceIndex: number;
  id: string;
  classificationLabel: string;
  conciseClassificationLabel: string;
  priorityLabel: string;
  nextStep: string;
  affectedPageCount: number;
}

export function findingConciseClassificationLabel(classification: Finding['classification']): string {
  switch (classification) {
    case 'confirmed':
      return 'Confirmed';
    case 'review':
      return 'Review';
    case 'blocker':
      return 'Blocker';
    case 'manual':
      return 'Manual';
  }
}

export function findingActionGuidance(classification: Finding['classification']): string {
  switch (classification) {
    case 'confirmed':
      return 'Treat this as a reproduced barrier: assign an owner, apply the recommended fix, and retest every affected page and viewport.';
    case 'review':
      return 'Validate this evidence with human judgement before recording a failure, and keep the reviewer’s decision with the finding.';
    case 'blocker':
      return 'Restore access or remove the blocking condition, then rerun the affected scope; this item is not a conformance result.';
    case 'manual':
      return 'Complete the documented human procedure and record the evidence and verdict; do not infer a pass from automation.';
  }
}

export function findingClassificationLabel(classification: Finding['classification']): string {
  switch (classification) {
    case 'confirmed':
      return 'Confirmed barrier';
    case 'review':
      return 'Requires human validation';
    case 'blocker':
      return 'Coverage blocker (not a conformance result)';
    case 'manual':
      return 'Manual check required';
  }
}

export function findingPriorityLabel(finding: Finding): string {
  switch (finding.classification) {
    case 'confirmed':
      return finding.severity;
    case 'review':
      return `Review priority: ${finding.severity}`;
    case 'blocker':
      return 'Coverage blocked';
    case 'manual':
      return 'Human check';
  }
}

function topActionNextStep(finding: Finding): string {
  const remediation = finding.remediation.trim();
  const testing = finding.testing.trim();
  switch (finding.classification) {
    case 'confirmed':
      return remediation || findingActionGuidance(finding.classification);
    case 'review':
    case 'manual':
      return testing || findingActionGuidance(finding.classification);
    case 'blocker':
      return remediation
        ? `${remediation.replace(/[.!?]+$/, '')}. Then rerun the affected scope.`
        : findingActionGuidance(finding.classification);
  }
}

export function buildTopActions(summary: AuditSummary, limit = 3): TopAction[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  return summary.findings
    .map((finding, sourceIndex) => ({ finding, sourceIndex }))
    .sort((left, right) => (
      CLASSIFICATION_PRIORITY[left.finding.classification] - CLASSIFICATION_PRIORITY[right.finding.classification]
      || SEVERITY_PRIORITY[left.finding.severity] - SEVERITY_PRIORITY[right.finding.severity]
      || left.sourceIndex - right.sourceIndex
    ))
    .slice(0, safeLimit)
    .map(({ finding, sourceIndex }) => ({
      finding,
      sourceIndex,
      id: findingId(finding, sourceIndex),
      classificationLabel: findingClassificationLabel(finding.classification),
      conciseClassificationLabel: findingConciseClassificationLabel(finding.classification),
      priorityLabel: findingPriorityLabel(finding),
      nextStep: topActionNextStep(finding),
      affectedPageCount: new Set(finding.urls).size
    }));
}
