import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS, { type CellValue, type DataValidation, type Style, type Worksheet } from 'exceljs';
import type { AuditSummary, Finding, PageAudit } from '../types.js';
import { assertCanonicalAuditSummary } from '../audit/canonical-validation.js';
import { AUDIT_SCOPE_LABEL } from '../scope.js';
import { buildExecutiveSummary } from './executive-summary.js';
import {
  comparisonCategories,
  comparisonHeadline,
  comparisonPriorityLabel,
  RESOLUTION_SCOPE_NOTE
} from './comparison-presentation.js';
import { buildTopActions } from './finding-actions.js';
import { findingId } from './finding-id.js';
import { EXPECTED_REPORT_HEADERS } from './validate.js';

interface LookupEntry {
  criterion: string;
  level: string;
  title: string;
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const templateFileName = ['accessibility', 'report', 'template.xlsx'].join('-');
export const DEFAULT_TEMPLATE = resolve(moduleDirectory, '..', '..', 'assets', templateFileName);
export const CANONICAL_TEMPLATE_SHA256 = '0dc49529d49402eaad4c5511f6db1cc44f91afb1cbd804da6bc702081321a4ce';

const REPORT_COLOURS = {
  primary: 'FF1A73E8',
  primaryDark: 'FF174EA6',
  text: 'FF202124',
  border: 'FFDADCE0',
  surface: 'FFF8F9FA',
  open: 'FFE8F0FE',
  critical: 'FFB3261E',
  serious: 'FFC5221F',
  moderate: 'FFF9AB00',
  minor: 'FFFDE293',
  advisory: 'FFDDE8F8',
  review: 'FFFFF4CE',
  blocker: 'FFEADDFF',
  confirmed: 'FFFCE8E6',
  manual: 'FFE6F4EA'
} as const;

const SEVERITY_COLOURS: Record<Finding['severity'], { background: string; foreground: string }> = {
  Critical: { background: REPORT_COLOURS.critical, foreground: 'FFFFFFFF' },
  Serious: { background: REPORT_COLOURS.serious, foreground: 'FFFFFFFF' },
  Moderate: { background: REPORT_COLOURS.moderate, foreground: REPORT_COLOURS.text },
  Minor: { background: REPORT_COLOURS.minor, foreground: REPORT_COLOURS.text },
  Advisory: { background: REPORT_COLOURS.advisory, foreground: REPORT_COLOURS.text }
};

const CLASSIFICATION_COLOURS: Record<Finding['classification'], { background: string; foreground: string }> = {
  confirmed: { background: REPORT_COLOURS.confirmed, foreground: REPORT_COLOURS.serious },
  review: { background: REPORT_COLOURS.review, foreground: 'FF7A4F01' },
  blocker: { background: REPORT_COLOURS.blocker, foreground: 'FF5B21B6' },
  manual: { background: REPORT_COLOURS.manual, foreground: 'FF137333' }
};

export async function assertCanonicalTemplate(path: string): Promise<void> {
  const digest = createHash('sha256').update(await readFile(path)).digest('hex');
  if (digest !== CANONICAL_TEMPLATE_SHA256) {
    throw new Error(`The report template does not match the CarlasHub WCAG audit template (${CANONICAL_TEMPLATE_SHA256}); received ${digest}.`);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const SUMMARY_LINE_LENGTH = 88;
const SUMMARY_LINE_HEIGHT = 18;

function wrapSummaryText(value: string): string {
  const wrapped: string[] = [];
  for (const paragraph of value.split('\n')) {
    if (!paragraph) {
      wrapped.push('');
      continue;
    }
    let line = '';
    for (const originalWord of paragraph.split(/\s+/)) {
      let word = originalWord;
      if (line && line.length + word.length + 1 > SUMMARY_LINE_LENGTH) {
        wrapped.push(line);
        line = '';
      }
      while (word.length > SUMMARY_LINE_LENGTH) {
        wrapped.push(word.slice(0, SUMMARY_LINE_LENGTH));
        word = word.slice(SUMMARY_LINE_LENGTH);
      }
      if (word) line = line ? `${line} ${word}` : word;
    }
    if (line) wrapped.push(line);
  }
  return wrapped.join('\n');
}

function solidFill(cell: ExcelJS.Cell, colour: string): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
}

function styleBadge(cell: ExcelJS.Cell, background: string, foreground: string): void {
  solidFill(cell, background);
  cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: foreground } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: REPORT_COLOURS.border } },
    bottom: { style: 'thin', color: { argb: REPORT_COLOURS.border } },
    left: { style: 'thin', color: { argb: REPORT_COLOURS.border } },
    right: { style: 'thin', color: { argb: REPORT_COLOURS.border } }
  };
}

function comparisonRowHeight(values: string[], widths: number[], minimum = 42): number {
  const lineCount = values.reduce((maximum, value, index) => {
    const charactersPerLine = Math.max(8, Math.floor((widths[index] ?? 20) * 0.85));
    const wrappedLines = value.split(/\r?\n/).reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)),
      0
    );
    return Math.max(maximum, wrappedLines);
  }, 1);
  return Math.max(minimum, lineCount * 15 + 9);
}

function evidenceKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/^\w/, (character) => character.toUpperCase());
}

function compactEvidenceText(value: unknown): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 260 ? `${text.slice(0, 257)}…` : text;
}

