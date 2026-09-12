import { access } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { REQUIRED_MANUAL_CHECKS } from '../audit/manual-checks.js';
import { WCAG_CRITERIA_DEFINITIONS } from '../audit/wcag-criteria.js';
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

export const EXPECTED_TEMPLATE_REPORT_HEADERS = [
  'Finding ID', 'Evidence type', 'Status', 'Severity', 'WCAG criterion', 'Level', 'WCAG title',
  'Affected URL(s)', 'Viewport(s)', 'Component', 'Location', 'Summary', 'Issue', 'User impact',
  'Technical locator', 'Test method', 'Actual result', 'Expected result', 'Recommendation', 'Owner',
  'Effort', 'Screenshot', 'Rule ID', 'Labels', 'Translation review'
];

export const EXPECTED_REPORT_HEADERS = EXPECTED_TEMPLATE_REPORT_HEADERS.map((header, index) => {
  if (index === 1) return 'Classification';
  if (index === 3) return 'Impact / review priority';
  if (index === 16) return 'Observed evidence';
  return header;
});

export const EXPECTED_TEMPLATE_WORKSHEETS = [
  'Audit Summary',
  'Findings',
  'Page Inventory',
  'Evidence',
  'Manual Checks',
  'WCAG 2.2 Reference'
] as const;

export const EXPECTED_WORKSHEETS = [
  ...EXPECTED_TEMPLATE_WORKSHEETS,
  'WCAG Criteria'
] as const;

const expectedHeaders = new Map<string, { row: number; values: string[] }>([
  ['Findings', { row: 6, values: EXPECTED_REPORT_HEADERS }],
  ['Page Inventory', { row: 4, values: ['URL', 'Audit state', 'Viewports planned', 'Viewports completed', 'Consent handling', 'Runtime errors', 'Notes'] }],
  ['Evidence', { row: 4, values: ['Evidence path', 'Finding ID', 'Page URL', 'Viewport', 'Rule ID', 'Component', 'Technical locator', 'Evidence type', 'Detail'] }],
  ['Manual Checks', { row: 4, values: ['Check ID', 'Manual check', 'WCAG criterion', 'Applies to', 'Procedure', 'Status', 'Reviewer notes'] }],
  ['WCAG 2.2 Reference', { row: 3, values: ['Success criterion', 'Level', 'Title', 'Understanding link'] }],
  ['WCAG Criteria', { row: 4, values: ['Criterion', 'Level', 'Scope', 'Status', 'Finding IDs', 'Automated evidence', 'Decision note', 'Understanding'] }]
]);

const expectedTabColors = new Map<string, string>([
  ['Audit Summary', 'FF17365D'],
  ['Findings', 'FFC00000'],
  ['Page Inventory', 'FF4472C4'],
  ['Evidence', 'FF548235'],
  ['Manual Checks', 'FFBF9000'],
  ['WCAG 2.2 Reference', 'FF7F7F7F'],
  ['WCAG Criteria', 'FF7030A0']
]);

const allowedClassifications = new Set(['confirmed', 'review', 'blocker', 'manual']);
const allowedStatuses = new Set(['Open', 'In progress', 'Resolved', 'Risk accepted', 'Not applicable']);
const allowedSeverities = new Set(['Critical', 'Serious', 'Moderate', 'Minor', 'Advisory']);
const allowedCriterionStatuses = new Set(['passed', 'failed', 'manual-review-required', 'not-applicable', 'inconclusive']);
const allowedEvidenceKinds = new Set(['axe', 'dom', 'keyboard', 'responsive', 'network', 'manual']);
const criterionDefinitions = new Map(WCAG_CRITERIA_DEFINITIONS.map((criterion) => [criterion.criterion, criterion]));
const standardCriteria = new Set(WCAG_CRITERIA_DEFINITIONS.filter(({ level }) => level !== 'AAA').map(({ criterion }) => criterion));
const requiredManualChecks = new Map(REQUIRED_MANUAL_CHECKS.map((check) => [check.id, check]));

