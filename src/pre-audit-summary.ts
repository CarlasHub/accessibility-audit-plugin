import { createHash } from 'node:crypto';
import type { AuditOptions } from './types.js';
import { singleLineText } from './text.js';
import { collectUrls } from './urls.js';
import { DEFAULT_REPORT_NAME } from './instructions.js';
import { preflightAuthentication, type AuthenticationPreflightResult } from './auth-preflight.js';
import { AUDIT_SCOPE_LABEL, AUDIT_SCOPE_MODE, type AuditScopeMode } from './scope.js';
import { safeBaselineSource } from './comparison.js';

const PAGE_PREVIEW_LIMIT = 10;

export interface PreAuditSummary {
  scopeMode: AuditScopeMode;
  inputCount: number;
  source: string;
  pageCount: number;
  maxPages: number | null;
  pages: string[];
  remainingPageCount: number;
  skippedCount: number;
  skipped: Array<{ url: string; reason: string }>;
  hosts: string[];
  preset: AuditOptions['preset'];
  auditor: string;
  landingPageUrl: string;
  browserMode: 'headless' | 'headed';
  browserEngine: AuditOptions['browserEngine'];
  browserSelection: string;
  autoInstallBrowser: boolean;
  savedBrowserState: boolean;
  captureScreenshots: boolean;
  concurrency: number;
  timeoutMs: number;
  maxTabStops: number;
  maxLinksPerPage: number;
  coverage: string;
  viewports: string[];
  journeyCount: number;
  journeys: string[];
  outputDir: string;
  reportName: string;
  templatePath?: string;
  historyCount: number;
  historySources: string[];
  allowedHosts: string[];
  exactHosts: string[];
  stagingOnly: boolean;
}

export interface PreparedPreAudit {
  summary: PreAuditSummary;
  resolvedPages: string[];
  confirmationDigest: string;
  /** Private in-memory binding; callers must never serialize it. */
  authentication: AuthenticationPreflightResult;
}

export interface PreAuditExecutionSettings {
  reportName?: string;
  templatePath?: string;
  historyPaths?: string[];
}

export async function preparePreAuditSummary(
  inputs: string[],
  options: AuditOptions,
  executionSettings: PreAuditExecutionSettings = {}
): Promise<PreparedPreAudit> {
  if (!inputs.length) throw new Error('At least one URL or input file is required.');
  const collected = await collectUrls(inputs, {
    allowedHosts: options.allowedHosts,
    exactHosts: options.exactHosts,
    ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
    stagingOnly: options.stagingOnly
  });
  const hosts = [...new Set(collected.urls.map((url) => new URL(url).hostname.toLowerCase()))];
  const authentication = await preflightAuthentication(options, collected.urls);

  const resolvedPages = [...collected.urls];
  const effectiveExecutionSettings = {
    reportName: executionSettings.reportName ?? DEFAULT_REPORT_NAME,
    templatePath: executionSettings.templatePath ?? null,
    historyPaths: executionSettings.historyPaths ?? []
  };
  const summary: PreAuditSummary = {
    scopeMode: AUDIT_SCOPE_MODE,
    inputCount: inputs.length,
    source: collected.source,
    pageCount: collected.urls.length,
    maxPages: options.maxPages ?? null,
    pages: collected.urls.slice(0, PAGE_PREVIEW_LIMIT),
    remainingPageCount: Math.max(0, collected.urls.length - PAGE_PREVIEW_LIMIT),
    skippedCount: collected.skipped.length,
    skipped: collected.skipped.slice(0, PAGE_PREVIEW_LIMIT),
    hosts,
    preset: options.preset,
    auditor: options.auditor,
    landingPageUrl: options.landingPageUrl ?? collected.urls[0] ?? '',
    browserMode: options.headless ? 'headless' : 'headed',
    browserEngine: options.browserEngine,
    browserSelection: options.executablePath
      ? `custom executable: ${options.executablePath}`
      : options.channel
        ? `installed ${options.channel} channel`
        : options.browserEngine === 'chromium'
          ? 'Playwright Chromium or supported system browser'
          : `Playwright ${options.browserEngine === 'firefox' ? 'Firefox' : 'WebKit'}`,
    autoInstallBrowser: options.autoInstallBrowser,
    savedBrowserState: authentication.configured,
    captureScreenshots: options.captureScreenshots,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    maxTabStops: options.maxTabStops,
    maxLinksPerPage: options.maxLinksPerPage,
    coverage: options.aaaAdvisory ? 'WCAG 2.2 AA core + AAA advisory' : 'WCAG 2.2 AA',
    viewports: options.viewports.map((viewport) => `${viewport.name} (${viewport.width}×${viewport.height})`),
    journeyCount: options.journeys.length,
    journeys: options.journeys.map((journey) => `${journey.title} [${journey.id}; ${journey.steps.length} step${journey.steps.length === 1 ? '' : 's'}]`),
    outputDir: options.outputDir,
    reportName: effectiveExecutionSettings.reportName,
    ...(executionSettings.templatePath ? { templatePath: executionSettings.templatePath } : {}),
    historyCount: effectiveExecutionSettings.historyPaths.length,
    historySources: effectiveExecutionSettings.historyPaths.map(safeBaselineSource),
    allowedHosts: options.allowedHosts,
    exactHosts: options.exactHosts,
    stagingOnly: options.stagingOnly
  };
  const confirmationDigest = createHash('sha256')
    .update(JSON.stringify({
      resolvedPages,
      options: {
        ...options,
        ...(options.storageState ? { storageState: '[configured]' } : {})
      },
      authenticationStateDigest: authentication.stateDigest ?? null,
      executionSettings: effectiveExecutionSettings
    }))
    .digest('hex');
  const prepared = { summary, resolvedPages, confirmationDigest } as PreparedPreAudit;
  Object.defineProperty(prepared, 'authentication', {
    value: authentication,
    enumerable: false,
    writable: false,
    configurable: false
  });
  return prepared;
}