function readableEvidenceDetail(detail: string): string {
  const source = detail.trim();
  if (!source) return 'No additional detail recorded.';
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return compactEvidenceText(source);
  }
  if (typeof parsed !== 'object' || parsed === null) return compactEvidenceText(parsed);

  const lines: string[] = [];
  let truncated = false;
  const append = (label: string, value: unknown): void => {
    if (lines.length >= 24) {
      truncated = true;
      return;
    }
    const text = compactEvidenceText(value);
    if (text) lines.push(`${evidenceKey(label)}: ${text}`);
  };
  const visit = (value: unknown, path: string, depth: number): void => {
    if (lines.length >= 24) {
      truncated = true;
      return;
    }
    if (value === null || value === undefined || typeof value !== 'object') {
      append(path || 'Value', value);
      return;
    }
    if (Array.isArray(value)) {
      if (value.every((item) => item === null || typeof item !== 'object')) {
        append(path || 'Values', value.join(', '));
        return;
      }
      value.slice(0, 8).forEach((item, index) => visit(item, `${path || 'Item'} ${index + 1}`, depth + 1));
      if (value.length > 8) truncated = true;
      return;
    }
    if (depth >= 3) {
      append(path || 'Detail', JSON.stringify(value));
      return;
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      visit(nested, path ? `${path} · ${key}` : key, depth + 1);
    }
  };
  visit(parsed, '', 0);
  if (truncated) lines.push('Additional technical detail is available in audit-results.json.');
  return lines.join('\n') || 'No additional detail recorded.';
}

function valueText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text ?? '').trim();
    if ('result' in value) return String(value.result ?? '').trim();
    return '';
  }
  return String(value).trim();
}

function getLookup(worksheet: Worksheet): Map<string, LookupEntry> {
  const lookup = new Map<string, LookupEntry>();
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return;
    const label = valueText(row.getCell(1).value);
    const criterion = /^([1-4]\.\d+\.\d+)(?::|$)/.exec(label)?.[1];
    if (!criterion) return;
    lookup.set(criterion, {
      criterion,
      level: valueText(row.getCell(2).value),
      title: valueText(row.getCell(3).value)
    });
  });
  return lookup;
}

function criterionEntries(finding: Finding, lookup: Map<string, LookupEntry>): LookupEntry[] {
  return finding.wcag.map((criterion) => lookup.get(criterion) ?? {
    criterion,
    level: '',
    title: 'Manual or advisory check'
  });
}

function workbookRelativePath(outputPath: string, targetPath: string): string {
  return relative(dirname(outputPath), resolve(targetPath))
    .split(sep)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function screenshotLink(finding: Finding, outputPath: string): CellValue {
  const path = finding.evidence.find((item) => item.screenshot)?.screenshot;
  if (!path) return 'Not captured';
  const reference = workbookRelativePath(outputPath, path);
  return { text: reference, hyperlink: reference, tooltip: 'Open the evidence image stored beside this workbook.' };
}

function viewportLabel(viewport: string): string {
  if (viewport === 'desktop') return 'Desktop (1440×1000)';
  if (viewport === 'mobile') return 'Mobile (390×844)';
  if (viewport === 'reflow-320') return 'Reflow (320×800)';
  return viewport.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function componentName(finding: Finding): string {
  return finding.componentName?.trim() || finding.component;
}

function componentLocation(finding: Finding): string {
  return finding.componentLocation?.trim() || 'See the affected URL and technical locator.';
}

function expectedOutcome(finding: Finding, criteria: LookupEntry[]): string {
  const rule = finding.ruleId;
  if (rule === 'page-unavailable') return 'The requested page loads successfully and every planned viewport can be tested.';
  if (rule === 'target-size-review') return 'Each pointer target contains a 24×24 CSS pixel area, has sufficient clearance, or has a documented exception.';
  if (/link-(?:broken-destination|destination-review)|missing-fragment/.test(rule)) return 'The link reaches a valid destination, or the interaction uses a button when it performs an action.';
  if (/link-name|empty-accessible-name|control-no-name|command-name|button-name|input-button-name/.test(rule)) return 'The control exposes a concise accessible name that communicates its purpose.';
  if (/label/.test(rule)) return 'The form control has a persistent visible label and a matching programmatic accessible name.';
  if (/image|linked-image/.test(rule)) return 'The image exposes a concise text alternative that communicates its purpose without unnecessary repetition.';
  if (/focus-order/.test(rule)) return 'Keyboard focus follows a logical sequence that matches the revealed content.';
  if (/focus/.test(rule)) return 'Keyboard focus remains visible, unobscured, and predictable.';
  if (/disclosure/.test(rule)) return 'The disclosure exposes accurate state and relationships and works predictably from the keyboard.';
  if (/tabs/.test(rule)) return 'The tabs expose valid tab-to-panel relationships and support their documented keyboard interaction.';
  if (/reflow|overflow/.test(rule)) return 'Content remains available without two-dimensional scrolling at the tested viewport.';
  if (/text-spacing/.test(rule)) return 'Content and functionality remain available after the WCAG text-spacing overrides are applied.';
  if (/landmark|region/.test(rule)) return 'Page regions use appropriate landmarks with clear names where required.';
  const criterion = criteria.find((entry) => entry.title);
  return criterion
    ? `The component meets ${criterion.criterion}${criterion.title ? ` (${criterion.title})` : ''}.`
    : 'The component does not expose the accessibility barrier described in this finding.';
}

function reportRowValues(finding: Finding, id: string, criteria: LookupEntry[], outputPath: string): CellValue[] {
  return [
    id,
    finding.classification,
    'Open',
    finding.severity,
    criteria.map((entry) => entry.criterion).join('\n') || 'Advisory',
    [...new Set(criteria.map((entry) => entry.level).filter(Boolean))].join('\n') || 'N/A',
    criteria.map((entry) => entry.title).filter(Boolean).join('\n') || 'Manual or advisory check',
    finding.urls.join('\n'),
    finding.viewports.map(viewportLabel).join('\n'),
    componentName(finding),
    componentLocation(finding),
    finding.summary,
    finding.issue,
    finding.impact,
    finding.selectors.join('\n') || 'Page-level or structural check',
    finding.testing,
    finding.evidence.map((item) => `[${item.kind}] ${readableEvidenceDetail(item.detail)}`).join('\n\n') || finding.issue,
    expectedOutcome(finding, criteria),
    finding.remediation,
    finding.assignment,
    finding.effort,
    screenshotLink(finding, outputPath),
    finding.ruleId,
    [finding.classification, finding.ruleId, ...(finding.standards ?? finding.wcag.map((criterion) => `WCAG ${criterion}`))].join(', '),
    finding.translationRequired
  ];
}

interface RowTemplate {
  styles: Array<Partial<Style>>;
  validations: DataValidation[];
  height: number | undefined;
}

function prepareRows(worksheet: Worksheet, templateRowNumber: number, dataStartRow: number, columns: number): RowTemplate {
  const templateRow = worksheet.getRow(templateRowNumber);
  const result = {
    styles: Array.from({ length: columns }, (_, index) => clone(templateRow.getCell(index + 1).style as Partial<Style>)),
    validations: Array.from({ length: columns }, (_, index) => clone(templateRow.getCell(index + 1).dataValidation as DataValidation)),
    height: templateRow.height
  };
  for (let rowNumber = dataStartRow; rowNumber <= worksheet.rowCount; rowNumber += 1) worksheet.getRow(rowNumber).values = [];
  return result;
}

function writeStyledRow(worksheet: Worksheet, rowNumber: number, values: CellValue[], template: RowTemplate): void {
  const row = worksheet.getRow(rowNumber);
  row.values = values;
  if (template.height !== undefined) row.height = template.height;
  for (let column = 1; column <= values.length; column += 1) {
    row.getCell(column).style = clone(template.styles[column - 1] ?? {});
    const validation = template.validations[column - 1];
    if (validation && Object.keys(validation).length) row.getCell(column).dataValidation = clone(validation);
  }
}

function pageStatus(page: PageAudit | undefined, skipped: boolean): string {
  if (skipped || !page) return 'Not started';
  if (page.viewports.some((viewport) => viewport.cancelled)) return 'Cancelled';
  if (page.partial || page.viewports.some((viewport) => viewport.partial || viewport.interactionBlocker || !viewport.axeRun.completed)) return 'Partial';
  return 'Completed';
}

function populatePageInventory(worksheet: Worksheet, summary: AuditSummary): void {
  const template = prepareRows(worksheet, 5, 5, 7);
  const urls = [...new Set([
    ...summary.requestedUrls,
    ...summary.auditedUrls,
    ...summary.pages.map((page) => page.url),
    ...summary.skippedUrls.map((item) => item.url)
  ].map((url) => url.trim()).filter(Boolean))];
  const pages = new Map(summary.pages.map((page) => [page.url, page]));
  const skipped = new Map(summary.skippedUrls.map((item) => [item.url, item.reason]));
  urls.forEach((url, index) => {
    const page = pages.get(url);
    const errors = page?.viewports.flatMap((viewport) => viewport.errors) ?? [];
    const blockers = page?.viewports.flatMap((viewport) => viewport.interactionBlocker?.reason ?? []) ?? [];
    const consent = page
      ? [...new Set(page.viewports.map((viewport) => viewport.consent.found
        ? `${viewport.consent.action}${viewport.consent.dismissed ? ' (dismissed)' : ''}`
        : 'not found'))].join('\n')
      : 'Not tested';
    writeStyledRow(worksheet, 5 + index, [
      { text: url, hyperlink: url },
      pageStatus(page, skipped.has(url)),
      page?.viewports.map((viewport) => viewportLabel(viewport.viewport.name)).join('\n') || 'Not recorded',
      page?.viewports.filter((viewport) => !viewport.cancelled && viewport.axeRun.completed).length ?? 0,
      consent,
      errors.join('\n') || 'None recorded',
      [skipped.get(url), ...blockers].filter(Boolean).join('\n') || 'None'
    ], template);
  });
  worksheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(5, urls.length + 4), column: 7 } };
}

