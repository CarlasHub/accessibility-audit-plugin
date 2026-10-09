import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
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

  it('enforces an exact-host boundary without changing parent-domain allowlists', async () => {
    await expect(collectUrls(['https://preview.example.test/start'], {
      exactHosts: ['preview.example.test']
    })).resolves.toMatchObject({ urls: ['https://preview.example.test/start'] });
    await expect(collectUrls(['https://child.preview.example.test/start'], {
      exactHosts: ['preview.example.test']
    })).rejects.toThrow('All discovered URLs were excluded by the host restrictions.');
    expect(urlRestrictionReason('https://child.preview.example.test/redirected', {
      exactHosts: ['preview.example.test']
    })).toContain('not in the exact-host list');
    expect(urlRestrictionReason('https://child.preview.example.test/redirected', {
      allowedHosts: ['preview.example.test']
    })).toBeNull();
  });

  it('preserves distinct hash-routed application states', async () => {
    await expect(collectUrls([
      'https://example.test/app',
      'https://example.test/app#special'
    ])).resolves.toMatchObject({
      urls: [
        'https://example.test/app',
        'https://example.test/app#special'
      ]
    });
  });

  it('keeps the explicit target set and order without deriving neighbouring pages', async () => {
    await expect(collectUrls([
      'https://preview.example.test/account',
      'https://preview.example.test/',
      'https://preview.example.test/account'
    ], { allowedHosts: ['preview.example.test'] })).resolves.toMatchObject({
      urls: [
        'https://preview.example.test/account',
        'https://preview.example.test/'
      ]
    });
  });

  it('enforces the maximum after authorization and deduplication without truncating', async () => {
    await expect(collectUrls([
      'https://preview.example.test/one',
      'https://preview.example.test/one',
      'https://outside.example.test/excluded',
      'https://preview.example.test/two'
    ], {
      exactHosts: ['preview.example.test'],
      maxPages: 2
    })).resolves.toMatchObject({
      urls: [
        'https://preview.example.test/one',
        'https://preview.example.test/two'
      ],
      skipped: [{
        url: 'https://outside.example.test/excluded',
        reason: expect.stringContaining('exact-host list')
      }]
    });

    await expect(collectUrls([
      'https://preview.example.test/one',
      'https://preview.example.test/two',
      'https://preview.example.test/three'
    ], { maxPages: 2 })).rejects.toThrow(
      'Resolved 3 authorized unique pages, exceeding the configured maximum of 2'
    );
  });

  it('expands whitespace-collapsed URL lists instead of encoding them as one path', async () => {
    const result = await collectUrls([
      'https://loreal.runmytests.eu/en  https://loreal.runmytests.eu/en/search-jobs https://loreal.runmytests.eu/en/saved-jobs'
    ]);

    expect(result.urls).toEqual([
      'https://loreal.runmytests.eu/en',
      'https://loreal.runmytests.eu/en/search-jobs',
      'https://loreal.runmytests.eu/en/saved-jobs'
    ]);
  });

  it('accepts pasted, bulleted, numbered, and JSON URL lists without changing URL punctuation', async () => {
    const formatted = await collectUrls([
      '- https://example.test/a,b;c?tags=one,two\n2. https://example.test/jobs;  * https://example.test/contact\nhttps://example.test/jobs'
    ]);
    const json = await collectUrls([
      '["https://example.test/a,b;c?tags=one,two", "https://example.test/jobs"]'
    ]);

    expect(formatted).toMatchObject({
      source: 'explicit URL list',
      urls: [
        'https://example.test/a,b;c?tags=one,two',
        'https://example.test/jobs',
        'https://example.test/contact'
      ]
    });
    expect(json).toMatchObject({
      source: 'explicit URL list',
      urls: [
        'https://example.test/a,b;c?tags=one,two',
        'https://example.test/jobs'
      ]
    });
  });

  it('identifies malformed pasted-list entries instead of silently dropping them', async () => {
    await expect(collectUrls([
      'not-a-complete-url\nhttps://example.test/two'
    ])).rejects.toThrow('Invalid explicit URL list entry 1');
    await expect(collectUrls([
      'https://example.test/one\nftp://example.test/two\nhttps://example.test/three'
    ])).rejects.toThrow('Invalid explicit URL list entry 2');
    await expect(collectUrls([
      'https://example.test/one\nhttps://user:secret@example.test/two'
    ])).rejects.toThrow('Invalid explicit URL list entry 2');
    await expect(collectUrls([
      'https://example.test/one\nhttps://example.test/two\nnot-a-complete-url'
    ])).rejects.toThrow('Invalid explicit URL list entry 3');
    await expect(collectUrls(['["https://example.test/"'])).rejects.toThrow(
      'Invalid explicit URL list JSON syntax'
    );
    await expect(collectUrls(['["https://example.test/", 42]'])).rejects.toThrow(
      'Invalid explicit URL list entry 2'
    );
  });

  it('imports URL-set sitemap locations in order without treating metadata as pages', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-sitemap-'));
    const path = join(directory, 'sitemap.xml');
    await writeFile(path, `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
              xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
        <url>
          <loc>https://preview.example.test/search?q=jobs&amp;lang=en</loc>
          <image:image><image:loc>https://cdn.example.test/hero.jpg</image:loc></image:image>
        </url>
        <url><loc><![CDATA[https://outside.test/excluded]]></loc></url>
        <url><loc>https://preview.example.test/search?q=jobs&amp;lang=en</loc></url>
        <url><loc>https://preview.example.test/jobs</loc></url>
      </urlset>`);

    const result = await collectUrls([path], { allowedHosts: ['preview.example.test'] });
    expect(result.urls).toEqual([
      'https://preview.example.test/search?q=jobs&lang=en',
      'https://preview.example.test/jobs'
    ]);
    expect(result.skipped).toEqual([{
      url: 'https://outside.test/excluded',
      reason: 'Host outside.test is not in the allowed-host list.'
    }]);
  });

  it('rejects unsafe or malformed sitemap XML with actionable errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-sitemap-invalid-'));
    const unsafePath = join(directory, 'unsafe.xml');
    const malformedPath = join(directory, 'malformed.xml');
    await writeFile(unsafePath, '<!DOCTYPE urlset [<!ENTITY secret SYSTEM "file:///etc/passwd">]><urlset><url><loc>&secret;</loc></url></urlset>');
    await writeFile(malformedPath, '<urlset><url><loc>https://example.test/</loc></urlset>');

    await expect(collectUrls([unsafePath])).rejects.toThrow('DOCTYPE declarations are not allowed');
    await expect(collectUrls([malformedPath])).rejects.toThrow('Invalid XML sitemap "malformed.xml"');
  });

  it('allows DOCTYPE-like text in XML comments while rejecting actual declarations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-sitemap-comment-'));
    const path = join(directory, 'comment.xml');
    await writeFile(path, '<urlset><!-- documentation: <!DOCTYPE is prohibited --><url><loc>https://example.test/</loc></url></urlset>');

    await expect(collectUrls([path])).resolves.toMatchObject({
      urls: ['https://example.test/']
    });
  });

  it('enforces the sitemap limit on imported locations rather than URL containers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-sitemap-limit-'));
    const path = join(directory, 'too-many.xml');
    const locations = Array.from(
      { length: 50_001 },
      (_, index) => `<loc>https://example.test/${index}</loc>`
    ).join('');
    await writeFile(path, `<urlset><url>${locations}</url></urlset>`);

    await expect(collectUrls([path])).rejects.toThrow('the file exceeds the 50,000 URL sitemap limit');
  });

  it.skipIf(process.platform === 'win32')('stops reading an oversized sitemap stream at the byte limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-sitemap-stream-'));
    const path = join(directory, 'oversized.xml');
    const fifo = spawn('mkfifo', [path]);
    const fifoExit = await new Promise<number | null>((resolveExit, rejectExit) => {
      fifo.once('error', rejectExit);
      fifo.once('exit', resolveExit);
    });
    expect(fifoExit).toBe(0);

    const attemptedCollection = collectUrls([path]);
    const bytesOffered = 55 * 1024 * 1024;
    const producerScript = `
      const { createWriteStream } = require('node:fs');
      const output = createWriteStream(process.argv[1]);
      const chunk = Buffer.alloc(64 * 1024, 32);
      const total = Number(process.argv[2]);
      let written = 0;
      output.on('error', (error) => {
        process.stderr.write(String(written));
        process.exit(error.code === 'EPIPE' ? 42 : 43);
      });
      output.on('open', function writeMore() {
        while (written < total) {
          written += chunk.length;
          if (!output.write(chunk)) {
            output.once('drain', writeMore);
            return;
          }
        }
        output.end(() => process.exit(0));
      });
    `;
    const producer = spawn(process.execPath, ['-e', producerScript, path, String(bytesOffered)]);
    let producerOutput = '';
    producer.stderr.setEncoding('utf8');
    producer.stderr.on('data', (chunk: string) => {
      producerOutput += chunk;
    });

    await expect(attemptedCollection).rejects.toThrow('the uncompressed file exceeds the 50 MiB sitemap limit');
    const producerExit = await new Promise<number | null>((resolveExit, rejectExit) => {
      producer.once('error', rejectExit);
      producer.once('exit', resolveExit);
    });
    expect(producerExit).toBe(42);
    expect(Number(producerOutput)).toBeLessThan(bytesOffered);
  }, 15_000);

  it('requires a URL-set file and does not recursively fetch sitemap indexes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-sitemap-index-'));
    const indexPath = join(directory, 'index.xml');
    const wrongRootPath = join(directory, 'feed.xml');
    await writeFile(indexPath, '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.test/child.xml</loc></sitemap></sitemapindex>');
    await writeFile(wrongRootPath, '<feed><loc>https://example.test/</loc></feed>');

    await expect(collectUrls([indexPath])).rejects.toThrow(
      'sitemap indexes are not fetched; provide each child URL-set XML file explicitly'
    );
    await expect(collectUrls([wrongRootPath])).rejects.toThrow('the root element must be <urlset>');
  });

  it('preserves remote XML URLs as explicit page targets', async () => {
    await expect(collectUrls(['https://preview.example.test/sitemap.xml'])).resolves.toMatchObject({
      urls: ['https://preview.example.test/sitemap.xml']
    });
  });
});
