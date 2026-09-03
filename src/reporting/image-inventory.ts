import type { AuditSummary, EvidenceItem, Finding } from '../types.js';

export const IMAGE_INVENTORY_SHEET = 'Image Inventory';
export const IMAGE_INVENTORY_HEADERS = [
  'Page URL',
  'Viewport',
  'Rule',
  'Component',
  'Location',
  'Selector',
  'Evidence Type',
  'Result',
  'Screenshot File',
  'Screenshot Link'
] as const;

export interface ImageEvidenceRow {
  pageUrl: string;
  viewport: string;
  ruleId: string;
  component: string;
  location: string;
  selector: string;
  evidenceType: string;
  result: string;
  screenshot: string;
}

function rowFromEvidence(finding: Finding, evidence: EvidenceItem): ImageEvidenceRow | null {
  if (!evidence.screenshot) return null;
  const normalizedPath = evidence.screenshot.replaceAll('\\', '/');
  return {
    pageUrl: evidence.pageUrl,
    viewport: evidence.viewport ?? (finding.viewports.join(', ') || 'All'),
    ruleId: finding.ruleId,
    component: finding.componentName ?? finding.component,
    location: finding.componentLocation ?? 'See the page URL and selector.',
    selector: evidence.selector ?? finding.selectors[0] ?? 'Page',
    evidenceType: normalizedPath.includes('/screenshots/elements/') ? 'Element screenshot' : 'Full-page screenshot',
    result: `${finding.classification}: ${finding.summary}`,
    screenshot: evidence.screenshot
  };
}

export function getImageEvidenceRows(summary: AuditSummary): ImageEvidenceRow[] {
  const rows: ImageEvidenceRow[] = [];
  const seen = new Set<string>();
  for (const finding of summary.findings) {
    for (const evidence of finding.evidence) {
      const row = rowFromEvidence(finding, evidence);
      if (!row) continue;
      const identity = `${row.pageUrl}|${row.viewport}|${row.ruleId}|${row.selector}|${row.screenshot}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      rows.push(row);
    }
  }
  return rows;
}