function populateEvidence(worksheet: Worksheet, summary: AuditSummary, outputPath: string): void {
  const template = prepareRows(worksheet, 5, 5, 9);
  let rowNumber = 5;
  summary.findings.forEach((finding, findingIndex) => {
    for (const evidence of finding.evidence) {
      const path = evidence.screenshot ? workbookRelativePath(outputPath, evidence.screenshot) : '';
      writeStyledRow(worksheet, rowNumber, [
        path ? { text: path, hyperlink: path, tooltip: 'Open the evidence file stored beside this workbook.' } : 'Not captured',
        findingId(finding, findingIndex),
        { text: evidence.pageUrl, hyperlink: evidence.pageUrl },
        evidence.viewport ? viewportLabel(evidence.viewport) : 'Not specified',
        finding.ruleId,
        componentName(finding),
        evidence.selector || finding.selectors.join('\n') || 'Page-level or structural check',
        evidence.kind,
        readableEvidenceDetail(evidence.detail)
      ], template);
      rowNumber += 1;
    }
  });
  worksheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(5, rowNumber - 1), column: 9 } };
}

function populateManualChecks(worksheet: Worksheet, summary: AuditSummary): void {
  const template = prepareRows(worksheet, 5, 5, 7);
  summary.manualChecks.forEach((check, index) => {
    writeStyledRow(worksheet, 5 + index, [
      check.id,
      check.title,
      check.wcag.join('\n') || 'Advisory',
      check.applicableTo,
      check.procedure,
      'Not tested',
      check.expectedEvidence ? `Record: ${check.expectedEvidence}` : 'Record the tested scope, method, result, evidence, and reviewer verdict.'
    ], template);
  });
  worksheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(5, summary.manualChecks.length + 4), column: 7 } };
}

