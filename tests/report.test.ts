import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { writeExcelReport } from '../src/reporting/excel.js';
import { EXPECTED_WORKSHEETS, validateExcelReport } from '../src/reporting/validate.js';
import type { AuditSummary } from '../src/types.js';

function summaryWithScreenshot(screenshot: string): AuditSummary {
  return {
    status: 'completed', generatedAt: '2026-09-02T10:00:00.000Z', auditor: 'Test Auditor', source: 'test',
    landingPageUrl: 'https://careers.qa.example.org/en', requestedUrls: ['https://careers.qa.example.org/en'],
    auditedUrls: ['https://careers.qa.example.org/en'], skippedUrls: [],
    pages: [{ url: 'https://careers.qa.example.org/en', viewports: [] }], coverage: [],
    findings: [{
      key: 'image-missing-alt:header-logo', ruleId: 'image-missing-alt', classification: 'confirmed',
      severity: 'Serious', wcag: ['1.1.1'], summary: 'Linked logo has no meaningful alternative',
      issue: 'The linked image is missing alt.', impact: 'The home destination is not identifiable.',
      testing: 'Rendered DOM and accessible-name inspection.',
      remediation: 'Give the home link an accessible name and appropriate image alternative text.',
      component: 'site logo link', componentName: 'Example Company home link', componentLocation: 'Primary navigation landmark',
      urls: ['https://careers.qa.example.org/en', 'https://careers.qa.example.org/jobs'], viewports: ['desktop', 'mobile'],
      selectors: ['header a.logo'], evidence: [{
        kind: 'dom', pageUrl: 'https://careers.qa.example.org/en', viewport: 'desktop', selector: 'header a.logo',
        detail: '<img src="logo.png">', screenshot
      }], assignment: 'Content', effort: 'Small', translationRequired: 'Review'
    }],
    manualChecks: [{ id: 'manual-image-purpose', title: 'Confirm image purpose', wcag: ['1.1.1'], applicableTo: 'Images', procedure: 'Confirm the text alternative conveys the image purpose.' }],
    limitations: ['Not a conformance certification.']
  };
}

describe('Excel report', () => {
  it('writes the six-sheet CarlasHub report with linked, lightweight evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-report-'));
    const screenshot = join(directory, 'screenshots', 'elements', 'element.png');
    await mkdir(join(directory, 'screenshots', 'elements'), { recursive: true });
    await writeFile(screenshot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const path = join(directory, 'report.xlsx');
    await writeExcelReport(summaryWithScreenshot(screenshot), { outputPath: path });

    const validation = await validateExcelReport(path);
    expect(validation).toEqual(expect.objectContaining({ valid: true, findingRows: 1, evidenceRows: 1, imageInventoryRows: 1, auditor: 'Test Auditor' }));
    expect(validation.errors).toEqual([]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(EXPECTED_WORKSHEETS);
    expect(workbook.worksheets.flatMap((worksheet) => worksheet.getImages())).toHaveLength(0);

    const pages = workbook.getWorksheet('Page Inventory')!;
    expect(pages.getCell('A5').value).toEqual(expect.objectContaining({ text: 'https://careers.qa.example.org/en', hyperlink: 'https://careers.qa.example.org/en' }));
    expect(pages.getCell('B5').value).toBe('Completed');

    const evidence = workbook.getWorksheet('Evidence')!;
    expect(evidence.getCell('A5').value).toEqual(expect.objectContaining({ text: 'screenshots/elements/element.png', hyperlink: 'screenshots/elements/element.png' }));
    expect(evidence.getCell('B5').value).toBe('A11Y001');
    expect(evidence.getCell('I5').value).toBe('<img src="logo.png">');

    const findings = workbook.getWorksheet('Findings')!;
    expect(findings.getCell('A7').value).toBe('A11Y001');
    expect(findings.getCell('B7').value).toBe('confirmed');
    expect(findings.getCell('C7').value).toBe('Open');
    expect(findings.getCell('E7').value).toBe('1.1.1');
    expect(findings.getCell('F7').value).toBe('A');
    expect(findings.getCell('G7').value).toBe('Non-text Content');
    expect(findings.getCell('H7').value).toBe('https://careers.qa.example.org/en\nhttps://careers.qa.example.org/jobs');
    expect(findings.getCell('I7').value).toBe('Desktop (1440×1000)\nMobile (390×844)');
    expect(findings.getCell('V7').value).toEqual(expect.objectContaining({ hyperlink: 'screenshots/elements/element.png' }));
    expect(findings.getCell('W7').value).toBe('image-missing-alt');

    const auditSummary = workbook.getWorksheet('Audit Summary')!;
    expect(auditSummary.getCell('B6').value).toBe('Test Auditor');
    expect(auditSummary.getCell('B8').value).toEqual(expect.objectContaining({ text: 'https://careers.qa.example.org/en', hyperlink: 'https://careers.qa.example.org/en' }));
    expect(auditSummary.getCell('E4').value).toBe(1);
  });

  it('uses readable fallback values for advisory criteria absent from the WCAG reference', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-report-advisory-'));
    const path = join(directory, 'report.xlsx');
    const summary = summaryWithScreenshot('');
    summary.findings[0]!.wcag = ['Best Practice'];
    summary.findings[0]!.classification = 'manual';
    await writeExcelReport(summary, { outputPath: path });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    const findings = workbook.getWorksheet('Findings')!;
    expect(findings.getCell('E7').value).toBe('Best Practice');
    expect(findings.getCell('F7').value).toBe('N/A');
    expect(findings.getCell('G7').value).toBe('Manual or advisory check');
    expect(JSON.stringify(findings.getRow(7).values)).not.toContain('[object Object]');
    expect((await validateExcelReport(path)).valid).toBe(true);
  });

  it('records evidence without a screenshot explicitly', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-report-no-image-'));
    const path = join(directory, 'report.xlsx');
    await writeExcelReport(summaryWithScreenshot(''), { outputPath: path });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    expect(workbook.getWorksheet('Findings')?.getCell('V7').value).toBe('Not captured');
    expect(workbook.getWorksheet('Evidence')?.getCell('A5').value).toBe('Not captured');
    expect(await validateExcelReport(path)).toEqual(expect.objectContaining({ valid: true, evidenceRows: 1, imageInventoryRows: 0 }));
  });

  it('rejects malformed finding values and duplicate page URLs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-report-invalid-'));
    const path = join(directory, 'report.xlsx');
    await writeExcelReport(summaryWithScreenshot(''), { outputPath: path });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    const findings = workbook.getWorksheet('Findings')!;
    findings.getCell('B7').value = 'guess';
    findings.getCell('C7').value = 'Fail';
    findings.getCell('D7').value = 'Unknown';
    findings.getCell('M7').value = '';
    const pages = workbook.getWorksheet('Page Inventory')!;
    pages.getCell('A6').value = { text: 'https://careers.qa.example.org/en', hyperlink: 'https://careers.qa.example.org/en' };
    await workbook.xlsx.writeFile(path);

    const validation = await validateExcelReport(path);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      'Findings!B7 contains an unsupported evidence type.',
      'Findings!C7 contains an unsupported status.',
      'Findings!D7 contains an unsupported severity.',
      'Required finding cell M7 is empty.',
      'Page Inventory!A6 duplicates an earlier URL.'
    ]));
  });
});
