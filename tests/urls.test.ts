import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { collectUrls } from '../src/urls.js';

describe('collectUrls', () => {
  it('uses the QA page column and filters non-staging hosts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-urls-'));
    const path = join(directory, 'pages.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pages');
    sheet.addRow(['Page name', 'QA page', 'Production page']);
    sheet.addRow(['Home', 'https://example.runmytests.com/en', 'https://example.com/en']);
    sheet.addRow(['Jobs', 'https://example.runmytests.com/jobs', 'https://example.com/jobs']);
    await workbook.xlsx.writeFile(path);

    const result = await collectUrls([path], { stagingOnly: true, allowedHosts: ['runmytests.com'] });
    expect(result.urls).toEqual([
      'https://example.runmytests.com/en',
      'https://example.runmytests.com/jobs'
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('rejects all URLs outside the allowed-host list', async () => {
    await expect(collectUrls(['https://example.com/'], { allowedHosts: ['runmytests.com'] })).rejects.toThrow(
      'All discovered URLs were excluded'
    );
  });
});
