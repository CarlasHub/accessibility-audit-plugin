import { access } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { IMAGE_INVENTORY_HEADERS, IMAGE_INVENTORY_SHEET } from './image-inventory.js';

export interface WorkbookValidation {
  valid: boolean;
  findingRows: number;
  imageInventoryRows: number;
  errors: string[];
  warnings: string[];
  auditor: string;
}

const expectedHeaders = [
  'ID', 'SC1', 'Level1', 'Synopsis1', 'Understanding1', 'SC2', 'Level2', 'Synopsis2', 'Understanding2',
  'SC3', 'Level3', 'Synopsis3', 'Understanding3', 'Links', 'Summary', 'Environment', 'Issue', 'Testing',
  'Screengrab', 'Translation?', 'ProductNote', 'Labels', 'Impact', 'Status', 'Assignment', 'Effort',
  'JIRASeverity', 'Specialist', 'Implementation', 'Notes', 'JIRA', 'Estimate'
];

const expectedPageInventoryHeaders = [
  'Requested URL', 'Final URL', 'HTTP Status', 'Page Title', 'Viewport', 'Consent Handling', 'Audit Errors'
];

const requiredIssueLabels = [
  'Component:', 'Location:', 'Affected viewport(s):', 'Accessibility issue:', 'User impact:', 'Technical locator:'
];

const requiredTestingMarkers = ['1.', 'Actual:', 'Expected:'];

function cellText(value: { text: unknown; value: unknown }): string {
  const candidate = value.text ?? value.value ?? '';
  if (typeof candidate === 'string') return candidate.trim();
  if (typeof candidate === 'object' && candidate && 'result' in candidate) return String(candidate.result ?? '').trim();
  return String(candidate).trim();
}

function cellHyperlink(value: unknown): string {
  return typeof value === 'object' && value !== null && 'hyperlink' in value
    ? String(value.hyperlink ?? '').trim()
    : '';
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
  if (!report) errors.push('Missing Accessibility Report worksheet.');
  if (!overview) errors.push('Missing Accessibility Overview worksheet.');
  if (!lookup) errors.push('Missing Lookup WCAG 2.2 worksheet.');
  if (!imageInventory) errors.push(`Missing ${IMAGE_INVENTORY_SHEET} worksheet.`);
  if (workbook.getWorksheet('Screen Reader Failures')) errors.push('Obsolete Screen Reader Failures worksheet is present.');

  let findingRows = 0;
  if (report) {
    const headers = Array.from({ length: 32 }, (_, index) => cellText(report.getRow(1).getCell(index + 1)));
    if (headers.join('|') !== expectedHeaders.join('|')) errors.push('The 32-column Accessibility Report header does not match the template.');
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
    const headers = Array.from(
      { length: IMAGE_INVENTORY_HEADERS.length },
      (_, index) => cellText(imageInventory.getRow(1).getCell(index + 1))
    );
    if (headers.join('|') !== IMAGE_INVENTORY_HEADERS.join('|')) {
      errors.push(`The ${IMAGE_INVENTORY_SHEET} header does not match the required schema.`);
    }
    for (let rowNumber = 2; rowNumber <= imageInventory.rowCount; rowNumber += 1) {
      const row = imageInventory.getRow(rowNumber);
      if (!cellText(row.getCell(1))) continue;
      if (cellText(row.getCell(3)) === 'N/A') continue;
      imageInventoryRows += 1;
      for (let column = 1; column <= IMAGE_INVENTORY_HEADERS.length; column += 1) {
        if (!cellText(row.getCell(column))) errors.push(`Required cell ${IMAGE_INVENTORY_SHEET}!${row.getCell(column).address} is empty.`);
      }
      const screenshotLink = cellHyperlink(row.getCell(10).value);
      if (!screenshotLink) {
        errors.push(`${IMAGE_INVENTORY_SHEET}!${row.getCell(10).address} is not a screenshot hyperlink.`);
      } else {
        await validateRelativeEvidenceLink(path, screenshotLink, `${IMAGE_INVENTORY_SHEET}!${row.getCell(10).address}`, errors);
      }
      if (cellText(row.getCell(7)) === 'Full-page screenshot' && !/^(?:page|html|body|page-level or structural check)$/i.test(cellText(row.getCell(6)))) {
        errors.push(`${IMAGE_INVENTORY_SHEET}!${row.getCell(7).address} must not use full-page evidence for a component locator.`);
      }
    }
    const embeddedImageCount = imageInventory.getImages().length;
    if (embeddedImageCount > 0) errors.push(`${IMAGE_INVENTORY_SHEET} contains ${embeddedImageCount} embedded image(s); screenshot evidence must remain linked to keep the workbook lightweight.`);
  }
  const pageInventory = workbook.getWorksheet('Page Inventroy');
  if (!pageInventory) {
    errors.push('Missing Page Inventroy worksheet.');
  } else {
    const headers = expectedPageInventoryHeaders.map((_, index) => cellText(pageInventory.getRow(1).getCell(index + 1)));
    if (headers.join('|') !== expectedPageInventoryHeaders.join('|')) {
      errors.push('The Page Inventroy header does not include the required consent-handling evidence column.');
    }
    for (let rowNumber = 2; rowNumber <= pageInventory.rowCount; rowNumber += 1) {
      const row = pageInventory.getRow(rowNumber);
      if (cellText(row.getCell(1)) && !cellText(row.getCell(6))) {
        errors.push(`Consent handling is empty in Page Inventroy!${row.getCell(6).address}.`);
      }
    }
  }
  const auditor = overview ? cellText(overview.getCell('B8')) : '';
  if (!auditor) errors.push('Auditor is empty in Accessibility Overview!B8.');
  const qaUrl = overview ? cellText(overview.getCell('B5')) : '';
  if (!/^https?:\/\/\S+$/i.test(qaUrl)) errors.push('Accessibility Overview!B5 must contain one HTTP(S) landing-page QA URL.');
  return { valid: errors.length === 0, findingRows, imageInventoryRows, errors, warnings, auditor };
}
