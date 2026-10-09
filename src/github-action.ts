import { appendFile, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { resolveOptions, type AuditConfigInput } from './config.js';
import type { AuditComparison, AuditHistory, AuditJourneyDefinition, AuditProgressEvent, BrowserEngine, Finding, Severity } from './types.js';
import { executeAudit, type AuditRunResult } from './service.js';
import { normalizeExplicitUrlEntries, splitUrlListValue } from './urls.js';
import { redactAuditProgressEvent, toActionableAuditError } from './errors.js';

export const FAILURE_POLICIES = ['none', 'new', 'blockers', 'confirmed', 'critical', 'serious', 'moderate', 'minor'] as const;
export type FailurePolicy = (typeof FAILURE_POLICIES)[number];

interface ActionEnvironment {
  [key: string]: string | undefined;
}

interface StoredAuditSummary {
  findings?: Array<Pick<Finding, 'classification' | 'severity'>>;
  comparison?: Pick<
    AuditComparison,
    | 'coverage'
    | 'newFindings'
    | 'unchangedFindings'
    | 'resolvedFindings'
    | 'indeterminateCurrentFindings'
    | 'unobservedBaselineFindings'
  >;
  history?: AuditHistory;
}

function markdownText(value: string): string {
  return value.replace(/[\\`*_[\]<>|]/g, '\\$&');
}

function historyMarkdown(history: AuditHistory | undefined): string[] {
  if (!history) return [];
  const current = history.points.at(-1);
  const change = current?.comparisonToPrevious;
  if (!current || !change) return [];
  return [
    '',
    '### Latest history trend',
    '',
    `Compared with ${markdownText(history.points.at(-2)?.source ?? 'the previous audit')} (${change.coverage} scope coverage):`,
    '',
    '| Change | Count |',
    '| --- | ---: |',
    `| New findings | ${change.newCount} |`,
    `| Persistent findings | ${change.unchangedCount} |`,
    `| Resolved findings | ${change.resolvedCount} |`,
    ...(change.coverage === 'partial'
      ? ['', `${change.indeterminateCurrentCount} current and ${change.unobservedPreviousCount} previous finding${change.unobservedPreviousCount === 1 ? '' : 's'} remain indeterminate outside equivalent scope.`]
      : [])
  ];
}

export interface GateEvaluation {
  policy: FailurePolicy;
  failed: boolean;
  matchedCount: number;
  label: string;
}

const severityRank: Record<Severity, number> = {
  Advisory: 0,
  Minor: 1,
  Moderate: 2,
  Serious: 3,
  Critical: 4
};

function escapeWorkflowCommand(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function writeWorkflowAnnotation(level: 'error' | 'notice' | 'warning', title: string, message: string): void {
  process.stdout.write(`::${level} title=${escapeWorkflowCommand(title)}::${escapeWorkflowCommand(message)}\n`);
}

export function parseListInput(value: string, allowCommas = false): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (!allowCommas || trimmed.startsWith('[')) return splitUrlListValue(trimmed);
  return trimmed.split(/[\r\n,]+/).flatMap((item) => splitUrlListValue(item));
}

export function resolveAllowedHosts(inputs: string[], configuredHosts: string[]): string[] {
  if (configuredHosts.length > 0) return configuredHosts;

  const hosts = inputs.map((input) => {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new Error('The GitHub Action urls input accepts explicit HTTP(S) URLs only.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('The GitHub Action urls input accepts explicit HTTP(S) URLs without embedded credentials only.');
    }
    return parsed.hostname.toLowerCase().replace(/\.+$/, '');
  });

  return [...new Set(hosts)];
}

export function parseBooleanInput(value: string, fallback: boolean): boolean {
  if (!value.trim()) return fallback;
  if (/^(true|yes|1)$/i.test(value.trim())) return true;
  if (/^(false|no|0)$/i.test(value.trim())) return false;
  throw new Error(`Expected a boolean value, received "${value}".`);
}

export function parseFailurePolicy(value: string): FailurePolicy {
  const normalized = (value.trim().toLowerCase() || 'none') as FailurePolicy;
  if (!FAILURE_POLICIES.includes(normalized)) {
    throw new Error(`fail-on must be one of: ${FAILURE_POLICIES.join(', ')}.`);
  }
  return normalized;
}

export function parseWcagLevel(value: string): 'AA' | 'AAA' {
  const normalized = value.trim().toUpperCase() || 'AA';
  if (normalized !== 'AA' && normalized !== 'AAA') {
    throw new Error('wcag-level must be AA or AAA.');
  }
  return normalized;
}

export function parseBrowserEngine(value: string): BrowserEngine {
  const normalized = value.trim().toLowerCase() || 'chromium';
  if (normalized === 'chromium' || normalized === 'firefox' || normalized === 'webkit') {
    return normalized;
  }

  throw new Error('browser must be one of: chromium, firefox, webkit.');
}

export function parsePositiveInteger(value: string, fallback: number, name: string, maximum?: number): number {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  if (maximum !== undefined && parsed > maximum) throw new Error(`${name} must be between 1 and ${maximum}.`);
  return parsed;
}

export function parseJourneysInput(value: string): AuditJourneyDefinition[] {
  if (!value.trim()) return [];
  const parsed: unknown = JSON.parse(value);
  if (
    parsed
    && typeof parsed === 'object'
    && (parsed as Record<string, unknown>).kind === 'accessibility-audit-journey-draft'
  ) {
    throw new Error('Journey drafts are non-runnable and cannot be used as the Action journeys input. Approve the draft before using it in an audit.');
  }
  const journeys = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && 'journeys' in parsed
      ? (parsed as { journeys: unknown }).journeys
      : undefined;
  if (!Array.isArray(journeys)) {
    throw new Error('journeys must be a JSON array or an object containing a journeys array.');
  }
  return resolveOptions({ journeys: journeys as AuditConfigInput['journeys'] }).journeys;
}

export function evaluateGate(
  policy: FailurePolicy,
  findings: StoredAuditSummary['findings'] = [],
  comparison?: Pick<AuditComparison, 'newFindings'>
): GateEvaluation {
  if (policy === 'none') return { policy, failed: false, matchedCount: 0, label: 'Informational only' };

  if (policy === 'new') {
    const matchedCount = comparison?.newFindings.length ?? 0;
    return { policy, failed: matchedCount > 0, matchedCount, label: 'New findings since baseline' };
  }

  if (policy === 'blockers') {
    const matchedCount = findings.filter((finding) => finding.classification === 'blocker').length;
    return { policy, failed: matchedCount > 0, matchedCount, label: 'Audit blockers' };
  }

  if (policy === 'confirmed') {
    const matchedCount = findings.filter((finding) => finding.classification === 'confirmed').length;
    return { policy, failed: matchedCount > 0, matchedCount, label: 'Confirmed findings' };
  }

  const threshold = severityRank[`${policy[0]?.toUpperCase()}${policy.slice(1)}` as Severity];
  const matchedCount = findings.filter((finding) => (
    finding.classification === 'confirmed' && severityRank[finding.severity] >= threshold
  )).length;
  return {
    policy,
    failed: matchedCount > 0,
    matchedCount,
    label: `Confirmed ${policy} or higher findings`
  };
}

function getInput(environment: ActionEnvironment, name: string): string {
  return environment[`INPUT_${name.toUpperCase()}`]?.trim() ?? '';
}

function resolveOutputDirectory(environment: ActionEnvironment, value: string): string {
  const requested = value || 'accessibility-audit-results';
  if (isAbsolute(requested)) return resolve(requested);
  return resolve(environment.GITHUB_WORKSPACE || process.cwd(), requested);
}

function resolveWorkspacePath(environment: ActionEnvironment, value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(environment.GITHUB_WORKSPACE || process.cwd(), value);
}

async function loadActionJourneys(environment: ActionEnvironment): Promise<AuditJourneyDefinition[]> {
  const inline = getInput(environment, 'JOURNEYS');
  const file = getInput(environment, 'JOURNEYS-FILE');
  if (inline && file) throw new Error('Use either journeys or journeys-file, not both.');
  if (inline) return parseJourneysInput(inline);
  if (!file) return [];
  const path = isAbsolute(file) ? file : resolve(environment.GITHUB_WORKSPACE || process.cwd(), file);
  try {
    return parseJourneysInput(await readFile(path, 'utf8'));
  } catch (error) {
    const message = toActionableAuditError(error).message;
    // Put the actionable cause before the source path. Default error rendering
    // intentionally collapses an absolute path and anything after it.
    throw new Error(`Could not load journeys-file: ${message} Source: ${file}`);
  }
}

async function setOutput(environment: ActionEnvironment, name: string, value: string | number): Promise<void> {
  const outputFile = environment.GITHUB_OUTPUT;
  if (!outputFile) return;
  const normalized = String(value);
  if (!/^[a-z0-9-]+$/.test(name) || /[\r\n]/.test(normalized)) throw new Error(`Unsafe GitHub Actions output: ${name}.`);
  await appendFile(outputFile, `${name}=${normalized}\n`, 'utf8');
}

export function formatProgress(event: AuditProgressEvent): string {
  const safeEvent = redactAuditProgressEvent(event);
  const count = safeEvent.current !== undefined && safeEvent.total !== undefined ? ` (${safeEvent.current}/${safeEvent.total})` : '';
  return `[accessibility-audit:${safeEvent.phase}]${count} ${safeEvent.message}`;
}

function runUrl(environment: ActionEnvironment): string | undefined {
  const repository = environment.GITHUB_REPOSITORY;
  const runId = environment.GITHUB_RUN_ID;
  if (!repository || !runId) return undefined;
  return `${environment.GITHUB_SERVER_URL || 'https://github.com'}/${repository}/actions/runs/${runId}`;
}

function comparisonMarkdown(comparison: StoredAuditSummary['comparison']): string[] {
  if (!comparison) return [];
  const currentIndeterminate = comparison.indeterminateCurrentFindings.length;
  const baselineIndeterminate = comparison.unobservedBaselineFindings.length;
  const coverage = comparison.coverage === 'complete'
    ? 'Comparison coverage is complete for the equivalent requested URL and viewport scope.'
    : `Comparison coverage is partial. ${currentIndeterminate} current finding${currentIndeterminate === 1 ? '' : 's'} and ${baselineIndeterminate} baseline finding${baselineIndeterminate === 1 ? '' : 's'} remain indeterminate because their scope was not equivalently observed.`;
  return [
    '',
    '### Changes since baseline',
    '',
    '| Comparison | Count |',
    '| --- | ---: |',
    `| New findings | ${comparison.newFindings.length} |`,
    `| Persistent findings | ${comparison.unchangedFindings.length} |`,
    `| Resolved findings | ${comparison.resolvedFindings.length} |`,
    '',
    `${coverage} Persistent findings have the same stable fingerprint in both audits.`
  ];
}

function reportMarkdown(
  result: AuditRunResult,
  gate: GateEvaluation,
  environment: ActionEnvironment,
  comparison?: StoredAuditSummary['comparison'],
  history?: AuditHistory
): string {
  const gateResult = gate.policy === 'none' ? 'Not evaluated' : gate.failed ? 'Failed' : 'Passed';
  const workflowRun = runUrl(environment);
  return [
    '<!-- carlashub-accessibility-audit -->',
    '## CarlasHub WCAG accessibility audit',
    '',
    '| Result | Count |',
    '| --- | ---: |',
    `| Pages requested | ${result.requestedPageCount} |`,
    `| Pages audited | ${result.auditedPageCount} |`,
    `| Pages fully completed | ${result.completedPageCount} |`,
    `| Pages partial | ${result.partialPageCount} |`,
    `| Pages not started | ${result.notStartedPageCount} |`,
    `| Confirmed findings | ${result.confirmedCount} |`,
    `| Review findings | ${result.reviewCount} |`,
    `| Audit blockers | ${result.blockerCount} |`,
    `| Manual checks | ${result.manualCheckCount} |`,
    ...comparisonMarkdown(comparison),
    ...historyMarkdown(history),
    '',
    `**Policy:** ${gate.label}  `,
    `**Gate result:** ${gateResult}`,
    ...(workflowRun ? ['', `[Open the workflow run](${workflowRun}) to download the accessible HTML report, Excel workbook, JSON, CSV, SARIF, screenshots, and ZIP evidence.`] : []),
    '',
    '_Automated results are evidence, not a declaration of WCAG conformance; complete the listed manual checks._'
  ].join('\n');
}

async function appendJobSummary(environment: ActionEnvironment, markdown: string): Promise<void> {
  if (!environment.GITHUB_STEP_SUMMARY) return;
  await appendFile(environment.GITHUB_STEP_SUMMARY, `${markdown}\n`, 'utf8');
}

interface PullRequestContext {
  owner: string;
  repository: string;
  number: number;
}

async function pullRequestContext(environment: ActionEnvironment): Promise<PullRequestContext | undefined> {
  if (!environment.GITHUB_EVENT_PATH || !environment.GITHUB_REPOSITORY) return undefined;
  const [owner, repository] = environment.GITHUB_REPOSITORY.split('/');
  if (!owner || !repository) return undefined;
  const event = JSON.parse(await readFile(environment.GITHUB_EVENT_PATH, 'utf8')) as {
    pull_request?: { number?: number };
  };
  const number = event.pull_request?.number;
  return Number.isInteger(number) ? { owner, repository, number: number as number } : undefined;
}

async function githubApi(environment: ActionEnvironment, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${environment.GITHUB_API_URL || 'https://api.github.com'}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'carlashub-accessibility-audit-action',
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${response.status}: ${body || response.statusText}`);
  }
  return response;
}

async function upsertPullRequestComment(environment: ActionEnvironment, token: string, markdown: string): Promise<boolean> {
  const context = await pullRequestContext(environment);
  if (!context) return false;
  const base = `/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repository)}`;
  const listResponse = await githubApi(environment, token, `${base}/issues/${context.number}/comments?per_page=100`);
  const comments = await listResponse.json() as Array<{ id?: number; body?: string; user?: { type?: string } }>;
  const existing = comments.find((comment) => (
    comment.user?.type === 'Bot' && comment.body?.includes('<!-- carlashub-accessibility-audit -->')
  ));
  const body = JSON.stringify({ body: markdown });
  if (existing?.id) {
    await githubApi(environment, token, `${base}/issues/comments/${existing.id}`, { method: 'PATCH', body });
  } else {
    await githubApi(environment, token, `${base}/issues/${context.number}/comments`, { method: 'POST', body });
  }
  return true;
}

async function readStoredSummary(jsonPath: string): Promise<StoredAuditSummary> {
  return JSON.parse(await readFile(jsonPath, 'utf8')) as StoredAuditSummary;
}

export async function runGitHubAction(
  environment: ActionEnvironment = process.env,
  signal?: AbortSignal
): Promise<AuditRunResult> {
  const inputs = normalizeExplicitUrlEntries(parseListInput(getInput(environment, 'URLS')));
  if (!inputs.length) throw new Error('The urls input must include at least one URL, with one URL per line.');

  const outputDir = resolveOutputDirectory(environment, getInput(environment, 'OUTPUT-DIR'));
  const allowedHosts = resolveAllowedHosts(inputs, parseListInput(getInput(environment, 'ALLOWED-HOSTS'), true));
  const exactHosts = parseListInput(getInput(environment, 'EXACT-HOSTS'), true);
  const maxPagesInput = getInput(environment, 'MAX-PAGES');
  const failurePolicy = parseFailurePolicy(getInput(environment, 'FAIL-ON'));
  const baselineInput = getInput(environment, 'BASELINE-PATH');
  if (failurePolicy === 'new' && !baselineInput) {
    throw new Error('fail-on new requires baseline-path to identify regressions.');
  }
  const baselinePath = baselineInput ? resolveWorkspacePath(environment, baselineInput) : undefined;
  const historyPaths = parseListInput(getInput(environment, 'HISTORY-PATHS'))
    .map((historyPath) => resolveWorkspacePath(environment, historyPath));
  const journeys = await loadActionJourneys(environment);
  const templatePath = environment.GITHUB_ACTION_PATH
    ? resolve(environment.GITHUB_ACTION_PATH, 'assets', 'accessibility-report-template.xlsx')
    : undefined;
  const result = await executeAudit({
    inputs,
    ...(getInput(environment, 'REPORT-NAME') ? { reportName: getInput(environment, 'REPORT-NAME') } : {}),
    ...(baselinePath ? { baselinePath } : {}),
    ...(historyPaths.length ? { historyPaths } : {}),
    options: {
      auditor: getInput(environment, 'AUDITOR') || 'GitHub Actions',
      wcagLevel: parseWcagLevel(getInput(environment, 'WCAG-LEVEL')),
      aaaAdvisory: parseBooleanInput(getInput(environment, 'AAA-ADVISORY'), false),
      outputDir,
      ...(getInput(environment, 'LANDING-PAGE-URL') ? { landingPageUrl: getInput(environment, 'LANDING-PAGE-URL') } : {}),
      allowedHosts,
      exactHosts,
      ...(maxPagesInput ? { maxPages: parsePositiveInteger(maxPagesInput, 1, 'max-pages', 50_000) } : {}),
      stagingOnly: parseBooleanInput(getInput(environment, 'STAGING-ONLY'), false),
      headless: true,
      autoInstallBrowser: parseBooleanInput(getInput(environment, 'AUTO-INSTALL-BROWSER'), true),
      browserEngine: parseBrowserEngine(getInput(environment, 'BROWSER')),
      timeoutMs: parsePositiveInteger(getInput(environment, 'TIMEOUT-MS'), 30_000, 'timeout-ms'),
      concurrency: parsePositiveInteger(getInput(environment, 'CONCURRENCY'), 2, 'concurrency', 8),
      captureScreenshots: parseBooleanInput(getInput(environment, 'CAPTURE-SCREENSHOTS'), true),
      journeys,
      ...(getInput(environment, 'BROWSER-CHANNEL') ? { channel: getInput(environment, 'BROWSER-CHANNEL') } : {}),
      ...(templatePath ? { templatePath } : {})
    },
    execution: {
      ...(signal ? { signal } : {}),
      onProgress: (event) => { process.stdout.write(`${formatProgress(event)}\n`); }
    }
  });

  const stored = await readStoredSummary(result.jsonPath);
  const gate = evaluateGate(failurePolicy, stored.findings, stored.comparison);
  const markdown = reportMarkdown(result, gate, environment, stored.comparison, stored.history);
  for (const [name, value] of [
    ['output-dir', outputDir],
    ['report-path', result.reportPath],
    ['html-path', result.htmlPath],
    ['json-path', result.jsonPath],
    ['csv-path', result.csvPath],
    ['sarif-path', result.sarifPath],
    ['archive-path', result.archivePath],
    ['confirmed-findings', result.confirmedCount],
    ['review-findings', result.reviewCount],
    ['blockers', result.blockerCount],
    ['requested-pages', result.requestedPageCount],
    ['audited-pages', result.auditedPageCount],
    ['completed-pages', result.completedPageCount],
    ['partial-pages', result.partialPageCount],
    ['not-started-pages', result.notStartedPageCount],
    ['skipped-pages', result.skippedPageCount],
    ['gate-result', failurePolicy === 'none' ? 'not-evaluated' : gate.failed ? 'failed' : 'passed']
  ] as const) {
    await setOutput(environment, name, value);
  }
  await appendJobSummary(environment, markdown);

  const shouldComment = parseBooleanInput(getInput(environment, 'COMMENT-ON-PR'), true);
  const token = getInput(environment, 'GITHUB-TOKEN');
  if (shouldComment && token) {
    try {
      const commented = await upsertPullRequestComment(environment, token, markdown);
      if (commented) writeWorkflowAnnotation('notice', 'Accessibility audit', 'Updated the pull request with the audit summary.');
    } catch (error) {
      writeWorkflowAnnotation('warning', 'Pull request comment skipped', toActionableAuditError(error).message);
    }
  } else if (shouldComment && environment.GITHUB_EVENT_NAME?.startsWith('pull_request')) {
    writeWorkflowAnnotation('warning', 'Pull request comment skipped', 'Pass github-token to enable the pull request summary.');
  }

  if (gate.failed) {
    throw new Error(`${gate.label} policy matched ${gate.matchedCount} finding${gate.matchedCount === 1 ? '' : 's'}.`);
  }
  return result;
}

export function reportActionFailure(error: unknown): void {
  const message = toActionableAuditError(error).message;
  writeWorkflowAnnotation('error', 'CarlasHub accessibility audit failed', message);
  process.exitCode = 1;
}
