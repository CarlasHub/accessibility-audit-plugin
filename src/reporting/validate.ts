import { access } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { cellText } from './cell-text.js';
import { IMAGE_INVENTORY_SHEET } from './image-inventory.js';

export interface WorkbookValidation {
  valid: boolean;
  findingRows: number;
  imageInventoryRows: number;
  errors: string[];
  warnings: string[];
  auditor: string;
}

export const EXPECTED_REPORT_HEADERS = [
  'ID', 'SC1', 'Level1', 'Synopsis1', 'Understanding1', 'SC2', 'Level2', 'Synopsis2', 'Understanding2',
  'SC3', 'Level3', 'Synopsis3', 'Understanding3', 'Links', 'Summary', 'Environment', 'Issue', 'Testing',
  'Screengrab', 'Translation?', 'ProductNote', 'Labels', 'Impact', 'Status', 'Assignment', 'Effort',
  'JIRASeverity', 'Specialist', 'Implementation', 'Notes', 'JIRA', 'Estimate'
];

export const EXPECTED_WORKSHEETS = [
  'Accessibility Overview',
  'Accessibility Report',
  'Page Inventroy',
  IMAGE_INVENTORY_SHEET,
  'Lookup WCAG 2.2'
] as const;

const expectedTabColors = new Map<string, string>([
  ['Accessibility Overview', 'FF6E00EF'],
  ['Accessibility Report', 'FFCC0000'],
  ['Page Inventroy', 'FF0000FF'],
  [IMAGE_INVENTORY_SHEET, 'FF38761D']
]);

const requiredIssueLabels = [
  'Component:', 'Location:', 'Affected viewport(s):', 'Accessibility issue:', 'User impact:', 'Technical locator:'
];

const requiredTestingMarkers = ['1.', 'Actual:', 'Expected:'];

function cellHyperlink(value: unknown): string {
  return typeof value === 'object' && value !== null && 'hyperlink' in value
    ? String(value.hyperlink ?? '').trim()
    : '';
}

function populatedCellsOutsideFirstColumn(worksheet: ExcelJS.Worksheet): string[] {
  const populated: string[] = [];
  worksheet.eachRow((row) => {
    for (let column = 2; column <= worksheet.columnCount; column += 1) {
      const cell = row.getCell(column);
      if (cellText(cell)) populated.push(cell.address);
    }
  });
  return populated;
}

function validateTemplateShape(workbook: ExcelJS.Workbook, errors: string[]): void {
  const worksheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
  if (worksheetNames.join('|') !== EXPECTED_WORKSHEETS.join('|')) {
    errors.push(`Worksheet names and order must be exactly: ${EXPECTED_WORKSHEETS.join(', ')}.`);
  }
  for (const [worksheetName, expectedColor] of expectedTabColors) {
    const worksheet = workbook.getWorksheet(worksheetName);
    const actualColor = worksheet?.properties.tabColor?.argb;
    if (actualColor !== expectedColor) {
      errors.push(`${worksheetName} worksheet tab colour does not match the supplied template.`);
    }
  }
  if (workbook.getWorksheet('Lookup WCAG 2.2')?.state !== 'hidden') {
    errors.push('Lookup WCAG 2.2 must remain hidden as defined by the supplied template.');
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
    errors.push(`${location} contains an invalid screenshot hyperlink.`);
    return;
  }
  const segments = decoded.replaceAll('\\', '/').split('/');
  if (!decoded || segments.includes('..') || isAbsolute(decoded) || /^file:/i.test(decoded) || /^[a-z]:[\\/]/i.test(decoded)) {
    errors.push(`${location} must use a relative screenshot hyperlink.`);
    return;
  }
  try {
    await access(resolve(dirname(workbookPath), decoded));
  } catch {
    errors.push(`${location} points to a screenshot file that is not available beside the workbook.`);
  }
}

