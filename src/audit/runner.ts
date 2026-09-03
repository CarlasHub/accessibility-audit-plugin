import { createHash } from 'node:crypto';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import axe from 'axe-core';
import type {
  AuditExecutionContext,
  AuditOptions,
  AuditProgressEvent,
  AuditSummary,
  AxeViolationResult,
  DomCheckResult,
  ElementScreenshot,
  Finding,
  PageAudit,
  ViewportAudit
} from '../types.js';
import { REQUIRED_MANUAL_CHECKS } from './manual-checks.js';
import { runDisclosureChecks, runDomChecks, runKeyboardChecks, runLinkChecks, runResponsiveChecks, runTabChecks } from './browser-checks.js';
import { findingsFromPage } from './findings.js';
import { assertRemediationOnlyNotes, consolidateFindings } from '../reporting/consolidate.js';
import { singleLineText } from '../text.js';

const CANCELLED_REASON = 'The audit was stopped by the user. Results include only work completed before cancellation.';

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

async function runAxe(page: Page): Promise<AxeViolationResult[]> {
  await page.addScriptTag({ content: axe.source });
  const output = await page.evaluate(async () => {
    const engine = (window as unknown as {
      axe: {
        run: (context: Document, options: unknown) => Promise<{ violations: AxeViolationResult[] }>;
      };
    }).axe;
    return engine.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
      },
      resultTypes: ['violations']
    });
  });
  return output.violations;
}

export function screenshotCandidatesForFindings(findings: Finding[]): string[] {
  const selectors = new Set<string>();
  const add = (selector?: string | null): void => { if (selector?.trim()) selectors.add(selector.trim()); };
  for (const finding of findings) {
    if (finding.classification !== 'confirmed' && finding.classification !== 'blocker') continue;
    for (const selector of finding.selectors) add(selector);
  }
  return [...selectors].slice(0, 50);
}

export function needsFullPageScreenshotFallback(
  findings: Finding[],
  elementScreenshots: ElementScreenshot[]
): boolean {
  const capturedSelectors = new Set(elementScreenshots.map((item) => item.selector));
  return findings.some((finding) =>
    (finding.classification === 'confirmed' || finding.classification === 'blocker')
    && (finding.selectors.length === 0 || !finding.selectors.some((selector) => capturedSelectors.has(selector)))
  );
}

async function captureElementScreenshots(
  page: Page,
  url: string,
  viewportName: string,
  outputDir: string,
  selectors: string[]
): Promise<ElementScreenshot[]> {
  const directory = resolve(outputDir, 'screenshots', 'elements');
  await mkdir(directory, { recursive: true });
  const screenshots: ElementScreenshot[] = [];
  for (const [index, selector] of selectors.entries()) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0 || !(await locator.isVisible().catch(() => false))) continue;
      await locator.scrollIntoViewIfNeeded();
      const selectorHash = createHash('sha1').update(selector).digest('hex').slice(0, 10);
      const path = resolve(directory, `${safeSlug(url)}-${viewportName}-${String(index + 1).padStart(3, '0')}-${selectorHash}.png`);
      await locator.screenshot({ path, animations: 'disabled' });
      screenshots.push({ selector, path });
    } catch {
      // A detached, invalid, or non-rendered selector retains the full-page fallback evidence.
    }
  }
  return screenshots;
}