function populateCriteria(workbook: ExcelJS.Workbook, summary: AuditSummary): void {
  const worksheet = workbook.addWorksheet('WCAG Criteria', {
    properties: { tabColor: { argb: 'FF7030A0' } }
  });
  worksheet.mergeCells('A1:H1');
  worksheet.getCell('A1').value = 'WCAG 2.2 criterion-by-criterion ledger';
  worksheet.getCell('A1').font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_COLOURS.primaryDark } };
  worksheet.getCell('A1').alignment = { vertical: 'middle' };
  worksheet.getRow(1).height = 32;
  worksheet.mergeCells('A2:H2');
  worksheet.getCell('A2').value = 'The conformance target is WCAG 2.2 Level AA. Level AAA entries are optional advisory checks. Automated evidence does not replace qualified human assessment or establish conformance.';
  worksheet.getCell('A2').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF595959' } };
  worksheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
  worksheet.getRow(2).height = 32;

  const headers = ['Criterion', 'Level', 'Scope', 'Status', 'Finding IDs', 'Automated evidence', 'Decision note', 'Understanding'];
  worksheet.getRow(4).values = headers;
  worksheet.getRow(4).height = 26;
  worksheet.getRow(4).eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_COLOURS.primary } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFB4C6E7' } } };
  });

  const statusColours: Record<string, string> = {
    passed: 'FFE2F0D9',
    failed: 'FFF4CCCC',
    'manual-review-required': 'FFFFF2CC',
    inconclusive: 'FFFCE5CD',
    'not-applicable': 'FFE7E6E6'
  };
  (summary.criteria ?? []).forEach((criterion, index) => {
    const row = worksheet.getRow(index + 5);
    row.values = [
      `${criterion.criterion} ${criterion.title}`,
      criterion.level,
      criterion.scope === 'standard' ? 'AA conformance target' : 'AAA advisory',
      criterion.status,
      criterion.findingIds.join('\n') || 'None',
      criterion.automatedEvidence.join('\n') || 'No automated evidence mapped',
      criterion.detail,
      { text: criterion.understandingUrl, hyperlink: criterion.understandingUrl, tooltip: `Open WCAG Understanding ${criterion.criterion}` }
    ];
    row.height = 48;
    row.eachCell((cell, column) => {
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF202124' } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFD9E2F3' } },
        right: { style: 'hair', color: { argb: 'FFE7E6E6' } }
      };
      if (column === 4) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColours[criterion.status] ?? 'FFFFFFFF' } };
    });
    row.getCell(1).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF202124' } };
    row.getCell(4).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"passed,failed,manual-review-required,not-applicable,inconclusive"'],
      showErrorMessage: true,
      errorTitle: 'Choose a WCAG status',
      error: 'Select one of the five supported criterion statuses.',
      showInputMessage: true,
      promptTitle: 'Human assessment decision',
      prompt: 'Change this status only after recording qualified human evidence in the decision note.'
    };
    row.getCell(8).font = { name: 'Arial', size: 10, color: { argb: 'FF0563C1' }, underline: true };
  });

  worksheet.columns = [
    { width: 34 }, { width: 9 }, { width: 22 }, { width: 24 },
    { width: 18 }, { width: 42 }, { width: 48 }, { width: 46 }
  ];
  worksheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 4, topLeftCell: 'C5', showGridLines: false, zoomScale: 90 }];
  worksheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(5, (summary.criteria?.length ?? 0) + 4), column: 8 } };
  worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function populateComparison(workbook: ExcelJS.Workbook, summary: AuditSummary): void {
  const comparison = summary.comparison;
  if (!comparison) return;
  const worksheet = workbook.addWorksheet('Baseline Comparison', {
    properties: { tabColor: { argb: 'FF1A73E8' } }
  });
  worksheet.mergeCells('A1:H1');
  worksheet.getCell('A1').value = 'Baseline comparison';
  worksheet.getCell('A1').font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  solidFill(worksheet.getCell('A1'), REPORT_COLOURS.primaryDark);
  worksheet.getCell('A1').alignment = { vertical: 'middle' };
  worksheet.getRow(1).height = 32;
  worksheet.mergeCells('A2:H2');
  worksheet.getCell('A2').value = comparisonHeadline(comparison);
  worksheet.getCell('A2').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF595959' } };
  worksheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
  worksheet.getRow(2).height = 32;

  worksheet.getCell('A4').value = 'Baseline source';
  worksheet.mergeCells('B4:D4');
  worksheet.getCell('B4').value = comparison.baselineSource;
  worksheet.getCell('E4').value = 'Coverage';
  worksheet.mergeCells('F4:H4');
  worksheet.getCell('F4').value = comparison.coverage === 'complete' ? 'Complete equivalent scope' : 'Partial equivalent scope';
  worksheet.getCell('A5').value = 'Baseline generated';
  worksheet.mergeCells('B5:D5');
  worksheet.getCell('B5').value = comparison.baselineGeneratedAt ?? 'Not recorded';
  worksheet.getCell('E5').value = 'Baseline findings';
  worksheet.getCell('F5').value = comparison.baselineFindingCount;
  worksheet.getCell('G5').value = 'Current findings';
  worksheet.getCell('H5').value = comparison.currentFindingCount;
  for (const address of ['A4', 'E4', 'A5', 'E5', 'G5']) {
    worksheet.getCell(address).font = { name: 'Arial', size: 10, bold: true, color: { argb: REPORT_COLOURS.primaryDark } };
  }
  for (const rowNumber of [4, 5]) {
    worksheet.getRow(rowNumber).height = 24;
    worksheet.getRow(rowNumber).eachCell((cell) => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: REPORT_COLOURS.border } } };
    });
  }

  const headers = ['Change', 'Finding ID', 'Classification', 'Impact / priority', 'Finding', 'Affected URLs', 'Viewports', 'Stable fingerprint'];
  const columnWidths = [24, 16, 18, 22, 44, 46, 22, 34];
  worksheet.getRow(7).values = headers;
  const changeColours: Record<string, { background: string; foreground: string }> = {
    new: { background: REPORT_COLOURS.confirmed, foreground: REPORT_COLOURS.serious },
    unchanged: { background: REPORT_COLOURS.open, foreground: REPORT_COLOURS.primaryDark },
    resolved: { background: REPORT_COLOURS.manual, foreground: 'FF137333' },
    'indeterminate-current': { background: REPORT_COLOURS.review, foreground: 'FF7A4F01' },
    'unobserved-baseline': { background: 'FFE7E6E6', foreground: REPORT_COLOURS.text }
  };
  let rowNumber = 8;
  for (const category of comparisonCategories(comparison)) {
    for (const record of category.records) {
      const row = worksheet.getRow(rowNumber);
      const values = [
        category.shortLabel,
        record.id ?? 'Not recorded',
        record.classification,
        comparisonPriorityLabel(record),
        record.summary,
        record.urls.join('\n') || 'Not recorded',
        record.viewports.join('\n') || 'Not recorded',
        record.fingerprint
      ];
      row.values = values;
      row.height = comparisonRowHeight(values, columnWidths, 54);
      rowNumber += 1;
    }
  }
  applySupportingSheetPresentation(worksheet, 7, 8, 8, 2);
  let styledRowNumber = 8;
  for (const category of comparisonCategories(comparison)) {
    for (const record of category.records) {
      const row = worksheet.getRow(styledRowNumber);
      const changeColour = changeColours[category.key]!;
      styleBadge(row.getCell(1), changeColour.background, changeColour.foreground);
      const classificationColour = CLASSIFICATION_COLOURS[record.classification];
      styleBadge(row.getCell(3), classificationColour.background, classificationColour.foreground);
      const priorityColour = record.classification === 'confirmed'
        ? SEVERITY_COLOURS[record.severity]
        : classificationColour;
      styleBadge(row.getCell(4), priorityColour.background, priorityColour.foreground);
      styledRowNumber += 1;
    }
  }
  if (rowNumber === 8) {
    worksheet.mergeCells('A8:H8');
    worksheet.getCell('A8').value = 'No baseline or current findings were available to compare.';
    worksheet.getCell('A8').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF595959' } };
  }
  const noteRow = Math.max(10, rowNumber + 1);
  worksheet.mergeCells(`A${noteRow}:H${noteRow}`);
  worksheet.getCell(`A${noteRow}`).value = RESOLUTION_SCOPE_NOTE;
  worksheet.getCell(`A${noteRow}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF7A4F01' } };
  worksheet.getCell(`A${noteRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_COLOURS.review } };
  worksheet.getCell(`A${noteRow}`).alignment = { wrapText: true, vertical: 'middle' };
  worksheet.getRow(noteRow).height = comparisonRowHeight([RESOLUTION_SCOPE_NOTE], [150], 34);
  worksheet.mergeCells(`A${noteRow + 1}:H${noteRow + 1}`);
  const limitationText = comparison.limitations.length
    ? `Comparison limitations: ${comparison.limitations.join(' | ')}`
    : 'Comparison limitations: No additional limitations were recorded.';
  worksheet.getCell(`A${noteRow + 1}`).value = limitationText;
  worksheet.getCell(`A${noteRow + 1}`).font = { name: 'Arial', size: 10, color: { argb: REPORT_COLOURS.text } };
  worksheet.getCell(`A${noteRow + 1}`).alignment = { wrapText: true, vertical: 'top' };
  worksheet.getRow(noteRow + 1).height = comparisonRowHeight([limitationText], [150]);
  worksheet.columns = columnWidths.map((width) => ({ width }));
  worksheet.autoFilter = { from: { row: 7, column: 1 }, to: { row: Math.max(7, rowNumber - 1), column: 8 } };
  worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function populateHistory(workbook: ExcelJS.Workbook, summary: AuditSummary): void {
  const history = summary.history;
  if (!history) return;
  const worksheet = workbook.addWorksheet('History & Trends', {
    properties: { tabColor: { argb: 'FF00897B' } }
  });
  worksheet.mergeCells('A1:R1');
  worksheet.getCell('A1').value = 'History and trends';
  worksheet.getCell('A1').font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  solidFill(worksheet.getCell('A1'), REPORT_COLOURS.primaryDark);
  worksheet.getCell('A1').alignment = { vertical: 'middle' };
  worksheet.getRow(1).height = 32;
  worksheet.mergeCells('A2:R2');
  worksheet.getCell('A2').value = 'Chronological audit snapshots; each change is measured against the immediately preceding snapshot and qualified by comparable scope.';
  worksheet.getCell('A2').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF595959' } };
  worksheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
  worksheet.getRow(2).height = 32;
  worksheet.mergeCells('A3:R3');
  worksheet.getCell('A3').value = history.limitations.length
    ? `History limitations: ${history.limitations.join(' | ')}`
    : 'History limitations: No additional limitations were recorded.';
  worksheet.getCell('A3').font = { name: 'Arial', size: 10, color: { argb: REPORT_COLOURS.text } };
  worksheet.getCell('A3').alignment = { wrapText: true, vertical: 'middle' };
  worksheet.getRow(3).height = comparisonRowHeight([String(worksheet.getCell('A3').value)], [180], 28);

  const headers = [
    'Audit', 'Generated (UTC)', 'Status', 'Requested pages', 'Audited pages', 'Findings', 'Confirmed', 'Review',
    'Blockers', 'Manual', 'Critical confirmed', 'Serious confirmed', 'Coverage vs previous', 'New', 'Unchanged',
    'Resolved', 'Indeterminate current', 'Previous not re-observed'
  ];
  worksheet.getRow(5).values = headers;
  history.points.forEach((point, index) => {
    const delta = point.comparisonToPrevious;
    worksheet.getRow(index + 6).values = [
      point.source,
      point.generatedAt,
      point.status,
      point.requestedPageCount,
      point.auditedPageCount,
      point.findingCount,
      point.confirmedCount,
      point.reviewCount,
      point.blockerCount,
      point.manualCount,
      point.criticalConfirmedCount,
      point.seriousConfirmedCount,
      delta?.coverage ?? 'Starting point',
      delta?.newCount ?? '',
      delta?.unchangedCount ?? '',
      delta?.resolvedCount ?? '',
      delta?.indeterminateCurrentCount ?? '',
      delta?.unobservedPreviousCount ?? ''
    ];
  });
  applySupportingSheetPresentation(worksheet, 5, 6, 18, 2);
  for (let rowNumber = 6; rowNumber < history.points.length + 6; rowNumber += 1) {
    const status = valueText(worksheet.getCell(rowNumber, 3));
    styleBadge(
      worksheet.getCell(rowNumber, 3),
      status === 'completed' ? REPORT_COLOURS.manual : REPORT_COLOURS.review,
      status === 'completed' ? 'FF137333' : 'FF7A4F01'
    );
    const coverage = valueText(worksheet.getCell(rowNumber, 13));
    styleBadge(
      worksheet.getCell(rowNumber, 13),
      coverage === 'complete' ? REPORT_COLOURS.manual : coverage === 'partial' ? REPORT_COLOURS.review : REPORT_COLOURS.open,
      coverage === 'complete' ? 'FF137333' : coverage === 'partial' ? 'FF7A4F01' : REPORT_COLOURS.primaryDark
    );
  }
  worksheet.columns = [28, 25, 14, 16, 15, 12, 12, 12, 12, 12, 19, 18, 22, 10, 13, 12, 22, 26]
    .map((width) => ({ width }));
  worksheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: history.points.length + 5, column: 18 } };
  worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function populateSummary(worksheet: Worksheet, summary: AuditSummary): void {
  const executiveSummary = buildExecutiveSummary(summary);
  const topActions = buildTopActions(summary);
  const allViewports = summary.pages.flatMap((page) => page.viewports);
  const classifications = (classification: Finding['classification']): number =>
    summary.findings.filter((finding) => finding.classification === classification).length;
  const confirmedSeverities = (severity: Finding['severity']): number =>
    summary.findings.filter((finding) => finding.classification === 'confirmed' && finding.severity === severity).length;
  worksheet.getCell('B4').value = summary.status === 'completed' ? 'Completed' : 'Cancelled';
  worksheet.getCell('B5').value = new Date(summary.generatedAt);
  worksheet.getCell('B6').value = summary.auditor;
  const aaaAdvisory = summary.aaaAdvisory ?? summary.wcagLevel === 'AAA';
  worksheet.getCell('B7').value = `WCAG 2.2 Level A and AA${aaaAdvisory ? '; separate Level AAA advisory checks enabled' : ''}`;
  const landingUrl = summary.landingPageUrl || summary.requestedUrls[0] || '';
  worksheet.getCell('B8').value = /^https?:\/\//i.test(landingUrl) ? { text: landingUrl, hyperlink: landingUrl } : landingUrl;
  worksheet.getCell('B9').value = summary.requestedUrls.length;
  worksheet.getCell('B10').value = summary.pages.length;
  worksheet.getCell('B11').value = allViewports.length;
  worksheet.getCell('D4').value = 'Report items';
  worksheet.getCell('D6').value = 'Review candidates';
  worksheet.getCell('D8').value = 'Manual plan checks';
  worksheet.getCell('G3').value = 'Confirmed impact';
  worksheet.getCell('E4').value = summary.findings.length;
  worksheet.getCell('E5').value = classifications('confirmed');
  worksheet.getCell('E6').value = classifications('review');
  worksheet.getCell('E7').value = classifications('blocker');
  worksheet.getCell('E8').value = summary.manualChecks.length;
  (['Critical', 'Serious', 'Moderate', 'Minor', 'Advisory'] as const).forEach((severity, index) => {
    worksheet.getCell(`H${index + 4}`).value = confirmedSeverities(severity);
  });
  const summaryStyle = clone(worksheet.getCell('A14').style as Partial<Style>);
  worksheet.unMergeCells('A14:H16');
  for (const rowNumber of [14, 15, 16]) {
    worksheet.mergeCells(`A${rowNumber}:H${rowNumber}`);
    worksheet.getCell(`A${rowNumber}`).style = clone(summaryStyle);
  }
  const scopeAndMethod = [
    `Browser engine: ${summary.browserEngine ?? 'not recorded'}`,
    `Scope mode: ${AUDIT_SCOPE_LABEL}`,
    `Requested URLs: ${summary.requestedUrls.length}`,
    `Audited URLs: ${summary.auditedUrls.length}`,
    `Partial pages: ${summary.pages.filter((page) => page.partial).length}`,
    `Skipped URLs: ${summary.skippedUrls.length}`,
    `Viewports run: ${allViewports.length}`,
    'Conformance target: WCAG 2.2 Level AA',
    `Audit Quality Contract: ${summary.qualityContract?.version ?? 'not recorded'}`,
    `Finding policy: ${summary.qualityContract?.findingPolicy ?? 'not recorded'}`,
    `AAA advisory checks: ${aaaAdvisory ? 'Enabled' : 'Disabled'}`,
    `Source: ${summary.source}`
  ].join('; ');
  worksheet.getCell('A13').value = 'Executive summary, scope and method';
  worksheet.getCell('A14').value = wrapSummaryText(`Executive summary: ${executiveSummary.headline}`);
  worksheet.getCell('A15').value = wrapSummaryText(`Current position: ${executiveSummary.currentPosition}`);
  worksheet.getCell('A16').value = wrapSummaryText([
    `Recommended next step: ${executiveSummary.nextStep}`,
    topActions.length
      ? ['Top actions:', ...topActions.map((action, index) => `${index + 1}. [${action.id}] ${action.classificationLabel} · ${action.priorityLabel} — ${action.nextStep}`)].join('\n')
      : `Top actions: ${executiveSummary.nextStep}`,
    summary.comparison ? `Baseline comparison: ${comparisonHeadline(summary.comparison)} See the Baseline Comparison sheet for details.` : '',
    `Scope and method: ${scopeAndMethod}`
  ].filter(Boolean).join('\n'));
  worksheet.mergeCells('A17:B17');
  worksheet.getCell('A17').value = 'Open top actions in Findings:';
  const actionLinkRanges = ['C17:D17', 'E17:F17', 'G17:H17'];
  const actionLinkCells = ['C17', 'E17', 'G17'];
  actionLinkRanges.forEach((range) => worksheet.mergeCells(range));
  actionLinkCells.forEach((address, index) => {
    const action = topActions[index];
    worksheet.getCell(address).value = action
      ? {
          text: `Open ${action.id}`,
          hyperlink: `#'Findings'!A${action.sourceIndex + 7}`,
          tooltip: `Open ${action.id} in the Findings sheet.`
        }
      : 'No additional action';
  });
  const unresolvedCoverage = summary.coverage.flatMap((page) => page.viewports)
    .flatMap((viewport) => viewport.assessments)
    .filter((item) => !['confirmed-passed', 'confirmed-failed', 'not-applicable'].includes(item.status)).length;
  worksheet.getCell('A19').value = [
    ...summary.limitations,
    'Conformance decision: Not determined. Qualified human assessment and sign-off are mandatory.',
    `Coverage matrix contains ${unresolvedCoverage} inconclusive, manual-review-required, or not-tested result(s); these are not passes.`,
    `Criterion ledger contains ${(summary.criteria ?? []).filter((criterion) => ['manual-review-required', 'inconclusive'].includes(criterion.status)).length} unresolved criterion outcome(s).`,
    summary.manualChecks.length
      ? `${summary.manualChecks.length} guided manual check(s) remain in the Manual Checks sheet.`
      : 'No additional guided manual checks were generated.'
  ].join('\n');
}

