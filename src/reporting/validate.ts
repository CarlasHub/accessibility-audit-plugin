import { access } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { cellText } from './cell-text.js';

export interface WorkbookValidation {
  valid: boolean;
  findingRows: number;
  evidenceRows?: number;
  /** Screenshot-link count retained under the previous API name for compatibility. */
  imageInventoryRows: number;
  errors: string[];
  warnings: string[];
  auditor: string;
}

export const EXPECTED_REPORT_HEADERS = [
  'Finding ID', 'Evidence type', 'Status', 'Severity', 'WCAG criterion', 'Level', 'WCAG title',
  'Affected URL(s)', 'Viewport(s)', 'Component', 'Location', 'Summary', 'Issue', 'User impact',
  'Technical locator', 'Test method', 'Actual result', 'Expected result', 'Recommendation', 'Owner',
  'Effort', 'Screenshot', 'Rule ID', 'Labels', 'Translation review'
];

export const EXPECTED_WORKSHEETS = [
  'Audit Summary',
  'Findings',
  'Page Inventory',
  'Evidence',
  'Manual Checks',
  'WCAG 2.2 Reference'
] as const;

const expectedHeaders = new Map<string, { row: number; values: string[] }>([
  ['Findings', { row: 6, values: EXPECTED_REPORT_HEADERS }],
  ['Page Inventory', { row: 4, values: ['URL', 'Audit state', 'Viewports planned', 'Viewports completed', 'Consent handling', 'Runtime errors', 'Notes'] }],
  ['Evidence', { row: 4, values: ['Evidence path', 'Finding ID', 'Page URL', 'Viewport', 'Rule ID', 'Component', 'Technical locator', 'Evidence type', 'Detail'] }],
  ['Manual Checks', { row: 4, values: ['Check ID', 'Manual check', 'WCAG criterion', 'Applies to', 'Procedure', 'Status', 'Reviewer notes'] }],
  ['WCAG 2.2 Reference', { row: 3, values: ['Success criterion', 'Level', 'Title', 'Understanding link'] }]
]);

const expectedTabColors = new Map<string, string>([
  ['Audit Summary', 'FF17365D'],
  ['Findings', 'FFC00000'],
  ['Page Inventory', 'FF4472C4'],
  ['Evidence', 'FF548235'],
  ['Manual Checks', 'FFBF9000'],
  ['WCAG 2.2 Reference', 'FF7F7F7F']
]);

const allowedClassifications = new Set(['confirmed', 'review', 'blocker', 'manual']);
const allowedStatuses = new Set(['Open', 'In progress', 'Resolved', 'Risk accepted', 'Not applicable']);
const allowedSeverities = new Set(['Critical', 'Serious', 'Moderate', 'Minor', 'Advisory']);

function cellHyperlink(value: unknown): string {
  return typeof value === 'object' && value !== null && 'hyperlink' in value
    ? String(value.hyperlink ?? '').trim()
    : '';
}

function validateTemplateShape(workbook: ExcelJS.Workbook, errors: string[]): void {
  const names = workbook.worksheets.map((worksheet) => worksheet.name);
  if (names.join('|') !== EXPECTED_WORKSHEETS.join('|')) {
    errors.push(`Worksheet names and order must be exactly: ${EXPECTED_WORKSHEETS.join(', ')}.`);
  }
  for (const [name, expected] of expectedHeaders) {
    const worksheet = workbook.getWorksheet(name);
    if (!worksheet) continue;
    const actual = expected.values.map((_, index) => cellText(worksheet.getRow(expected.row).getCell(index + 1)));
    if (actual.join('|') !== expected.values.join('|')) errors.push(`${name} header row does not match the CarlasHub template.`);
  }
  for (const [name, color] of expectedTabColors) {
    if (workbook.getWorksheet(name)?.properties.tabColor?.argb !== color) {
      errors.push(`${name} worksheet tab colour does not match the CarlasHub template.`);
    }
  }
}

async function validateRelativeEvidenceLink(
  workbookPath: string,
  hyperlink: string,
  location: string,
  errors: string[]
): Promise<void> {
  let decoded = '';
  try {
    decoded = decodeURIComponent(hyperlink);
  } catch {
    errors.push(`${location} contains an invalid evidence hyperlink.`);
    return;
  }
  const segments = decoded.replaceAll('\\', '/').split('/');
  if (!decoded || segments.includes('..') || isAbsolute(decoded) || /^file:/i.test(decoded) || /^[a-z]:[\\/]/i.test(decoded)) {
    errors.push(`${location} must use a relative evidence hyperlink.`);
    return;
  }
  try {
    await access(resolve(dirname(workbookPath), decoded));
  } catch {
    errors.push(`${location} points to an evidence file that is not available beside the workbook.`);
  }
}

