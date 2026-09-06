import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS, { type CellValue, type ConditionalFormattingOptions, type DataValidation, type Style, type Worksheet } from 'exceljs';
import type { AuditSummary, Finding } from '../types.js';
import { cellText } from './cell-text.js';
import { getImageEvidencePaths, IMAGE_INVENTORY_SHEET } from './image-inventory.js';

interface LookupEntry {
  label: string;
  level: string;
  synopsis: string;
  understanding: string;
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TEMPLATE = resolve(moduleDirectory, '../../assets/accessibility-report-template.xlsx');
export const CANONICAL_TEMPLATE_SHA256 = 'e2bad974cb5192fb4b64e81a60d9eabf6877e20593c7ed79c7e08314df36257f';

async function assertCanonicalTemplate(path: string): Promise<void> {
  const digest = createHash('sha256').update(await readFile(path)).digest('hex');
  if (digest !== CANONICAL_TEMPLATE_SHA256) {
    throw new Error(
      `The report template must be an exact copy of Accessibility Testing Boilerplate v.4 (4) (${CANONICAL_TEMPLATE_SHA256}); received ${digest}.`
    );
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
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
  return `Headless Chromium; ${finding.viewports.map(viewportLabel).join(', ')}`;
}

function viewportLabel(viewport: string): string {
  if (viewport === 'desktop') return 'Desktop (1440×1000)';
  if (viewport === 'mobile') return 'Mobile (390×844)';
  if (viewport === 'reflow-320') return 'Mobile reflow (320×800)';
  return viewport.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function findingViewportScope(finding: Finding): string {
  const hasDesktop = finding.viewports.includes('desktop');
  const hasMobile = finding.viewports.some((viewport) => viewport === 'mobile' || viewport === 'reflow-320');
  if (hasDesktop && hasMobile) return 'Desktop and mobile';
  if (hasMobile) return 'Mobile';
  if (hasDesktop) return 'Desktop';
  return 'Tested viewport';
}

function componentName(finding: Finding): string {
  return finding.componentName?.trim() || finding.component;
}

function componentLocation(finding: Finding): string {
  return finding.componentLocation?.trim() || 'See the affected page URL and technical locator.';
}

function issueDescription(finding: Finding): string {
  const selectors = finding.selectors.length ? finding.selectors.join('\n') : 'Page-level or structural check';
  return [
    `Component: ${componentName(finding)}`,
    `Location: ${componentLocation(finding)}`,
    `Affected viewport(s): ${finding.viewports.map(viewportLabel).join(', ')}`,
    `Accessibility issue: ${finding.issue}`,
    `User impact: ${finding.impact}`,
    `Technical locator: ${selectors}`
  ].join('\n');
}

function expectedOutcome(finding: Finding, criteria: LookupEntry[]): string {
  const rule = finding.ruleId;
  if (rule === 'page-unavailable') return 'The requested staging page loads successfully and every planned viewport can be tested.';
  if (rule === 'target-size-review') return 'Each pointer target contains a 24×24 CSS pixel area, has sufficient clearance, or has a documented applicable exception.';
  if (/link-(?:broken-destination|destination-review)|missing-fragment/.test(rule)) {
    return 'The link navigates to a valid destination, or the interaction uses a native button when it performs an action.';
  }
  if (/link-name|empty-accessible-name|control-no-name|command-name|button-name|input-button-name/.test(rule)) {
    return 'The interactive element exposes a concise accessible name that communicates its purpose or destination.';
  }
  if (/label/.test(rule)) return 'The form control has a persistent visible label and a matching programmatic accessible name.';
  if (/image|linked-image/.test(rule)) return 'The image or image link exposes one concise text alternative that communicates its purpose without unnecessary repetition.';
  if (/focus-order/.test(rule)) return 'Keyboard focus follows a logical sequence that matches the revealed content and preserves the user’s position.';
  if (/focus/.test(rule)) return 'Keyboard focus remains visible, unobscured, and predictable throughout the interaction.';
  if (/disclosure/.test(rule)) return 'The disclosure uses an appropriate control, exposes accurate state and relationships, and behaves predictably from the keyboard.';
  if (/tabs/.test(rule)) return 'The tab component exposes valid tab-to-panel relationships and supports its documented keyboard interaction.';
  if (/reflow|overflow/.test(rule)) return 'Ordinary page content remains available without two-dimensional scrolling at the tested viewport.';
  if (/text-spacing/.test(rule)) return 'All content and functionality remain visible and operable after the WCAG text-spacing overrides are applied.';
  if (/landmark|region/.test(rule)) return 'Page regions use appropriate semantic landmarks with clear and distinguishable names where required.';
  const criterion = criteria.find((entry) => entry.label !== 'None' && entry.synopsis !== 'NA');
  return criterion
    ? `The component meets ${criterion.label}: ${criterion.synopsis}.`
    : 'The component does not expose the accessibility barrier described in this finding.';
}

function testingDescription(finding: Finding, criteria: LookupEntry[]): string {
  if (/^\s*1\./m.test(finding.testing) && /\bActual:/i.test(finding.testing) && /\bExpected:/i.test(finding.testing)) {
    return finding.testing;
  }
  const method = finding.testing.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return [
    `1. Open each affected page at ${finding.viewports.map(viewportLabel).join(', ')}.`,
    `2. Locate ${componentName(finding)} at ${componentLocation(finding)}.`,
    `3. ${method}.`,
    `Actual: ${finding.issue}`,
    `Expected: ${expectedOutcome(finding, criteria)}`
  ].join('\n');
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
    `${findingViewportScope(finding)}: ${componentName(finding)} — ${finding.summary}`,
    testingEnvironment(finding),
    issueDescription(finding),
    testingDescription(finding, criteria),
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
    const scannedUrls = [...new Set(summary.pages.map((page) => page.url.trim()).filter(Boolean))];
    for (const url of scannedUrls) {
      pageSheet.addRow([{
        text: url,
        hyperlink: url
      }]);
    }
  }

  const imageSheet = workbook.getWorksheet(IMAGE_INVENTORY_SHEET);
  if (imageSheet) {
    imageSheet.spliceRows(1, imageSheet.rowCount);
    for (const screenshotPath of getImageEvidencePaths(summary)) {
      const reference = workbookRelativePath(outputPath, screenshotPath);
      imageSheet.addRow([{
        text: reference,
        hyperlink: reference
      }]);
    }
  }
}

function extendReportConditionalFormatting(worksheet: Worksheet, finalRow: number): void {
  if (finalRow <= 3) return;
  const conditionalFormattings = (worksheet as Worksheet & {
    conditionalFormattings: ConditionalFormattingOptions[];
  }).conditionalFormattings;
  for (const conditionalFormatting of conditionalFormattings) {
    conditionalFormatting.ref = conditionalFormatting.ref
      .split(/\s+/)
      .map((range) => {
        const match = /^(\$?[A-Z]+)\$?2:(\$?[A-Z]+)\$?3$/.exec(range);
        return match ? `${match[1]}2:${match[2]}${finalRow}` : range;
      })
      .join(' ');
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
  const templatePath = options.templatePath ?? DEFAULT_TEMPLATE;
  await assertCanonicalTemplate(templatePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
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

  const finalReportRow = Math.max(originalRowCount, summary.findings.length + 1);
  report.autoFilter = { from: 'A1', to: `AF${finalReportRow}` };
  extendReportConditionalFormatting(report, finalReportRow);
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
  const blockedViewportCount = summary.pages.flatMap((page) => page.viewports)
    .filter((viewport) => Boolean(viewport.interactionBlocker)).length;
  const incompleteCoverageCount = summary.coverage
    .flatMap((page) => page.viewports)
    .flatMap((viewport) => viewport.assessments)
    .filter((item) => !['confirmed-passed', 'confirmed-failed', 'not-applicable'].includes(item.status))
    .length;
  overview.getCell('B9').value = [
    'Headless Playwright Chromium',
    'axe-core WCAG 2.2 A/AA',
    'automated keyboard sampling',
    'DOM/ARIA checks',
    'desktop/mobile/reflow',
    'text spacing',
    'disclosures',
    'tabs',
    'same-origin link validation',
    hasScreenshotEvidence ? 'linked contextual evidence for confirmed, blocker, and review findings where capture succeeded' : 'no screenshot evidence captured',
    blockedViewportCount > 0 ? `${blockedViewportCount} viewport run(s) blocked before page-level interaction coverage` : 'no unresolved interaction blocker recorded'
  ].join('; ') + '.';
  overview.getCell('B15').value = [
    ...summary.limitations,
    `Coverage matrix: audit-results.json records ${incompleteCoverageCount} inconclusive, manual-review-required, or not-tested page/viewport/area result(s). These are not passes.`,
    'Outstanding guided checks:',
    ...summary.manualChecks.map((check) => `• ${check.title}: ${check.procedure}`)
  ].join('\n');
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