function applySummaryPresentation(worksheet: Worksheet): void {
  worksheet.views = [{ state: 'frozen', ySplit: 3, showGridLines: false, zoomScale: 100 }];
  worksheet.getCell('B5').numFmt = 'dd mmm yyyy, hh:mm';
  for (const cellAddress of ['B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11']) {
    const cell = worksheet.getCell(cellAddress);
    cell.font = { ...cell.font, name: 'Arial', color: { argb: REPORT_COLOURS.text } };
  }
  const runStatus = valueText(worksheet.getCell('B4').value);
  if (runStatus === 'Completed') styleBadge(worksheet.getCell('B4'), REPORT_COLOURS.manual, 'FF137333');
  else if (runStatus === 'Cancelled') styleBadge(worksheet.getCell('B4'), REPORT_COLOURS.review, 'FF7A4F01');
  else styleBadge(worksheet.getCell('B4'), REPORT_COLOURS.confirmed, REPORT_COLOURS.serious);
  const resultCards: Array<[string, string, string]> = [
    ['E4', REPORT_COLOURS.open, REPORT_COLOURS.primaryDark],
    ['E5', REPORT_COLOURS.confirmed, REPORT_COLOURS.serious],
    ['E6', REPORT_COLOURS.review, 'FF7A4F01'],
    ['E7', REPORT_COLOURS.blocker, 'FF5B21B6'],
    ['E8', REPORT_COLOURS.manual, 'FF137333']
  ];
  resultCards.forEach(([address, background, foreground]) => styleBadge(worksheet.getCell(address), background, foreground));
  (['Critical', 'Serious', 'Moderate', 'Minor', 'Advisory'] as const).forEach((severity, index) => {
    const colours = SEVERITY_COLOURS[severity];
    styleBadge(worksheet.getCell(`G${index + 4}`), colours.background, colours.foreground);
    styleBadge(worksheet.getCell(`H${index + 4}`), colours.background, colours.foreground);
  });
  for (const rowNumber of [14, 15, 16]) {
    const cell = worksheet.getCell(`A${rowNumber}`);
    cell.alignment = { vertical: 'top', wrapText: true };
    const lineCount = valueText(cell.value).split('\n').length;
    worksheet.getRow(rowNumber).height = Math.max(36, lineCount * SUMMARY_LINE_HEIGHT + 8);
  }
  const actionLabel = worksheet.getCell('A17');
  solidFill(actionLabel, REPORT_COLOURS.surface);
  actionLabel.font = { name: 'Arial', size: 10, bold: true, color: { argb: REPORT_COLOURS.text } };
  actionLabel.alignment = { vertical: 'middle', wrapText: true };
  for (const address of ['C17', 'E17', 'G17']) {
    const cell = worksheet.getCell(address);
    styleBadge(cell, REPORT_COLOURS.open, REPORT_COLOURS.primaryDark);
    if (typeof cell.value === 'object' && cell.value !== null && 'hyperlink' in cell.value) {
      cell.font = { ...cell.font, underline: true };
    }
  }
  worksheet.getRow(17).height = 30;
  worksheet.getCell('A19').alignment = { vertical: 'top', wrapText: true };
  worksheet.getRow(19).height = 156;
}

