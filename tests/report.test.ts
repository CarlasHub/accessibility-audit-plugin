import { mkdtemp, writeFile } from 'node:fs/promises';
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
    auditor: 'Carla Goncalves',
    source: 'test',
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
  it('removes placeholders and screen-reader sheets, embeds Image Inventory evidence, and validates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-report-'));
    const screenshot = join(directory, 'element.png');
    await writeFile(screenshot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const path = join(directory, 'report.xlsx');
    await writeExcelReport(summaryWithScreenshot(screenshot), { outputPath: path });
    const validation = await validateExcelReport(path);
    expect(validation).toEqual(expect.objectContaining({
      valid: true,
      findingRows: 1,
      imageInventoryRows: 1,
      auditor: 'Carla Goncalves'
    }));
    expect(validation.errors).toEqual([]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    expect(workbook.getWorksheet('Screen Reader Failures')).toBeUndefined();
    const inventory = workbook.getWorksheet('Image Inventory');
    expect(inventory?.getCell('C2').value).toBe('image-missing-alt');
    expect(inventory?.getCell('E2').value).toBe('Full-page screenshot');
    expect(inventory?.getImages()).toHaveLength(1);
    expect(workbook.getWorksheet('Accessibility Report')?.getCell('N2').value).toBe(
      'https://example.runmytests.com/en\nhttps://example.runmytests.com/jobs'
    );
  });
});
