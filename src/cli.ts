#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { AUDIT_PRESETS, resolveOptions, type AuditConfigInput } from './config.js';
import { executeAudit, type AuditRequest } from './service.js';
import { validateExcelReport } from './reporting/validate.js';
import { DEFAULT_AUDITOR, DEFAULT_REPORT_NAME } from './instructions.js';
import type { AuditProgressEvent, BrowserEngine } from './types.js';
import { singleLineText } from './text.js';
import { PLUGIN_VERSION } from './version.js';
import { isDirectInvocation } from './invocation.js';
import { openReport } from './open-report.js';
import { formatPreAuditSummary, preparePreAuditSummary } from './pre-audit-summary.js';
import type { AuthenticationPreflightResult } from './auth-preflight.js';
import { cliDebugEnabled, formatCliError, redactAuditProgressEvent } from './errors.js';
import { formatDoctorReport, runDoctor } from './doctor.js';
import { DEMO_REPORT_NAME, demoAuditDefaults, startDemoSite } from './demo.js';
import { buildGuidedJourney, formatJourneyJson } from './journey-builder.js';
import {
  JourneyValidationError,
  formatJourneyValidationSummary,
  toJourneyValidationFailure,
  validateJourneyFile
} from './journey-validation.js';
import {
  createJourneyDraft,
  createJourneyDraftFile,
  formatJourneyDraftSummary,
  saveJourneyDraft
} from './journey-drafts.js';
import { approveJourneyDraftFile, formatJourneyApprovalSummary } from './journey-approval.js';
import { loadAuditConfigFile } from './journey-config.js';

interface AuditCliOptions {
  config?: string;
  journeysFile?: string;
  storageState?: string;
  preset?: string;
  auditor?: string;
  wcagLevel?: string;
  aaaAdvisory?: boolean;
  landingPage?: string;
  output?: string;
  allowHost?: string[];
  exactHost?: string[];
  maxPages?: string;
  stagingOnly?: boolean;
  headed?: boolean;
  browser?: string;
  channel?: string;
  executablePath?: string;
  autoInstallBrowser?: boolean;
  concurrency?: string;
  timeout?: string;
  maxLinks?: string;
  template?: string;
  reportName?: string;
  history?: string[];
  screenshots?: boolean;
  yes?: boolean;
  open?: boolean;
}

export function describeCliBrowserMode(headless: boolean): string {
  return headless ? 'headlessly' : 'in a visible browser';
}

interface QuickCliOptions {
  auditor?: string;
  output?: string;
  stagingOnly?: boolean;
  headed?: boolean;
  browser?: string;
  channel?: string;
  executablePath?: string;
  autoInstallBrowser?: boolean;
  timeout?: string;
  maxLinks?: string;
  screenshots?: boolean;
  open?: boolean;
}

interface DoctorCliOptions {
  output?: string;
  template?: string;
  browser?: string;
  channel?: string;
  executablePath?: string;
  json?: boolean;
}

interface DemoCliOptions {
  output?: string;
  headed?: boolean;
  browser?: string;
  channel?: string;
  executablePath?: string;
  autoInstallBrowser?: boolean;
  timeout?: string;
  screenshots?: boolean;
  open?: boolean;
}

interface QuickAuditDefaults {
  auditor: string;
  landingPageUrl: string;
  exactHosts: string[];
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function progressLine(event: AuditProgressEvent): string {
  const safeEvent = redactAuditProgressEvent(event);
  const count = safeEvent.current !== undefined && safeEvent.total !== undefined
    ? ` ${safeEvent.current}/${safeEvent.total}`
    : '';
  return `[accessibility-audit:${safeEvent.phase}]${count} ${terminalText(safeEvent.message)}\n`;
}

function terminalText(value: string): string {
  return singleLineText(value);
}

export function quickAuditDefaults(target: string): QuickAuditDefaults {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error('Quick Audit requires one valid HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Quick Audit requires one valid HTTP(S) URL.');
  }
  return {
    auditor: DEFAULT_AUDITOR,
    landingPageUrl: url.href,
    exactHosts: [url.hostname]
  };
}

interface InteractiveAuditFlowRequest {
  inputs: string[];
  requestedOptions: Partial<AuditConfigInput>;
  initialAuditor: string;
  initialLandingPageUrl?: string;
  reportName: string;
  templatePath?: string;
  historyPaths?: string[];
  question: (prompt: string) => Promise<string>;
  write: (message: string) => void;
  executeApproved: (request: {
    inputs: string[];
    options: Partial<AuditConfigInput>;
    authentication: AuthenticationPreflightResult;
  }) => Promise<void>;
}