interface FindingWorkbookRecord {
  classification: string;
  criteria: Set<string>;
  rowNumber: number;
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function criterionId(value: string): string {
  return value.trim().split(/\s+/, 1)[0] ?? '';
}

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
  const findingRecords = new Map<string, FindingWorkbookRecord>();
  if (findings) {
    for (let rowNumber = 7; rowNumber <= findings.rowCount; rowNumber += 1) {
      const row = findings.getRow(rowNumber);
      if (!cellText(row.getCell(1))) continue;
      findingRows += 1;
      const id = cellText(row.getCell(1));
      const classification = cellText(row.getCell(2));
      const mappedCriteria = new Set(lines(cellText(row.getCell(5))).filter((value) => !['Advisory', 'Best Practice', 'None'].includes(value)));
      if (!/^A11Y\d{3,}$/.test(id)) errors.push(`Findings!A${rowNumber} must contain a generated finding ID.`);
      if (findingRecords.has(id)) errors.push(`Findings!A${rowNumber} duplicates finding ID ${id}.`);
      findingRecords.set(id, { classification, criteria: mappedCriteria, rowNumber });
      if (!allowedClassifications.has(classification)) errors.push(`Findings!B${rowNumber} contains an unsupported evidence type.`);
      if (!allowedStatuses.has(cellText(row.getCell(3)))) errors.push(`Findings!C${rowNumber} contains an unsupported status.`);
      if (!allowedSeverities.has(cellText(row.getCell(4)))) errors.push(`Findings!D${rowNumber} contains an unsupported severity.`);
      for (const criterion of mappedCriteria) {
        if (!criterionDefinitions.has(criterion)) errors.push(`Findings!E${rowNumber} maps to unknown or obsolete criterion ${criterion}.`);
      }
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
  const evidenceFindingIds = new Set<string>();
  if (evidence) {
    for (let rowNumber = 5; rowNumber <= evidence.rowCount; rowNumber += 1) {
      const row = evidence.getRow(rowNumber);
      if (!Array.from({ length: 9 }, (_, index) => cellText(row.getCell(index + 1))).some(Boolean)) continue;
      evidenceRows += 1;
      for (let column = 1; column <= 9; column += 1) {
        if (!cellText(row.getCell(column))) errors.push(`Required evidence cell ${row.getCell(column).address} is empty.`);
      }
      const evidenceFindingId = cellText(row.getCell(2));
      evidenceFindingIds.add(evidenceFindingId);
      if (!findingRecords.has(evidenceFindingId)) errors.push(`Evidence!B${rowNumber} refers to unknown finding ID ${evidenceFindingId}.`);
      if (!allowedEvidenceKinds.has(cellText(row.getCell(8)))) errors.push(`Evidence!H${rowNumber} contains an unsupported evidence type.`);
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
  for (const [id, finding] of findingRecords) {
    if (!evidenceFindingIds.has(id)) errors.push(`Finding ${id} at Findings!A${finding.rowNumber} has no evidence row.`);
  }

  const manualChecks = workbook.getWorksheet('Manual Checks');
  if (manualChecks) {
    const seenChecks = new Set<string>();
    const seenCriteria = new Set<string>();
    for (let rowNumber = 5; rowNumber <= manualChecks.rowCount; rowNumber += 1) {
      const row = manualChecks.getRow(rowNumber);
      if (!cellText(row.getCell(1))) continue;
      const id = cellText(row.getCell(1));
      const criterion = cellText(row.getCell(3));
      const expected = requiredManualChecks.get(id);
      if (seenChecks.has(id)) errors.push(`Manual Checks!A${rowNumber} duplicates check ID ${id}.`);
      seenChecks.add(id);
      if (!expected) errors.push(`Manual Checks!A${rowNumber} contains unknown check ID ${id}.`);
      if (!standardCriteria.has(criterion)) errors.push(`Manual Checks!C${rowNumber} must map to one active WCAG 2.2 A/AA criterion.`);
      if (seenCriteria.has(criterion)) errors.push(`Manual Checks!C${rowNumber} duplicates criterion ${criterion}.`);
      seenCriteria.add(criterion);
      if (expected && expected.wcag[0] !== criterion) errors.push(`Manual Checks!C${rowNumber} does not match ${id}.`);
      for (const column of [2, 4, 5, 7]) {
        if (!cellText(row.getCell(column))) errors.push(`Required manual-check cell ${row.getCell(column).address} is empty.`);
      }
      if (cellText(row.getCell(6)) !== 'Not tested') errors.push(`Manual Checks!F${rowNumber} must initially be “Not tested”.`);
    }
    const missingChecks = [...requiredManualChecks.keys()].filter((id) => !seenChecks.has(id));
    const missingCriteria = [...standardCriteria].filter((criterion) => !seenCriteria.has(criterion));
    if (missingChecks.length) errors.push(`Manual Checks is missing ${missingChecks.length} required check(s): ${missingChecks.join(', ')}.`);
    if (missingCriteria.length) errors.push(`Manual Checks is missing ${missingCriteria.length} WCAG 2.2 A/AA criterion mapping(s): ${missingCriteria.join(', ')}.`);
    if (seenChecks.size !== REQUIRED_MANUAL_CHECKS.length) errors.push(`Manual Checks must contain exactly ${REQUIRED_MANUAL_CHECKS.length} unique required checks.`);
  }

  const embeddedImages = workbook.worksheets.reduce((total, worksheet) => total + worksheet.getImages().length, 0);
  if (embeddedImages) errors.push(`Workbook contains ${embeddedImages} embedded image(s); evidence must remain linked to keep it portable and lightweight.`);
  const summary = workbook.getWorksheet('Audit Summary');
  const aaaAdvisoryEnabled = summary
    ? cellText(summary.getCell('B7')).includes('separate Level AAA advisory checks enabled')
    : false;
  const criteria = workbook.getWorksheet('WCAG Criteria');
  if (criteria) {
    const seenCriteria = new Set<string>();
    for (let rowNumber = 5; rowNumber <= criteria.rowCount; rowNumber += 1) {
      const row = criteria.getRow(rowNumber);
      if (!cellText(row.getCell(1))) continue;
      const id = criterionId(cellText(row.getCell(1)));
      const definition = criterionDefinitions.get(id);
      if (seenCriteria.has(id)) errors.push(`WCAG Criteria!A${rowNumber} duplicates criterion ${id}.`);
      seenCriteria.add(id);
      for (let column = 1; column <= 8; column += 1) {
        if (!cellText(row.getCell(column))) errors.push(`Required criterion cell ${row.getCell(column).address} is empty.`);
      }
      if (!definition) errors.push(`WCAG Criteria!A${rowNumber} contains unknown or obsolete criterion ${id}.`);
      const level = cellText(row.getCell(2));
      const scope = cellText(row.getCell(3));
      const status = cellText(row.getCell(4));
      if (definition && level !== definition.level) errors.push(`WCAG Criteria!B${rowNumber} does not match criterion ${id}.`);
      if (definition && scope !== (definition.level === 'AAA' ? 'AAA advisory' : 'AA conformance target')) {
        errors.push(`WCAG Criteria!C${rowNumber} does not match criterion ${id}.`);
      }
      if (!allowedCriterionStatuses.has(status)) errors.push(`WCAG Criteria!D${rowNumber} contains an unsupported status.`);
      if (status === 'passed') errors.push(`WCAG Criteria!D${rowNumber} cannot be marked passed by an automated report.`);
      const referencedIds = lines(cellText(row.getCell(5))).filter((value) => value !== 'None');
      const related = [...findingRecords.entries()].filter(([, finding]) => finding.criteria.has(id));
      const confirmedIds = related.filter(([, finding]) => finding.classification === 'confirmed').map(([findingId]) => findingId);
      const unresolvedIds = related.filter(([, finding]) => ['review', 'blocker'].includes(finding.classification)).map(([findingId]) => findingId);
      for (const findingId of referencedIds) {
        const finding = findingRecords.get(findingId);
        if (!finding) errors.push(`WCAG Criteria!E${rowNumber} refers to unknown finding ID ${findingId}.`);
        else if (!finding.criteria.has(id)) errors.push(`WCAG Criteria!E${rowNumber} refers to ${findingId}, which is not mapped to criterion ${id}.`);
      }
      const criterionIsEvaluated = definition?.level !== 'AAA' || aaaAdvisoryEnabled;
      if (criterionIsEvaluated) {
        if (confirmedIds.length && status !== 'failed') errors.push(`WCAG Criteria!D${rowNumber} must be failed because confirmed finding(s) map to ${id}.`);
        if (!confirmedIds.length && status === 'failed') errors.push(`WCAG Criteria!D${rowNumber} cannot be failed without a confirmed finding mapped to ${id}.`);
        if (!confirmedIds.length && unresolvedIds.length && status !== 'inconclusive') errors.push(`WCAG Criteria!D${rowNumber} must be inconclusive while review or blocker findings map to ${id}.`);
        const allowedUnevaluatedStatuses = definition?.level === 'AAA' ? ['inconclusive'] : ['manual-review-required', 'inconclusive'];
        if (!confirmedIds.length && !unresolvedIds.length && !allowedUnevaluatedStatuses.includes(status)) {
          errors.push(`WCAG Criteria!D${rowNumber} requires a human decision for ${id}.`);
        }
      }
      if (definition?.level === 'AAA' && !aaaAdvisoryEnabled && status !== 'not-applicable') errors.push(`WCAG Criteria!D${rowNumber} must keep optional AAA criterion ${id} outside the AA conformance decision.`);
      if (criterionIsEvaluated) {
        for (const confirmedId of confirmedIds) {
          if (!referencedIds.includes(confirmedId)) errors.push(`WCAG Criteria!E${rowNumber} is missing confirmed finding ${confirmedId}.`);
        }
      }
      validateHttpCell(row.getCell(8), `WCAG Criteria!H${rowNumber}`, errors);
    }
    const missing = [...criterionDefinitions.keys()].filter((criterion) => !seenCriteria.has(criterion));
    if (missing.length) errors.push(`WCAG Criteria is missing ${missing.length} active criterion row(s): ${missing.join(', ')}.`);
    if (seenCriteria.size !== WCAG_CRITERIA_DEFINITIONS.length) errors.push(`WCAG Criteria must contain exactly ${WCAG_CRITERIA_DEFINITIONS.length} unique active WCAG 2.2 criteria.`);
  }
  const auditor = summary ? cellText(summary.getCell('B6')) : '';
  if (!auditor) errors.push('Auditor is empty in Audit Summary!B6.');
  if (summary) validateHttpCell(summary.getCell('B8'), 'Audit Summary!B8', errors);

  return { valid: errors.length === 0, findingRows, evidenceRows, imageInventoryRows, errors, warnings, auditor };
}
