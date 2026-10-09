import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveOptions } from '../src/config.js';
import {
  createPreAuditSummary,
  formatPreAuditSummary,
  preparePreAuditSummary
} from '../src/pre-audit-summary.js';

describe('pre-audit summary', () => {
  it('keeps Chromium as the default and clearly discloses opt-in engines', async () => {
    expect(resolveOptions().browserEngine).toBe('chromium');
    const firefox = await createPreAuditSummary(
      ['https://preview.example.test/'],
      resolveOptions({ browserEngine: 'firefox' })
    );
    expect(firefox).toMatchObject({
      browserEngine: 'firefox',
      browserSelection: 'Playwright Firefox'
    });
    expect(formatPreAuditSummary(firefox)).toContain('automatic Firefox install on');
    expect(() => resolveOptions({ browserEngine: 'webkit', channel: 'chrome' })).toThrow(
      'Browser channels are supported only with the Chromium engine. Remove channel or select browserEngine "chromium".'
    );
  });

  it('resolves scope restrictions and effective settings before consent', async () => {
    const options = resolveOptions({
      preset: 'thorough',
      allowedHosts: ['preview.example.test'],
      auditor: 'Test Auditor',
      outputDir: 'test-results'
    });
    const summary = await createPreAuditSummary([
      'https://preview.example.test/jobs',
      'https://production.example.test/'
    ], options);

    expect(summary).toEqual(expect.objectContaining({
      scopeMode: 'supplied-pages-only',
      inputCount: 2,
      pageCount: 1,
      pages: ['https://preview.example.test/jobs'],
      skippedCount: 1,
      hosts: ['preview.example.test'],
      preset: 'thorough',
      auditor: 'Test Auditor',
      landingPageUrl: 'https://preview.example.test/jobs',
      coverage: 'WCAG 2.2 AA core + AAA advisory',
      browserSelection: 'Playwright Chromium or supported system browser',
      timeoutMs: 45_000,
      maxTabStops: 240,
      maxLinksPerPage: 500,
      allowedHosts: ['preview.example.test'],
      maxPages: null
    }));
    expect(summary.skipped[0]).toEqual(expect.objectContaining({
      url: 'https://production.example.test/',
      reason: expect.stringContaining('allowed-host list')
    }));

    const formatted = formatPreAuditSummary(summary);
    expect(formatted).toContain('1 resolved from 2 inputs; 1 excluded by scope rules');
    expect(formatted).toContain('maximum unlimited');
    expect(formatted).toContain('supplied pages only (no crawl); allowed hosts: preview.example.test');
    expect(formatted).toContain('thorough preset; headless browser');
    expect(formatted).toContain('WCAG 2.2 AA core + AAA advisory');
    expect(formatted).toContain('automatic Chromium install on');
    expect(formatted).toContain('45000 ms per operation; 240 keyboard tab stops; 500 same-origin links per page');
    expect(formatted).toContain('Excluded: https://production.example.test/');
  });

  it('shows an explicit page ceiling before the run', async () => {
    const summary = await createPreAuditSummary(
      ['https://preview.example.test/one', 'https://preview.example.test/two'],
      resolveOptions({ exactHosts: ['preview.example.test'], maxPages: 2 })
    );

    expect(summary).toMatchObject({ exactHosts: ['preview.example.test'], maxPages: 2 });
    expect(formatPreAuditSummary(summary)).toContain('2 resolved from 2 inputs; maximum 2');
  });

  it('discloses saved browser-state use without exposing its local path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pre-audit-auth-'));
    const privatePath = join(directory, 'customer-session.json');
    try {
      await writeFile(privatePath, JSON.stringify({
        cookies: [{
          name: 'session', value: 'private-value', domain: 'preview.example.test', path: '/',
          expires: -1, httpOnly: true, secure: true, sameSite: 'Lax'
        }],
        origins: []
      }));
      await chmod(privatePath, 0o600);
      const summary = await createPreAuditSummary(
        ['https://preview.example.test/account'],
        resolveOptions({ storageState: privatePath })
      );
      const formatted = formatPreAuditSummary(summary);
      const prepared = await preparePreAuditSummary(
        ['https://preview.example.test/account'],
        resolveOptions({ storageState: privatePath })
      );

      expect(summary.savedBrowserState).toBe(true);
      expect(formatted).toContain('saved browser state preflight passed');
      expect(formatted).not.toContain(privatePath);
      expect(formatted).not.toContain('private-value');
      expect(JSON.stringify(prepared)).not.toContain('private-value');
      expect(Object.keys(prepared)).not.toContain('authentication');
      expect(formatPreAuditSummary(await createPreAuditSummary(
        ['https://preview.example.test/'],
        resolveOptions()
      ))).toContain('no saved browser state');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('limits long page previews while preserving the resolved page count', async () => {
    const pages = Array.from({ length: 12 }, (_, index) => `https://preview.example.test/page-${index + 1}`);
    const summary = await createPreAuditSummary(pages, resolveOptions({ preset: 'debug' }));

    expect(summary.pageCount).toBe(12);
    expect(summary.pages).toHaveLength(10);
    expect(summary.remainingPageCount).toBe(2);
    expect(summary.browserMode).toBe('headed');
    expect(formatPreAuditSummary(summary)).toContain('…and 2 more');
  });

  it('resolves page-list files and defaults the landing page to the first URL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pre-audit-summary-'));
    const pageList = join(directory, 'pages.txt');
    try {
      await writeFile(pageList, 'https://preview.example.test/\nhttps://preview.example.test/contact\n');
      const summary = await createPreAuditSummary([pageList], resolveOptions());

      expect(summary.source).toBe('pages.txt');
      expect(summary.pageCount).toBe(2);
      expect(summary.pages).toEqual([
        'https://preview.example.test/',
        'https://preview.example.test/contact'
      ]);
      expect(summary.landingPageUrl).toBe('https://preview.example.test/');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps a complete approval snapshot and changes its digest when a page list changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pre-audit-snapshot-'));
    const pageList = join(directory, 'pages.txt');
    try {
      await writeFile(pageList, 'https://preview.example.test/approved\n');
      const approved = await preparePreAuditSummary([pageList], resolveOptions());

      await writeFile(pageList, 'https://preview.example.test/changed\n');
      const changed = await preparePreAuditSummary([pageList], resolveOptions());

      expect(approved.resolvedPages).toEqual(['https://preview.example.test/approved']);
      expect(approved.confirmationDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(changed.resolvedPages).toEqual(['https://preview.example.test/changed']);
      expect(changed.confirmationDigest).not.toBe(approved.confirmationDigest);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('discloses only history filenames and binds their ordered paths into confirmation', async () => {
    const privateRoot = join('/private', 'customer-a');
    const options = resolveOptions();
    const first = await preparePreAuditSummary(['https://preview.example.test/'], options, {
      historyPaths: [join(privateRoot, 'august.json'), join(privateRoot, 'september.json')]
    });
    const reordered = await preparePreAuditSummary(['https://preview.example.test/'], options, {
      historyPaths: [join(privateRoot, 'september.json'), join(privateRoot, 'august.json')]
    });

    expect(first.summary).toMatchObject({
      historyCount: 2,
      historySources: ['august.json', 'september.json']
    });
    expect(formatPreAuditSummary(first.summary)).toContain('2 prior audits (august.json, september.json)');
    expect(JSON.stringify(first.summary)).not.toContain(privateRoot);
    expect(first.confirmationDigest).not.toBe(reordered.confirmationDigest);
  });
});