export async function runInteractiveAuditFlow(request: InteractiveAuditFlowRequest): Promise<boolean> {
  let auditor = request.initialAuditor;
  let landingPageUrl = request.initialLandingPageUrl;
  let previewOptions = resolveOptions({
    ...request.requestedOptions,
    auditor,
    ...(landingPageUrl ? { landingPageUrl } : {})
  });
  let preparedAudit = await preparePreAuditSummary(request.inputs, previewOptions, {
    reportName: request.reportName,
    ...(request.templatePath ? { templatePath: request.templatePath } : {}),
    ...(request.historyPaths?.length ? { historyPaths: request.historyPaths } : {})
  });
  const initialSummary = preparedAudit.summary;
  const answer = await request.question(`Auditor [${auditor}]: `);
  if (answer.trim()) auditor = answer.trim();
  const landingPageAnswer = await request.question(
    `Landing-page QA URL [${terminalText(landingPageUrl ?? initialSummary.landingPageUrl)}]: `
  );
  if (landingPageAnswer.trim()) landingPageUrl = landingPageAnswer.trim();
  previewOptions = resolveOptions({
    ...request.requestedOptions,
    auditor,
    ...(landingPageUrl ? { landingPageUrl } : {})
  });
  preparedAudit = await preparePreAuditSummary(request.inputs, previewOptions, {
    reportName: request.reportName,
    ...(request.templatePath ? { templatePath: request.templatePath } : {}),
    ...(request.historyPaths?.length ? { historyPaths: request.historyPaths } : {})
  });
  request.write(`${formatPreAuditSummary(preparedAudit.summary)}\n`);
  const selectedBrowser = previewOptions.browserEngine === 'firefox' ? 'Firefox' : previewOptions.browserEngine === 'webkit' ? 'WebKit' : 'Chromium';
  const confirmation = await request.question(`Start these checks ${describeCliBrowserMode(previewOptions.headless)}?${previewOptions.autoInstallBrowser ? ` If no supported browser is available, Playwright ${selectedBrowser} will be installed once in plugin-owned storage.` : ''} [Y/n] `);
  if (/^(n|no)$/i.test(confirmation.trim())) {
    request.write('Audit not started.\n');
    return false;
  }
  await request.executeApproved({
    inputs: preparedAudit.resolvedPages,
    authentication: preparedAudit.authentication,
    options: {
      ...request.requestedOptions,
      auditor,
      ...(landingPageUrl ? { landingPageUrl } : {})
    }
  });
  return true;
}

export interface CliAuditRuntime {
  executeAudit?: typeof executeAudit;
  openReport?: typeof openReport;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
  setExitCode?: (code: number) => void;
}

export async function runCliAudit(
  request: Omit<AuditRequest, 'execution'>,
  shouldOpenReport = false,
  runtime: CliAuditRuntime = {}
): Promise<void> {
  const execute = runtime.executeAudit ?? executeAudit;
  const open = runtime.openReport ?? openReport;
  const writeStdout = runtime.writeStdout ?? ((message: string) => { process.stdout.write(message); });
  const writeStderr = runtime.writeStderr ?? ((message: string) => { process.stderr.write(message); });
  const setExitCode = runtime.setExitCode ?? ((code: number) => { process.exitCode = code; });
  const abortController = new AbortController();
  const CANCEL_REASON = 'Stopped by user';
  let stopRequested = false;
  const stopGracefully = (): void => {
    if (stopRequested) {
      writeStderr('Second interrupt received; exiting immediately without waiting for partial report generation.\n');
      process.exit(130);
    }
    stopRequested = true;
    writeStderr('Stop requested. Closing active browser work and writing partial HTML/JSON/CSV/SARIF/XLSX output.\n');
    abortController.abort(CANCEL_REASON);
  };
  process.on('SIGINT', stopGracefully);
  process.on('SIGTERM', stopGracefully);
  writeStderr('Press Ctrl+C once to stop safely and write partial output.\n');
  try {
    const result = await execute({
      ...request,
      execution: {
        signal: abortController.signal,
        onProgress: (event) => { writeStderr(progressLine(event)); }
      }
    });
    writeStdout(`${JSON.stringify(result, null, 2)}\n`);
    writeStderr(
      `Open HTML report: ${terminalText(result.htmlPath)}\n` +
      `Share portable ZIP: ${terminalText(result.archivePath)}\n`
    );
    if (result.status === 'cancelled') {
      setExitCode(130);
    } else if (shouldOpenReport) {
      const opened = await open(result.htmlPath);
      writeStderr(opened
        ? `Opened HTML report: ${terminalText(result.htmlPath)}\n`
        : `Could not open the HTML report automatically; open it here: ${terminalText(result.htmlPath)}\n`);
    }
  } finally {
    process.off('SIGINT', stopGracefully);
    process.off('SIGTERM', stopGracefully);
  }
}

