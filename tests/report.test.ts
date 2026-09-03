import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { AuditSummary } from '../src/types.js';
import { writeExcelReport } from '../src/reporting/excel.js';
import { validateExcelReport } from '../src/reporting/validate.js';

function summaryWithScreenshot(screenshot: string): AuditSummary {
  return {
    status: 'completed',
    generatedAt: '2026-09-02T10:00:00.000Z',
    auditor: 'Test Auditor',
    source: 'test',
    landingPageUrl: 'https://example.runmytests.com/en',
    requestedUrls: ['https://example.runmytests.com/en'],
    auditedUrls: ['https://example.runmytests.com/en'],
    skippedUrls: [],
    pages: [{ url: 'https://example.runmytests.com/en', viewports: [] }],
    findings: [{
      key: 'image-missing-alt:header-logo',
      ruleId: 'image-missing-alt',
      classification: 'confirmed',
      severity: 'Serious',
      wcag: ['1.1.1'],
      summary: 'Linked logo has no meaningful alternative',
      issue: 'The linked image is missing alt.',
      impact: 'The home destination is not identifiable.',
      testing: 'Rendered DOM and accessible name inspection.',
      remediation: 'Give the home link an accessible name that identifies the organisation home page and use appropriate image alt text.',
      component: 'site logo link',
      componentName: '“Unilever” home link',
      componentLocation: 'Within the “Primary” navigation landmark',
      urls: ['https://example.runmytests.com/en', 'https://example.runmytests.com/jobs'],
      viewports: ['desktop', 'mobile'],
      selectors: ['header a.logo'],
      evidence: [{
        kind: 'dom',
        pageUrl: 'https://example.runmytests.com/en',
        viewport: 'desktop',
        selector: 'header a.logo',
        detail: '<img src="logo.png">',
        screenshot
      }],
      assignment: 'Content',
      effort: 'Small',
      translationRequired: 'Review'
    }],
    manualChecks: [{ id: 'manual', title: 'Manual check', wcag: ['1.1.1'], applicableTo: 'Images', procedure: 'Confirm text alternative meaning.' }],
    limitations: ['Not a conformance certification.']
  };
}

