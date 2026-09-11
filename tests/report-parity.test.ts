import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { REQUIRED_MANUAL_CHECKS } from '../src/audit/manual-checks.js';
import { buildWcagCriterionLedger } from '../src/audit/wcag-criteria.js';
import { createAuditArchive } from '../src/reporting/archive.js';
import { writeExcelReport } from '../src/reporting/excel.js';
import { writeHtmlReport } from '../src/reporting/html.js';
import { writeJsonReport } from '../src/reporting/json.js';
import { validateExcelReport } from '../src/reporting/validate.js';
import type { AuditSummary, Finding, FindingClassification } from '../src/types.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function finding(
  classification: FindingClassification,
  screenshot: string,
  index: number
): Finding {
  const blocker = classification === 'blocker';
  return {
    key: `${classification}-${index}`,
    ruleId: blocker ? 'interaction-blocker' : 'axe-image-alt',
    classification,
    severity: blocker ? 'Serious' : 'Moderate',
    wcag: blocker ? [] : ['1.1.1'],
    summary: blocker ? 'Interaction coverage was blocked' : 'Image is missing alternative text',
    issue: blocker ? 'A full-screen surface prevented interaction testing.' : 'The image has no text alternative.',
    impact: 'People may be unable to perceive or operate the content.',
    testing: 'Reproduce the recorded check and inspect the linked evidence.',
    remediation: blocker ? 'Remove or dismiss the blocking surface.' : 'Add an appropriate text alternative.',
    component: blocker ? 'full-screen backdrop' : 'content image',
    urls: ['https://example.test/app#special'],
    viewports: ['desktop'],
    selectors: [blocker ? '.modal-backdrop' : 'main img'],
    evidence: [{
      kind: blocker ? 'keyboard' : 'axe',
      pageUrl: 'https://example.test/app#special',
      viewport: 'desktop',
      selector: blocker ? '.modal-backdrop' : 'main img',
      detail: blocker ? 'The interaction surface covered the viewport.' : 'Element failed image-alt.',
      screenshot
    }],
    assignment: 'Development',
    effort: 'Small',
    translationRequired: 'No'
  };
}

function summary(screenshot: string): AuditSummary {
  const audit: AuditSummary = {
    status: 'completed',
    generatedAt: '2026-09-10T12:00:00.000Z',
    auditor: 'CarlasHub',
    source: 'cross-format regression',
    wcagLevel: 'AA',
    landingPageUrl: 'https://example.test/app#special',
    requestedUrls: ['https://example.test/app#special'],
    auditedUrls: ['https://example.test/app#special'],
    skippedUrls: [],
    pages: [{ url: 'https://example.test/app#special', viewports: [], partial: true }],
    coverage: [{
      url: 'https://example.test/app#special',
      viewports: [{
        viewport: 'desktop',
        assessments: [{
          area: 'keyboard-only',
          status: 'tested-inconclusive',
          detail: 'Interaction testing was blocked before the keyboard journey could run.'
        }]
      }]
    }],
    findings: [
      finding('confirmed', screenshot, 1),
      finding('review', screenshot, 2),
      finding('blocker', screenshot, 3),
      finding('manual', screenshot, 4)
    ],
    manualChecks: REQUIRED_MANUAL_CHECKS,
    limitations: ['This page is partial because an interaction blocker prevented keyboard coverage.']
  };
  audit.criteria = buildWcagCriterionLedger(audit.pages, audit.findings, audit.manualChecks, false);
  return audit;
}

function htmlFindingIds(html: string): string[] {
  return [...html.matchAll(/<tr id="finding-(A11Y\d+)"/g)].map((match) => match[1]!);
}