interface CliPrompt {
  question: (message: string) => Promise<string>;
  close: () => void;
}

export interface AccessibilityAuditCliDependencies {
  runAudit?: typeof runCliAudit;
  isInteractiveTerminal?: () => boolean;
  createPrompt?: () => CliPrompt;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
  setExitCode?: (code: number) => void;
}

export function createAccessibilityAuditCli(dependencies: AccessibilityAuditCliDependencies = {}): Command {
const runAudit = dependencies.runAudit ?? runCliAudit;
const isInteractiveTerminal = dependencies.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stderr.isTTY));
const createPrompt = dependencies.createPrompt ?? (() => createInterface({ input: process.stdin, output: process.stderr }));
const writeStdout = dependencies.writeStdout ?? ((message: string) => { process.stdout.write(message); });
const writeStderr = dependencies.writeStderr ?? ((message: string) => { process.stderr.write(message); });
const setExitCode = dependencies.setExitCode ?? ((code: number) => { process.exitCode = code; });
const program = new Command();
program.name('accessibility-audit').description('Run structured WCAG 2.2 audits and generate accessible HTML, Excel, JSON, CSV, and SARIF evidence.').version(PLUGIN_VERSION);

program
  .command('audit')
  .description('Audit explicit URLs, a pasted URL list, or an XLSX/CSV/TXT/JSON/XML page list.')
  .argument('<inputs...>', 'URLs, a pasted whitespace/newline/JSON URL list, or input files')
  .option('-c, --config <path>', 'JSON configuration file')
  .option('--journeys-file <path>', 'Reusable journey JSON file; overrides journeys in --config')
  .option('--storage-state <path>', 'Playwright storage-state JSON for an authorized signed-in session; overrides --config')
  .option('--preset <name>', 'Reusable setup: standard, thorough, or debug')
  .option('--auditor <name>', 'Auditor name')
  .option('--wcag-level <level>', 'WCAG conformance target: AA (legacy AAA also enables the separate AAA advisory checks)')
  .option('--aaa-advisory', 'Run WCAG Level AAA rules as advisory checks, separate from the Level AA conformance target')
  .option('--landing-page <url>', 'Landing-page QA URL written to Audit Summary')
  .option('-o, --output <directory>', 'Output directory')
  .option('--allow-host <host>', 'Allowed hostname or parent domain; repeat for more than one', collect, [])
  .option('--exact-host <host>', 'Exact allowed hostname; repeat for more than one', collect, [])
  .option('--max-pages <count>', 'Maximum authorized unique pages accepted before starting')
  .option('--staging-only', 'Reject hosts that do not look like staging, QA, preview, test, or local hosts')
  .option('--headed', 'Show the browser')
  .option('--browser <engine>', 'Browser engine: chromium (default), firefox, or webkit')
  .option('--channel <name>', 'Installed browser channel, for example chrome')
  .option('--executable-path <path>', 'Browser executable path')
  .option('--no-auto-install-browser', 'Do not install the selected Playwright browser automatically when no supported browser is available')
  .option('--concurrency <count>', 'Parallel page count')
  .option('--timeout <milliseconds>', 'Per-operation timeout')
  .option('--max-links <count>', 'Maximum rendered same-origin links checked per page')
  .option('--template <path>', 'Path to a byte-identical copy of the bundled CarlasHub WCAG 2.2 report template; other templates are rejected')
  .option('--report-name <name>', 'Excel filename')
  .option('--history <path>', 'Prior audit-results.json for history and trends; repeat in any order', collect, [])
  .option('--no-screenshots', 'Disable screenshot capture')
  .option('--open', 'Open the generated HTML report after the audit completes')
  .option('-y, --yes', 'Confirm the supplied/default auditor and start the audit')
  .action(async (inputs: string[], cli: AuditCliOptions, command: Command) => {
    const fileConfig = await loadAuditConfigFile(cli.config, cli.journeysFile, cli.storageState);
    const fromCommandLine = (name: string): boolean => command.getOptionValueSource(name) === 'cli';
    const requestedOptions: Partial<AuditConfigInput> = {
      ...fileConfig,
      ...(cli.preset ? { preset: cli.preset as keyof typeof AUDIT_PRESETS } : {}),
      ...(cli.wcagLevel ? { wcagLevel: cli.wcagLevel.toUpperCase() as 'AA' | 'AAA' } : {}),
      ...(fromCommandLine('aaaAdvisory') ? { aaaAdvisory: Boolean(cli.aaaAdvisory) } : {}),
      ...(cli.output ? { outputDir: cli.output } : {}),
      ...(cli.allowHost?.length ? { allowedHosts: cli.allowHost } : {}),
      ...(cli.exactHost?.length ? { exactHosts: cli.exactHost } : {}),
      ...(cli.maxPages ? { maxPages: Number(cli.maxPages) } : {}),
      ...(fromCommandLine('stagingOnly') ? { stagingOnly: Boolean(cli.stagingOnly) } : {}),
      ...(fromCommandLine('headed') ? { headless: !cli.headed } : {}),
      ...(cli.browser ? { browserEngine: cli.browser as BrowserEngine } : {}),
      ...(cli.channel ? { channel: cli.channel } : {}),
      ...(cli.executablePath ? { executablePath: cli.executablePath } : {}),
      ...(fromCommandLine('autoInstallBrowser') ? { autoInstallBrowser: Boolean(cli.autoInstallBrowser) } : {}),
      ...(cli.concurrency ? { concurrency: Number(cli.concurrency) } : {}),
      ...(cli.timeout ? { timeoutMs: Number(cli.timeout) } : {}),
      ...(cli.maxLinks ? { maxLinksPerPage: Number(cli.maxLinks) } : {}),
      ...(fromCommandLine('screenshots') ? { captureScreenshots: Boolean(cli.screenshots) } : {})
    };
    const auditor = cli.auditor ?? fileConfig.auditor ?? DEFAULT_AUDITOR;
    const landingPageUrl = cli.landingPage ?? fileConfig.landingPageUrl;
    if (!cli.yes && isInteractiveTerminal()) {
      const prompt = createPrompt();
      try {
        await runInteractiveAuditFlow({
          inputs,
          requestedOptions,
          initialAuditor: auditor,
          ...(landingPageUrl ? { initialLandingPageUrl: landingPageUrl } : {}),
          reportName: cli.reportName ?? DEFAULT_REPORT_NAME,
          ...(cli.template ? { templatePath: cli.template } : {}),
          ...(cli.history?.length ? { historyPaths: cli.history } : {}),
          question: (message) => prompt.question(message),
          write: (message) => { process.stderr.write(message); },
          executeApproved: async (approved) => {
            await runAudit({
              ...approved,
              ...(cli.template ? { templatePath: cli.template } : {}),
              ...(cli.history?.length ? { historyPaths: cli.history } : {}),
              reportName: cli.reportName ?? DEFAULT_REPORT_NAME
            }, Boolean(cli.open));
          }
        });
      } finally {
        prompt.close();
      }
      return;
    }
    const options: Partial<AuditConfigInput> = {
      ...requestedOptions,
      auditor,
      ...(landingPageUrl ? { landingPageUrl } : {})
    };
    await runAudit({
      inputs,
      options,
      ...(cli.template ? { templatePath: cli.template } : {}),
      ...(cli.history?.length ? { historyPaths: cli.history } : {}),
      ...(cli.reportName ? { reportName: cli.reportName } : {})
    }, Boolean(cli.open));
  });