function validateHttpCell(cell: ExcelJS.Cell, label: string, errors: string[]): void {
  const url = cellText(cell);
  if (!/^https?:\/\/\S+$/i.test(url)) errors.push(`${label} must contain one HTTP(S) URL.`);
  if (cellHyperlink(cell.value) !== url) errors.push(`${label} must link to the same URL displayed in the cell.`);
}

export async function validateExcelReport(path: string): Promise<WorkbookValidation> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const errors: string[] = [];
  const warnings: string[] = [];
  validateTemplateShape(workbook, errors);
  for (const name of EXPECTED_WORKSHEETS) {
    if (!workbook.getWorksheet(name)) errors.push(`Missing ${name} worksheet.`);
  }

  const findings = workbook.getWorksheet('Findings');
  let findingRows = 0;
  if (findings) {
    for (let rowNumber = 7; rowNumber <= findings.rowCount; rowNumber += 1) {
      const row = findings.getRow(rowNumber);
      if (!cellText(row.getCell(1))) continue;
      findingRows += 1;
      if (!/^A11Y\d{3,}$/.test(cellText(row.getCell(1)))) errors.push(`Findings!A${rowNumber} must contain a generated finding ID.`);
      if (!allowedClassifications.has(cellText(row.getCell(2)))) errors.push(`Findings!B${rowNumber} contains an unsupported evidence type.`);
      if (!allowedStatuses.has(cellText(row.getCell(3)))) errors.push(`Findings!C${rowNumber} contains an unsupported status.`);
      if (!allowedSeverities.has(cellText(row.getCell(4)))) errors.push(`Findings!D${rowNumber} contains an unsupported severity.`);
      for (let column = 1; column <= EXPECTED_REPORT_HEADERS.length; column += 1) {
        if (!cellText(row.getCell(column))) errors.push(`Required finding cell ${row.getCell(column).address} is empty.`);
      }
      const screenshot = cellText(row.getCell(22));
      const screenshotLink = cellHyperlink(row.getCell(22).value);
      if (screenshot !== 'Not captured') {
        if (!screenshotLink) errors.push(`Findings!V${rowNumber} must contain a relative evidence hyperlink or “Not captured”.`);
        else await validateRelativeEvidenceLink(path, screenshotLink, `Findings!V${rowNumber}`, errors);
      }
    }
  }
  if (findingRows === 0) warnings.push('The workbook contains no finding rows.');

  const pages = workbook.getWorksheet('Page Inventory');
  if (pages) {
    const seen = new Set<string>();
    for (let rowNumber = 5; rowNumber <= pages.rowCount; rowNumber += 1) {
      const cell = pages.getRow(rowNumber).getCell(1);
      if (!cellText(cell)) continue;
      validateHttpCell(cell, `Page Inventory!A${rowNumber}`, errors);
      if (seen.has(cellText(cell))) errors.push(`Page Inventory!A${rowNumber} duplicates an earlier URL.`);
      seen.add(cellText(cell));
    }
  }

  const evidence = workbook.getWorksheet('Evidence');
  let evidenceRows = 0;
  let imageInventoryRows = 0;
  if (evidence) {
    for (let rowNumber = 5; rowNumber <= evidence.rowCount; rowNumber += 1) {
      const row = evidence.getRow(rowNumber);
      if (!Array.from({ length: 9 }, (_, index) => cellText(row.getCell(index + 1))).some(Boolean)) continue;
      evidenceRows += 1;
      for (let column = 1; column <= 9; column += 1) {
        if (!cellText(row.getCell(column))) errors.push(`Required evidence cell ${row.getCell(column).address} is empty.`);
      }
      validateHttpCell(row.getCell(3), `Evidence!C${rowNumber}`, errors);
      const reference = cellText(row.getCell(1));
      const hyperlink = cellHyperlink(row.getCell(1).value);
      if (reference !== 'Not captured') {
        imageInventoryRows += 1;
        if (!hyperlink) errors.push(`Evidence!A${rowNumber} must contain a relative evidence hyperlink or “Not captured”.`);
        else await validateRelativeEvidenceLink(path, hyperlink, `Evidence!A${rowNumber}`, errors);
      }
    }
  }

  const embeddedImages = workbook.worksheets.reduce((total, worksheet) => total + worksheet.getImages().length, 0);
  if (embeddedImages) errors.push(`Workbook contains ${embeddedImages} embedded image(s); evidence must remain linked to keep it portable and lightweight.`);
  const summary = workbook.getWorksheet('Audit Summary');
  const auditor = summary ? cellText(summary.getCell('B6')) : '';
  if (!auditor) errors.push('Auditor is empty in Audit Summary!B6.');
  if (summary) validateHttpCell(summary.getCell('B8'), 'Audit Summary!B8', errors);

  return { valid: errors.length === 0, findingRows, evidenceRows, imageInventoryRows, errors, warnings, auditor };
}
