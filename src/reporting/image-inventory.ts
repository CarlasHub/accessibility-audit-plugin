import type { AuditSummary } from '../types.js';

export const IMAGE_INVENTORY_SHEET = 'Image Inventory';
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
