import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { collectUrls, urlRestrictionReason } from '../src/urls.js';

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

  it('rejects embedded credentials and unsupported URL protocols clearly', async () => {
    await expect(collectUrls(['https://user:secret@example.test/'])).rejects.toThrow(
      'embedded usernames or passwords'
    );
    await expect(collectUrls(['ftp://example.test/report'])).rejects.toThrow(
      'Unsupported or invalid target URL'
    );
  });

  it('normalizes URL-shaped allowlist entries and permits their subdomains', async () => {
    await expect(collectUrls(['https://docs.example.test/'], {
      allowedHosts: ['https://example.test/']
    })).resolves.toMatchObject({ urls: ['https://docs.example.test/'] });
    await expect(collectUrls(['https://example.test/'], {
      allowedHosts: ['https://example.test/path']
    })).rejects.toThrow('Invalid allowed host');
  });

  it('applies host and staging restrictions to navigation redirects', () => {
    expect(urlRestrictionReason('https://docs.example.test/page', {
      allowedHosts: ['example.test']
    })).toBeNull();
    expect(urlRestrictionReason('https://outside.test/page', {
      allowedHosts: ['example.test']
    })).toContain('not in the allowed-host list');
    expect(urlRestrictionReason('https://contest.example/page', { stagingOnly: true })).toContain(
      'does not look like a staging host'
    );
    expect(urlRestrictionReason('https://preview-42.example/page', { stagingOnly: true })).toBeNull();
  });
});
