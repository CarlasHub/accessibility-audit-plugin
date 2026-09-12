import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import axe from 'axe-core';
import type {
  AuditExecutionContext,
  AuditOptions,
  AuditProgressEvent,
  AuditSummary,
  AxeRunMetadata,
  AxeViolationResult,
  ConsentHandlingResult,
  DomCheckResult,
  ElementContext,
  ElementScreenshot,
  Finding,
  InteractionBlocker,
  LinkCheckMetadata,
  PageAudit,
  ViewportAudit
} from '../types.js';
import { REQUIRED_MANUAL_CHECKS } from './manual-checks.js';
import { runDisclosureChecks, runDomChecks, runKeyboardChecks, runLinkChecks, runResponsiveChecks, runTabChecks } from './browser-checks.js';
import { runConfiguredJourneyChecks } from './journey-checks.js';
import { collectElementContexts, detectInteractionBlocker, dismissConsentBanner } from './page-preparation.js';
import { findingsFromPage } from './findings.js';
import { buildCoverageMatrix } from './coverage.js';
import { buildWcagCriterionLedger } from './wcag-criteria.js';
import { applyConfirmedFindingConfidenceGate, assertAuditQualityContract, AUDIT_QUALITY_CONTRACT } from './quality-contract.js';
import { assertRemediationOnlyNotes, consolidateFindings } from '../reporting/consolidate.js';
import { assignFindingIds } from '../reporting/finding-id.js';
import { writeJsonReport } from '../reporting/json.js';
import { singleLineText } from '../text.js';
import { urlRestrictionReason } from '../urls.js';

const CANCELLED_REASON = 'The audit was stopped by the user. Results include only work completed before cancellation.';
const MAX_CAPTURED_RUNTIME_ERRORS = 50;
const require = createRequire(import.meta.url);

export function isBrowserNetworkConsoleError(message: string): boolean {
  return /^Failed to load resource:\s+net::ERR_[A-Z0-9_]+$/i.test(message.trim());
}

function emptyDom(): DomCheckResult {
  return {
    h1Count: 0,
    mainCount: 0,
    unnamedLandmarks: [],
    missingAltImages: [],
    linkedImagesForReview: [],
    emptyLinks: [],
    emptyNamedControls: [],
    unlabeledFields: [],
    duplicateIds: [],
    smallTargets: [],
    tablesForReview: [],
    autoplayMedia: []
  };
}

async function emitProgress(execution: AuditExecutionContext, event: AuditProgressEvent): Promise<void> {
  try {
    await execution.onProgress?.(event);
  } catch {
    // Progress display failures must not invalidate audit evidence or reporting.
  }
}

