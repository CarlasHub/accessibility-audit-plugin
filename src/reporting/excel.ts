import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS, { type CellValue, type DataValidation, type Style, type Worksheet } from 'exceljs';
import type { AuditSummary, Finding } from '../types.js';
import { getImageEvidenceRows, IMAGE_INVENTORY_HEADERS, IMAGE_INVENTORY_SHEET } from './image-inventory.js';

interface LookupEntry {
  label: string;
  level: string;
  synopsis: string;
  understanding: string;
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TEMPLATE = resolve(moduleDirectory, '../../assets/accessibility-report-template.xlsx');

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cellText(value: { text: unknown; value: unknown }): string {
  const candidate = value.text ?? value.value ?? '';
  return typeof candidate === 'string' ? candidate.trim() : String(candidate).trim();
}

function getLookup(worksheet: Worksheet): Map<string, LookupEntry> {
  const lookup = new Map<string, LookupEntry>();
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const label = cellText(row.getCell(1));
    if (!label) return;
    const criterion = /^([1-4]\.\d+\.\d+):/.exec(label)?.[1] ?? label;
    lookup.set(criterion, {
      label,
      level: cellText(row.getCell(2)) || 'NA',
      synopsis: cellText(row.getCell(3)) || 'NA',
      understanding: cellText(row.getCell(4)) || 'NA'
    });
  });
  return lookup;
}

function criterionEntries(finding: Finding, lookup: Map<string, LookupEntry>): LookupEntry[] {
  const requested = finding.wcag.slice(0, 3);
  while (requested.length < 3) requested.push(finding.ruleId.startsWith('axe-') && requested.length === 2 ? 'Automated Scan (AXE)' : 'None');
  return requested.map((criterion) => lookup.get(criterion) ?? lookup.get('None') ?? {
    label: 'None',
    level: 'NA',
    synopsis: 'NA',
    understanding: 'NA'
  });
}

function templateAssignment(finding: Finding): string {
  if (finding.assignment === 'Design') return 'Creative Support';
  if (finding.assignment === 'Content') return 'Accessibility Support';
  if (finding.assignment === 'QA') return 'Implementation Queue';
  if (finding.assignment === 'Mixed') return 'Accessibility Support';
  return 'Implementation Queue';
}

function templateEffort(finding: Finding): string {
  if (finding.effort === 'Small') return 'Easy';
  if (finding.effort === 'Large') return 'Difficult';
  return 'Medium';
}

function jiraSeverity(finding: Finding): string {
  if (finding.severity === 'Critical') return 'Critical';
  if (finding.severity === 'Serious') return 'Major';
  return 'Trivial';
}