program
  .command('journeys')
  .description('Build and manage repeatable keyboard and interaction journeys.')
  .addCommand(
    new Command('build')
      .description('Create one validated journey with a guided interactive wizard.')
      .option('--draft <path>', 'Also save the generated journey as a non-runnable draft')
      .action(async (cli: { draft?: string }) => {
        if (!isInteractiveTerminal()) {
          throw new Error('The guided journey builder requires an interactive terminal. Existing journey JSON remains supported in config files, MCP tools, and GitHub Actions.');
        }
        const prompt = createPrompt();
        try {
          writeStderr('This builder creates JSON only; it will not visit a page or start an audit.\n');
          const journey = await buildGuidedJourney({
            question: (message) => prompt.question(message),
            write: writeStderr
          });
          writeStdout(formatJourneyJson(journey));
          if (cli.draft) {
            const summary = await saveJourneyDraft(createJourneyDraft([journey]), cli.draft);
            writeStderr(formatJourneyDraftSummary(summary));
          } else {
            writeStderr('Journey ready. Add this array to the journeys field in your audit config or use it as a GitHub Action journeys file.\n');
          }
        } finally {
          prompt.close();
        }
      })
  )
  .addCommand(
    new Command('draft')
      .description('Preserve complete or incomplete journey JSON as a non-runnable draft.')
      .argument('[path]', 'Optional partial journey JSON; omit to start a blank draft')
      .option('-o, --output <path>', 'Draft path (defaults beside the input or to journey-draft.json)')
      .action(async (path: string | undefined, cli: { output?: string }) => {
        const summary = await createJourneyDraftFile(path, cli.output);
        writeStdout(formatJourneyDraftSummary(summary));
      })
  )
  .addCommand(
    new Command('validate')
      .description('Validate journey JSON without visiting a page or starting an audit.')
      .argument('<path>', 'Journey JSON file containing an array or a journeys object')
      .option('--json', 'Print a machine-readable validation summary')
      .action(async (path: string, cli: { json?: boolean }) => {
        try {
          const summary = await validateJourneyFile(path);
          writeStdout(cli.json
            ? `${JSON.stringify(summary, null, 2)}\n`
            : formatJourneyValidationSummary(summary));
        } catch (error) {
          if (!cli.json || !(error instanceof JourneyValidationError)) throw error;
          writeStdout(`${JSON.stringify(toJourneyValidationFailure(error), null, 2)}\n`);
          setExitCode(1);
        }
      })
  )
  .addCommand(
    new Command('approve')
      .description('Approve a valid journey draft into runnable journey configuration.')
      .argument('<path>', 'Versioned journey draft to approve')
      .option('-o, --output <path>', 'Approved config path (defaults beside the draft)')
      .action(async (path: string, cli: { output?: string }) => {
        const summary = await approveJourneyDraftFile(path, cli.output);
        writeStdout(formatJourneyApprovalSummary(summary));
      })
  );

