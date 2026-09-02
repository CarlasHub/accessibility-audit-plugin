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

function cellText(value: { text: unknown; value: unknown }): string {
  const candidate = value.text ?? value.value ?? '';
  if (typeof candidate === 'string') return candidate.trim();
  if (typeof candidate === 'object' && candidate && 'result' in candidate) return String(candidate.result ?? '').trim();
  return String(candidate).trim();
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
    }
    const embeddedImageCount = imageInventory.getImages().length;
    if (imageInventoryRows > embeddedImageCount) errors.push(`${IMAGE_INVENTORY_SHEET} has ${imageInventoryRows} evidence row(s) but only ${embeddedImageCount} embedded screenshot(s).`);
  }
  const auditor = overview ? cellText(overview.getCell('B8')) : '';
  if (!auditor) errors.push('Auditor is empty in Accessibility Overview!B8.');
  return { valid: errors.length === 0, findingRows, imageInventoryRows, errors, warnings, auditor };
}