describe('cross-format report contract', () => {
  it('keeps identities, totals, state, and evidence links portable across HTML, XLSX, JSON, and ZIP', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'a11y-parity-'));
    const outputDir = join(parent, 'Audit Results');
    const screenshot = join(outputDir, 'screenshots', 'elements', 'finding.png');
    const htmlPath = join(outputDir, 'Audit.html');
    const workbookPath = join(outputDir, 'Audit.xlsx');
    const jsonPath = join(outputDir, 'audit-results.json');
    await mkdir(join(outputDir, 'screenshots', 'elements'), { recursive: true });
    await writeFile(screenshot, PNG);

    const audit = summary(screenshot);
    await Promise.all([
      writeHtmlReport(audit, htmlPath),
      writeExcelReport(audit, { outputPath: workbookPath }),
      writeJsonReport(audit, jsonPath)
    ]);
    const archivePath = await createAuditArchive(outputDir, workbookPath, htmlPath, jsonPath);

    const html = await readFile(htmlPath, 'utf8');
    const jsonText = await readFile(jsonPath, 'utf8');
    const json = JSON.parse(jsonText) as AuditSummary;
    const archiveText = (await readFile(archivePath)).toString('latin1');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);

    const jsonIds = json.findings.map((item) => item.id);
    const htmlIds = htmlFindingIds(html);
    const findingsSheet = workbook.getWorksheet('Findings')!;
    const workbookIds = audit.findings.map((_, index) => String(findingsSheet.getCell(index + 7, 1).value));
    expect(jsonIds).toEqual(['A11Y001', 'A11Y002', 'A11Y003', 'A11Y004']);
    expect(htmlIds).toEqual(jsonIds);
    expect(workbookIds).toEqual(jsonIds);

    const totals = Object.fromEntries((['confirmed', 'review', 'blocker', 'manual'] as const).map((classification) => [
      classification,
      json.findings.filter((item) => item.classification === classification).length
    ]));
    expect(totals).toEqual({ confirmed: 1, review: 1, blocker: 1, manual: 1 });
    const auditSummary = workbook.getWorksheet('Audit Summary')!;
    expect([auditSummary.getCell('E5').value, auditSummary.getCell('E6').value, auditSummary.getCell('E7').value])
      .toEqual([totals.confirmed, totals.review, totals.blocker]);
    expect(html).toContain('<span>Confirmed</span><strong>1</strong>');
    expect(html).toContain('<span>Needs review</span><strong>1</strong>');
    expect(html).toContain('<strong>1 audit blocker:</strong>');

    expect(html).toContain('status-partial"></span>Partial');
    expect(html).toContain('tested-inconclusive');
    expect(json.pages[0]?.partial).toBe(true);
    expect(workbook.getWorksheet('Page Inventory')!.getCell('B5').value).toBe('Partial');
    expect(String(auditSummary.getCell('A19').value)).toContain('interaction blocker');

    const relativeScreenshot = 'screenshots/elements/finding.png';
    expect(html).toContain(`href="${relativeScreenshot}"`);
    expect(json.findings.every((item) => item.evidence[0]?.screenshot === relativeScreenshot)).toBe(true);
    expect(findingsSheet.getCell('V7').value).toEqual(expect.objectContaining({ hyperlink: relativeScreenshot }));
    await expect(readFile(join(outputDir, relativeScreenshot))).resolves.toEqual(PNG);

    expect(html).not.toContain(parent);
    expect(jsonText).not.toContain(parent);
    expect(JSON.stringify(workbook.worksheets.map((sheet) => sheet.model))).not.toContain(parent);
    expect(archiveText).not.toContain(parent);
    expect(archiveText).toContain('Audit Results/Audit.html');
    expect(archiveText).toContain('Audit Results/Audit.xlsx');
    expect(archiveText).toContain('Audit Results/audit-results.json');
    expect(archiveText).toContain(`Audit Results/${relativeScreenshot}`);
    await expect(validateExcelReport(workbookPath)).resolves.toEqual(expect.objectContaining({
      valid: true,
      findingRows: 4,
      evidenceRows: 4,
      imageInventoryRows: 4
    }));
  });
});
