import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { resolveOptions } from '../src/config.js';
import { auditViewport, runAudit, type AuditViewportDependencies } from '../src/audit/runner.js';
import { runResponsiveChecks } from '../src/audit/browser-checks.js';
import { buildCoverageMatrix } from '../src/audit/coverage.js';
import { findingsFromPage } from '../src/audit/findings.js';
import { detectInteractionBlocker } from '../src/audit/page-preparation.js';
import type { CoverageArea } from '../src/types.js';
import { executeAudit } from '../src/service.js';
import { DEFAULT_AUDITOR } from '../src/instructions.js';

describe.skipIf(process.env.RUN_BROWSER_INTEGRATION !== '1')('browser audit integration', () => {
  it('keeps completed evidence and marks only injected pipeline failures partial', async () => {
    const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
    const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
    const failures: Array<{
      name: string;
      area: CoverageArea;
      override: Partial<AuditViewportDependencies>;
    }> = [
      { name: 'DOM', area: 'structure-headings-landmarks', override: { runDomChecks: async () => { throw new Error('injected DOM failure'); } } },
      { name: 'Keyboard', area: 'keyboard-only', override: { runKeyboardChecks: async () => { throw new Error('injected keyboard failure'); } } },
      { name: 'Disclosure', area: 'interactive-components', override: { runDisclosureChecks: async () => { throw new Error('injected disclosure failure'); } } },
      { name: 'Tab', area: 'interactive-components', override: { runTabChecks: async () => { throw new Error('injected tab failure'); } } },
      { name: 'Link', area: 'broken-or-misleading-links', override: { runLinkChecks: async () => { throw new Error('injected link failure'); } } },
      { name: 'Element context', area: 'viewport-render', override: { collectElementContexts: async () => { throw new Error('injected context failure'); } } },
      { name: 'Screenshot', area: 'viewport-render', override: { captureElementScreenshots: async () => { throw new Error('injected screenshot failure'); } } }
    ];

    try {
      for (const failure of failures) {
        const structuralMarkup = failure.name === 'DOM' ? '' : '<main><h1>Failure injection fixture</h1></main>';
        const html = `<!doctype html><html lang="en"><head><title>Failure injection</title></head><body>${structuralMarkup}<img id="hero" width="20" height="20" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"></body></html>`;
        const url = `data:text/html,${encodeURIComponent(html)}`;
        const options = resolveOptions({
          auditor: 'Failure injection',
          outputDir: await mkdtemp(join(tmpdir(), 'a11y-injected-')),
          allowedHosts: [],
          stagingOnly: false,
          concurrency: 1,
          captureScreenshots: true,
          viewports: [{ name: 'desktop', width: 1200, height: 800 }],
          ...(channel ? { channel } : {})
        });
        const audit = await auditViewport(browser, url, options, options.viewports[0]!, undefined, failure.override);
        const page = { url, viewports: [audit], partial: Boolean(audit.partial) };
        const findings = findingsFromPage(page);
        const coverage = buildCoverageMatrix([page], findings)[0]?.viewports[0]?.assessments ?? [];

        expect(audit.partial, failure.name).toBe(true);
        expect(audit.axeRun.completed, failure.name).toBe(true);
        expect(audit.axe.some((result) => result.id === 'image-alt' && result.resultType === 'violation'), failure.name).toBe(true);
        expect(findings.some((finding) => finding.ruleId === 'axe-image-alt' && finding.classification === 'confirmed'), failure.name).toBe(true);
        expect(coverage.find((assessment) => assessment.area === 'automated-axe')?.status, failure.name).toBe('confirmed-failed');
        expect(coverage.find((assessment) => assessment.area === failure.area)?.status, failure.name).toBe('tested-inconclusive');
        if (failure.name === 'DOM') {
          expect(findings.some((finding) => finding.ruleId === 'missing-main-landmark'), failure.name).toBe(false);
          expect(findings.some((finding) => finding.ruleId === 'missing-h1'), failure.name).toBe(false);
        }
      }
    } finally {
      await browser.close();
    }
  }, 120_000);

  it('distinguishes real interaction blockers from modal-like names at every supported viewport', async () => {
    const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
    const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
    const viewports = [
      { name: 'desktop', width: 1200, height: 800 },
      { name: 'mobile', width: 390, height: 844, isMobile: true },
      { name: 'reflow-320', width: 320, height: 800, isMobile: true }
    ];
    const cases = [
      {
        name: 'CSS overriding hidden',
        html: '<style>.forced-visible{display:block!important;position:fixed;inset:0;background:rgba(0,0,0,.6);pointer-events:auto}</style><main><h1>Page</h1></main><div id="css-dialog" role="dialog" hidden class="forced-visible">Blocking dialog</div>',
        expectedSelector: '#css-dialog'
      },
      {
        name: 'non-semantic fixed backdrop',
        html: '<main><h1>Page</h1></main><div id="backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.6);pointer-events:auto"></div>',
        expectedSelector: '#backdrop'
      },
      {
        name: 'small modal-named card',
        html: '<main><h1>Page</h1><div id="card" class="modal-card" style="width:200px;height:100px">Not a blocker</div></main>',
        expectedSelector: undefined
      },
      {
        name: 'stale consent class on body',
        html: '<body class="consent-modal-open"><main><h1>Page</h1><p>Consent was dismissed.</p></main></body>',
        expectedSelector: undefined
      }
    ];

    try {
      const page = await browser.newPage();
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        for (const fixture of cases) {
          await page.setContent(`<!doctype html><html lang="en"><head><title>${fixture.name}</title></head>${fixture.html}</html>`);
          const blocker = await detectInteractionBlocker(page);
          if (fixture.expectedSelector) {
            expect(blocker?.selector, `${viewport.name}: ${fixture.name}`).toBe(fixture.expectedSelector);
          } else {
            expect(blocker, `${viewport.name}: ${fixture.name}`).toBeNull();
          }
        }
      }
      await page.close();

      for (const viewport of viewports) {
        let keyboardCalls = 0;
        let responsiveCalls = 0;
        const html = '<!doctype html><html lang="en"><head><title>Blocked page</title></head><body><main><h1>Page</h1><button>Unreachable</button></main><div id="backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.6);pointer-events:auto"></div></body></html>';
        const url = `data:text/html,${encodeURIComponent(html)}`;
        const options = resolveOptions({
          auditor: 'Blocker contract',
          outputDir: await mkdtemp(join(tmpdir(), 'a11y-blocker-')),
          allowedHosts: [],
          stagingOnly: false,
          concurrency: 1,
          captureScreenshots: false,
          viewports: [viewport],
          ...(channel ? { channel } : {})
        });
        const audit = await auditViewport(browser, url, options, viewport, undefined, {
          runKeyboardChecks: async () => {
            keyboardCalls += 1;
            throw new Error('keyboard checks must not run behind an interaction blocker');
          },
          runResponsiveChecks: async () => {
            responsiveCalls += 1;
            throw new Error('responsive checks must not run behind an interaction blocker');
          }
        });
        const findings = findingsFromPage({ url, viewports: [audit], partial: Boolean(audit.partial) });

        expect(keyboardCalls, viewport.name).toBe(0);
        expect(responsiveCalls, viewport.name).toBe(0);
        expect(audit.interactionBlocker?.selector, viewport.name).toBe('#backdrop');
        expect(findings.some((finding) => finding.classification === 'blocker'), viewport.name).toBe(true);
        expect(findings.some((finding) => finding.ruleId.includes('keyboard-focus-obscured')), viewport.name).toBe(false);
        expect(findings.some((finding) => finding.ruleId.startsWith('responsive-')), viewport.name).toBe(false);
      }
    } finally {
      await browser.close();
    }
  }, 120_000);

  it('does not classify an intentional carousel viewport as clipped content', async () => {
    const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
    const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
    try {
      const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
      await page.setContent(`
        <style>
          .viewport { width: 100px; height: 40px; overflow: hidden; }
          .track { display: flex; width: 300px; }
          .carousel-slide { flex: 0 0 150px; }
          .wide { width: 300px; height: 20px; }
          .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
        </style>
        <main>
          <div id="stories-carousel" class="viewport carousel">
            <div class="track" data-carousel>
              <div class="carousel-slide">One</div>
              <div class="carousel-slide">Two</div>
            </div>
          </div>
          <div id="genuine-clipping" class="viewport"><div class="wide">Clipped content</div></div>
          <span id="assistive-copy" class="sr-only">Useful screen reader instructions that are intentionally hidden visually.</span>
        </main>
      `);

      const result = await runResponsiveChecks(page);
      expect(result.clippedElements.some((element) => element.selector === '#stories-carousel')).toBe(false);
      expect(result.clippedElements.some((element) => element.selector === '#genuine-clipping')).toBe(true);
      expect(result.clippedElements.filter((element) => element.selector === '#genuine-clipping')).toHaveLength(1);
      expect(result.clippedElements.some((element) => element.selector === '#assistive-copy')).toBe(false);
    } finally {
      await browser.close();
    }
  });

  it('runs a real Chromium audit and classifies fixture failures', async () => {
    const url = pathToFileURL(resolve('tests/fixtures/site/index.html')).href;
    const outputDir = await mkdtemp(join(tmpdir(), 'a11y-browser-'));
    const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
    const options = resolveOptions({
      auditor: 'Test Auditor',
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
    expect(result.pages[0]?.viewports.every((viewport) => viewport.disclosures.find((item) => item.selector === '#menu-toggle')?.spaceTestCompleted)).toBe(true);
    expect(result.findings.some((finding) => (
      finding.ruleId === 'linked-image-purpose-review'
      && finding.selectors.includes('#cookie-settings')
    ))).toBe(false);
    const targetSizeFindings = result.findings.filter((finding) => finding.ruleId === 'target-size-review');
    expect(targetSizeFindings).toHaveLength(1);
    expect(targetSizeFindings[0]).toEqual(expect.objectContaining({
      classification: 'review',
      componentLocation: expect.stringContaining('Fixture page')
    }));
    expect(result.findings.some((finding) => finding.ruleId === 'tabs-broken-relationships')).toBe(true);
    expect(result.pages[0]?.viewports.some((viewport) => viewport.elementScreenshots.length > 0)).toBe(true);
    expect(result.pages[0]?.viewports.every((viewport) => viewport.consent.found && viewport.consent.dismissed)).toBe(true);
    expect(result.pages[0]?.viewports.every((viewport) => viewport.consent.buttonName === 'Reject all')).toBe(true);
    expect(result.findings.filter((finding) => finding.selectors.length > 0).every((finding) => finding.componentName && finding.componentLocation)).toBe(true);
    expect(result.findings
      .filter((finding) => finding.classification === 'confirmed' && finding.selectors.length > 0)
      .every((finding) => finding.evidence.every((item) => !item.screenshot || item.screenshot.includes('screenshots/elements/')))).toBe(true);
    expect(result.findings
      .filter((finding) => finding.classification === 'review' && finding.selectors.length > 0)
      .some((finding) => finding.evidence.some((item) => item.screenshot?.includes('screenshots/elements/')))).toBe(true);
    expect(result.pages[0]?.viewports[0]?.dom.emptyLinks.some((link) => link.selector === '#meaningful-image-link')).toBe(false);
    expect(result.pages[0]?.viewports[0]?.dom.emptyNamedControls.some((control) => control.selector === '#labelled-input')).toBe(false);
  });

  it('keeps AA conformance separate from AAA advice and retains keyboard, reflow, and semantic fixture evidence', async () => {
    const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
    const baseOptions = {
      auditor: 'Regression Auditor',
      allowedHosts: [],
      stagingOnly: false,
      concurrency: 1,
      maxTabStops: 20,
      captureScreenshots: false,
      viewports: [{ name: 'reflow-320', width: 320, height: 800, isMobile: true }],
      ...(channel ? { channel } : {})
    };
    const passUrl = pathToFileURL(resolve('tests/fixtures/quality/pass.html')).href;
    const failUrl = pathToFileURL(resolve('tests/fixtures/quality/fail.html')).href;

    const aaResult = await runAudit([passUrl], 'AA regression fixture', [], resolveOptions({
      ...baseOptions,
      outputDir: await mkdtemp(join(tmpdir(), 'a11y-quality-aa-')),
      wcagLevel: 'AA',
      aaaAdvisory: false
    }));
    expect(aaResult.conformanceTarget).toBe('AA');
    expect(aaResult.aaaAdvisory).toBe(false);
    expect(aaResult.criteria?.find((criterion) => criterion.criterion === '1.4.6')).toEqual(
      expect.objectContaining({ scope: 'advisory', status: 'not-applicable' })
    );
    expect(aaResult.findings.some((finding) => finding.ruleId.includes('color-contrast-enhanced'))).toBe(false);
    expect(aaResult.pages[0]?.viewports[0]?.keyboard.journeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'forward-reverse-focus-order', status: 'passed' }),
      expect.objectContaining({ id: 'bypass-blocks', status: 'passed' })
    ]));

    const aaaResult = await runAudit([passUrl], 'AAA advisory regression fixture', [], resolveOptions({
      ...baseOptions,
      outputDir: await mkdtemp(join(tmpdir(), 'a11y-quality-aaa-')),
      wcagLevel: 'AA',
      aaaAdvisory: true
    }));
    expect(aaaResult.conformanceTarget).toBe('AA');
    expect(aaaResult.aaaAdvisory).toBe(true);
    expect(aaaResult.findings.some((finding) => finding.ruleId.includes('color-contrast-enhanced'))).toBe(true);
    expect(aaaResult.criteria?.find((criterion) => criterion.criterion === '1.4.6')).toEqual(
      expect.objectContaining({ scope: 'advisory', status: 'failed' })
    );

    const failResult = await runAudit([failUrl], 'failing regression fixture', [], resolveOptions({
      ...baseOptions,
      outputDir: await mkdtemp(join(tmpdir(), 'a11y-quality-fail-')),
      wcagLevel: 'AA'
    }));
    const failRuleIds = failResult.findings.map((finding) => finding.ruleId);
    expect(failRuleIds).toEqual(expect.arrayContaining([
      expect.stringMatching(/(?:axe-)?color-contrast/),
      expect.stringMatching(/(?:axe-)?image-alt/),
      'responsive-content-clipped',
      'responsive-controls-overlap',
      'text-spacing-functionality-lost',
      'keyboard-focus-outside-viewport',
      'keyboard-journey-bypass-blocks'
    ]));
    expect(failResult.criteria?.find((criterion) => criterion.criterion === '1.4.10')?.status).toBe('inconclusive');
    expect(failResult.humanAssessmentRequired).toBe(true);
    expect(failResult.conformanceDecision).toBe('not-determined');
  }, 120_000);

  it('runs axe under a strict CSP and blocks redirects outside the authorized hosts', async () => {
    const fixture = '<!doctype html><html lang="en"><head><title>Strict CSP</title></head><body><main><h1>Audit me</h1><img src="missing.png"></main></body></html>';
    const server = createServer((request, response) => {
      if (request.url === '/redirect') {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port.');
        response.writeHead(302, { location: `http://localhost:${address.port}/strict` });
        response.end();
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'self'; script-src 'none'"
      });
      response.end(fixture);
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port.');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
      const baseOptions = {
        auditor: 'Test Auditor',
        allowedHosts: ['127.0.0.1'],
        stagingOnly: false,
        concurrency: 1,
        captureScreenshots: false,
        viewports: [{ name: 'desktop', width: 1200, height: 800 }],
        ...(channel ? { channel } : {})
      };
      const strictUrl = `${baseUrl}/strict`;
      const strictResult = await runAudit([strictUrl], 'strict CSP fixture', [], resolveOptions({
        ...baseOptions,
        outputDir: await mkdtemp(join(tmpdir(), 'a11y-csp-'))
      }));
      expect(strictResult.auditedUrls).toEqual([strictUrl]);
      expect(strictResult.pages[0]?.viewports[0]?.axeRun.completed).toBe(true);

      const redirectUrl = `${baseUrl}/redirect`;
      const redirectResult = await runAudit([redirectUrl], 'redirect fixture', [], resolveOptions({
        ...baseOptions,
        outputDir: await mkdtemp(join(tmpdir(), 'a11y-redirect-'))
      }));
      expect(redirectResult.auditedUrls).toEqual([]);
      expect(redirectResult.pages[0]?.viewports[0]?.axeRun.completed).toBe(false);
      expect(redirectResult.pages[0]?.viewports[0]?.errors.join(' ')).toContain('Navigation blocked');
      expect(redirectResult.findings.some((finding) => finding.classification === 'blocker')).toBe(true);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 120_000);

  it('dismisses an iAlert consent modal before testing the page keyboard sequence', async () => {
    const fixture = `<!doctype html>
      <html lang="en">
        <head><title>iAlert fixture</title></head>
        <body class="system-ialert-active ialert-experience-modal">
          <div id="system-ialert" role="dialog" aria-modal="true" aria-label="Privacy choices">
            <p>Choose your privacy and cookie settings.</p>
            <button id="system-ialert-reject-button">Reject all</button>
            <button id="system-ialert-button">Accept all</button>
          </div>
          <a id="page-link" href="#main">Skip to main content</a>
          <main id="main"><h1>Page content</h1><button id="page-action">Page action</button></main>
          <script>
            document.querySelector('#system-ialert-reject-button').addEventListener('click', () => {
              document.querySelector('#system-ialert').remove();
              document.body.classList.remove('system-ialert-active');
            });
          </script>
        </body>
      </html>`;
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(fixture);
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port.');
      const url = `http://127.0.0.1:${address.port}/`;
      const outputDir = await mkdtemp(join(tmpdir(), 'a11y-ialert-'));
      const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
      const result = await runAudit([url], 'iAlert fixture', [], resolveOptions({
        auditor: 'Test Auditor',
        outputDir,
        allowedHosts: ['127.0.0.1'],
        stagingOnly: false,
        concurrency: 1,
        captureScreenshots: false,
        viewports: [{ name: 'desktop', width: 1200, height: 800 }],
        ...(channel ? { channel } : {})
      }));
      const viewport = result.pages[0]!.viewports[0]!;
      expect(viewport.consent).toEqual(expect.objectContaining({
        found: true,
        dismissed: true,
        action: 'reject',
        buttonName: 'Reject all'
      }));
      expect(viewport.interactionBlocker).toBeNull();
      expect(viewport.keyboard.scope).toBe('document');
      expect(viewport.keyboard.sequence.map((item) => item.selector)).toEqual(expect.arrayContaining(['#page-link', '#page-action']));
      expect(result.findings.some((finding) => finding.ruleId === 'interaction-coverage-blocked')).toBe(false);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 120_000);

  it('re-queries delayed re-rendered disclosures and excludes hidden clones from state evidence', async () => {
    const fixture = `<!doctype html>
      <html lang="en">
        <head>
          <title>Disclosure re-render fixture</title>
          <style>
            button { display: block; margin: 16px; }
            [hidden] { display: none !important; }
          </style>
        </head>
        <body>
          <main>
            <h1>Disclosure checks</h1>
            <div class="slick-cloned">
              <button id="hidden-clone" aria-expanded="false" aria-controls="hidden-panel">Slow menu</button>
              <div id="hidden-panel" hidden>Hidden clone content</div>
            </div>
            <button id="slow-toggle" aria-expanded="false" aria-controls="slow-panel">Slow menu</button>
            <div id="slow-panel" aria-hidden="true" hidden><a href="#slow-content">Slow content</a></div>
            <button id="broken-toggle" aria-expanded="false" aria-controls="broken-panel">Broken menu</button>
            <div id="broken-panel" hidden>Broken content</div>
            <button id="relationship-only" aria-expanded="false">Relationship-free disclosure</button>
            <button id="locked-open" aria-expanded="true" aria-controls="locked-panel">Always open</button>
            <div id="locked-panel">Always visible content</div>
            <div id="late-mount"></div>
          </main>
          <script>
            const replaceAfterDelay = (id, update) => {
              const current = document.getElementById(id);
              setTimeout(() => {
                const live = document.getElementById(id);
                const replacement = live.cloneNode(true);
                update(replacement);
                live.replaceWith(replacement);
              }, 450);
            };
            document.addEventListener('click', (event) => {
              const target = event.target.closest('button');
              if (!target) return;
              if (target.id === 'slow-toggle') {
                const nextExpanded = target.getAttribute('aria-expanded') !== 'true';
                replaceAfterDelay('slow-toggle', (replacement) => {
                  replacement.setAttribute('aria-expanded', String(nextExpanded));
                  document.getElementById('slow-panel').hidden = !nextExpanded;
                });
              }
              if (target.id === 'broken-toggle') {
                replaceAfterDelay('broken-toggle', () => {
                  document.getElementById('broken-panel').hidden = false;
                });
              }
              if (target.id === 'relationship-only') {
                const nextExpanded = target.getAttribute('aria-expanded') !== 'true';
                replaceAfterDelay('relationship-only', (replacement) => {
                  replacement.setAttribute('aria-expanded', String(nextExpanded));
                });
              }
              if (target.id === 'late-toggle') {
                const nextExpanded = target.getAttribute('aria-expanded') !== 'true';
                replaceAfterDelay('late-toggle', (replacement) => {
                  replacement.setAttribute('aria-expanded', String(nextExpanded));
                  document.getElementById('late-panel').hidden = !nextExpanded;
                });
              }
            });
            setTimeout(() => {
              document.getElementById('late-mount').innerHTML =
                '<button id="late-toggle" aria-expanded="false" aria-controls="late-panel">Hydrated menu</button>' +
                '<div id="late-panel" hidden>Hydrated content</div>';
            }, 350);
          </script>
        </body>
      </html>`;
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(fixture);
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port.');
      const url = `http://127.0.0.1:${address.port}/`;
      const outputDir = await mkdtemp(join(tmpdir(), 'a11y-disclosure-rerender-'));
      const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
      const result = await runAudit([url], 'disclosure fixture', [], resolveOptions({
        auditor: 'Test Auditor',
        outputDir,
        allowedHosts: ['127.0.0.1'],
        stagingOnly: false,
        concurrency: 1,
        captureScreenshots: false,
        viewports: [{ name: 'desktop', width: 1200, height: 800 }],
        ...(channel ? { channel } : {})
      }));
      const viewport = result.pages[0]!.viewports[0]!;
      const slow = viewport.disclosures.find((item) => item.selector === '#slow-toggle');
      expect(slow).toEqual(expect.objectContaining({
        activationTargetVerified: true,
        enterTargetVerified: true,
        enterTestCompleted: true,
        enterSettled: true,
        beforeExpanded: 'false',
        afterExpanded: 'true',
        controlledVisibleBefore: false,
        controlledVisibleAfterOpen: true,
        spaceTestCompleted: true,
        spaceTargetVerified: true,
        spaceSettled: true
      }));
      expect(slow?.enterSettleMs).toBeGreaterThanOrEqual(400);
      expect(slow?.afterEnterState).toEqual(expect.objectContaining({
        selector: '#slow-toggle',
        expanded: 'true',
        controlledVisible: true,
        controlledExposed: false
      }));
      expect(viewport.disclosures.some((item) => item.selector === '#hidden-clone')).toBe(false);
      expect(viewport.disclosures.find((item) => item.selector === '#late-toggle')).toEqual(expect.objectContaining({
        enterTestCompleted: true,
        enterSettled: true,
        afterExpanded: 'true',
        controlledVisibleAfterOpen: true
      }));
      expect(viewport.disclosures.find((item) => item.selector === '#locked-open')?.error).toContain('collapsed baseline');
      expect(result.findings.some((finding) => finding.ruleId === 'disclosure-state-not-updated' && finding.selectors.includes('#slow-toggle'))).toBe(false);
      expect(result.findings.some((finding) => finding.ruleId === 'disclosure-state-not-updated' && finding.selectors.includes('#relationship-only'))).toBe(false);
      expect(result.findings.some((finding) => finding.ruleId === 'disclosure-state-not-updated' && finding.selectors.includes('#locked-open'))).toBe(false);
      expect(result.findings.some((finding) => finding.ruleId === 'disclosure-state-not-updated' && finding.selectors.includes('#broken-toggle'))).toBe(true);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 120_000);

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
        inputs: [url, `${url}missing`],
        options: {
          auditor: 'Test Auditor',
          outputDir,
          allowedHosts: ['127.0.0.1'],
          concurrency: 1,
          captureScreenshots: true,
          viewports: [{ name: 'desktop', width: 1200, height: 800 }],
          ...(channel ? { channel } : {})
        }
      });
      expect(result.requestedPageCount).toBe(2);
      expect(result.auditedPageCount).toBe(1);
      expect(result.completedPageCount).toBe(1);
      expect(result.partialPageCount).toBe(1);
      expect(result.notStartedPageCount).toBe(0);
      expect(result.validation.valid).toBe(true);
      expect(result.validation.auditor).toBe('Test Auditor');
      expect(result.imageInventoryCount).toBeGreaterThan(0);
      expect(result.confirmedCount).toBeGreaterThan(0);
      const evidence = JSON.parse(await readFile(result.jsonPath, 'utf8')) as { findings: Array<{ ruleId: string; evidence: Array<{ screenshot?: string }> }> };
      expect(evidence.findings.some((finding) => finding.ruleId === 'link-broken-destination')).toBe(true);
      expect(evidence.findings.some((finding) => finding.evidence.some((item) => item.screenshot?.includes('screenshots/elements/')))).toBe(true);
      const referencedScreenshots = new Set(evidence.findings.flatMap((finding) =>
        finding.evidence.map((item) => item.screenshot).filter((value): value is string => Boolean(value))
      ));
      const generatedScreenshots = (await readdir(join(outputDir, 'screenshots'), { recursive: true }))
        .filter((path) => /\.png$/i.test(path));
      expect(generatedScreenshots).toHaveLength(referencedScreenshots.size);
      expect(result.reportPath).toMatch(/Accessibility_Audit_Report\.xlsx$/);
      expect(result.htmlPath).toMatch(/Accessibility_Audit_Report\.html$/);
      expect(await readFile(result.htmlPath, 'utf8')).toContain('<title>Accessibility audit report');
      expect(Buffer.byteLength(await readFile(result.archivePath))).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 120_000);

  it('runs the documented npm audit command through the built CLI', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html lang="en"><head><title>Public CLI contract</title></head><body><main><h1>Audit target</h1><img src="/missing-alt.png"></main></body></html>');
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port.');
      const outputDir = await mkdtemp(join(tmpdir(), 'a11y-public-command-'));
      const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
      const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const child = spawn(executable, [
        'run', 'audit', '--', `http://127.0.0.1:${address.port}/`, '--yes',
        '--output', outputDir, '--allow-host', '127.0.0.1', '--no-screenshots', '--timeout', '10000',
        ...(channel ? ['--channel', channel] : [])
      ], { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      const [exitCode] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];

      expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
      expect(stderr).toContain('[accessibility-audit:browser]');
      const evidence = JSON.parse(await readFile(join(outputDir, 'audit-results.json'), 'utf8')) as {
        status: string;
        findings: Array<{ ruleId: string; classification: string }>;
      };
      expect(evidence.status).toBe('completed');
      expect(evidence.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ ruleId: 'axe-image-alt', classification: 'confirmed' })
      ]));
      await Promise.all([
        readFile(join(outputDir, 'Accessibility_Audit_Report.html')),
        readFile(join(outputDir, 'Accessibility_Audit_Report.xlsx')),
        readFile(`${outputDir}.zip`)
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 180_000);

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
            auditor: 'Test Auditor',
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
      expect(stderr).toContain('Stopped safely. Partial HTML, Excel, and JSON output is in');
      expect(stderr).toContain('the portable ZIP is');
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
