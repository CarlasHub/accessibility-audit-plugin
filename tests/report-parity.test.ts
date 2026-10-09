import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { REQUIRED_MANUAL_CHECKS } from '../src/audit/manual-checks.js';
import { buildWcagCriterionLedger } from '../src/audit/wcag-criteria.js';
import { createAuditArchive } from '../src/reporting/archive.js';
import { writeCsvReport } from '../src/reporting/csv.js';
import { writeExcelReport } from '../src/reporting/excel.js';
import { writeHtmlReport } from '../src/reporting/html.js';
import { writeJsonReport } from '../src/reporting/json.js';
import { writeSarifReport } from '../src/reporting/sarif.js';
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
    scopeMode: 'supplied-pages-only',
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
  it('keeps identities, totals, state, and evidence links portable across every report format', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'a11y-parity-'));
    const outputDir = join(parent, 'Audit Results');
    const screenshot = join(outputDir, 'screenshots', 'elements', 'finding.png');
    const htmlPath = join(outputDir, 'Audit.html');
    const workbookPath = join(outputDir, 'Audit.xlsx');
    const jsonPath = join(outputDir, 'audit-results.json');
    const csvPath = join(outputDir, 'audit-findings.csv');
    const sarifPath = join(outputDir, 'audit-results.sarif');
    await mkdir(join(outputDir, 'screenshots', 'elements'), { recursive: true });
    await writeFile(screenshot, PNG);

    const audit = summary(screenshot);
    await Promise.all([
      writeHtmlReport(audit, htmlPath),
      writeExcelReport(audit, { outputPath: workbookPath }),
      writeJsonReport(audit, jsonPath),
      writeCsvReport(audit, csvPath),
      writeSarifReport(audit, sarifPath)
    ]);
    const archivePath = await createAuditArchive(outputDir, workbookPath, htmlPath, jsonPath, [csvPath, sarifPath]);

    const html = await readFile(htmlPath, 'utf8');
    const jsonText = await readFile(jsonPath, 'utf8');
    const json = JSON.parse(jsonText) as AuditSummary;
    const csv = await readFile(csvPath, 'utf8');
    const sarif = JSON.parse(await readFile(sarifPath, 'utf8')) as {
      version: string;
      runs: Array<{
        results: Array<{
          kind: string;
          properties: { auditFindingId: string; classification: string };
          partialFingerprints: Record<string, string>;
        }>;
      }>;
    };
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
    expect(csv.match(/"A11Y\d{3}"/g)).toEqual(jsonIds.map((id) => `"${id}"`));
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0]?.results.map((result) => result.properties.auditFindingId)).toEqual(jsonIds);
    expect(sarif.runs[0]?.results.map((result) => result.properties.classification))
      .toEqual(['confirmed', 'review', 'blocker', 'manual']);
    expect(sarif.runs[0]?.results.map((result) => result.kind)).toEqual(['fail', 'review', 'review', 'review']);
    expect(sarif.runs[0]?.results.every((result) => /^a11y-fp-v1:[a-f0-9]{64}$/.test(
      result.partialFingerprints['accessibility-audit/v1'] ?? ''
    ))).toBe(true);
    expect(json.scopeMode).toBe('supplied-pages-only');
    expect(html).toContain('Supplied pages only (no crawl); links are never added as audit targets');

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
    expect(html).toContain('Audit coverage is incomplete, so resolve the gaps before drawing conclusions from the results.');
    expect(String(auditSummary.getCell('A13').value)).toBe('Executive summary, scope and method');
    expect(String(auditSummary.getCell('A14').value).replace(/\n/g, ' ')).toContain(
      'Executive summary: Audit coverage is incomplete, so resolve the gaps before drawing conclusions from the results.'
    );
    expect(String(auditSummary.getCell('A15').value).replace(/\n/g, ' ')).toContain(
      'WCAG conformance remains not determined pending qualified human assessment.'
    );
    expect(String(auditSummary.getCell('A16').value).replace(/\n/g, ' ')).toContain('Source: cross-format regression');
    expect(String(auditSummary.getCell('A16').value).replace(/\n/g, ' ')).toContain('Scope mode: Supplied pages only (no crawl)');
    expect(String(auditSummary.getCell('A16').value)).toContain('Top actions:');
    expect(String(auditSummary.getCell('A16').value)).toContain(
      '[A11Y003] Coverage blocker (not a conformance result) · Coverage blocked'
    );
    expect(String(auditSummary.getCell('A16').value)).toContain('[A11Y001] Confirmed barrier · Moderate');
    expect(String(auditSummary.getCell('A16').value)).toContain(
      '[A11Y002] Requires human validation · Review priority: Moderate'
    );
    expect(auditSummary.getCell('C17').value).toEqual(expect.objectContaining({
      text: 'Open A11Y003',
      hyperlink: "#'Findings'!A9"
    }));
    expect(auditSummary.getCell('E17').value).toEqual(expect.objectContaining({
      text: 'Open A11Y001',
      hyperlink: "#'Findings'!A7"
    }));
    expect(auditSummary.getCell('G17').value).toEqual(expect.objectContaining({
      text: 'Open A11Y002',
      hyperlink: "#'Findings'!A8"
    }));
    expect(html).toMatch(/id="top-actions"[\s\S]*?href="#finding-A11Y003"/);
    for (const rowNumber of [14, 15, 16]) {
      const lines = String(auditSummary.getCell(`A${rowNumber}`).value).split('\n');
      expect(lines.every((line) => line.length <= 88)).toBe(true);
      expect(auditSummary.getRow(rowNumber).height).toBeGreaterThanOrEqual(lines.length * 18 + 8);
    }

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
    expect(archiveText).toContain('Audit Results/audit-findings.csv');
    expect(archiveText).toContain('Audit Results/audit-results.sarif');
    expect(archiveText).toContain(`Audit Results/${relativeScreenshot}`);
    await expect(validateExcelReport(workbookPath)).resolves.toEqual(expect.objectContaining({
      valid: true,
      findingRows: 4,
      evidenceRows: 4,
      imageInventoryRows: 4
    }));
  });

  it('neutralizes spreadsheet formulas in CSV text cells, including formulas after whitespace', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'a11y-csv-safety-'));
    const csvPath = join(parent, 'audit-findings.csv');
    const audit = summary(join(parent, 'finding.png'));
    audit.findings[0]!.summary = '  =HYPERLINK("https://example.invalid","Open")';

    await writeCsvReport(audit, csvPath);

    const csv = await readFile(csvPath, 'utf8');
    expect(csv).toContain('"\'  =HYPERLINK(""https://example.invalid"",""Open"")"');
  });
});
