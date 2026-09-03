import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveOptions } from '../src/config.js';
import { runAudit } from '../src/audit/runner.js';
import { executeAudit } from '../src/service.js';
import { DEFAULT_AUDITOR } from '../src/instructions.js';

describe.skipIf(process.env.RUN_BROWSER_INTEGRATION !== '1')('browser audit integration', () => {
  it('runs a real Chromium audit and classifies fixture failures', async () => {
    const url = pathToFileURL(resolve('tests/fixtures/site/index.html')).href;
    const outputDir = await mkdtemp(join(tmpdir(), 'a11y-browser-'));
    const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
    const options = resolveOptions({
      auditor: 'Carla Goncalves',
      outputDir,
      allowedHosts: [],
      stagingOnly: false,
      concurrency: 1,
      maxTabStops: 30,
      captureScreenshots: true,
      viewports: [
        { name: 'desktop', width: 1200, height: 800 },
        { name: 'mobile', width: 390, height: 844, isMobile: true },
        { name: 'reflow-320', width: 320, height: 800, isMobile: true }
      ],
      ...(channel ? { channel } : {})
    });
    const result = await runAudit([url], 'fixture', [], options);
    expect(result.auditedUrls).toEqual([url]);
    expect(result.findings.some((finding) => finding.ruleId.includes('image-alt') || finding.ruleId.includes('image-redundant-alt'))).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === 'form-field-no-label' || finding.ruleId === 'axe-label')).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === 'disclosure-focus-order')).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === 'target-size-review')).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === 'tabs-broken-relationships')).toBe(true);
    expect(result.pages[0]?.viewports.some((viewport) => viewport.elementScreenshots.length > 0)).toBe(true);
    expect(result.pages[0]?.viewports[0]?.dom.emptyLinks.some((link) => link.selector === '#meaningful-image-link')).toBe(false);
    expect(result.pages[0]?.viewports[0]?.dom.emptyNamedControls.some((control) => control.selector === '#labelled-input')).toBe(false);
  });

  it('runs the professional service entry point and validates its workbook', async () => {
    const fixture = await readFile(resolve('tests/fixtures/site/index.html'));
    const server = createServer((request, response) => {
      if (request.url === '/missing') {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(fixture);
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port.');
      const url = `http://127.0.0.1:${address.port}/`;
      const outputDir = await mkdtemp(join(tmpdir(), 'a11y-service-'));
      const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
      const result = await executeAudit({
        inputs: [url],
        options: {
          auditor: 'Carla Goncalves',
          outputDir,
          allowedHosts: ['127.0.0.1'],
          concurrency: 1,
          captureScreenshots: true,
          viewports: [{ name: 'desktop', width: 1200, height: 800 }],
          ...(channel ? { channel } : {})
        }
      });
      expect(result.auditedPageCount).toBe(1);
      expect(result.validation.valid).toBe(true);
      expect(result.validation.auditor).toBe('Carla Goncalves');
      expect(result.imageInventoryCount).toBeGreaterThan(0);
      expect(result.confirmedCount).toBeGreaterThan(0);
      const evidence = JSON.parse(await readFile(result.jsonPath, 'utf8')) as { findings: Array<{ ruleId: string; evidence: Array<{ screenshot?: string }> }> };
      expect(evidence.findings.some((finding) => finding.ruleId === 'link-broken-destination')).toBe(true);
      expect(evidence.findings.some((finding) => finding.evidence.some((item) => item.screenshot?.includes('/screenshots/elements/')))).toBe(true);
      expect(result.reportPath).toMatch(/Accessibility_Audit_Report\.xlsx$/);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 120_000);

  it('closes active Chromium work and writes a valid partial report after cancellation', async () => {
    const server = createServer(() => {
      // Keep navigation pending until the cancellation closes the browser connection.
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port.');
      const url = `http://127.0.0.1:${address.port}/slow`;
      const outputDir = await mkdtemp(join(tmpdir(), 'a11y-service-cancel-'));
      const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
      const abortController = new AbortController();
      const started = Date.now();
      const cancellation = setTimeout(() => abortController.abort('integration stop'), 750);
      try {
        const result = await executeAudit({
          inputs: [url],
          options: {
            auditor: 'Carla Goncalves',
            outputDir,
            allowedHosts: ['127.0.0.1'],
            concurrency: 1,
            timeoutMs: 30_000,
            captureScreenshots: false,
            viewports: [{ name: 'desktop', width: 1200, height: 800 }],
            ...(channel ? { channel } : {})
          },
          execution: { signal: abortController.signal }
        });
        expect(result.status).toBe('cancelled');
        expect(result.validation.valid).toBe(true);
        expect(Date.now() - started).toBeLessThan(10_000);
        const partial = JSON.parse(await readFile(result.jsonPath, 'utf8')) as { status: string };
        expect(partial.status).toBe('cancelled');
      } finally {
        clearTimeout(cancellation);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 120_000);

  it.skipIf(process.platform === 'win32')('handles one CLI SIGINT and completes partial report writing before exiting', async () => {
    const server = createServer(() => {
      // Keep navigation pending until the CLI signal handler closes Chromium.
    });
    let child: ReturnType<typeof spawn> | undefined;
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port.');
      const url = `http://127.0.0.1:${address.port}/slow-cli`;
      const outputDir = await mkdtemp(join(tmpdir(), 'a11y-cli-cancel-'));
      const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
      const args = [
        '--import',
        'tsx',
        resolve('src/cli.ts'),
        url,
        '--yes',
        '--output',
        outputDir,
        '--allow-host',
        '127.0.0.1',
        '--timeout',
        '30000',
        '--no-screenshots',
        ...(channel ? ['--channel', channel] : [])
      ];
      child = spawn(process.execPath, args, { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let resolveStarted: (() => void) | undefined;
      const started = new Promise<void>((resolvePromise) => { resolveStarted = resolvePromise; });
      const childStdout = child.stdout;
      const childStderr = child.stderr;
      if (!childStdout || !childStderr) throw new Error('CLI test process did not expose output streams.');
      childStdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      childStderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.includes('Testing page 1/1 at desktop')) resolveStarted?.();
      });
      const startTimeout = setTimeout(() => resolveStarted?.(), 15_000);
      await started;
      clearTimeout(startTimeout);
      expect(stderr).toContain('Testing page 1/1 at desktop');
      child.kill('SIGINT');
      const [exitCode] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];

      expect(exitCode).toBe(130);
      expect(stderr).toContain('Stopped safely. Partial Excel and JSON reports are available');
      const cliResult = JSON.parse(stdout) as { status: string; validation: { valid: boolean; auditor: string } };
      expect(cliResult.status).toBe('cancelled');
      expect(cliResult.validation.valid).toBe(true);
      expect(cliResult.validation.auditor).toBe(DEFAULT_AUDITOR);
      const partial = JSON.parse(await readFile(join(outputDir, 'audit-results.json'), 'utf8')) as { status: string; auditor: string };
      expect(partial.status).toBe('cancelled');
      expect(partial.auditor).toBe(DEFAULT_AUDITOR);
    } finally {
      if (child && child.exitCode === null) child.kill('SIGTERM');
      server.closeAllConnections();
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 120_000);
});
