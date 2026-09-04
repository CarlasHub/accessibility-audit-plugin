import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { executeAudit } from '../src/service.js';
import type { AuditProgressEvent, AuditSummary } from '../src/types.js';

describe('graceful audit cancellation', () => {
  it('writes valid partial JSON and XLSX output when stopped before browser work starts', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'a11y-cancelled-'));
    const abortController = new AbortController();
    const progress: AuditProgressEvent[] = [];
    abortController.abort('test stop');

    const result = await executeAudit({
      inputs: ['https://preview.example.test/jobs'],
      options: {
        auditor: 'Test Auditor',
        outputDir,
        allowedHosts: ['preview.example.test']
      },
      execution: {
        signal: abortController.signal,
        onProgress: (event) => { progress.push(event); }
      }
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'cancelled',
      requestedPageCount: 1,
      completedPageCount: 0,
      partialPageCount: 0,
      notStartedPageCount: 1
    }));
    expect(result.validation.valid).toBe(true);
    expect(progress.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'preparing',
      'targets',
      'browser',
      'cancelled',
      'reporting',
      'validation'
    ]));

    const summary = JSON.parse(await readFile(result.jsonPath, 'utf8')) as AuditSummary;
    expect(summary.status).toBe('cancelled');
    expect(summary.findings).toEqual([]);
    expect(summary.skippedUrls).toEqual([
      { url: 'https://preview.example.test/jobs', reason: 'Audit cancelled before this page started.' }
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.reportPath);
    const inventory = workbook.getWorksheet('Page Inventroy');
    expect(inventory?.actualRowCount).toBe(0);
    expect(inventory?.actualColumnCount).toBe(0);
  });
});