export async function createPreAuditSummary(
  inputs: string[],
  options: AuditOptions,
  executionSettings: PreAuditExecutionSettings = {}
): Promise<PreAuditSummary> {
  return (await preparePreAuditSummary(inputs, options, executionSettings)).summary;
}

function scopeDescription(summary: PreAuditSummary): string {
  const restrictions = [
    summary.exactHosts.length > 0 ? `exact hosts: ${summary.exactHosts.join(', ')}` : '',
    summary.allowedHosts.length > 0 ? `allowed hosts: ${summary.allowedHosts.join(', ')}` : '',
    summary.stagingOnly ? 'staging-like hosts only' : ''
  ].filter(Boolean);
  return `${AUDIT_SCOPE_LABEL.toLowerCase()}${restrictions.length > 0 ? `; ${restrictions.join('; ')}` : ''}`;
}

export function formatPreAuditSummary(summary: PreAuditSummary): string {
  const safe = (value: string): string => singleLineText(value, 500);
  const lines = [
    'Pre-audit summary',
    `  Pages: ${summary.pageCount} resolved from ${summary.inputCount} input${summary.inputCount === 1 ? '' : 's'}${summary.skippedCount > 0 ? `; ${summary.skippedCount} excluded by scope rules` : ''}; maximum ${summary.maxPages ?? 'unlimited'}`,
    `  Input source: ${safe(summary.source)}`,
    `  Hosts: ${summary.hosts.map(safe).join(', ')}`,
    `  Scope: ${scopeDescription(summary)}`,
    `  Coverage: ${summary.coverage}; ${summary.viewports.map(safe).join(', ')}`,
    `  Journeys: ${summary.journeyCount === 0 ? 'none' : summary.journeys.map(safe).join('; ')}`,
    `  Run mode: ${summary.preset} preset; ${summary.browserMode === 'headless' ? 'headless' : 'visible'} browser; ${safe(summary.browserSelection)}; automatic ${summary.browserEngine === 'firefox' ? 'Firefox' : summary.browserEngine === 'webkit' ? 'WebKit' : 'Chromium'} install ${summary.autoInstallBrowser ? 'on' : 'off'}; ${summary.savedBrowserState ? 'saved browser state preflight passed' : 'no saved browser state'}; concurrency ${summary.concurrency}; screenshot evidence ${summary.captureScreenshots ? 'on' : 'off'}`,
    `  Limits: ${summary.timeoutMs} ms per operation; ${summary.maxTabStops} keyboard tab stops; ${summary.maxLinksPerPage} same-origin links per page`,
    `  Auditor: ${safe(summary.auditor)}`,
    `  Landing page: ${safe(summary.landingPageUrl)}`,
    `  Output: ${safe(summary.outputDir)}/${safe(summary.reportName)}`,
    `  Template: ${summary.templatePath ? safe(summary.templatePath) : 'bundled report template'}`,
    `  History: ${summary.historyCount === 0 ? 'none' : `${summary.historyCount} prior audit${summary.historyCount === 1 ? '' : 's'} (${summary.historySources.map(safe).join(', ')})`}`,
    '  Resolved pages:',
    ...summary.pages.map((url) => `    - ${safe(url)}`),
    ...(summary.remainingPageCount > 0 ? [`    - …and ${summary.remainingPageCount} more`] : []),
    ...summary.skipped.map((entry) => `  Excluded: ${safe(entry.url)} — ${safe(entry.reason)}`),
    ...(summary.skippedCount > summary.skipped.length
      ? [`  Excluded: …and ${summary.skippedCount - summary.skipped.length} more`]
      : [])
  ];
  return lines.join('\n');
}