function workbookRelativePath(outputPath: string, targetPath: string): string {
  return relative(dirname(outputPath), resolve(targetPath))
    .split(sep)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function screenshots(finding: Finding, outputPath: string): CellValue {
  const paths = [...new Set(finding.evidence.map((item) => item.screenshot).filter((value): value is string => Boolean(value)))];
  if (!paths.length) return 'Not captured';
  return {
    text: paths.length === 1 ? 'Open screenshot' : `Open first screenshot (${paths.length} linked in Image Inventory)`,
    hyperlink: workbookRelativePath(outputPath, paths[0]!),
    tooltip: 'Open the screenshot file stored beside this workbook.'
  };
}

function testingEnvironment(finding: Finding): string {
  return `Headless Chromium; ${finding.viewports.join(', ')}`;
}

function reportRowValues(finding: Finding, id: string, criteria: LookupEntry[], outputPath: string): CellValue[] {
  const labels = [finding.classification, finding.ruleId, ...finding.wcag.map((criterion) => `WCAG ${criterion}`)].join(', ');
  return [
    id,
    criteria[0]?.label ?? 'None',
    null,
    null,
    null,
    criteria[1]?.label ?? 'None',
    null,
    null,
    null,
    criteria[2]?.label ?? 'None',
    null,
    null,
    null,
    finding.urls.join('\n'),
    `${finding.component}: ${finding.summary}`,
    testingEnvironment(finding),
    finding.issue,
    finding.testing,
    screenshots(finding, outputPath),
    finding.translationRequired,
    finding.classification === 'confirmed' || finding.classification === 'blocker'
      ? 'Confirmed issue supported by recorded evidence.'
      : 'Review issue requiring the guided manual confirmation described in Testing.',
    labels,
    finding.severity === 'Advisory' ? 'Minor' : finding.severity,
    'Fail',
    templateAssignment(finding),
    templateEffort(finding),
    jiraSeverity(finding),
    finding.classification === 'review' ? 'Yes' : 'No',
    finding.classification === 'review' ? 'Need More Info' : 'Work in Progress',
    finding.remediation,
    'Not supplied',
    0
  ];
}

function setLookupFormula(
  worksheet: Worksheet,
  rowNumber: number,
  criterionColumn: string,
  outputColumns: [string, string, string],
  criterion: LookupEntry
): void {
  const [levelColumn, synopsisColumn, understandingColumn] = outputColumns;
  worksheet.getCell(`${levelColumn}${rowNumber}`).value = {
    formula: `IFERROR(VLOOKUP(${criterionColumn}${rowNumber},WCAGLookup,2,FALSE),"")`,
    result: criterion.level
  };
  worksheet.getCell(`${synopsisColumn}${rowNumber}`).value = {
    formula: `IFERROR(VLOOKUP(${criterionColumn}${rowNumber},WCAGLookup,3,FALSE),"")`,
    result: criterion.synopsis
  };
  worksheet.getCell(`${understandingColumn}${rowNumber}`).value = {
    formula: `IFERROR(VLOOKUP(${criterionColumn}${rowNumber},WCAGLookup,4,FALSE),"")`,
    result: criterion.understanding
  };
}

function populateInventorySheets(workbook: ExcelJS.Workbook, summary: AuditSummary, outputPath: string): void {
  const pageSheet = workbook.getWorksheet('Page Inventroy');
  if (pageSheet) {
    pageSheet.spliceRows(1, pageSheet.rowCount);
    pageSheet.addRow(['Requested URL', 'Final URL', 'HTTP Status', 'Page Title', 'Viewport', 'Audit Errors']);
    for (const page of summary.pages) {
      for (const viewport of page.viewports) {
        pageSheet.addRow([
          page.url,
          viewport.finalUrl,
          viewport.status ?? 'No response',
          viewport.title || 'Not available',
          `${viewport.viewport.name} (${viewport.viewport.width}×${viewport.viewport.height})`,
          viewport.errors.length ? viewport.errors.join('\n') : 'None recorded'
        ]);
      }
    }
    const represented = new Set(summary.pages.map((page) => page.url));
    for (const skipped of summary.skippedUrls.filter((item) => !represented.has(item.url))) {
      pageSheet.addRow([
        skipped.url,
        skipped.url,
        'Not tested',
        'Not available',
        'Not started',
        skipped.reason
      ]);
    }
    pageSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    pageSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    pageSheet.views = [{ state: 'frozen', ySplit: 1 }];
    pageSheet.autoFilter = { from: 'A1', to: `F${Math.max(1, pageSheet.rowCount)}` };
    [45, 45, 14, 35, 24, 60].forEach((width, index) => { pageSheet.getColumn(index + 1).width = width; });
    pageSheet.eachRow((row) => { row.alignment = { vertical: 'top', wrapText: true }; });
  }

  const imageSheet = workbook.getWorksheet(IMAGE_INVENTORY_SHEET);
  if (imageSheet) {
    imageSheet.spliceRows(1, imageSheet.rowCount);
    imageSheet.addRow([...IMAGE_INVENTORY_HEADERS]);
    const rows = getImageEvidenceRows(summary);
    for (const item of rows) {
      const row = imageSheet.addRow([
        item.pageUrl,
        item.viewport,
        item.ruleId,
        item.selector,
        item.evidenceType,
        item.result,
        basename(item.screenshot),
        {
          text: 'Open screenshot',
          hyperlink: workbookRelativePath(outputPath, item.screenshot),
          tooltip: 'Open the screenshot file stored beside this workbook.'
        }
      ]);
      row.getCell(8).font = { color: { argb: 'FF0563C1' }, underline: true };
    }
    if (imageSheet.rowCount === 1) {
      imageSheet.addRow(['All audited pages', 'All', 'N/A', 'N/A', 'Not captured', 'No finding screenshot evidence was generated.', 'N/A', 'N/A']);
    }
    imageSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    imageSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    imageSheet.views = [{ state: 'frozen', ySplit: 1 }];
    imageSheet.autoFilter = { from: 'A1', to: `H${Math.max(1, imageSheet.rowCount)}` };
    [42, 16, 28, 42, 22, 42, 32, 24].forEach((width, index) => { imageSheet.getColumn(index + 1).width = width; });
    imageSheet.eachRow((row) => { row.alignment = { vertical: 'top', wrapText: true }; });
  }
}

function setFormulaResult(worksheet: Worksheet, address: string, result: number): void {
  const cell = worksheet.getCell(address);
  const value = cell.value;
  if (value && typeof value === 'object' && 'formula' in value) {
    cell.value = { formula: String(value.formula), result };
  }
}

function refreshOverviewResults(
  overview: Worksheet,
  summary: AuditSummary,
  criteriaByFinding: Map<string, LookupEntry[]>
): void {
  const reportSeverity = (finding: Finding): string => finding.severity === 'Advisory' ? 'Minor' : finding.severity;
  setFormulaResult(overview, 'F3', summary.findings.length);
  setFormulaResult(overview, 'G3', 0);
  (['Critical', 'Serious', 'Moderate', 'Minor'] as const).forEach((severity, index) => {
    setFormulaResult(overview, `${String.fromCharCode('H'.charCodeAt(0) + index)}3`, summary.findings.filter((finding) => reportSeverity(finding) === severity).length);
  });
  (['A', 'AA', 'AAA', 'BP', 'Auto'] as const).forEach((level, index) => {
    const count = summary.findings.reduce(
      (total, finding) => total + (criteriaByFinding.get(finding.key) ?? []).filter((criterion) => criterion.level === level).length,
      0
    );
    setFormulaResult(overview, `${String.fromCharCode('L'.charCodeAt(0) + index)}3`, count);
  });
  setFormulaResult(overview, 'Q3', summary.findings.length);

  const assignmentRows: Array<[number, string]> = [
    [7, 'Development Support Traffic'],
    [8, 'Implementation Queue'],
    [9, 'Accessibility Support'],
    [10, 'Creative Support'],
    [11, 'Product Engineer'],
    [12, 'Product Owner'],
    [13, 'CSS Support']
  ];
  for (const [row, assignment] of assignmentRows) {
    const assigned = summary.findings.filter((finding) => templateAssignment(finding) === assignment);
    (['Critical', 'Serious', 'Moderate', 'Minor'] as const).forEach((severity, index) => {
      setFormulaResult(overview, `${String.fromCharCode('H'.charCodeAt(0) + index)}${row}`, assigned.filter((finding) => reportSeverity(finding) === severity).length);
    });
    (['A', 'AA', 'AAA', 'BP', 'Auto'] as const).forEach((level, index) => {
      const count = assigned.reduce(
        (total, finding) => total + (criteriaByFinding.get(finding.key) ?? []).filter((criterion) => criterion.level === level).length,
        0
      );
      setFormulaResult(overview, `${String.fromCharCode('L'.charCodeAt(0) + index)}${row}`, count);
    });
    setFormulaResult(overview, `Q${row}`, assigned.length);
  }
}

export interface ExcelReportOptions {
  outputPath: string;
  templatePath?: string;
}

export async function writeExcelReport(summary: AuditSummary, options: ExcelReportOptions): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(options.templatePath ?? DEFAULT_TEMPLATE);
  const report = workbook.getWorksheet('Accessibility Report');
  const overview = workbook.getWorksheet('Accessibility Overview');
  const lookupSheet = workbook.getWorksheet('Lookup WCAG 2.2');
  if (!report || !overview || !lookupSheet) throw new Error('The workbook template is missing a required worksheet.');
  const obsoleteScreenReaderSheet = workbook.getWorksheet('Screen Reader Failures');
  if (obsoleteScreenReaderSheet) workbook.removeWorksheet(obsoleteScreenReaderSheet.id);

  const lookup = getLookup(lookupSheet);
  const styleTemplate = Array.from({ length: 32 }, (_, index) => clone(report.getRow(2).getCell(index + 1).style as Partial<Style>));
  const validationTemplate = Array.from({ length: 32 }, (_, index) => clone(report.getRow(2).getCell(index + 1).dataValidation as DataValidation));
  const rowHeight = report.getRow(2).height;
  const originalRowCount = report.rowCount;
  for (let rowNumber = 2; rowNumber <= originalRowCount; rowNumber += 1) report.getRow(rowNumber).values = [];
  const criteriaByFinding = new Map<string, LookupEntry[]>();

  summary.findings.forEach((finding, index) => {
    const rowNumber = index + 2;
    const id = `A11Y${String(index + 1).padStart(3, '0')}`;
    const criteria = criterionEntries(finding, lookup);
    criteriaByFinding.set(finding.key, criteria);
    const row = report.getRow(rowNumber);
    row.values = reportRowValues(finding, id, criteria, options.outputPath);
    if (rowHeight !== undefined) row.height = rowHeight;
    for (let column = 1; column <= 32; column += 1) {
      row.getCell(column).style = clone(styleTemplate[column - 1] ?? {});
      const validation = validationTemplate[column - 1];
      if (validation && Object.keys(validation).length) row.getCell(column).dataValidation = clone(validation);
    }
    setLookupFormula(report, rowNumber, 'B', ['C', 'D', 'E'], criteria[0]!);
    setLookupFormula(report, rowNumber, 'F', ['G', 'H', 'I'], criteria[1]!);
    setLookupFormula(report, rowNumber, 'J', ['K', 'L', 'M'], criteria[2]!);
    const screenshotCell = row.getCell(19);
    if (screenshotCell.value && typeof screenshotCell.value === 'object' && 'hyperlink' in screenshotCell.value) {
      screenshotCell.font = { ...screenshotCell.font, color: { argb: 'FF0563C1' }, underline: true };
    }
    const estimateCell = row.getCell(32);
    estimateCell.numFmt = '0.00;-0.00;0';
    estimateCell.dataValidation = {
      type: 'custom',
      allowBlank: false,
      formulae: [`=OR(AF${rowNumber}=0,MOD(AF${rowNumber},0.25)=0)`],
      showErrorMessage: true,
      errorTitle: 'Invalid estimate',
      error: 'Use 0 or quarter increments such as 0.25, 0.50, 0.75, or 1.00.'
    };
    row.commit();
  });

  report.autoFilter = { from: 'A1', to: `AF${Math.max(2, report.rowCount)}` };
  report.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  overview.getCell('B3').value = 'Not supplied';
  overview.getCell('B4').value = new Date(summary.generatedAt);
  const landingPageUrl = summary.landingPageUrl || summary.requestedUrls[0] || 'Not supplied';
  overview.getCell('B5').value = /^https?:\/\//i.test(landingPageUrl)
    ? { text: landingPageUrl, hyperlink: landingPageUrl }
    : landingPageUrl;
  overview.getCell('B6').value = 'Not tested; staging URLs only';
  overview.getCell('B7').value = 'WCAG 2.2 AA (Includes Level A)';
  overview.getCell('B8').value = summary.auditor;
  const hasScreenshotEvidence = summary.findings.some((finding) =>
    finding.evidence.some((item) => Boolean(item.screenshot))
  );
  overview.getCell('B9').value = [
    'Headless Playwright Chromium',
    'axe-core WCAG 2.2 A/AA',
    'keyboard traversal',
    'DOM/ARIA checks',
    'desktop/mobile/reflow',
    'text spacing',
    'disclosures',
    'tabs',
    'same-origin link validation',
    hasScreenshotEvidence ? 'linked element-level evidence for confirmed failures and blockers' : 'no screenshot evidence captured'
  ].join('; ') + '.';
  overview.getCell('B15').value = [
    ...summary.limitations,
    'Outstanding guided checks:',
    ...summary.manualChecks.map((check) => `• ${check.title}: ${check.procedure}`)
  ].join('\n');
  overview.getCell('B15').alignment = { vertical: 'top', wrapText: true };
  refreshOverviewResults(overview, summary, criteriaByFinding);
  populateInventorySheets(workbook, summary, options.outputPath);

  workbook.creator = summary.auditor;
  workbook.lastModifiedBy = summary.auditor;
  workbook.created = new Date(summary.generatedAt);
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  await workbook.xlsx.writeFile(options.outputPath);
  return options.outputPath;
}
