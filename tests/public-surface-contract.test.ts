import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { PUBLIC_SURFACE_V1_8_4 } from './fixtures/public-surface-v1-8-4.js';

const execFileAsync = promisify(execFile);

async function cliHelp(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', 'src/cli.ts', ...args],
    { cwd: process.cwd() }
  );
  return stdout;
}

function longOptions(help: string): string[] {
  return help
    .split('\n')
    .flatMap((line) => line.match(/^\s+(?:-\w,\s+)?(--[a-z][a-z-]*)/)?.[1] ?? [])
    .sort();
}

function topLevelSectionKeys(yaml: string, section: string): string[] {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => line === `${section}:`);
  if (start < 0) throw new Error(`Missing ${section} section.`);
  const keys: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.length > 0 && !line.startsWith(' ')) break;
    const match = line.match(/^ {2}([a-z][a-z0-9-]*):\s*$/);
    if (match?.[1]) keys.push(match[1]);
  }
  return keys.sort();
}

function workflowCallInputKeys(yaml: string): string[] {
  const lines = yaml.split('\n');
  const inputsStart = lines.findIndex((line) => line === '    inputs:');
  if (inputsStart < 0) return [];

  const keys: string[] = [];
  for (const line of lines.slice(inputsStart + 1)) {
    if (/^ {0,4}\S/.test(line)) break;
    const match = line.match(/^ {6}([a-z][a-z0-9-]*):\s*$/);
    if (match?.[1]) keys.push(match[1]);
  }
  return keys.sort();
}

describe('public compatibility surface', () => {
  it('keeps the established CLI commands and options available', async () => {
    const rootHelp = await cliHelp('--help');
    for (const command of PUBLIC_SURFACE_V1_8_4.cli.commands) expect(rootHelp).toContain(command);
    expect(longOptions(rootHelp)).toEqual(expect.arrayContaining([...PUBLIC_SURFACE_V1_8_4.cli.rootOptions]));
    expect(longOptions(await cliHelp('audit', '--help'))).toEqual(
      expect.arrayContaining([...PUBLIC_SURFACE_V1_8_4.cli.auditOptions])
    );
    expect(await cliHelp('audit', '--help')).toContain('--preset <name>');
    expect(rootHelp).toContain('presets');
    expect(rootHelp).toContain('quick');
    expect(rootHelp).toContain('doctor');
    expect(rootHelp).toContain('demo');
    expect(rootHelp).toContain('journeys');
    expect(await cliHelp('journeys', '--help')).toContain('build');
    expect(await cliHelp('journeys', '--help')).toContain('validate');
    expect(longOptions(await cliHelp('quick', '--help'))).toEqual(expect.arrayContaining([
      '--auditor',
      '--output',
      '--staging-only',
      '--headed',
      '--no-open'
    ]));
    expect(longOptions(await cliHelp('doctor', '--help'))).toEqual(expect.arrayContaining([
      '--output',
      '--template',
      '--channel',
      '--executable-path',
      '--json'
    ]));
    expect(longOptions(await cliHelp('demo', '--help'))).toEqual(expect.arrayContaining([
      '--output',
      '--headed',
      '--channel',
      '--executable-path',
      '--no-auto-install-browser',
      '--timeout',
      '--no-screenshots',
      '--no-open'
    ]));
  });

  it('keeps the established GitHub Action inputs and outputs available', async () => {
    const action = await readFile('action.yml', 'utf8');
    expect(topLevelSectionKeys(action, 'inputs')).toEqual(
      expect.arrayContaining([...PUBLIC_SURFACE_V1_8_4.githubAction.inputs])
    );
    expect(topLevelSectionKeys(action, 'outputs')).toEqual(
      expect.arrayContaining([...PUBLIC_SURFACE_V1_8_4.githubAction.outputs])
    );
  });

  it('exposes and forwards reusable-workflow scope safety controls', async () => {
    const workflow = await readFile('.github/workflows/reusable-accessibility-audit.yml', 'utf8');
    expect(workflowCallInputKeys(workflow)).toEqual(
      expect.arrayContaining(['allowed-hosts', 'browser', 'exact-hosts', 'max-pages'])
    );
    expect(workflow).toContain('          allowed-hosts: ${{ inputs.allowed-hosts }}');
    expect(workflow).toContain('          exact-hosts: ${{ inputs.exact-hosts }}');
    expect(workflow).toContain('          max-pages: ${{ inputs.max-pages }}');
    expect(workflow).toContain('          browser: ${{ inputs.browser }}');
  });

  it('keeps hosted report sharing explicit, optional, and permission-scoped', async () => {
    const workflow = await readFile('.github/workflows/reusable-accessibility-audit.yml', 'utf8');
    expect(workflowCallInputKeys(workflow)).toContain('publish-report');
    expect(workflow).toContain('      hosted-report-url:');
    expect(workflow).toContain(
      [
        '      publish-report:',
        '        description: Explicitly publish the report to GitHub Pages; leave false for private artifact-only storage',
        '        required: false',
        '        type: boolean',
        '        default: false',
      ].join('\n'),
    );
    expect(workflow).toContain("steps.hosted_stage.outcome == 'success'");
    expect(workflow).toContain("if: always() && inputs.publish-report && needs.audit.outputs.hosted-artifact-id != ''");

    const publishJob = workflow.split('\n  publish:\n')[1];
    expect(publishJob).toBeDefined();
    expect(publishJob).toContain('      pages: write');
    expect(publishJob).toContain('      id-token: write');
    expect(publishJob).toContain('artifact_name: accessibility-audit-pages');
    expect(workflow.slice(0, workflow.indexOf('\n  publish:\n'))).not.toContain('pages: write');
  });

  it('offers a direct doctor shortcut for source checkouts', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.doctor).toBe('node --import tsx src/cli.ts doctor');
  });
});