describe('Excel report', () => {
  it('removes placeholders and screen-reader sheets, links lightweight evidence, and applies report defaults', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-report-'));
    const screenshot = join(directory, 'screenshots', 'elements', 'element.png');
    await mkdir(join(directory, 'screenshots', 'elements'), { recursive: true });
    await writeFile(screenshot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const path = join(directory, 'report.xlsx');
    await writeExcelReport(summaryWithScreenshot(screenshot), { outputPath: path });
    const validation = await validateExcelReport(path);
    expect(validation).toEqual(expect.objectContaining({
      valid: true,
      findingRows: 1,
      imageInventoryRows: 1,
      auditor: 'Test Auditor'
    }));
    expect(validation.errors).toEqual([]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    expect(workbook.getWorksheet('Screen Reader Failures')).toBeUndefined();
    const inventory = workbook.getWorksheet('Image Inventory');
    expect(inventory?.getCell('C2').value).toBe('image-missing-alt');
    expect(inventory?.getCell('D2').value).toBe('“Unilever” home link');
    expect(inventory?.getCell('E2').value).toBe('Within the “Primary” navigation landmark');
    expect(inventory?.getCell('G2').value).toBe('Element screenshot');
    expect(inventory?.getImages()).toHaveLength(0);
    expect(inventory?.getCell('J2').value).toEqual(expect.objectContaining({
      text: 'Open screenshot',
      hyperlink: 'screenshots/elements/element.png'
    }));
    const report = workbook.getWorksheet('Accessibility Report');
    expect(report?.getCell('N2').value).toBe(
      'https://example.runmytests.com/en\nhttps://example.runmytests.com/jobs'
    );
    expect(report?.getCell('O2').value).toBe('Desktop and mobile: “Unilever” home link — Linked logo has no meaningful alternative');
    expect(report?.getCell('P2').value).toBe('Headless Chromium; Desktop (1440×1000), Mobile (390×844)');
    expect(report?.getCell('Q2').value).toContain('Component: “Unilever” home link');
    expect(report?.getCell('Q2').value).toContain('Location: Within the “Primary” navigation landmark');
    expect(report?.getCell('Q2').value).toContain('Affected viewport(s): Desktop (1440×1000), Mobile (390×844)');
    expect(report?.getCell('Q2').value).toContain('User impact: The home destination is not identifiable.');
    expect(report?.getCell('Q2').value).toContain('Technical locator: header a.logo');
    expect(report?.getCell('R2').value).toContain('1. Open each affected page at Desktop (1440×1000), Mobile (390×844).');
    expect(report?.getCell('R2').value).toContain('Actual: The linked image is missing alt.');
    expect(report?.getCell('R2').value).toContain('Expected: The image or image link exposes one concise text alternative');
    expect(report?.getCell('S2').value).toEqual(expect.objectContaining({ hyperlink: 'screenshots/elements/element.png' }));
    expect(report?.getCell('X2').value).toBe('Fail');
    expect(report?.getCell('Y2').value).toBe('Accessibility Support');
    expect(report?.getCell('AF2').value).toBe(0);
    expect(report?.getCell('AF2').numFmt).toBe('0.00;-0.00;0');
    expect(report?.getCell('AF2').dataValidation.formulae).toEqual(['=OR(AF2=0,MOD(AF2,0.25)=0)']);
    const overview = workbook.getWorksheet('Accessibility Overview');
    expect(overview?.getCell('B5').value).toEqual(expect.objectContaining({
      text: 'https://example.runmytests.com/en',
      hyperlink: 'https://example.runmytests.com/en'
    }));
    expect(overview?.getCell('B9').value).toContain('linked element-level evidence for confirmed failures and blockers');
  });

  it('states when screenshots were disabled and leaves the Image Inventory without evidence images', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-report-no-images-'));
    const path = join(directory, 'report.xlsx');
    const summary = summaryWithScreenshot('');
    summary.findings[0]!.evidence[0]!.screenshot = '';
    summary.findings[0]!.classification = 'review';
    summary.findings[0]!.assignment = 'Development';
    await writeExcelReport(summary, { outputPath: path });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    expect(workbook.getWorksheet('Accessibility Overview')?.getCell('B9').value).toContain('no screenshot evidence captured');
    const inventory = workbook.getWorksheet('Image Inventory');
    expect(inventory?.getCell('G2').value).toBe('Not captured');
    expect(inventory?.getImages()).toHaveLength(0);
    const report = workbook.getWorksheet('Accessibility Report');
    expect(report?.getCell('X2').value).toBe('Fail');
    expect(report?.getCell('Y2').value).toBe('Implementation Queue');
    expect(report?.getCell('AF2').value).toBe(0);
  });

  it('rejects incomplete finding wording and full-page evidence assigned to a component locator', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-report-context-validation-'));
    const screenshotDirectory = join(directory, 'screenshots', 'elements');
    await mkdir(screenshotDirectory, { recursive: true });
    const screenshot = join(screenshotDirectory, 'element.png');
    await writeFile(screenshot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const path = join(directory, 'report.xlsx');
    await writeExcelReport(summaryWithScreenshot(screenshot), { outputPath: path });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    workbook.getWorksheet('Accessibility Report')!.getCell('Q2').value = 'The link is inaccessible.';
    workbook.getWorksheet('Accessibility Report')!.getCell('R2').value = 'Automated scan only.';
    workbook.getWorksheet('Image Inventory')!.getCell('G2').value = 'Full-page screenshot';
    await workbook.xlsx.writeFile(path);

    const validation = await validateExcelReport(path);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Issue is missing “Component:” context at row 2.');
    expect(validation.errors).toContain('Testing is missing “Actual:” evidence at row 2.');
    expect(validation.errors).toContain('Testing is missing “Expected:” evidence at row 2.');
    expect(validation.errors).toContain('Image Inventory!G2 must not use full-page evidence for a component locator.');
  });

  it('rejects non-Fail status and invalid estimate increments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-report-invalid-defaults-'));
    const path = join(directory, 'report.xlsx');
    const summary = summaryWithScreenshot('');
    summary.findings[0]!.evidence[0]!.screenshot = '';
    await writeExcelReport(summary, { outputPath: path });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    const report = workbook.getWorksheet('Accessibility Report');
    if (!report) throw new Error('Accessibility Report worksheet missing.');
    report.getCell('X2').value = 'NA';
    report.getCell('AF2').value = 0.1;
    report.getCell('AF2').dataValidation = { type: 'custom', formulae: ['=FALSE'] };
    await workbook.xlsx.writeFile(path);

    const validation = await validateExcelReport(path);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Status must default to Fail at row 2.');
    expect(validation.errors).toContain('Estimate must be 0 or a non-negative 0.25 increment at row 2.');
    expect(validation.errors).toContain('Estimate validation is missing or incorrect at row 2.');
  });
});
