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
    sheet.addRow(['Home', 'https://careers.qa.example.org/en', 'https://careers.example.org/en']);
    sheet.addRow(['Jobs', 'https://careers.qa.example.org/jobs', 'https://careers.example.org/jobs']);
    await workbook.xlsx.writeFile(path);

    const result = await collectUrls([path], { stagingOnly: true, allowedHosts: ['qa.example.org'] });
    expect(result.urls).toEqual([
      'https://careers.qa.example.org/en',
      'https://careers.qa.example.org/jobs'
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('rejects all URLs outside the allowed-host list', async () => {
    await expect(collectUrls(['https://example.com/'], { allowedHosts: ['qa.example.org'] })).rejects.toThrow(
      'All discovered URLs were excluded'
    );
  });
});
