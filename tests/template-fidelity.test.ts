import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS, { type Cell, type ConditionalFormattingOptions, type Worksheet } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { CANONICAL_TEMPLATE_SHA256, DEFAULT_TEMPLATE, writeExcelReport } from '../src/reporting/excel.js';
import { EXPECTED_REPORT_HEADERS, EXPECTED_WORKSHEETS } from '../src/reporting/validate.js';
import type { AuditSummary } from '../src/types.js';

function visualStyle(cell: Cell): unknown {
  return JSON.parse(JSON.stringify({
    alignment: cell.alignment,
    border: cell.border,
    fill: cell.fill,
    font: cell.font,
    protection: cell.protection
  }, (_key, value) => value === false ? undefined : value));
}

function conditionalFormattingRefs(worksheet: Worksheet): string[] {
  return (worksheet as Worksheet & {
    conditionalFormattings: ConditionalFormattingOptions[];
  }).conditionalFormattings.map((entry) => entry.ref);
}

function summaryWithEvidence(screenshot: string): AuditSummary {
  return {
    status: 'completed',
    generatedAt: '2026-09-04T12:00:00.000Z',
    auditor: 'Automated',
    source: 'test',
    landingPageUrl: 'https://preview.example.test/',
    requestedUrls: ['https://preview.example.test/'],
    auditedUrls: ['https://preview.example.test/'],
    skippedUrls: [],
    pages: [{ url: 'https://preview.example.test/', viewports: [] }],
    coverage: [],
    findings: [{
      key: 'test-finding',
      ruleId: 'image-missing-alt',
      classification: 'confirmed',
      severity: 'Serious',
      wcag: ['1.1.1'],
      summary: 'Image is missing a text alternative',
      issue: 'The image has no text alternative.',
      impact: 'The image purpose is unavailable to users who cannot see it.',
      testing: 'Inspect the rendered image and its accessible name.',
      remediation: 'Add a concise text alternative that communicates the image purpose.',
      component: 'image',
      componentName: 'Hero image',
      componentLocation: 'Main content',
      urls: ['https://preview.example.test/'],
      viewports: ['desktop'],
      selectors: ['main img'],
      evidence: [{
        kind: 'dom',
        pageUrl: 'https://preview.example.test/',
        viewport: 'desktop',
        selector: 'main img',
        detail: '<img>',
        screenshot
      }],
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'No'
    }],
    manualChecks: [],
    limitations: ['Not a conformance certification.']
  };
}

describe('canonical workbook template fidelity', () => {
  it('bundles Accessibility Testing Boilerplate v.4 (4) byte-for-byte', async () => {
    const digest = createHash('sha256').update(await readFile(DEFAULT_TEMPLATE)).digest('hex');
    expect(CANONICAL_TEMPLATE_SHA256).toBe('e2bad974cb5192fb4b64e81a60d9eabf6877e20593c7ed79c7e08314df36257f');
    expect(digest).toBe('e2bad974cb5192fb4b64e81a60d9eabf6877e20593c7ed79c7e08314df36257f');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DEFAULT_TEMPLATE);
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(EXPECTED_WORKSHEETS);
    expect(workbook.getWorksheet('Accessibility Report')?.getRow(1).values).toEqual([
      undefined,
      ...EXPECTED_REPORT_HEADERS
    ]);
    expect(workbook.getWorksheet('Page Inventroy')?.actualRowCount).toBe(0);
    expect(workbook.getWorksheet('Page Inventroy')?.actualColumnCount).toBe(0);
    expect(workbook.getWorksheet('Image Inventory')?.actualRowCount).toBe(0);
    expect(workbook.getWorksheet('Image Inventory')?.actualColumnCount).toBe(0);
  });

  it('rejects a replacement workbook that can introduce template drift', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-template-rejection-'));
    const replacement = join(directory, 'replacement.xlsx');
    await writeFile(replacement, 'not the canonical workbook', 'utf8');
    await expect(writeExcelReport(summaryWithEvidence(''), {
      outputPath: join(directory, 'report.xlsx'),
      templatePath: replacement
    })).rejects.toThrow('must be an exact copy of Accessibility Testing Boilerplate v.4 (4)');
  });

  it('preserves the template sheet structure and colour scheme while populating only its existing fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-template-fidelity-'));
    const screenshotDirectory = join(directory, 'screenshots', 'elements');
    await mkdir(screenshotDirectory, { recursive: true });
    const screenshot = join(screenshotDirectory, 'element.png');
    await writeFile(screenshot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const output = join(directory, 'Accessibility_Audit_Report.xlsx');
    const summary = summaryWithEvidence(screenshot);
    const finding = summary.findings[0]!;
    summary.findings = [
      finding,
      { ...finding, key: 'test-finding-2' },
      { ...finding, key: 'test-finding-3' }
    ];
    await writeExcelReport(summary, { outputPath: output });

    const template = new ExcelJS.Workbook();
    const generated = new ExcelJS.Workbook();
    await Promise.all([template.xlsx.readFile(DEFAULT_TEMPLATE), generated.xlsx.readFile(output)]);

    expect(generated.worksheets.map((worksheet) => worksheet.name)).toEqual(EXPECTED_WORKSHEETS);
    for (const templateSheet of template.worksheets) {
      const generatedSheet = generated.getWorksheet(templateSheet.name);
      expect(generatedSheet?.state).toBe(templateSheet.state);
      expect(generatedSheet?.properties.tabColor).toEqual(templateSheet.properties.tabColor);
      expect(generatedSheet?.views).toEqual(templateSheet.views);
    }

    const templateReport = template.getWorksheet('Accessibility Report')!;
    const generatedReport = generated.getWorksheet('Accessibility Report')!;
    for (let column = 1; column <= EXPECTED_REPORT_HEADERS.length; column += 1) {
      expect(generatedReport.getColumn(column).width).toBe(templateReport.getColumn(column).width);
      expect(generatedReport.getColumn(column).hidden).toBe(templateReport.getColumn(column).hidden);
      expect(visualStyle(generatedReport.getCell(1, column))).toEqual(visualStyle(templateReport.getCell(1, column)));
      expect(visualStyle(generatedReport.getCell(2, column))).toEqual(visualStyle(templateReport.getCell(2, column)));
      expect(visualStyle(generatedReport.getCell(4, column))).toEqual(visualStyle(templateReport.getCell(2, column)));
    }
    expect(generatedReport.autoFilter).toBe('A1:AF4');
    expect(conditionalFormattingRefs(generatedReport)).toEqual(
      conditionalFormattingRefs(templateReport).map((ref) => ref.replaceAll('3', '4'))
    );
    expect(generatedReport.getCell('Y4').dataValidation.formulae).toEqual([
      '"Accessibility Support,Client Auditor,CSS Support,Creative Support,Development Support Traffic,Implementation Queue,No Assignment,Product Engineer,Product Owner,Third-Party Auditor,Third-Party Issue (YouTube, ATS, etc.)"'
    ]);
    expect(generatedReport.getCell('AF4').dataValidation.formulae).toEqual(['=OR(AF4=0,MOD(AF4,0.25)=0)']);

    for (const sheetName of ['Page Inventroy', 'Image Inventory']) {
      const worksheet = generated.getWorksheet(sheetName)!;
      expect(worksheet.actualColumnCount).toBe(1);
      expect(worksheet.getColumn(1).width).toBe(template.getWorksheet(sheetName)!.getColumn(1).width);
      expect(worksheet.getCell('B1').value).toBeNull();
    }
  });
});