function safeSlug(url: string): string {
  const parsed = new URL(url);
  const value = `${parsed.hostname}${parsed.pathname}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return value.slice(0, 100) || 'page';
}

function safeProgressLabel(value: string): string {
  return singleLineText(value, 240);
}

export function createBrowserLaunchOptions(
  options: Pick<AuditOptions, 'channel' | 'executablePath'>,
  headless: boolean
): Parameters<typeof chromium.launch>[0] {
  return {
    headless,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    ...(options.channel ? { channel: options.channel } : {}),
    ...(options.executablePath ? { executablePath: options.executablePath } : {})
  };
}

export function browserLaunchCandidates(
  options: Pick<AuditOptions, 'channel' | 'executablePath'>,
  headless: boolean
): Array<Parameters<typeof chromium.launch>[0]> {
  const explicit = Boolean(options.channel || options.executablePath);
  if (explicit) return [createBrowserLaunchOptions(options, headless)];
  return [
    createBrowserLaunchOptions({}, headless),
    createBrowserLaunchOptions({ channel: 'chrome' }, headless),
    createBrowserLaunchOptions({ channel: 'msedge' }, headless)
  ];
}

export function isMissingBrowserExecutableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /executable (?:doesn['’]t|does not) exist|browser executable|could not find.+(?:chrome|edge|chromium)|(?:browser|channel|chromium distribution).+not found|(?:please\s+)?run.+playwright install/i.test(message);
}

export async function installPlaywrightChromium(signal?: AbortSignal): Promise<void> {
  const cli = require.resolve('playwright/cli');
  await new Promise<void>((resolveInstall, rejectInstall) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const forward = (chunk: Buffer | string): void => { process.stderr.write(chunk); };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    const abort = (): void => { child.kill('SIGTERM'); };
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', rejectInstall);
    child.once('exit', (code, exitSignal) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) {
        rejectInstall(new Error('Chromium installation was cancelled.'));
      } else if (code === 0) {
        resolveInstall();
      } else {
        rejectInstall(new Error(`Playwright Chromium installation failed${exitSignal ? ` with signal ${exitSignal}` : ` with exit code ${code ?? 'unknown'}`}.`));
      }
    });
  });
}

async function launchAuditBrowser(
  options: AuditOptions,
  execution: AuditExecutionContext
): Promise<Browser> {
  const candidates = browserLaunchCandidates(options, options.headless);
  let lastMissingError: unknown;
  for (const candidate of candidates) {
    try {
      return await chromium.launch(candidate);
    } catch (error) {
      if (!isMissingBrowserExecutableError(error)) throw error;
      lastMissingError = error;
    }
  }

  if (options.channel || options.executablePath) {
    throw lastMissingError instanceof Error
      ? lastMissingError
      : new Error('The explicitly configured browser executable is unavailable.');
  }

  if (!options.autoInstallBrowser) {
    throw new Error(
      `No supported Chromium browser is available. Run "npx playwright install chromium" in the plugin directory or enable automatic browser installation. ${lastMissingError instanceof Error ? lastMissingError.message : ''}`.trim()
    );
  }

  await emitProgress(execution, {
    phase: 'browser',
    message: 'No supported browser was found. Installing headless Playwright Chromium once before the audit starts.'
  });
  await installPlaywrightChromium(execution.signal);
  return chromium.launch(createBrowserLaunchOptions({}, options.headless));
}

async function runAxe(
  page: Page,
  wcagLevel: AuditOptions['wcagLevel']
): Promise<{ results: AxeViolationResult[]; metadata: AxeRunMetadata }> {
  await page.addScriptTag({ content: axe.source });
  const tags = [
    'wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa',
    ...(wcagLevel === 'AAA' ? ['wcag2aaa', 'wcag21aaa', 'wcag22aaa'] : []),
    'best-practice'
  ];
  const output = await page.evaluate(async (runOnlyTags) => {
    const engine = (window as unknown as {
      axe: {
        run: (context: Document, options: unknown) => Promise<{
          violations: AxeViolationResult[];
          incomplete: AxeViolationResult[];
          passes: AxeViolationResult[];
        }>;
      };
    }).axe;
    return engine.run(document, {
      runOnly: {
        type: 'tag',
        values: runOnlyTags
      },
      resultTypes: ['violations', 'incomplete', 'passes']
    });
  }, tags);
  return {
    results: [
      ...output.violations.map((result) => ({ ...result, resultType: 'violation' as const })),
      ...output.incomplete.map((result) => ({ ...result, resultType: 'incomplete' as const }))
    ],
    metadata: {
      completed: true,
      violationCount: output.violations.length,
      incompleteCount: output.incomplete.length,
      passCount: output.passes.length,
      passes: output.passes.map((result) => ({ id: result.id, tags: result.tags, nodeCount: result.nodes.length }))
    }
  };
}

export function screenshotCandidatesForFindings(findings: Finding[]): string[] {
  const selectors = new Set<string>();
  const add = (selector?: string | null): void => { if (selector?.trim()) selectors.add(selector.trim()); };
  const rank = { blocker: 0, confirmed: 1, review: 2, manual: 3 } as const;
  const ordered = [...findings].sort((a, b) => (
    rank[a.classification] - rank[b.classification]
    || a.ruleId.localeCompare(b.ruleId)
    || a.key.localeCompare(b.key)
  ));
  for (const finding of ordered) {
    if (finding.classification === 'manual') continue;
    add(finding.selectors.find((selector) => !/^(?:page|html|body)$/i.test(selector.trim())));
  }
  return [...selectors].slice(0, 12);
}

export function needsFullPageScreenshotFallback(
  findings: Finding[],
  elementScreenshots: ElementScreenshot[]
): boolean {
  const capturedSelectors = new Set(elementScreenshots.map((item) => item.selector));
  return findings.some((finding) =>
    finding.classification !== 'manual'
    && (
      finding.selectors.length === 0
      || finding.selectors.every((selector) => /^(?:page|html|body)$/i.test(selector.trim()))
    )
    && !finding.selectors.some((selector) => capturedSelectors.has(selector))
  );
}

export function retainRepresentativeScreenshotPerFinding(findings: Finding[]): void {
  for (const finding of findings) {
    let retained = false;
    finding.evidence = finding.evidence.map((item) => {
      if (!item.screenshot) return item;
      if (!retained) {
        retained = true;
        return item;
      }
      const withoutScreenshot = { ...item };
      delete withoutScreenshot.screenshot;
      return withoutScreenshot;
    });
  }
}

function elementContextFor(contexts: ElementContext[], selector: string): ElementContext | undefined {
  return contexts.find((context) => context.selector === selector);
}

async function resolveEvidenceTarget(
  page: Page,
  selector: string,
  context?: ElementContext
): Promise<Locator | null> {
  try {
    const direct = page.locator(selector).first();
    if ((await direct.count()) > 0 && await direct.isVisible().catch(() => false)) return direct;
  } catch {
    // Continue with the evidence-backed role/name fallback below.
  }
  if (context?.accessibleName) {
    const supportedRoles = new Set([
      'alert', 'alertdialog', 'button', 'checkbox', 'combobox', 'dialog', 'heading', 'image', 'link',
      'listbox', 'menu', 'menuitem', 'navigation', 'option', 'radio', 'region', 'searchbox', 'slider',
      'spinbutton', 'switch', 'tab', 'table', 'textbox', 'treeitem'
    ]);
    if (supportedRoles.has(context.role)) {
      const byRole = page.getByRole(
        context.role as Parameters<Page['getByRole']>[0],
        { name: context.accessibleName, exact: true }
      ).first();
      if ((await byRole.count()) > 0 && await byRole.isVisible().catch(() => false)) return byRole;
    }
  }
  return null;
}

async function contextualCaptureLocator(
  page: Page,
  target: Locator,
  context?: ElementContext
): Promise<Locator> {
  const viewport = page.viewportSize();
  const maxHeight = Math.max(240, (viewport?.height ?? 900) * 0.85);
  const suitable = async (locator: Locator, minimumHeight = 56): Promise<boolean> => {
    if (!(await locator.isVisible().catch(() => false))) return false;
    const box = await locator.boundingBox().catch(() => null);
    return Boolean(box && box.width >= 120 && box.height >= minimumHeight && box.height <= maxHeight);
  };

  if (context?.captureSelector) {
    try {
      const component = page.locator(context.captureSelector).first();
      if ((await component.count()) > 0 && await suitable(component, 20)) return component;
    } catch {
      // Fall back to a rendered ancestor around the target.
    }
  }

  let ancestor = target;
  let best = target;
  for (let depth = 0; depth < 5; depth += 1) {
    const parent = ancestor.locator('xpath=..');
    if ((await parent.count()) === 0) break;
    ancestor = parent;
    if (await suitable(ancestor)) {
      best = ancestor;
      break;
    }
  }
  return best;
}

async function captureElementScreenshots(
  page: Page,
  url: string,
  viewportName: string,
  outputDir: string,
  selectors: string[],
  elementContexts: ElementContext[]
): Promise<ElementScreenshot[]> {
  const directory = resolve(outputDir, 'screenshots', 'elements');
  await mkdir(directory, { recursive: true });
  const screenshots: ElementScreenshot[] = [];
  for (const [index, selector] of selectors.entries()) {
    let target: Locator | null = null;
    let originalStyle: string | null = null;
    try {
      const context = elementContextFor(elementContexts, selector);
      target = await resolveEvidenceTarget(page, selector, context);
      if (!target) continue;
      await target.scrollIntoViewIfNeeded();
      await target.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await page.waitForTimeout(50);
      const capture = await contextualCaptureLocator(page, target, context);
      originalStyle = await target.getAttribute('style');
      await target.evaluate((element) => {
        const targetElement = element as HTMLElement;
        targetElement.style.setProperty('outline', '4px solid #d0021b', 'important');
        targetElement.style.setProperty('outline-offset', '3px', 'important');
      });
      const selectorHash = createHash('sha1').update(selector).digest('hex').slice(0, 10);
      const path = resolve(directory, `${safeSlug(url)}-${viewportName}-${String(index + 1).padStart(3, '0')}-${selectorHash}.png`);
      await capture.screenshot({ path, animations: 'disabled', caret: 'hide' });
      screenshots.push({ selector, path });
    } catch {
      // A detached, invalid, or non-rendered component is left without misleading full-page evidence.
    } finally {
      if (target) {
        await target.evaluate((element, style) => {
          if (style === null) element.removeAttribute('style');
          else element.setAttribute('style', style);
        }, originalStyle).catch(() => undefined);
      }
    }
  }
  return screenshots;
}

async function prepareEvidenceStates(page: Page, findings: Finding[]): Promise<void> {
  for (const finding of findings) {
    if (!/^disclosure-state/.test(finding.ruleId)) continue;
    for (const selector of finding.selectors.slice(0, 10)) {
      try {
        const control = page.locator(selector).first();
        if ((await control.count()) === 0 || !(await control.isVisible().catch(() => false))) continue;
        if ((await control.getAttribute('aria-expanded')) === 'false') {
          await control.focus();
          await page.keyboard.press('Enter');
          await page.waitForTimeout(200);
        }
      } catch {
        // The finding retains its JSON interaction evidence if a dynamic selector cannot be replayed.
      }
    }
  }
}

function emptyConsent(): ConsentHandlingResult {
  return {
    found: false,
    dismissed: false,
    action: 'none',
    buttonName: '',
    surfaceSelector: '',
    frameUrl: ''
  };
}

export interface AuditViewportDependencies {
  runAxe: typeof runAxe;
  runDomChecks: typeof runDomChecks;
  runKeyboardChecks: typeof runKeyboardChecks;
  runConfiguredJourneyChecks: typeof runConfiguredJourneyChecks;
  runDisclosureChecks: typeof runDisclosureChecks;
  runTabChecks: typeof runTabChecks;
  runResponsiveChecks: typeof runResponsiveChecks;
  runLinkChecks: typeof runLinkChecks;
  collectElementContexts: typeof collectElementContexts;
  captureElementScreenshots: typeof captureElementScreenshots;
  dismissConsentBanner: typeof dismissConsentBanner;
  detectInteractionBlocker: typeof detectInteractionBlocker;
  capturePageScreenshot: (page: Page, path: string) => Promise<void>;
}

const defaultAuditViewportDependencies: AuditViewportDependencies = {
  runAxe,
  runDomChecks,
  runKeyboardChecks,
  runConfiguredJourneyChecks,
  runDisclosureChecks,
  runTabChecks,
  runResponsiveChecks,
  runLinkChecks,
  collectElementContexts,
  captureElementScreenshots,
  dismissConsentBanner,
  detectInteractionBlocker,
  capturePageScreenshot: async (page, path) => {
    await mkdir(resolve(path, '..'), { recursive: true });
    await page.screenshot({ path, fullPage: true, animations: 'disabled', caret: 'hide' });
  }
};

function isPartialAudit(errors: string[], axeRun: AxeRunMetadata, blocker: InteractionBlocker | null): boolean {
  return Boolean(blocker)
    || !axeRun.completed
    || errors.some((message) => /^(?:DOM|Keyboard|Configured journey|Disclosure|Tab|Responsive|Link|Element context|Screenshot) checks? error:/i.test(message));
}

export async function auditViewport(
  browser: Browser,
  url: string,
  options: AuditOptions,
  viewport: AuditOptions['viewports'][number],
  signal?: AbortSignal,
  dependencyOverrides: Partial<AuditViewportDependencies> = {}
): Promise<ViewportAudit> {
  const dependencies = { ...defaultAuditViewportDependencies, ...dependencyOverrides };
  const errors: string[] = [];
  let status: number | null = null;
  let finalUrl = url;
  let title = '';
  let consent = emptyConsent();
  let interactionBlocker: InteractionBlocker | null = null;
  let axeRun: AxeRunMetadata = {
    completed: false,
    error: 'axe did not start.',
    violationCount: 0,
    incompleteCount: 0,
    passCount: 0,
    passes: []
  };
  let linkRun: LinkCheckMetadata = {
    completed: false,
    candidateCount: 0,
    checkedCount: 0,
    truncated: false,
    scope: viewport.name === 'desktop' ? 'blocked' : 'not-applicable',
    ...(viewport.name === 'desktop' ? { error: 'Link checks did not start.' } : {})
  };
  let axeResults: AxeViolationResult[] = [];
  let dom = emptyDom();
  let keyboard: ViewportAudit['keyboard'] = {
    sequence: [], completedCycle: false, truncated: false, scope: 'unknown', journeys: []
  };
  let responsive: ViewportAudit['responsive'] = {
    completed: false,
    horizontalOverflow: 0,
    overflowElements: [],
    textSpacingOverflow: 0,
    clippedElements: [],
    overlapPairs: [],
    lostInteractiveElements: []
  };
  let disclosures: ViewportAudit['disclosures'] = [];
  let tabs: ViewportAudit['tabs'] = [];
  let links: ViewportAudit['links'] = [];
  const screenshot = resolve(options.outputDir, 'screenshots', `${safeSlug(url)}-${viewport.name}.png`);
  let context: Awaited<ReturnType<Browser['newContext']>> | undefined;
  const closeOnAbort = (): void => { void context?.close().catch(() => undefined); };

  try {
    if (signal?.aborted) throw new Error(CANCELLED_REASON);
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile ?? false,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      colorScheme: 'light',
      bypassCSP: true
    });
    signal?.addEventListener('abort', closeOnAbort, { once: true });
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    page.setDefaultNavigationTimeout(options.timeoutMs);
    let runtimeErrorCount = 0;
    const captureRuntimeError = (message: string): void => {
      runtimeErrorCount += 1;
      if (runtimeErrorCount <= MAX_CAPTURED_RUNTIME_ERRORS) errors.push(message);
      if (runtimeErrorCount === MAX_CAPTURED_RUNTIME_ERRORS + 1) {
        errors.push(`Additional page and console errors were omitted after ${MAX_CAPTURED_RUNTIME_ERRORS} entries.`);
      }
    };
    page.on('pageerror', (error) => captureRuntimeError(`Page error: ${error.message}`));
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && !isBrowserNetworkConsoleError(text)) {
        captureRuntimeError(`Console error: ${text}`);
      }
    });
    let blockedNavigationReason: string | null = null;
    await page.route('**/*', async (route) => {
      const request = route.request();
      const requestFrame = request.frame();
      const isMainFrameNavigation = request.isNavigationRequest()
        && (requestFrame === page.mainFrame() || requestFrame.parentFrame() === null);
      if (isMainFrameNavigation) {
        const isSupportedLocalFixture = /^(file|data):/i.test(url) && request.url() === url;
        const reason = isSupportedLocalFixture ? null : urlRestrictionReason(request.url(), options);
        if (reason) {
          blockedNavigationReason = `Navigation blocked: ${reason}`;
          await route.abort('blockedbyclient');
          return;
        }
      }
      await route.continue();
    });
    let response: Awaited<ReturnType<Page['goto']>>;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      if (blockedNavigationReason) throw new Error(blockedNavigationReason);
      throw error;
    }
    // Chromium can resolve page.goto() with the preceding redirect response even
    // when a routed redirect destination was aborted, so check the route signal
    // explicitly before treating the page as successfully loaded.
    if (blockedNavigationReason) throw new Error(blockedNavigationReason);
    status = response?.status() ?? null;
    await page.waitForLoadState('networkidle', { timeout: Math.min(options.timeoutMs, 5_000) }).catch(() => undefined);
    finalUrl = page.url();
    const finalUrlRestriction = /^(file|data):/i.test(url) && finalUrl === url
      ? null
      : urlRestrictionReason(finalUrl, options);
    if (finalUrlRestriction) {
      status = null;
      throw new Error(`Navigation blocked: ${finalUrlRestriction}`);
    }
    title = await page.title();
    consent = await dependencies.dismissConsentBanner(page);
    if (consent.error) errors.push(`Consent handling error: ${consent.error}`);
    if (consent.found && !consent.dismissed) {
      errors.push('A visible consent banner could not be dismissed before accessibility interaction testing.');
    }
    interactionBlocker = await dependencies.detectInteractionBlocker(page);
    if (interactionBlocker) errors.push(`${interactionBlocker.reason} ${interactionBlocker.selector}`);
    try {
      const axeOutput = await dependencies.runAxe(page, options.wcagLevel);
      axeResults = axeOutput.results;
      axeRun = axeOutput.metadata;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`axe-core error: ${message}`);
      axeRun = {
        completed: false,
        error: message,
        violationCount: 0,
        incompleteCount: 0,
        passCount: 0,
        passes: []
      };
    }
    const axeTargetSizeSelectors = axeResults
      .filter((result) => result.id === 'target-size')
      .flatMap((result) => result.nodes.flatMap((node) => node.target));
    try {
      dom = await dependencies.runDomChecks(page, axeTargetSizeSelectors);
    } catch (error) {
      errors.push(`DOM checks error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!interactionBlocker) {
      try {
        keyboard = await dependencies.runKeyboardChecks(page, options.maxTabStops);
      } catch (error) {
        errors.push(`Keyboard checks error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!interactionBlocker && keyboard.scope === 'modal-only') {
      interactionBlocker = {
        selector: keyboard.modalSelector ?? 'modal surface',
        role: 'dialog',
        name: '',
        reason: 'Sequential keyboard focus remained inside one modal surface and did not reach the underlying page.'
      };
      errors.push(`${interactionBlocker.reason} ${interactionBlocker.selector}`);
    }
    if (!interactionBlocker) {
      try {
        disclosures = await dependencies.runDisclosureChecks(page);
      } catch (error) {
        errors.push(`Disclosure checks error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const disclosure of disclosures.filter((item) => item.error)) {
      errors.push(`Disclosure interaction check incomplete for “${disclosure.name || disclosure.selector}”: ${disclosure.error}`);
    }
    if (!interactionBlocker) {
      try {
        tabs = await dependencies.runTabChecks(page);
      } catch (error) {
        errors.push(`Tab checks error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      responsive = await dependencies.runResponsiveChecks(page);
    } catch (error) {
      errors.push(`Responsive checks error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!interactionBlocker && viewport.name === 'desktop') {
      try {
        const linkOutput = await dependencies.runLinkChecks(page, options.maxLinksPerPage);
        links = linkOutput.results;
        linkRun = linkOutput.metadata;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Link checks error: ${message}`);
        linkRun = {
          completed: false,
          candidateCount: 0,
          checkedCount: 0,
          truncated: false,
          scope: 'desktop-same-origin',
          error: message
        };
      }
    } else if (interactionBlocker && viewport.name === 'desktop') {
      linkRun = {
        completed: false,
        candidateCount: 0,
        checkedCount: 0,
        truncated: false,
        scope: 'blocked',
        error: `Link checks were blocked by ${interactionBlocker.selector}.`
      };
    }
    if (!interactionBlocker && options.journeys.length > 0) {
      try {
        const configuredJourneys = await dependencies.runConfiguredJourneyChecks(
          page,
          options.journeys,
          url,
          viewport.name,
          async () => {
            const journeyConsent = await dependencies.dismissConsentBanner(page);
            if (journeyConsent.error) throw new Error(`Consent handling failed: ${journeyConsent.error}`);
          }
        );
        keyboard.journeys.push(...configuredJourneys);
        await page.goto(finalUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: Math.min(options.timeoutMs, 5_000) }).catch(() => undefined);
        await dependencies.dismissConsentBanner(page);
      } catch (error) {
        errors.push(`Configured journey checks error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (signal?.aborted) throw new Error(CANCELLED_REASON);
    const preliminaryAudit: ViewportAudit = {
      viewport,
      url,
      finalUrl,
      status,
      title,
      axe: axeResults,
      axeRun,
      dom,
      keyboard,
      responsive,
      disclosures,
      tabs,
      links,
      linkRun,
      consent,
      interactionBlocker,
      elementContexts: [],
      screenshot: '',
      elementScreenshots: [],
      errors
    };
    const allViewportFindings = findingsFromPage({ url, viewports: [preliminaryAudit] });
    try {
      preliminaryAudit.elementContexts = await dependencies.collectElementContexts(
        page,
        allViewportFindings.flatMap((finding) => finding.selectors)
      );
    } catch (error) {
      errors.push(`Element context check error: ${error instanceof Error ? error.message : String(error)}`);
    }
    const screenshotFindings = allViewportFindings
      .filter((finding) => finding.classification !== 'manual');
    if (options.captureScreenshots && screenshotFindings.length > 0) {
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: Math.min(options.timeoutMs, 5_000) }).catch(() => undefined);
      const captureConsent = await dependencies.dismissConsentBanner(page);
      const captureBlocker = await dependencies.detectInteractionBlocker(page);
      const evidenceSurfaceClear = (!captureConsent.found || captureConsent.dismissed) && !captureBlocker;
      try {
        if (!evidenceSurfaceClear) {
          errors.push(`Component screenshot capture was blocked by a visible surface${captureBlocker ? `: ${captureBlocker.selector}` : '.'}`);
          await dependencies.capturePageScreenshot(page, screenshot);
          preliminaryAudit.screenshot = screenshot;
        } else {
          await prepareEvidenceStates(page, screenshotFindings);
          preliminaryAudit.elementScreenshots = await dependencies.captureElementScreenshots(
            page,
            url,
            viewport.name,
            options.outputDir,
            screenshotCandidatesForFindings(screenshotFindings),
            preliminaryAudit.elementContexts
          );
          if (needsFullPageScreenshotFallback(screenshotFindings, preliminaryAudit.elementScreenshots)) {
            await dependencies.capturePageScreenshot(page, screenshot);
            preliminaryAudit.screenshot = screenshot;
          }
        }
      } catch (error) {
        errors.push(`Screenshot check error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    preliminaryAudit.partial = isPartialAudit(errors, axeRun, interactionBlocker);
    return preliminaryAudit;
  } catch (error) {
    const cancelled = Boolean(signal?.aborted);
    errors.push(cancelled ? CANCELLED_REASON : error instanceof Error ? error.message : String(error));
    return {
      viewport,
      url,
      finalUrl,
      status,
      title,
      axe: axeResults,
      axeRun,
      dom,
      keyboard,
      responsive,
      disclosures,
      tabs,
      links,
      linkRun,
      consent,
      interactionBlocker,
      elementContexts: [],
      screenshot: '',
      elementScreenshots: [],
      errors,
      partial: true,
      ...(cancelled ? { cancelled: true } : {})
    };
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    await context?.close().catch(() => undefined);
  }
}

async function auditPageBrowser(
  browser: Browser,
  url: string,
  options: AuditOptions,
  execution: AuditExecutionContext,
  pageNumber: number,
  pageTotal: number
): Promise<PageAudit> {
  const viewports: ViewportAudit[] = [];
  for (const viewport of options.viewports) {
    if (execution.signal?.aborted) break;
    await emitProgress(execution, {
      phase: 'browser',
      message: `Testing page ${pageNumber}/${pageTotal} at ${viewport.name}: ${safeProgressLabel(url)}`,
      current: pageNumber,
      total: pageTotal,
      url,
      viewport: viewport.name
    });
    const result = await auditViewport(browser, url, options, viewport, execution.signal);
    viewports.push(result);
    if (result.cancelled) break;
    await emitProgress(execution, {
      phase: 'browser',
      message: `Completed ${viewport.name} for ${safeProgressLabel(result.title || url)}.`,
      current: pageNumber,
      total: pageTotal,
      url,
      viewport: viewport.name
    });
  }
  return {
    url,
    viewports,
    partial: viewports.length !== options.viewports.length
      || viewports.some((viewport) => viewport.cancelled || viewport.partial)
  };
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R | undefined>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length && !signal?.aborted) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await worker(item, index);
    }
  });
  await Promise.all(runners);
  return results.filter((result): result is R => result !== undefined);
}

async function screenshotFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await screenshotFiles(path));
    else if (entry.isFile() && /\.png$/i.test(entry.name)) files.push(path);
  }
  return files;
}

async function pruneUnreferencedScreenshots(summary: AuditSummary, outputDir: string): Promise<void> {
  const referenced = new Set(
    summary.findings.flatMap((finding) =>
      finding.evidence.map((item) => item.screenshot).filter((value): value is string => Boolean(value))
    ).map((value) => resolve(value))
  );
  for (const page of summary.pages) {
    for (const viewport of page.viewports) {
      if (viewport.screenshot && !referenced.has(resolve(viewport.screenshot))) viewport.screenshot = '';
      viewport.elementScreenshots = viewport.elementScreenshots.filter((item) => referenced.has(resolve(item.path)));
    }
  }
  const files = await screenshotFiles(resolve(outputDir, 'screenshots'));
  await Promise.all(files.filter((path) => !referenced.has(resolve(path))).map((path) => unlink(path)));
}

export async function runAudit(
  urls: string[],
  source: string,
  skippedUrls: Array<{ url: string; reason: string }>,
  options: AuditOptions,
  execution: AuditExecutionContext = {}
): Promise<AuditSummary> {
  await emitProgress(execution, {
    phase: 'browser',
    message: `Starting ${options.headless ? 'headless' : 'headed'} browser checks for ${urls.length} page${urls.length === 1 ? '' : 's'}.`,
    current: 0,
    total: urls.length
  });

  let pages: PageAudit[] = [];
  if (!execution.signal?.aborted) {
    let browser: Browser | undefined;
    const closeOnAbort = (): void => { void browser?.close().catch(() => undefined); };
    try {
      browser = await launchAuditBrowser(options, execution);
      execution.signal?.addEventListener('abort', closeOnAbort, { once: true });
      pages = await runPool(
        urls,
        options.concurrency,
        execution.signal,
        (url, index) => auditPageBrowser(browser!, url, options, execution, index + 1, urls.length)
      );
    } finally {
      execution.signal?.removeEventListener('abort', closeOnAbort);
      await browser?.close().catch(() => undefined);
    }
  }

  const findings = assignFindingIds(consolidateFindings(applyConfirmedFindingConfidenceGate(pages.flatMap(findingsFromPage))));
  retainRepresentativeScreenshotPerFinding(findings);
  assertRemediationOnlyNotes(findings);
  const startedUrls = new Set(pages.map((page) => page.url));
  const cancellationSkips = execution.signal?.aborted
    ? urls.filter((url) => !startedUrls.has(url)).map((url) => ({ url, reason: 'Audit cancelled before this page started.' }))
    : [];
  const cancelled = Boolean(execution.signal?.aborted);
  const generatedAt = new Date().toISOString();
  const aaaAdvisory = Boolean(options.aaaAdvisory || options.wcagLevel === 'AAA');
  const summary: AuditSummary = {
    status: cancelled ? 'cancelled' : 'completed',
    ...(cancelled ? { cancelledAt: generatedAt } : {}),
    generatedAt,
    auditor: options.auditor,
    source,
    wcagLevel: options.wcagLevel,
    conformanceTarget: 'AA',
    aaaAdvisory,
    humanAssessmentRequired: true,
    conformanceDecision: 'not-determined',
    qualityContract: { ...AUDIT_QUALITY_CONTRACT },
    landingPageUrl: options.landingPageUrl ?? urls[0] ?? '',
    requestedUrls: urls,
    auditedUrls: pages.filter((page) => page.viewports.some((viewport) =>
      !viewport.cancelled && viewport.axeRun.completed && (
        (viewport.status !== null && viewport.status < 400) ||
        /^(file|data):/i.test(viewport.finalUrl)
      )
    )).map((page) => page.url),
    skippedUrls: [...skippedUrls, ...cancellationSkips],
    pages,
    findings,
    coverage: buildCoverageMatrix(pages, findings),
    criteria: buildWcagCriterionLedger(pages, findings, REQUIRED_MANUAL_CHECKS, aaaAdvisory),
    manualChecks: REQUIRED_MANUAL_CHECKS,
    limitations: [
      'This output is an evidence-backed test result, not a WCAG conformance certification.',
      'Automated checks cannot establish content meaning, complete contrast over imagery, correct reading order in every assistive technology, or all WCAG exceptions.',
      ...(cancelled ? [CANCELLED_REASON] : []),
      'Native screen-reader workflow evidence supplements this report when run, but screen-reader, physical-device, content-meaning, and judgment-based WCAG checks still require qualified human assessment.',
      'A qualified reviewer must decide applicability and sign off every WCAG 2.2 A and AA criterion before this evidence can support a conformance claim.'
    ]
  };
  assertAuditQualityContract(summary);
  await pruneUnreferencedScreenshots(summary, options.outputDir);
  const jsonPath = resolve(options.outputDir, 'audit-results.json');
  await writeJsonReport(summary, jsonPath);
  await emitProgress(execution, {
    phase: cancelled ? 'cancelled' : 'reporting',
    message: cancelled
      ? `Audit stopped. Partial JSON evidence was saved to ${jsonPath}.`
      : `Browser evidence was saved to ${jsonPath}.`
  });
  return summary;
}
