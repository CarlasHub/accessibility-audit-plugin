import type { AuditSummary } from '../types.js';

export const EVIDENCE_SHEET = 'Evidence';
/** @deprecated Use EVIDENCE_SHEET. Retained for API compatibility. */
export const IMAGE_INVENTORY_SHEET = EVIDENCE_SHEET;
export function getImageEvidencePaths(summary: AuditSummary): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const finding of summary.findings) {
    for (const evidence of finding.evidence) {
      if (!evidence.screenshot) continue;
      const identity = evidence.screenshot.replaceAll('\\', '/');
      if (seen.has(identity)) continue;
      seen.add(identity);
      paths.push(evidence.screenshot);
    }
  }
  return paths;
}
