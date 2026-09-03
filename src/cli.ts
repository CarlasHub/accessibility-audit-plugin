#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import type { AuditConfigInput } from './config.js';
import { executeAudit } from './service.js';
import { validateExcelReport } from './reporting/validate.js';
import { DEFAULT_AUDITOR } from './instructions.js';
import type { AuditProgressEvent } from './types.js';
import { singleLineText } from './text.js';
import { PLUGIN_VERSION } from './version.js';

interface AuditCliOptions {
  config?: string;
  auditor?: string;
  landingPage?: string;
  output?: string;
  allowHost?: string[];
  stagingOnly?: boolean;
  headed?: boolean;
  channel?: string;
  executablePath?: string;
  concurrency?: string;
  timeout?: string;
  maxLinks?: string;
  template?: string;
  reportName?: string;
  screenshots?: boolean;
  yes?: boolean;
}

async function readConfig(path?: string): Promise<Partial<AuditConfigInput>> {
  if (!path) return {};
  return JSON.parse(await readFile(resolve(path), 'utf8')) as Partial<AuditConfigInput>;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function progressLine(event: AuditProgressEvent): string {
  const count = event.current !== undefined && event.total !== undefined
    ? ` ${event.current}/${event.total}`
    : '';
  return `[accessibility-audit:${event.phase}]${count} ${terminalText(event.message)}\n`;
}

function terminalText(value: string): string {
  return singleLineText(value);
}

const program = new Command();
program.name('accessibility-audit').description('Run structured WCAG 2.2 A/AA audits and generate the standard Excel report.').version(PLUGIN_VERSION);

program
  .command('audit')
  .description('Audit one or more URLs, text/CSV/JSON files, or XLSX page lists.')
  .argument('<inputs...>', 'URLs or input files')
  .option('-c, --config <path>', 'JSON configuration file')
  .option('--auditor <name>', 'Auditor name')
  .option('--landing-page <url>', 'Landing-page QA URL written to Accessibility Overview')
  .option('-o, --output <directory>', 'Output directory')
  .option('--allow-host <host>', 'Allowed hostname; repeat for more than one', collect, [])
  .option('--staging-only', 'Reject hosts that do not look like staging, QA, preview, test, or local hosts')
  .option('--headed', 'Show the browser')
  .option('--channel <name>', 'Installed browser channel, for example chrome')
  .option('--executable-path <path>', 'Browser executable path')
  .option('--concurrency <count>', 'Parallel page count')
  .option('--timeout <milliseconds>', 'Per-operation timeout')
  .option('--max-links <count>', 'Maximum rendered same-origin links checked per page')
  .option('--template <path>', 'Alternate report template')
  .option('--report-name <name>', 'Excel filename')
  .option('--no-screenshots', 'Disable screenshot capture')
  .option('-y, --yes', 'Confirm the supplied/default auditor and start the audit')
  .action(async (inputs: string[], cli: AuditCliOptions, command: Command) => {
    const fileConfig = await readConfig(cli.config);
    let auditor = cli.auditor ?? fileConfig.auditor ?? DEFAULT_AUDITOR;
    let landingPageUrl = cli.landingPage ?? fileConfig.landingPageUrl;
    if (!cli.yes && process.stdin.isTTY && process.stderr.isTTY) {
      process.stderr.write(`Pages/input to test:\n${inputs.map((input) => `  - ${terminalText(input)}`).join('\n')}\n`);
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = await prompt.question(`Auditor [${auditor}]: `);
        if (answer.trim()) auditor = answer.trim();
        const landingPageAnswer = await prompt.question(
          `Landing-page QA URL${landingPageUrl ? ` [${terminalText(landingPageUrl)}]` : ' [first resolved URL]'}: `
        );
        if (landingPageAnswer.trim()) landingPageUrl = landingPageAnswer.trim();
        const confirmation = await prompt.question('Start the headless desktop, mobile, reflow, link, keyboard, and screenshot checks? [Y/n] ');
        if (/^(n|no)$/i.test(confirmation.trim())) {
          process.stderr.write('Audit not started.\n');
          return;
        }
      } finally {
        prompt.close();
      }
    }
    const fromCommandLine = (name: string): boolean => command.getOptionValueSource(name) === 'cli';
    const options: Partial<AuditConfigInput> = {
      ...fileConfig,
      auditor,
      ...(landingPageUrl ? { landingPageUrl } : {}),
      ...(cli.output ? { outputDir: cli.output } : {}),
      ...(cli.allowHost?.length ? { allowedHosts: cli.allowHost } : {}),
      ...(fromCommandLine('stagingOnly') ? { stagingOnly: Boolean(cli.stagingOnly) } : {}),
      ...(fromCommandLine('headed') ? { headless: !cli.headed } : {}),
      ...(cli.channel ? { channel: cli.channel } : {}),
      ...(cli.executablePath ? { executablePath: cli.executablePath } : {}),
      ...(cli.concurrency ? { concurrency: Number(cli.concurrency) } : {}),
      ...(cli.timeout ? { timeoutMs: Number(cli.timeout) } : {}),
      ...(cli.maxLinks ? { maxLinksPerPage: Number(cli.maxLinks) } : {}),
      ...(fromCommandLine('screenshots') ? { captureScreenshots: Boolean(cli.screenshots) } : {})
    };
    const abortController = new AbortController();
    const CANCEL_REASON = 'Stopped by user';
    let stopRequested = false;
    const stopGracefully = (): void => {
      if (stopRequested) {
        process.stderr.write('Second interrupt received; exiting immediately without waiting for partial report generation.\n');
        process.exit(130);
      }
      stopRequested = true;
      process.stderr.write('Stop requested. Closing active browser work and writing partial JSON/XLSX output.\n');
      abortController.abort(CANCEL_REASON);
    };
    process.on('SIGINT', stopGracefully);
    process.on('SIGTERM', stopGracefully);
    process.stderr.write('Press Ctrl+C once to stop safely and write partial output.\n');
    try {
      const result = await executeAudit({
        inputs,
        options,
        ...(cli.template ? { templatePath: cli.template } : {}),
        ...(cli.reportName ? { reportName: cli.reportName } : {}),
        execution: {
          signal: abortController.signal,
          onProgress: (event) => { process.stderr.write(progressLine(event)); }
        }
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.status === 'cancelled') process.exitCode = 130;
    } finally {
      process.off('SIGINT', stopGracefully);
      process.off('SIGTERM', stopGracefully);
    }
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

export function normalizeCliArguments(argv: string[]): string[] {
  const normalized = [...argv];
  const first = normalized[2];
  const reserved = new Set(['audit', 'validate', 'help']);
  if (first && !first.startsWith('-') && !reserved.has(first)) normalized.splice(2, 0, 'audit');
  return normalized;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    await program.parseAsync(normalizeCliArguments(process.argv));
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