export async function validateExcelReport(path: string): Promise<WorkbookValidation> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const errors: string[] = [];
  const warnings: string[] = [];
  const report = workbook.getWorksheet('Accessibility Report');
  const overview = workbook.getWorksheet('Accessibility Overview');
  const lookup = workbook.getWorksheet('Lookup WCAG 2.2');
  const imageInventory = workbook.getWorksheet(IMAGE_INVENTORY_SHEET);
  const pageInventory = workbook.getWorksheet('Page Inventroy');
  validateTemplateShape(workbook, errors);
  if (!report) errors.push('Missing Accessibility Report worksheet.');
  if (!overview) errors.push('Missing Accessibility Overview worksheet.');
  if (!lookup) errors.push('Missing Lookup WCAG 2.2 worksheet.');
  if (!pageInventory) errors.push('Missing Page Inventroy worksheet.');
  if (!imageInventory) errors.push(`Missing ${IMAGE_INVENTORY_SHEET} worksheet.`);
  if (workbook.getWorksheet('Screen Reader Failures')) errors.push('Obsolete Screen Reader Failures worksheet is present.');

  let findingRows = 0;
  if (report) {
    const headers = Array.from({ length: 32 }, (_, index) => cellText(report.getRow(1).getCell(index + 1)));
    if (headers.join('|') !== EXPECTED_REPORT_HEADERS.join('|')) errors.push('The 32-column Accessibility Report header does not match the template.');
    const extraReportCells: string[] = [];
    report.eachRow((row) => {
      for (let column = 33; column <= report.columnCount; column += 1) {
        if (cellText(row.getCell(column))) extraReportCells.push(row.getCell(column).address);
      }
    });
    if (extraReportCells.length) errors.push(`Accessibility Report contains values outside the 32 template columns: ${extraReportCells.join(', ')}.`);
    for (let rowNumber = 2; rowNumber <= report.rowCount; rowNumber += 1) {
      const row = report.getRow(rowNumber);
      if (!cellText(row.getCell(1))) continue;
      findingRows += 1;
      if (/^A11YEXP/i.test(cellText(row.getCell(1)))) errors.push(`Placeholder finding remains at row ${rowNumber}.`);
      if (!cellText(row.getCell(30))) errors.push(`Notes is empty at row ${rowNumber}.`);
      if (/jira/i.test(cellText(row.getCell(30)))) errors.push(`Notes contains a Jira reference at row ${rowNumber}.`);
      if (cellText(row.getCell(24)) !== 'Fail') errors.push(`Status must default to Fail at row ${rowNumber}.`);
      if (cellText(row.getCell(25)) === 'Development Support Traffic') {
        errors.push(`Assignment uses the retired default queue at row ${rowNumber}.`);
      }
      const estimateValue = Number(row.getCell(32).value);
      if (!Number.isFinite(estimateValue) || estimateValue < 0 || Math.abs(estimateValue * 4 - Math.round(estimateValue * 4)) > 1e-8) {
        errors.push(`Estimate must be 0 or a non-negative 0.25 increment at row ${rowNumber}.`);
      }
      const estimateValidation = row.getCell(32).dataValidation;
      const expectedEstimateFormula = `=OR(AF${rowNumber}=0,MOD(AF${rowNumber},0.25)=0)`;
      if (estimateValidation.type !== 'custom' || estimateValidation.formulae?.[0] !== expectedEstimateFormula) {
        errors.push(`Estimate validation is missing or incorrect at row ${rowNumber}.`);
      }
      if (row.getCell(32).numFmt !== '0.00;-0.00;0') {
        errors.push(`Estimate number format is incorrect at row ${rowNumber}.`);
      }
      const issue = cellText(row.getCell(17));
      for (const label of requiredIssueLabels) {
        if (!issue.includes(label)) errors.push(`Issue is missing “${label}” context at row ${rowNumber}.`);
      }
      const summary = cellText(row.getCell(15));
      if (!/^(?:Desktop|Mobile|Desktop and mobile|Tested viewport):\s+\S/.test(summary)) {
        errors.push(`Summary is missing the affected viewport scope at row ${rowNumber}.`);
      }
      const testing = cellText(row.getCell(18));
      for (const marker of requiredTestingMarkers) {
        if (!testing.includes(marker)) errors.push(`Testing is missing “${marker}” evidence at row ${rowNumber}.`);
      }
      const reportScreenshotLink = cellHyperlink(row.getCell(19).value);
      if (reportScreenshotLink) {
        await validateRelativeEvidenceLink(path, reportScreenshotLink, `Accessibility Report!${row.getCell(19).address}`, errors);
      }
      const requiredColumns = [1, 2, 6, 10, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
      for (const column of requiredColumns) {
        if (!cellText(row.getCell(column))) errors.push(`Required cell ${row.getCell(column).address} is empty.`);
      }
    }
  }
  if (findingRows === 0) warnings.push('The report contains no finding rows.');
  let imageInventoryRows = 0;
  if (imageInventory) {
    const extraCells = populatedCellsOutsideFirstColumn(imageInventory);
    if (extraCells.length) {
      errors.push(`${IMAGE_INVENTORY_SHEET} must contain only the column-A evidence reference list; extra values exist in ${extraCells.join(', ')}.`);
    }
    const seenReferences = new Set<string>();
    for (let rowNumber = 1; rowNumber <= imageInventory.rowCount; rowNumber += 1) {
      const row = imageInventory.getRow(rowNumber);
      if (!cellText(row.getCell(1))) continue;
      imageInventoryRows += 1;
      const reference = cellText(row.getCell(1));
      const screenshotLink = cellHyperlink(row.getCell(1).value);
      if (!screenshotLink) {
        errors.push(`${IMAGE_INVENTORY_SHEET}!${row.getCell(1).address} is not a screenshot hyperlink.`);
      } else {
        if (reference !== screenshotLink) {
          errors.push(`${IMAGE_INVENTORY_SHEET}!${row.getCell(1).address} must display the same relative path used by its hyperlink.`);
        }
        await validateRelativeEvidenceLink(path, screenshotLink, `${IMAGE_INVENTORY_SHEET}!${row.getCell(1).address}`, errors);
      }
      if (seenReferences.has(reference)) {
        errors.push(`${IMAGE_INVENTORY_SHEET}!${row.getCell(1).address} duplicates an earlier evidence reference.`);
      }
      seenReferences.add(reference);
    }
    const embeddedImageCount = imageInventory.getImages().length;
    if (embeddedImageCount > 0) errors.push(`${IMAGE_INVENTORY_SHEET} contains ${embeddedImageCount} embedded image(s); screenshot evidence must remain linked to keep the workbook lightweight.`);
  }
  if (pageInventory) {
    const extraCells = populatedCellsOutsideFirstColumn(pageInventory);
    if (extraCells.length) {
      errors.push(`Page Inventroy must contain only the column-A scanned URL list; extra values exist in ${extraCells.join(', ')}.`);
    }
    const seenUrls = new Set<string>();
    for (let rowNumber = 1; rowNumber <= pageInventory.rowCount; rowNumber += 1) {
      const cell = pageInventory.getRow(rowNumber).getCell(1);
      const url = cellText(cell);
      if (!url) continue;
      const hyperlink = cellHyperlink(cell.value);
      if (!/^https?:\/\/\S+$/i.test(url)) {
        errors.push(`Page Inventroy!${cell.address} must contain one HTTP(S) scanned URL.`);
      }
      if (hyperlink !== url) {
        errors.push(`Page Inventroy!${cell.address} must link to the same scanned URL displayed in the cell.`);
      }
      if (seenUrls.has(url)) errors.push(`Page Inventroy!${cell.address} duplicates an earlier scanned URL.`);
      seenUrls.add(url);
    }
  }
  const auditor = overview ? cellText(overview.getCell('B8')) : '';
  if (!auditor) errors.push('Auditor is empty in Accessibility Overview!B8.');
  const qaUrl = overview ? cellText(overview.getCell('B5')) : '';
  if (!/^https?:\/\/\S+$/i.test(qaUrl)) errors.push('Accessibility Overview!B5 must contain one HTTP(S) landing-page QA URL.');
  return { valid: errors.length === 0, findingRows, imageInventoryRows, errors, warnings, auditor };
}
