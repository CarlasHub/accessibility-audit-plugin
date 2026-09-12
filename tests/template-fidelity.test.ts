import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { CANONICAL_TEMPLATE_SHA256, DEFAULT_TEMPLATE, writeExcelReport } from '../src/reporting/excel.js';
import {
  EXPECTED_REPORT_HEADERS,
  EXPECTED_TEMPLATE_REPORT_HEADERS,
  EXPECTED_TEMPLATE_WORKSHEETS,
  EXPECTED_WORKSHEETS
} from '../src/reporting/validate.js';
import type { AuditSummary } from '../src/types.js';

function summaryWithEvidence(screenshot: string): AuditSummary {
  return {
    status: 'completed',
    wcagLevel: 'AA',
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
        detail: JSON.stringify({ contrastRatio: 2.1, expectedRatio: 4.5, html: '<img class="hero">' }),
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

describe('CarlasHub WCAG workbook template fidelity', () => {
  it('bundles the approved template byte-for-byte', async () => {
    const digest = createHash('sha256').update(await readFile(DEFAULT_TEMPLATE)).digest('hex');
    expect(CANONICAL_TEMPLATE_SHA256).toBe('0dc49529d49402eaad4c5511f6db1cc44f91afb1cbd804da6bc702081321a4ce');
    expect(digest).toBe(CANONICAL_TEMPLATE_SHA256);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(DEFAULT_TEMPLATE);
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(EXPECTED_TEMPLATE_WORKSHEETS);
    expect(workbook.getWorksheet('Findings')?.getRow(6).values).toEqual([undefined, ...EXPECTED_TEMPLATE_REPORT_HEADERS]);
    expect(workbook.getWorksheet('Page Inventory')?.getRow(4).values).toEqual([
      undefined, 'URL', 'Audit state', 'Viewports planned', 'Viewports completed', 'Consent handling', 'Runtime errors', 'Notes'
    ]);
    expect(workbook.getWorksheet('Evidence')?.getRow(4).values).toEqual([
      undefined, 'Evidence path', 'Finding ID', 'Page URL', 'Viewport', 'Rule ID', 'Component', 'Technical locator', 'Evidence type', 'Detail'
    ]);
    expect(workbook.getWorksheet('Manual Checks')?.getRow(4).values).toEqual([
      undefined, 'Check ID', 'Manual check', 'WCAG criterion', 'Applies to', 'Procedure', 'Status', 'Reviewer notes'
    ]);
    expect(workbook.getWorksheet('WCAG 2.2 Reference')?.getRow(3).values).toEqual([
      undefined, 'Success criterion', 'Level', 'Title', 'Understanding link'
    ]);
    expect(workbook.getWorksheet('Findings')?.getCell('B7').dataValidation.formulae?.[0]).toContain('manual');
  });

  it('rejects a replacement workbook that can introduce template drift', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-template-rejection-'));
    const replacement = join(directory, 'replacement.xlsx');
    await writeFile(replacement, 'not the canonical workbook', 'utf8');
    await expect(writeExcelReport(summaryWithEvidence(''), {
      outputPath: join(directory, 'report.xlsx'),
      templatePath: replacement
    })).rejects.toThrow('does not match the CarlasHub WCAG audit template');
  });

  it('preserves the canonical sheets while adding the generated criterion ledger', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-template-fidelity-'));
    const screenshotDirectory = join(directory, 'screenshots', 'elements');
    await mkdir(screenshotDirectory, { recursive: true });
    const screenshot = join(screenshotDirectory, 'element.png');
    await writeFile(screenshot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const output = join(directory, 'Accessibility_Audit_Report.xlsx');
    const summary = summaryWithEvidence(screenshot);
    const finding = summary.findings[0]!;
    summary.findings = [finding, { ...finding, key: 'test-finding-2' }, { ...finding, key: 'test-finding-3' }];
    await writeExcelReport(summary, { outputPath: output });

    const template = new ExcelJS.Workbook();
    const generated = new ExcelJS.Workbook();
    await Promise.all([template.xlsx.readFile(DEFAULT_TEMPLATE), generated.xlsx.readFile(output)]);

    expect(generated.worksheets.map((worksheet) => worksheet.name)).toEqual(EXPECTED_WORKSHEETS);
    for (const templateSheet of template.worksheets) {
      const generatedSheet = generated.getWorksheet(templateSheet.name);
      expect(generatedSheet?.state).toBe(templateSheet.state);
      expect(generatedSheet?.properties.tabColor).toEqual(templateSheet.properties.tabColor);
      expect(generatedSheet?.views[0]?.showGridLines).toBe(false);
    }

    const generatedFindings = generated.getWorksheet('Findings')!;
    expect(generatedFindings.getRow(6).values).toEqual([undefined, ...EXPECTED_REPORT_HEADERS]);
    const expectedWidths = [12, 14, 12, 16, 14, 8, 22, 34, 18, 22, 22, 32, 36, 34, 30, 34, 36, 34, 36, 14, 12, 18, 18, 18, 16];
    const hiddenColumns = new Set([6, 7, 9, 11, 15, 16, 24, 25]);
    for (let column = 1; column <= EXPECTED_REPORT_HEADERS.length; column += 1) {
      expect(generatedFindings.getColumn(column).width).toBe(expectedWidths[column - 1]);
      expect(generatedFindings.getColumn(column).hidden ?? false).toBe(hiddenColumns.has(column));
      expect((generatedFindings.getCell(6, column).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF1A73E8');
      expect(generatedFindings.getCell(6, column).font.color?.argb).toBe('FFFFFFFF');
      expect(generatedFindings.getCell(6, column).font.bold).toBe(true);
    }
    expect(generatedFindings.views[0]).toEqual(expect.objectContaining({ xSplit: 2, ySplit: 6, showGridLines: false }));
    expect((generatedFindings.getCell('B9').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFCE8E6');
    expect((generatedFindings.getCell('D9').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFC5221F');
    expect(generatedFindings.getCell('D9').font.color?.argb).toBe('FFFFFFFF');
    expect(generatedFindings.getCell('D9').font.bold).toBe(true);
    expect(generatedFindings.getCell('D9').value).toBe('Serious');
    expect(generatedFindings.getCell('M9').value).toBe('The image has no text alternative.');
    expect(generatedFindings.getCell('Q9').value).toContain('Contrast Ratio: 2.1');
    expect(generatedFindings.getCell('Q9').value).not.toContain('{');
    expect(generatedFindings.autoFilter).toBe('A6:Y9');
    expect(generatedFindings.getCell('B9').dataValidation.formulae?.[0]).toContain('manual');
    expect(generatedFindings.getCell('T9').dataValidation.formulae?.[0]).toContain('Development');
    expect(generatedFindings.getCell('U9').dataValidation.formulae?.[0]).toContain('Small');
    expect(generatedFindings.getCell('Y9').dataValidation.formulae?.[0]).toContain('Review');
    expect(generated.getWorksheet('Page Inventory')?.getCell('A5').text).toBe('https://preview.example.test/');
    expect(generated.getWorksheet('Evidence')?.getCell('A5').hyperlink).toContain('screenshots/elements/element.png');
    expect(generated.getWorksheet('Evidence')?.getCell('I5').value).toContain('Contrast Ratio: 2.1');
    expect(generated.getWorksheet('Evidence')?.getCell('I5').value).not.toContain('{');
    expect(generated.getWorksheet('Manual Checks')?.getCell('A5').value).toBeNull();
    expect(generated.getWorksheet('WCAG 2.2 Reference')?.getCell('A4').value).toEqual(
      template.getWorksheet('WCAG 2.2 Reference')?.getCell('A4').value
    );
  });
});