program
  .command('presets')
  .description('List reusable audit setups and the settings each one changes.')
  .action(() => {
    const lines = Object.entries(AUDIT_PRESETS).map(([name, preset]) => {
      const settings = Object.keys(preset.options).length > 0
        ? JSON.stringify(preset.options)
        : 'established defaults';
      return `${name}: ${preset.description}\n  ${settings}`;
    });
    process.stdout.write(`Available audit presets:\n${lines.join('\n')}\n\nExplicit CLI options and config fields override preset settings.\n`);
  });

program
  .command('doctor')
  .description('Check local audit prerequisites without running an audit or installing software.')
  .option('-o, --output <directory>', 'Output directory to check')
  .option('--template <path>', 'Canonical report template to check')
  .option('--browser <engine>', 'Browser engine: chromium (default), firefox, or webkit')
  .option('--channel <name>', 'Installed browser channel, for example chrome')
  .option('--executable-path <path>', 'Browser executable path')
  .option('--json', 'Print machine-readable diagnostic results')
  .action(async (cli: DoctorCliOptions) => {
    const report = await runDoctor({
      ...(cli.output ? { outputDir: cli.output } : {}),
      ...(cli.template ? { templatePath: cli.template } : {}),
      ...(cli.browser ? { browserEngine: cli.browser as BrowserEngine } : {}),
      ...(cli.channel ? { channel: cli.channel } : {}),
      ...(cli.executablePath ? { executablePath: cli.executablePath } : {})
    });
    process.stdout.write(cli.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report));
    if (report.status !== 'ready') process.exitCode = 1;
  });

