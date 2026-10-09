import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_OUTPUT_DIR, DEMO_REPORT_NAME, demoAuditDefaults, startDemoSite, type DemoSite } from '../src/demo.js';

let site: DemoSite | undefined;

afterEach(async () => {
  await site?.close();
  site = undefined;
});

describe('safe local demo', () => {
  it('serves the intentionally imperfect practice page on loopback only', async () => {
    site = await startDemoSite();
    const target = new URL(site.url);
    const response = await fetch(site.url);
    const html = await response.text();

    expect(target.hostname).toBe('127.0.0.1');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(html).toContain('Accessibility Audit practice page');
    expect(html).toContain('intentionally imperfect');
    expect(html).not.toMatch(/(?:href|src)=["']https?:\/\//i);
  });

  it('allows only read requests and does not expose other paths', async () => {
    site = await startDemoSite();
    expect((await fetch(new URL('/missing', site.url))).status).toBe(404);
    expect((await fetch(site.url, { method: 'POST' })).status).toBe(405);
  });

  it('uses an isolated report name, output directory, and exact loopback boundary', async () => {
    site = await startDemoSite();
    expect(demoAuditDefaults(site.url)).toMatchObject({
      auditor: 'Automated',
      landingPageUrl: site.url,
      outputDir: expect.stringContaining(DEMO_OUTPUT_DIR),
      exactHosts: ['127.0.0.1'],
      stagingOnly: true,
      concurrency: 1
    });
    expect(DEMO_REPORT_NAME).toBe('Accessibility_Audit_Demo.xlsx');
  });

  it('rejects a non-loopback demo target', () => {
    expect(() => demoAuditDefaults('https://example.test/')).toThrow('private loopback server');
  });

  it('releases the ephemeral port when closed', async () => {
    site = await startDemoSite();
    const url = site.url;
    await site.close();
    site = undefined;
    await expect(fetch(url)).rejects.toThrow();
  });
});
