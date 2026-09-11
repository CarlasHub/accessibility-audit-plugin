import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS, { type CellValue, type DataValidation, type Style, type Worksheet } from 'exceljs';
import type { AuditSummary, Finding, PageAudit } from '../types.js';
import { findingId } from './finding-id.js';

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

async function assertCanonicalTemplate(path: string): Promise<void> {
  const digest = createHash('sha256').update(await readFile(path)).digest('hex');
  if (digest !== CANONICAL_TEMPLATE_SHA256) {
    throw new Error(`The report template does not match the CarlasHub WCAG audit template (${CANONICAL_TEMPLATE_SHA256}); received ${digest}.`);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
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
    finding.issue,
    expectedOutcome(finding, criteria),
    finding.remediation,
    finding.assignment,
    finding.effort,
    screenshotLink(finding, outputPath),
    finding.ruleId,
    [finding.classification, finding.ruleId, ...finding.wcag.map((criterion) => `WCAG ${criterion}`)].join(', '),
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
      ''
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

function populateSummary(worksheet: Worksheet, summary: AuditSummary): void {
  const allViewports = summary.pages.flatMap((page) => page.viewports);
  const classifications = (classification: Finding['classification']): number =>
    summary.findings.filter((finding) => finding.classification === classification).length;
  const severities = (severity: Finding['severity']): number =>
    summary.findings.filter((finding) => finding.severity === severity).length;
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
  worksheet.getCell('E4').value = summary.findings.length;
  worksheet.getCell('E5').value = classifications('confirmed');
  worksheet.getCell('E6').value = classifications('review');
  worksheet.getCell('E7').value = classifications('blocker');
  worksheet.getCell('E8').value = summary.manualChecks.length;
  (['Critical', 'Serious', 'Moderate', 'Minor', 'Advisory'] as const).forEach((severity, index) => {
    worksheet.getCell(`H${index + 4}`).value = severities(severity);
  });
  worksheet.getCell('A14').value = [
    `Requested URLs: ${summary.requestedUrls.length}`,
    `Audited URLs: ${summary.auditedUrls.length}`,
    `Partial pages: ${summary.pages.filter((page) => page.partial).length}`,
    `Skipped URLs: ${summary.skippedUrls.length}`,
    `Viewports run: ${allViewports.length}`,
    `Conformance target: WCAG 2.2 Level AA`,
    `AAA advisory checks: ${aaaAdvisory ? 'Enabled' : 'Disabled'}`,
    `Source: ${summary.source}`
  ].join('\n');
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
  worksheet.getCell('A14').alignment = { vertical: 'top', wrapText: true };
  worksheet.getCell('A19').alignment = { vertical: 'top', wrapText: true };
  worksheet.getRow(19).height = 156;
}

function applyFindingPresentation(worksheet: Worksheet, findings: Finding[]): void {
  worksheet.views = [{
    state: 'frozen',
    xSplit: 4,
    ySplit: 6,
    topLeftCell: 'E7',
    showGridLines: false,
    zoomScale: 85
  }];
  worksheet.getCell('A4').value = 'Prioritise confirmed barriers and blockers. Review rows are evidence-led candidates that require human validation; severity is colour-coded and also stated as text.';
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
    const severity = SEVERITY_COLOURS[finding.severity];
    styleBadge(row.getCell(4), severity.background, severity.foreground);
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
