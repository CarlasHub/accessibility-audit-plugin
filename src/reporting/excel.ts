import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS, { type CellValue, type DataValidation, type Style, type Worksheet } from 'exceljs';
import type { AuditSummary, Finding, PageAudit } from '../types.js';

interface LookupEntry {
  criterion: string;
  level: string;
  title: string;
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const templateFileName = ['accessibility', 'report', 'template.xlsx'].join('-');
export const DEFAULT_TEMPLATE = resolve(moduleDirectory, '..', '..', 'assets', templateFileName);
export const CANONICAL_TEMPLATE_SHA256 = '0dc49529d49402eaad4c5511f6db1cc44f91afb1cbd804da6bc702081321a4ce';

async function assertCanonicalTemplate(path: string): Promise<void> {
  const digest = createHash('sha256').update(await readFile(path)).digest('hex');
  if (digest !== CANONICAL_TEMPLATE_SHA256) {
    throw new Error(`The report template does not match the CarlasHub WCAG audit template (${CANONICAL_TEMPLATE_SHA256}); received ${digest}.`);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
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

function findingId(index: number): string {
  return `A11Y${String(index + 1).padStart(3, '0')}`;
}

function pageStatus(page: PageAudit | undefined, skipped: boolean): string {
  if (skipped || !page) return 'Not started';
  if (page.viewports.some((viewport) => viewport.cancelled)) return 'Cancelled';
  if (page.viewports.some((viewport) => viewport.interactionBlocker || !viewport.axeRun.completed)) return 'Partial';
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
        findingId(findingIndex),
        { text: evidence.pageUrl, hyperlink: evidence.pageUrl },
        evidence.viewport ? viewportLabel(evidence.viewport) : 'Not specified',
        finding.ruleId,
        componentName(finding),
        evidence.selector || finding.selectors.join('\n') || 'Page-level or structural check',
        evidence.kind,
        evidence.detail
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

function populateSummary(worksheet: Worksheet, summary: AuditSummary): void {
  const allViewports = summary.pages.flatMap((page) => page.viewports);
  const classifications = (classification: Finding['classification']): number =>
    summary.findings.filter((finding) => finding.classification === classification).length;
  const severities = (severity: Finding['severity']): number =>
    summary.findings.filter((finding) => finding.severity === severity).length;
  worksheet.getCell('B4').value = summary.status === 'completed' ? 'Completed' : 'Cancelled';
  worksheet.getCell('B5').value = new Date(summary.generatedAt);
  worksheet.getCell('B6').value = summary.auditor;
  worksheet.getCell('B7').value = summary.wcagLevel === 'AAA'
    ? 'WCAG 2.2 Level A, AA, and AAA'
    : 'WCAG 2.2 Level A and AA';
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
    `Skipped URLs: ${summary.skippedUrls.length}`,
    `Viewports run: ${allViewports.length}`,
    `Source: ${summary.source}`
  ].join('\n');
  const unresolvedCoverage = summary.coverage.flatMap((page) => page.viewports)
    .flatMap((viewport) => viewport.assessments)
    .filter((item) => !['confirmed-passed', 'confirmed-failed', 'not-applicable'].includes(item.status)).length;
  worksheet.getCell('A19').value = [
    ...summary.limitations,
    `Coverage matrix contains ${unresolvedCoverage} inconclusive, manual-review-required, or not-tested result(s); these are not passes.`,
    summary.manualChecks.length
      ? `${summary.manualChecks.length} guided manual check(s) remain in the Manual Checks sheet.`
      : 'No additional guided manual checks were generated.'
  ].join('\n');
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
      reportRowValues(finding, findingId(index), criterionEntries(finding, lookup), options.outputPath),
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
  workbook.creator = summary.auditor;
  workbook.lastModifiedBy = summary.auditor;
  workbook.created = new Date(summary.generatedAt);
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  await workbook.xlsx.writeFile(options.outputPath);
  return options.outputPath;
}
