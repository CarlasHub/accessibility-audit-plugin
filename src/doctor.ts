import { constants } from 'node:fs';
import { access, lstat, mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { browserEngineLabel, browserLaunchCandidates, isMissingBrowserExecutableError } from './audit/runner.js';
import type { BrowserEngine } from './types.js';
import { DEFAULT_OUTPUT_DIR } from './instructions.js';
import { auditArchivePath } from './reporting/archive.js';
import { assertCanonicalTemplate, DEFAULT_TEMPLATE } from './reporting/excel.js';
import { PLUGIN_VERSION } from './version.js';

export type DoctorCheckId = 'node' | 'template' | 'output' | 'browser';
export type DoctorCheckStatus = 'pass' | 'fail';

export interface DoctorCheck {
  id: DoctorCheckId;
  label: string;
  status: DoctorCheckStatus;
  detail: string;
  nextActions: string[];
}

export interface DoctorReport {
  status: 'ready' | 'needs-attention';
  pluginVersion: string;
  checks: DoctorCheck[];
  summary: string;
}

export interface DoctorOptions {
  outputDir?: string;
  templatePath?: string;
  channel?: string;
  executablePath?: string;
  browserEngine?: BrowserEngine;
}

interface DoctorBrowser {
  close: () => Promise<void>;
}

interface DoctorDependencies {
  nodeVersion: string;
  assertTemplate: (path: string) => Promise<void>;
  probeOutput: (path: string) => Promise<void>;
  launchBrowser: (options: Parameters<typeof chromium.launch>[0], engine?: BrowserEngine) => Promise<DoctorBrowser>;
}

function passed(id: DoctorCheckId, label: string, detail: string): DoctorCheck {
  return { id, label, status: 'pass', detail, nextActions: [] };
}

function failed(id: DoctorCheckId, label: string, detail: string, nextActions: string[]): DoctorCheck {
  return { id, label, status: 'fail', detail, nextActions };
}

function nodeCheck(version: string): DoctorCheck {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major >= 22
    ? passed('node', 'Node.js', `Node.js ${version} satisfies the supported Node.js 22 or newer requirement.`)
    : failed(
      'node',
      'Node.js',
      `Node.js ${version || 'unknown'} does not satisfy the supported runtime requirement.`,
      ['Install Node.js 22 or newer, then run the doctor again.']
    );
}

async function nearestExistingDirectory(path: string): Promise<string> {
  let candidate = resolve(path);
  while (true) {
    try {
      const details = await stat(candidate);
      if (!details.isDirectory()) throw new Error('The configured output location is an existing file, not a directory.');
      return candidate;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

export type WritableDirectoryProbe = (path: string) => Promise<void>;

async function probeWritableDirectory(path: string): Promise<void> {
  await access(path, constants.W_OK);
  let probe: string | undefined;
  try {
    probe = await mkdtemp(join(path, '.accessibility-audit-doctor-'));
  } finally {
    if (probe) await rm(probe, { recursive: true, force: true });
  }
}

async function probeArchiveDestination(
  outputDir: string,
  probeWritable: WritableDirectoryProbe
): Promise<void> {
  const archivePath = auditArchivePath(outputDir);
  try {
    // Inspect the directory entry itself so a dangling symlink is not mistaken
    // for an absent archive that production could create successfully.
    const details = await lstat(archivePath);
    if (!details.isFile()) throw new Error('The portable archive location is not a regular file.');
    await access(archivePath, constants.W_OK);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const archiveDirectory = await nearestExistingDirectory(dirname(archivePath));
    await probeWritable(archiveDirectory);
  }
}

export async function probeOutputDirectory(
  outputDir: string,
  probeWritable: WritableDirectoryProbe = probeWritableDirectory
): Promise<void> {
  const reportDirectory = await nearestExistingDirectory(outputDir);
  await probeWritable(reportDirectory);
  await probeArchiveDestination(outputDir, probeWritable);
}

async function templateCheck(path: string, assertTemplate: DoctorDependencies['assertTemplate']): Promise<DoctorCheck> {
  try {
    await assertTemplate(path);
    return passed('template', 'Report template', 'The report template is present and matches the canonical template.');
  } catch {
    return failed(
      'template',
      'Report template',
      'The report template is missing, unreadable, or does not match the canonical template.',
      ['Restore the bundled template or choose a byte-identical canonical template with --template.']
    );
  }
}

async function outputCheck(path: string, probeOutput: DoctorDependencies['probeOutput']): Promise<DoctorCheck> {
  try {
    await probeOutput(path);
    return passed(
      'output',
      'Output location',
      'The configured report and portable ZIP locations can be created and written.'
    );
  } catch {
    return failed(
      'output',
      'Output location',
      'The configured report or portable ZIP location cannot be created or written.',
      ['Choose an --output location whose directory and parent are writable, then run the doctor again.']
    );
  }
}

function browserName(candidate: Parameters<typeof chromium.launch>[0], engine: BrowserEngine): string {
  if (candidate?.channel === 'chrome') return 'Google Chrome';
  if (candidate?.channel === 'msedge') return 'Microsoft Edge';
  if (candidate?.executablePath) return 'the configured browser executable';
  return `Playwright ${browserEngineLabel(engine)}`;
}

async function browserCheck(
  options: DoctorOptions,
  launchBrowser: DoctorDependencies['launchBrowser']
): Promise<DoctorCheck> {
  const engine = options.browserEngine ?? 'chromium';
  if (engine !== 'chromium' && options.channel) {
    return failed(
      'browser',
      'Browser',
      'Browser channels are supported only with the Chromium engine.',
      ['Remove --channel or select --browser chromium, then run the doctor again.']
    );
  }
  const candidates = browserLaunchCandidates({
    browserEngine: engine,
    ...(options.channel ? { channel: options.channel } : {}),
    ...(options.executablePath ? { executablePath: options.executablePath } : {})
  }, true);
  let onlyMissingExecutables = true;
  for (const candidate of candidates) {
    try {
      const browser = await launchBrowser(candidate, engine);
      await browser.close();
      return passed('browser', 'Browser', `${browserName(candidate, engine)} launched and closed successfully.`);
    } catch (error) {
      if (!isMissingBrowserExecutableError(error)) onlyMissingExecutables = false;
    }
  }

  const explicit = Boolean(options.channel || options.executablePath);
  if (explicit) {
    return failed(
      'browser',
      'Browser',
      'The explicitly configured browser could not be launched.',
      ['Check the --channel or --executable-path value, then run the doctor again.']
    );
  }
  return failed(
    'browser',
    'Browser',
    onlyMissingExecutables
      ? `No supported ${browserEngineLabel(engine)} browser is currently available.`
      : 'A supported browser was found but could not complete a launch check.',
    onlyMissingExecutables
      ? [`Run "npx playwright install ${engine}" in the plugin directory, then run the doctor again.`]
      : ['Close conflicting browser processes, verify local browser permissions, then run the doctor again.']
  );
}

const defaultDependencies: DoctorDependencies = {
  nodeVersion: process.versions.node,
  assertTemplate: assertCanonicalTemplate,
  probeOutput: probeOutputDirectory,
  launchBrowser: (options, engine = 'chromium') => ({ chromium, firefox, webkit })[engine].launch(options)
};

export async function runDoctor(
  options: DoctorOptions = {},
  dependencies: Partial<DoctorDependencies> = {}
): Promise<DoctorReport> {
  const resolvedDependencies = { ...defaultDependencies, ...dependencies };
  const checks = [
    nodeCheck(resolvedDependencies.nodeVersion),
    ...await Promise.all([
      templateCheck(options.templatePath ?? DEFAULT_TEMPLATE, resolvedDependencies.assertTemplate),
      outputCheck(options.outputDir ?? DEFAULT_OUTPUT_DIR, resolvedDependencies.probeOutput),
      browserCheck(options, resolvedDependencies.launchBrowser)
    ])
  ];
  const failedCount = checks.filter((check) => check.status === 'fail').length;
  return {
    status: failedCount === 0 ? 'ready' : 'needs-attention',
    pluginVersion: PLUGIN_VERSION,
    checks,
    summary: failedCount === 0
      ? 'Ready to run an accessibility audit.'
      : `${failedCount} prerequisite${failedCount === 1 ? '' : 's'} need attention before an audit.`
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [`Accessibility Audit doctor ${report.pluginVersion}`, ''];
  for (const check of report.checks) {
    lines.push(`[${check.status === 'pass' ? 'PASS' : 'FAIL'}] ${check.label}: ${check.detail}`);
    for (const action of check.nextActions) lines.push(`       Next: ${action}`);
  }
  lines.push('', report.summary);
  return `${lines.join('\n')}\n`;
}