program
  .command('demo')
  .description('Audit a bundled, intentionally imperfect page without visiting an external website.')
  .option('-o, --output <directory>', 'Output directory')
  .option('--headed', 'Show the browser')
  .option('--browser <engine>', 'Browser engine: chromium (default), firefox, or webkit')
  .option('--channel <name>', 'Installed browser channel, for example chrome')
  .option('--executable-path <path>', 'Browser executable path')
  .option('--no-auto-install-browser', 'Do not install the selected Playwright browser automatically when no supported browser is available')
  .option('--timeout <milliseconds>', 'Per-operation timeout')
  .option('--no-screenshots', 'Disable screenshot capture')
  .option('--no-open', 'Do not open the generated HTML report')
  .action(async (cli: DemoCliOptions, command: Command) => {
    const fromCommandLine = (name: string): boolean => command.getOptionValueSource(name) === 'cli';
    const site = await startDemoSite();
    process.stderr.write('Running a safe demo against a bundled practice page served only on this computer. No external website will be visited.\n');
    try {
      await runAudit({
        inputs: [site.url],
        options: {
          ...demoAuditDefaults(site.url),
          ...(cli.output ? { outputDir: cli.output } : {}),
          ...(fromCommandLine('headed') ? { headless: !cli.headed } : {}),
          ...(cli.browser ? { browserEngine: cli.browser as BrowserEngine } : {}),
          ...(cli.channel ? { channel: cli.channel } : {}),
          ...(cli.executablePath ? { executablePath: cli.executablePath } : {}),
          ...(fromCommandLine('autoInstallBrowser') ? { autoInstallBrowser: Boolean(cli.autoInstallBrowser) } : {}),
          ...(cli.timeout ? { timeoutMs: Number(cli.timeout) } : {}),
          ...(fromCommandLine('screenshots') ? { captureScreenshots: Boolean(cli.screenshots) } : {})
        },
        reportName: DEMO_REPORT_NAME
      }, cli.open !== false);
    } finally {
      await site.close();
    }
  });

program
  .command('quick')
  .description('Audit one explicit URL with safe defaults, then open the HTML report.')
  .argument('<url>', 'Authorized HTTP(S) page URL')
  .option('--auditor <name>', 'Auditor name', DEFAULT_AUDITOR)
  .option('-o, --output <directory>', 'Output directory')
  .option('--staging-only', 'Reject a host that does not look like staging, QA, preview, test, or local')
  .option('--headed', 'Show the browser')
  .option('--browser <engine>', 'Browser engine: chromium (default), firefox, or webkit')
  .option('--channel <name>', 'Installed browser channel, for example chrome')
  .option('--executable-path <path>', 'Browser executable path')
  .option('--no-auto-install-browser', 'Do not install the selected Playwright browser automatically when no supported browser is available')
  .option('--timeout <milliseconds>', 'Per-operation timeout')
  .option('--max-links <count>', 'Maximum rendered same-origin links checked')
  .option('--no-screenshots', 'Disable screenshot capture')
  .option('--no-open', 'Do not open the generated HTML report')
  .action(async (target: string, cli: QuickCliOptions, command: Command) => {
    const defaults = quickAuditDefaults(target);
    const fromCommandLine = (name: string): boolean => command.getOptionValueSource(name) === 'cli';
    await runAudit({
      inputs: [defaults.landingPageUrl],
      options: {
        ...defaults,
        auditor: cli.auditor ?? DEFAULT_AUDITOR,
        ...(cli.output ? { outputDir: cli.output } : {}),
        ...(fromCommandLine('stagingOnly') ? { stagingOnly: Boolean(cli.stagingOnly) } : {}),
        ...(fromCommandLine('headed') ? { headless: !cli.headed } : {}),
        ...(cli.browser ? { browserEngine: cli.browser as BrowserEngine } : {}),
        ...(cli.channel ? { channel: cli.channel } : {}),
        ...(cli.executablePath ? { executablePath: cli.executablePath } : {}),
        ...(fromCommandLine('autoInstallBrowser') ? { autoInstallBrowser: Boolean(cli.autoInstallBrowser) } : {}),
        ...(cli.timeout ? { timeoutMs: Number(cli.timeout) } : {}),
        ...(cli.maxLinks ? { maxLinksPerPage: Number(cli.maxLinks) } : {}),
        ...(fromCommandLine('screenshots') ? { captureScreenshots: Boolean(cli.screenshots) } : {})
      }
    }, cli.open !== false);
  });

program
  .command('validate')
  .description('Validate the structure and required populated fields of a generated workbook.')
  .argument('<workbook>', 'Generated XLSX report')
  .action(async (workbook: string) => {
    const result = await validateExcelReport(resolve(workbook));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
  });

return program;
}

export function normalizeCliArguments(argv: string[]): string[] {
  const normalized = [...argv];
  const first = normalized[2];
  const reserved = new Set(['audit', 'quick', 'journeys', 'presets', 'doctor', 'demo', 'validate', 'help']);
  if (first && !first.startsWith('-') && !reserved.has(first)) normalized.splice(2, 0, 'audit');
  return normalized;
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  try {
    const program = createAccessibilityAuditCli();
    await program.parseAsync(normalizeCliArguments(process.argv));
  } catch (error: unknown) {
    process.stderr.write(`${formatCliError(error, cliDebugEnabled())}\n`);
    process.exitCode = 1;
  }
}