async function auditViewport(
  browser: Browser,
  url: string,
  options: AuditOptions,
  viewport: AuditOptions['viewports'][number],
  signal?: AbortSignal
): Promise<ViewportAudit> {
  const errors: string[] = [];
  let status: number | null = null;
  let finalUrl = url;
  let title = '';
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
      colorScheme: 'light'
    });
    signal?.addEventListener('abort', closeOnAbort, { once: true });
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    page.setDefaultNavigationTimeout(options.timeoutMs);
    page.on('pageerror', (error) => errors.push(`Page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`Console error: ${message.text()}`);
    });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    status = response?.status() ?? null;
    await page.waitForLoadState('networkidle', { timeout: Math.min(options.timeoutMs, 5_000) }).catch(() => undefined);
    finalUrl = page.url();
    title = await page.title();
    const axeResults = await runAxe(page).catch((error) => {
      errors.push(`axe-core error: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
    const dom = await runDomChecks(page);
    const keyboard = await runKeyboardChecks(page, options.maxTabStops);
    const disclosures = await runDisclosureChecks(page);
    const tabs = await runTabChecks(page);
    const responsive = await runResponsiveChecks(page);
    const links = viewport.name === 'desktop' ? await runLinkChecks(page, options.maxLinksPerPage) : [];
    if (signal?.aborted) throw new Error(CANCELLED_REASON);
    const preliminaryAudit: ViewportAudit = {
      viewport,
      url,
      finalUrl,
      status,
      title,
      axe: axeResults,
      dom,
      keyboard,
      responsive,
      disclosures,
      tabs,
      links,
      screenshot: '',
      elementScreenshots: [],
      errors
    };
    const screenshotFindings = findingsFromPage({ url, viewports: [preliminaryAudit] })
      .filter((finding) => finding.classification === 'confirmed' || finding.classification === 'blocker');
    if (options.captureScreenshots && screenshotFindings.length > 0) {
      preliminaryAudit.elementScreenshots = await captureElementScreenshots(
        page,
        url,
        viewport.name,
        options.outputDir,
        screenshotCandidatesForFindings(screenshotFindings)
      );
      if (needsFullPageScreenshotFallback(screenshotFindings, preliminaryAudit.elementScreenshots)) {
        await mkdir(resolve(options.outputDir, 'screenshots'), { recursive: true });
        await page.screenshot({ path: screenshot, fullPage: true });
        preliminaryAudit.screenshot = screenshot;
      }
    }
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
      axe: [],
      dom: emptyDom(),
      keyboard: { sequence: [] },
      responsive: { horizontalOverflow: 0, overflowElements: [], textSpacingOverflow: 0 },
      disclosures: [],
      tabs: [],
      links: [],
      screenshot: '',
      elementScreenshots: [],
      errors,
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
  return { url, viewports };
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
    const launchOptions = createBrowserLaunchOptions(options, options.headless);
    let browser: Browser | undefined;
    const closeOnAbort = (): void => { void browser?.close().catch(() => undefined); };
    try {
      browser = await chromium.launch(launchOptions);
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

  const findings = consolidateFindings(pages.flatMap(findingsFromPage));
  assertRemediationOnlyNotes(findings);
  const startedUrls = new Set(pages.map((page) => page.url));
  const cancellationSkips = execution.signal?.aborted
    ? urls.filter((url) => !startedUrls.has(url)).map((url) => ({ url, reason: 'Audit cancelled before this page started.' }))
    : [];
  const cancelled = Boolean(execution.signal?.aborted);
  const generatedAt = new Date().toISOString();
  const summary: AuditSummary = {
    status: cancelled ? 'cancelled' : 'completed',
    ...(cancelled ? { cancelledAt: generatedAt } : {}),
    generatedAt,
    auditor: options.auditor,
    source,
    landingPageUrl: options.landingPageUrl ?? urls[0] ?? '',
    requestedUrls: urls,
    auditedUrls: pages.filter((page) => page.viewports.some((viewport) =>
      !viewport.cancelled && (
        (viewport.status !== null && viewport.status < 400) ||
        (/^(file|data):/i.test(viewport.finalUrl) && viewport.errors.length === 0)
      )
    )).map((page) => page.url),
    skippedUrls: [...skippedUrls, ...cancellationSkips],
    pages,
    findings,
    manualChecks: REQUIRED_MANUAL_CHECKS,
    limitations: [
      'This output is an evidence-backed test result, not a WCAG conformance certification.',
      'Automated checks cannot establish content meaning, complete contrast over imagery, correct reading order in every assistive technology, or all WCAG exceptions.',
      ...(cancelled ? [CANCELLED_REASON] : []),
      'Screen-reader, physical-device, content-meaning, and judgment-based WCAG checks remain guided manual work.'
    ]
  };
  await pruneUnreferencedScreenshots(summary, options.outputDir);
  const jsonPath = resolve(options.outputDir, 'audit-results.json');
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await emitProgress(execution, {
    phase: cancelled ? 'cancelled' : 'reporting',
    message: cancelled
      ? `Audit stopped. Partial JSON evidence was saved to ${jsonPath}.`
      : `Browser evidence was saved to ${jsonPath}.`
  });
  return summary;
}
