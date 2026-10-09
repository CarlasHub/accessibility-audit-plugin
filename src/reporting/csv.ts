import { writeFile } from 'node:fs/promises';
import type { AuditSummary, Finding } from '../types.js';
import { assertCanonicalAuditSummary } from '../audit/canonical-validation.js';
import { assignFindingIds } from './finding-id.js';

const CSV_COLUMNS = [
  'id',
  'fingerprint',
  'classification',
  'severity',
  'rule_id',
  'wcag',
  'summary',
  'issue',
  'impact',
  'testing',
  'remediation',
  'component',
  'component_name',
  'component_location',
  'urls',
  'viewports',
  'selectors',
  'assignment',
  'effort',
  'translation_required',
  'evidence_count'
] as const;

function safeSpreadsheetText(value: string): string {
  let firstMeaningful = 0;
  while (firstMeaningful < value.length && value.charCodeAt(firstMeaningful) <= 0x20) firstMeaningful += 1;
  return '=+-@'.includes(value[firstMeaningful] ?? '') ? `'${value}` : value;
}

function csvCell(value: string | number): string {
  const safe = safeSpreadsheetText(String(value));
  return `"${safe.replaceAll('"', '""')}"`;
}

function findingRow(finding: Finding): Array<string | number> {
  return [
    finding.id ?? '',
    finding.fingerprint ?? '',
    finding.classification,
    finding.severity,
    finding.ruleId,
    finding.wcag.join(' | '),
    finding.summary,
    finding.issue,
    finding.impact,
    finding.testing,
    finding.remediation,
    finding.component,
    finding.componentName ?? '',
    finding.componentLocation ?? '',
    finding.urls.join(' | '),
    finding.viewports.join(' | '),
    finding.selectors.join(' | '),
    finding.assignment,
    finding.effort,
    finding.translationRequired,
    finding.evidence.length
  ];
}

export function csvReport(summary: AuditSummary): string {
  assertCanonicalAuditSummary(summary);
  const findings = assignFindingIds(summary.findings);
  const rows = [
    CSV_COLUMNS.map(csvCell).join(','),
    ...findings.map((finding) => findingRow(finding).map(csvCell).join(','))
  ];
  return `${rows.join('\r\n')}\r\n`;
}

export async function writeCsvReport(summary: AuditSummary, outputPath: string): Promise<string> {
  await writeFile(outputPath, csvReport(summary), 'utf8');
  return outputPath;
}