function applyFindingPresentation(worksheet: Worksheet, findings: Finding[]): void {
  worksheet.getRow(6).values = EXPECTED_REPORT_HEADERS;
  worksheet.getRow(6).eachCell((cell) => {
    solidFill(cell, REPORT_COLOURS.primary);
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  worksheet.views = [{
    state: 'frozen',
    xSplit: 2,
    ySplit: 6,
    topLeftCell: 'C7',
    showGridLines: false,
    zoomScale: 75
  }];
  worksheet.getCell('A4').value = 'Confirmed = reproduced barrier to assign, fix and retest. Review = evidence requiring a documented human decision. Blocker = restore the affected scope and rerun it. Manual = complete the human procedure and record evidence. Ratings on non-confirmed rows are review priority, not confirmed impact severity.';
  const widths = [12, 14, 12, 16, 14, 8, 22, 34, 18, 22, 22, 32, 36, 34, 30, 34, 36, 34, 36, 14, 12, 18, 18, 18, 16];
  const hiddenColumns = new Set([6, 7, 9, 11, 15, 16, 24, 25]);
  widths.forEach((width, index) => {
    const column = worksheet.getColumn(index + 1);
    column.width = width;
    column.hidden = hiddenColumns.has(index + 1);
  });
  worksheet.pageSetup = {
    ...worksheet.pageSetup,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: false,
    printTitlesRow: '1:6'
  };
  findings.forEach((finding, index) => {
    const row = worksheet.getRow(index + 7);
    row.height = 72;
    row.eachCell((cell) => {
      cell.font = { ...cell.font, name: 'Arial', size: 10, color: { argb: REPORT_COLOURS.text } };
      cell.alignment = { ...cell.alignment, vertical: 'top', wrapText: true };
      cell.border = { ...cell.border, bottom: { style: 'thin', color: { argb: REPORT_COLOURS.border } } };
      if (index % 2 === 1) solidFill(cell, REPORT_COLOURS.surface);
    });
    row.getCell(1).font = { name: 'Arial', size: 10, bold: true, color: { argb: REPORT_COLOURS.primaryDark } };
    const classification = CLASSIFICATION_COLOURS[finding.classification];
    styleBadge(row.getCell(2), classification.background, classification.foreground);
    styleBadge(row.getCell(3), REPORT_COLOURS.open, REPORT_COLOURS.primaryDark);
    const priority = finding.classification === 'confirmed'
      ? SEVERITY_COLOURS[finding.severity]
      : CLASSIFICATION_COLOURS[finding.classification];
    styleBadge(row.getCell(4), priority.background, priority.foreground);
  });
}

function applySupportingSheetPresentation(
  worksheet: Worksheet,
  headerRow: number,
  dataStartRow: number,
  columnCount: number,
  xSplit = 1
): void {
  worksheet.views = [{
    state: 'frozen',
    xSplit,
    ySplit: headerRow,
    topLeftCell: `${String.fromCharCode(65 + xSplit)}${dataStartRow}`,
    showGridLines: false,
    zoomScale: 90
  }];
  worksheet.getRow(headerRow).eachCell((cell) => {
    solidFill(cell, REPORT_COLOURS.primary);
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  });
  for (let rowNumber = dataStartRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.height = worksheet.name === 'Evidence' ? 66 : Math.max(row.height ?? 0, 42);
    for (let column = 1; column <= columnCount; column += 1) {
      const cell = row.getCell(column);
      cell.font = { ...cell.font, name: 'Arial', size: 10, color: { argb: REPORT_COLOURS.text } };
      cell.alignment = { ...cell.alignment, vertical: 'top', wrapText: true };
      cell.border = { ...cell.border, bottom: { style: 'thin', color: { argb: REPORT_COLOURS.border } } };
      if ((rowNumber - dataStartRow) % 2 === 1) solidFill(cell, REPORT_COLOURS.surface);
    }
  }
}

function applyStatusBadges(pageSheet: Worksheet, manualSheet: Worksheet): void {
  for (let rowNumber = 5; rowNumber <= pageSheet.rowCount; rowNumber += 1) {
    const cell = pageSheet.getCell(rowNumber, 2);
    const status = valueText(cell.value);
    if (status === 'Completed') styleBadge(cell, REPORT_COLOURS.manual, 'FF137333');
    else if (status === 'Partial') styleBadge(cell, REPORT_COLOURS.review, 'FF7A4F01');
    else styleBadge(cell, REPORT_COLOURS.confirmed, REPORT_COLOURS.serious);
  }
  for (let rowNumber = 5; rowNumber <= manualSheet.rowCount; rowNumber += 1) {
    styleBadge(manualSheet.getCell(rowNumber, 6), REPORT_COLOURS.review, 'FF7A4F01');
  }
}

export interface ExcelReportOptions {
  outputPath: string;
  templatePath?: string;
}

export async function writeExcelReport(summary: AuditSummary, options: ExcelReportOptions): Promise<string> {
  assertCanonicalAuditSummary(summary);
  const templatePath = options.templatePath ?? DEFAULT_TEMPLATE;
  await assertCanonicalTemplate(templatePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const summarySheet = workbook.getWorksheet('Audit Summary');
  const findingsSheet = workbook.getWorksheet('Findings');
  const pageSheet = workbook.getWorksheet('Page Inventory');
  const evidenceSheet = workbook.getWorksheet('Evidence');
  const manualSheet = workbook.getWorksheet('Manual Checks');
  const lookupSheet = workbook.getWorksheet('WCAG 2.2 Reference');
  if (!summarySheet || !findingsSheet || !pageSheet || !evidenceSheet || !manualSheet || !lookupSheet) {
    throw new Error('The CarlasHub workbook template is missing a required worksheet.');
  }

  const lookup = getLookup(lookupSheet);
  const findingTemplate = prepareRows(findingsSheet, 7, 7, 25);
  summary.findings.forEach((finding, index) => {
    writeStyledRow(
      findingsSheet,
      index + 7,
      reportRowValues(finding, findingId(finding, index), criterionEntries(finding, lookup), options.outputPath),
      findingTemplate
    );
  });
  findingsSheet.autoFilter = {
    from: { row: 6, column: 1 },
    to: { row: Math.max(7, summary.findings.length + 6), column: 25 }
  };

  populateSummary(summarySheet, summary);
  populatePageInventory(pageSheet, summary);
  populateEvidence(evidenceSheet, summary, options.outputPath);
  populateManualChecks(manualSheet, summary);
  populateCriteria(workbook, summary);
  populateComparison(workbook, summary);
  populateHistory(workbook, summary);
  applySummaryPresentation(summarySheet);
  applyFindingPresentation(findingsSheet, summary.findings);
  applySupportingSheetPresentation(pageSheet, 4, 5, 7, 2);
  applySupportingSheetPresentation(evidenceSheet, 4, 5, 9, 2);
  applySupportingSheetPresentation(manualSheet, 4, 5, 7, 2);
  applySupportingSheetPresentation(lookupSheet, 3, 4, 4);
  applyStatusBadges(pageSheet, manualSheet);
  workbook.creator = summary.auditor;
  workbook.lastModifiedBy = summary.auditor;
  workbook.created = new Date(summary.generatedAt);
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  await workbook.xlsx.writeFile(options.outputPath);
  return options.outputPath;
}
