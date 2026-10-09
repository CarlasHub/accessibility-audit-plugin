import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AuditRunResult } from '../src/service.js';
import { formatCliError } from '../src/errors.js';
import { resolveAuthenticationForExecution } from '../src/auth-preflight.js';
import {
  createAccessibilityAuditCli,
  describeCliBrowserMode,
  normalizeCliArguments,
  quickAuditDefaults,
  runCliAudit,
  runInteractiveAuditFlow
} from '../src/cli.js';

function auditResult(status: 'completed' | 'cancelled' = 'completed'): AuditRunResult {
  return {
    status,
    reportPath: '/tmp/report.xlsx',
    htmlPath: '/tmp/report\ninjected\tpath.html',
    jsonPath: '/tmp/audit-results.json',
    csvPath: '/tmp/audit-findings.csv',
    sarifPath: '/tmp/audit-results.sarif',
    archivePath: '/tmp/archive\ninjected\tpath.zip',
    requestedPageCount: 1,
    auditedPageCount: status === 'completed' ? 1 : 0,
    skippedPageCount: 0,
    completedPageCount: status === 'completed' ? 1 : 0,
    partialPageCount: status === 'cancelled' ? 1 : 0,
    notStartedPageCount: 0,
    confirmedCount: 0,
    blockerCount: 0,
    reviewCount: 0,
    manualCheckCount: 1,
    imageInventoryCount: 0,
    validation: {
      valid: true,
      findingRows: 0,
      imageInventoryRows: 0,
      errors: [],
      warnings: [],
      auditor: 'Automated'
    }
  };
}

describe('professional CLI invocation', () => {
  it('routes a direct target to the audit command', () => {
    expect(normalizeCliArguments(['node', 'accessibility-audit', 'https://test.example/'])).toEqual([
      'node',
      'accessibility-audit',
      'audit',
      'https://test.example/'
    ]);
  });

  it('preserves explicit commands', () => {
    expect(normalizeCliArguments(['node', 'accessibility-audit', 'validate', 'report.xlsx'])).toEqual([
      'node',
      'accessibility-audit',
      'validate',
      'report.xlsx'
    ]);
    expect(normalizeCliArguments(['node', 'accessibility-audit', 'quick', 'https://test.example/'])).toEqual([
      'node',
      'accessibility-audit',
      'quick',
      'https://test.example/'
    ]);
    expect(normalizeCliArguments(['node', 'accessibility-audit', 'presets'])).toEqual([
      'node',
      'accessibility-audit',
      'presets'
    ]);
    expect(normalizeCliArguments(['node', 'accessibility-audit', 'doctor'])).toEqual([
      'node',
      'accessibility-audit',
      'doctor'
    ]);
    expect(normalizeCliArguments(['node', 'accessibility-audit', 'demo'])).toEqual([
      'node',
      'accessibility-audit',
      'demo'
    ]);
    expect(normalizeCliArguments(['node', 'accessibility-audit', 'journeys', 'build'])).toEqual([
      'node',
      'accessibility-audit',
      'journeys',
      'build'
    ]);
    expect(normalizeCliArguments(['node', 'accessibility-audit', 'journeys', 'validate', 'journeys.json'])).toEqual([
      'node',
      'accessibility-audit',
      'journeys',
      'validate',
      'journeys.json'
    ]);
    expect(normalizeCliArguments(['node', 'accessibility-audit', 'journeys', 'draft', 'partial.json'])).toEqual([
      'node',
      'accessibility-audit',
      'journeys',
      'draft',
      'partial.json'
    ]);
  });

  it('runs the guided journey builder without starting an audit', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const answers = [
      '1',
      'Open account menu',
      '',
      '',
      '',
      '#account-menu-button',
      '#account-menu'
    ];
    let auditRuns = 0;
    let promptClosed = false;
    const program = createAccessibilityAuditCli({
      runAudit: async () => { auditRuns += 1; },
      isInteractiveTerminal: () => true,
      createPrompt: () => ({
        question: async () => answers.shift() ?? '',
        close: () => { promptClosed = true; }
      }),
      writeStdout: (message) => { stdout.push(message); },
      writeStderr: (message) => { stderr.push(message); }
    });

    await program.parseAsync(['node', 'accessibility-audit', 'journeys', 'build']);

    expect(JSON.parse(stdout.join(''))).toEqual([expect.objectContaining({
      id: 'open-account-menu',
      categories: ['keyboard', 'interaction']
    })]);
    expect(stderr.join('')).toContain('will not visit a page or start an audit');
    expect(stderr.join('')).toContain('Journey ready');
    expect(auditRuns).toBe(0);
    expect(promptClosed).toBe(true);
  });

  it('validates a journey file without starting an audit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journeys-'));
    const path = join(directory, 'journeys.json');
    const stdout: string[] = [];
    let auditRuns = 0;
    await writeFile(path, JSON.stringify({ journeys: [{
      id: 'menu',
      title: 'Open menu',
      categories: ['keyboard', 'interaction'],
      steps: [{ action: 'press', selector: '#menu', key: 'Enter' }]
    }] }));
    try {
      const program = createAccessibilityAuditCli({
        runAudit: async () => { auditRuns += 1; },
        writeStdout: (message) => { stdout.push(message); }
      });

      await program.parseAsync(['node', 'accessibility-audit', 'journeys', 'validate', path, '--json']);

      expect(JSON.parse(stdout.join(''))).toEqual(expect.objectContaining({
        valid: true,
        journeyCount: 1,
        stepCount: 1
      }));
      expect(auditRuns).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves incomplete journey JSON as a non-runnable draft without starting an audit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-draft-cli-'));
    const input = join(directory, 'partial.json');
    const output = join(directory, 'saved-draft.json');
    const stdout: string[] = [];
    let auditRuns = 0;
    await writeFile(input, JSON.stringify({ title: 'Incomplete checkout', steps: [] }));
    try {
      const program = createAccessibilityAuditCli({
        runAudit: async () => { auditRuns += 1; },
        writeStdout: (message) => { stdout.push(message); }
      });

      await program.parseAsync(['node', 'accessibility-audit', 'journeys', 'draft', input, '--output', output]);

      const draft = JSON.parse(await readFile(output, 'utf8')) as Record<string, unknown>;
      expect(draft).toEqual(expect.objectContaining({
        kind: 'accessibility-audit-journey-draft',
        status: 'draft',
        candidateJourneys: [{ title: 'Incomplete checkout', steps: [] }],
        validation: expect.objectContaining({ valid: false })
      }));
      expect(stdout.join('')).toContain('Drafts are never run by an audit');
      expect(auditRuns).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['missing source', undefined, 'file-read'],
    ['malformed JSON', '{"title":', 'invalid-json'],
    ['invalid primitive shape', '42', 'invalid-schema']
  ] as const)('reports %s with draft-specific recovery and creates no artifact', async (_label, source, code) => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-draft-error-cli-'));
    const input = join(directory, 'source.json');
    const output = join(directory, 'saved-draft.json');
    let auditRuns = 0;
    if (source !== undefined) await writeFile(input, source);
    try {
      const program = createAccessibilityAuditCli({
        runAudit: async () => { auditRuns += 1; }
      });

      const failure = await program.parseAsync([
        'node',
        'accessibility-audit',
        'journeys',
        'draft',
        input,
        '--output',
        output
      ]).then(() => undefined, (error: unknown) => error);
      const formatted = formatCliError(failure);

      expect(failure).toEqual(expect.objectContaining({ name: 'JourneyDraftError', code }));
      expect(formatted).toContain(`Journey draft could not be saved (${code}).`);
      expect(formatted).toContain('accessibility-audit journeys draft [path] [--output <path>]');
      expect(formatted).not.toContain('journeys validate');
      await expect(readFile(output, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(auditRuns).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('can preserve guided-builder output as a review draft without changing runnable stdout JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-builder-draft-cli-'));
    const output = join(directory, 'guided-draft.json');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const answers = ['1', 'Open account menu', '', '', '', '#account-menu-button', '#account-menu'];
    let auditRuns = 0;
    try {
      const program = createAccessibilityAuditCli({
        runAudit: async () => { auditRuns += 1; },
        isInteractiveTerminal: () => true,
        createPrompt: () => ({ question: async () => answers.shift() ?? '', close: () => undefined }),
        writeStdout: (message) => { stdout.push(message); },
        writeStderr: (message) => { stderr.push(message); }
      });

      await program.parseAsync(['node', 'accessibility-audit', 'journeys', 'build', '--draft', output]);

      const runnable = JSON.parse(stdout.join('')) as unknown[];
      const draft = JSON.parse(await readFile(output, 'utf8')) as Record<string, unknown>;
      expect(runnable).toEqual([expect.objectContaining({ id: 'open-account-menu' })]);
      expect(draft).toEqual(expect.objectContaining({
        kind: 'accessibility-audit-journey-draft',
        candidateJourneys: runnable,
        validation: { valid: true, issues: [] }
      }));
      expect(stderr.join('')).toContain('Journey draft saved');
      expect(auditRuns).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('approves a complete draft into runnable configuration without starting an audit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-approve-cli-'));
    const input = join(directory, 'checkout.draft.json');
    const output = join(directory, 'approved.json');
    const stdout: string[] = [];
    let auditRuns = 0;
    await writeFile(input, JSON.stringify({
      kind: 'accessibility-audit-journey-draft',
      schemaVersion: 1,
      status: 'draft',
      createdAt: '2026-10-08T10:00:00.000Z',
      updatedAt: '2026-10-08T10:00:00.000Z',
      candidateJourneys: [{
        id: 'open-menu',
        title: 'Open menu',
        categories: ['keyboard'],
        steps: [{ action: 'press', selector: '#menu', key: 'Enter' }]
      }],
      validation: { valid: true, issues: [] }
    }));
    try {
      const program = createAccessibilityAuditCli({
        runAudit: async () => { auditRuns += 1; },
        writeStdout: (message) => { stdout.push(message); }
      });

      await program.parseAsync([
        'node',
        'accessibility-audit',
        'journeys',
        'approve',
        input,
        '--output',
        output
      ]);

      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({
        journeys: [expect.objectContaining({ id: 'open-menu' })]
      });
      expect(stdout.join('')).toContain('Journey draft approved');
      expect(stdout.join('')).toContain('No audit was started');
      expect(auditRuns).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses to approve incomplete candidates and creates no runnable artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-approve-invalid-cli-'));
    const input = join(directory, 'partial.draft.json');
    const output = join(directory, 'approved.json');
    let auditRuns = 0;
    await writeFile(input, JSON.stringify({
      kind: 'accessibility-audit-journey-draft',
      schemaVersion: 1,
      status: 'draft',
      createdAt: '2026-10-08T10:00:00.000Z',
      updatedAt: '2026-10-08T10:00:00.000Z',
      candidateJourneys: [{ title: 'Incomplete' }],
      validation: { valid: true, issues: [] }
    }));
    try {
      const program = createAccessibilityAuditCli({ runAudit: async () => { auditRuns += 1; } });
      const failure = await program.parseAsync([
        'node', 'accessibility-audit', 'journeys', 'approve', input, '--output', output
      ]).then(() => undefined, (error: unknown) => error);

      expect(failure).toEqual(expect.objectContaining({ name: 'JourneyApprovalError', code: 'invalid-schema' }));
      expect(formatCliError(failure)).toContain('Journey draft could not be approved (invalid-schema).');
      await expect(readFile(output, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(auditRuns).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a draft envelope when supplied as runnable CLI audit configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-draft-config-cli-'));
    const config = join(directory, 'draft.json');
    let auditRuns = 0;
    await writeFile(config, JSON.stringify({
      kind: 'accessibility-audit-journey-draft',
      schemaVersion: 1,
      status: 'draft',
      candidateJourneys: [],
      validation: { valid: false, issues: [] }
    }));
    try {
      const program = createAccessibilityAuditCli({
        runAudit: async () => { auditRuns += 1; },
        isInteractiveTerminal: () => false
      });

      await expect(program.parseAsync([
        'node',
        'accessibility-audit',
        'audit',
        'https://test.example/',
        '--config',
        config,
        '--yes'
      ])).rejects.toThrow('Journey drafts are non-runnable');
      expect(auditRuns).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('builds Quick Audit defaults from one explicit URL and restricts scope to its exact host', () => {
    expect(quickAuditDefaults('https://Preview.Example.test/start?mode=qa')).toEqual({
      auditor: 'Automated',
      landingPageUrl: 'https://preview.example.test/start?mode=qa',
      exactHosts: ['preview.example.test']
    });
  });

  it('forwards exact-host and maximum-page controls from the CLI', async () => {
    let capturedOptions: Record<string, unknown> = {};
    const program = createAccessibilityAuditCli({
      runAudit: async (request) => { capturedOptions = request.options ?? {}; },
      isInteractiveTerminal: () => false
    });

    await program.parseAsync([
      'node', 'accessibility-audit', 'audit', 'https://preview.example.test/',
      '--exact-host', 'preview.example.test', '--max-pages', '12', '--browser', 'webkit', '--yes'
    ]);

    expect(capturedOptions).toEqual(expect.objectContaining({
      exactHosts: ['preview.example.test'],
      maxPages: 12,
      browserEngine: 'webkit'
    }));
  });

  it('forwards repeatable history paths in the supplied order', async () => {
    let capturedHistory: string[] | undefined;
    const program = createAccessibilityAuditCli({
      runAudit: async (request) => { capturedHistory = request.historyPaths; },
      isInteractiveTerminal: () => false
    });

    await program.parseAsync([
      'node', 'accessibility-audit', 'audit', 'https://preview.example.test/',
      '--history', 'august.json', '--history', 'september.json', '--yes'
    ]);

    expect(capturedHistory).toEqual(['august.json', 'september.json']);
  });

  it('describes the effective preset browser mode accurately in confirmation prompts', () => {
    expect(describeCliBrowserMode(true)).toBe('headlessly');
    expect(describeCliBrowserMode(false)).toBe('in a visible browser');
  });

  it.each(['not a url', 'file:///tmp/page.html', 'ftp://preview.example.test/page'])(
    'rejects an unsupported Quick Audit target: %s',
    (target) => {
      expect(() => quickAuditDefaults(target)).toThrow('Quick Audit requires one valid HTTP(S) URL.');
    }
  );

  it.each([
    { mode: 'direct', extraArguments: ['--yes'], expectedOpen: false },
    { mode: 'direct', extraArguments: ['--yes', '--open'], expectedOpen: true },
    { mode: 'interactive', extraArguments: [], expectedOpen: false },
    { mode: 'interactive', extraArguments: ['--open'], expectedOpen: true }
  ])('forwards --open=$expectedOpen across the $mode audit boundary', async ({ mode, extraArguments, expectedOpen }) => {
    const openValues: boolean[] = [];
    const runAudit: typeof runCliAudit = async (_request, shouldOpen = false) => {
      openValues.push(shouldOpen);
    };
    const answers = ['', '', ''];
    const program = createAccessibilityAuditCli({
      runAudit,
      isInteractiveTerminal: () => mode === 'interactive',
      createPrompt: () => ({
        question: async () => answers.shift() ?? '',
        close: () => undefined
      })
    });

    await program.parseAsync([
      'node',
      'accessibility-audit',
      'audit',
      'https://preview.example.test/',
      ...extraArguments
    ]);

    expect(openValues).toEqual([expectedOpen]);
  });

  it.each([
    { shouldOpen: false, expectedOpenCalls: 0 },
    { shouldOpen: true, expectedOpenCalls: 1 }
  ])('keeps completed audit JSON on stdout and opens only when requested ($shouldOpen)', async ({ shouldOpen, expectedOpenCalls }) => {
    const result = auditResult();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const openedPaths: string[] = [];

    await runCliAudit({ inputs: ['https://preview.example.test/'] }, shouldOpen, {
      executeAudit: async () => result,
      openReport: async (path) => { openedPaths.push(path); return true; },
      writeStdout: (message) => { stdout.push(message); },
      writeStderr: (message) => { stderr.push(message); }
    });

    expect(JSON.parse(stdout.join(''))).toEqual(result);
    expect(openedPaths).toHaveLength(expectedOpenCalls);
    if (shouldOpen) expect(openedPaths).toEqual([result.htmlPath]);
    const diagnostics = stderr.join('');
    expect(diagnostics).toContain('Open HTML report: /tmp/report injected path.html\n');
    expect(diagnostics).toContain('Share portable ZIP: /tmp/archive injected path.zip\n');
    expect(diagnostics).not.toContain('report\ninjected');
    expect(diagnostics).not.toContain('archive\ninjected');
  });

  it('redacts credentials from audit progress written to stderr', async () => {
    const stderr: string[] = [];
    await runCliAudit({ inputs: ['https://preview.example.test/'] }, false, {
      executeAudit: async (request) => {
        await request.execution?.onProgress?.({
          phase: 'browser',
          current: 1,
          total: 1,
          message: 'Testing https://public.example/path?access%252525255Ftoken=cli-secret&next=/public'
        });
        await request.execution?.onProgress?.({
          phase: 'browser',
          message: String.raw`Authorization: Digest realm=\"Private \\\"hidden; request do not expose\\\" tail\", nonce=\"cli-header-secret\". Please retry safely`
        });
        return auditResult();
      },
      writeStdout: () => undefined,
      writeStderr: (message) => { stderr.push(message); }
    });

    expect(stderr.join('')).toContain(
      '[accessibility-audit:browser] 1/1 Testing https://public.example/path?access%252525255Ftoken=[redacted]&next=/public'
    );
    expect(stderr.join('')).not.toContain('cli-secret');
    expect(stderr.join('')).toContain(
      '[accessibility-audit:browser] Authorization: [redacted]. Please retry safely'
    );
    expect(stderr.join('')).not.toMatch(/Private|cli-header-secret|nonce/);
  });

  it('reports cancelled artifacts, exits 130, and never opens an incomplete report', async () => {
    const result = auditResult('cancelled');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const openedPaths: string[] = [];
    const exitCodes: number[] = [];

    await runCliAudit({ inputs: ['https://preview.example.test/'] }, true, {
      executeAudit: async () => result,
      openReport: async (path) => { openedPaths.push(path); return true; },
      writeStdout: (message) => { stdout.push(message); },
      writeStderr: (message) => { stderr.push(message); },
      setExitCode: (code) => { exitCodes.push(code); }
    });

    expect(JSON.parse(stdout.join(''))).toEqual(result);
    expect(stderr.join('')).toContain('Open HTML report: /tmp/report injected path.html\n');
    expect(stderr.join('')).toContain('Share portable ZIP: /tmp/archive injected path.zip\n');
    expect(openedPaths).toEqual([]);
    expect(exitCodes).toEqual([130]);
  });

  it('executes the page snapshot shown by the interactive CLI even if its source file changes at confirmation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cli-confirmation-snapshot-'));
    const pageList = join(directory, 'pages.txt');
    await writeFile(pageList, 'https://preview.example.test/approved\n');
    let questionCount = 0;
    let displayedSummary = '';
    let executedInputs: string[] = [];
    try {
      const started = await runInteractiveAuditFlow({
        inputs: [pageList],
        requestedOptions: {},
        initialAuditor: 'Automated',
        reportName: 'Accessibility_Audit_Report.xlsx',
        question: async () => {
          questionCount += 1;
          if (questionCount === 3) {
            await writeFile(pageList, 'https://preview.example.test/changed\n');
          }
          return '';
        },
        write: (message) => { displayedSummary += message; },
        executeApproved: async (request) => { executedInputs = request.inputs; }
      });

      expect(started).toBe(true);
      expect(displayedSummary).toContain('https://preview.example.test/approved');
      expect(displayedSummary).not.toContain('https://preview.example.test/changed');
      expect(executedInputs).toEqual(['https://preview.example.test/approved']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rebuilds the interactive summary after editable confirmation details change', async () => {
    const answers = ['Named Auditor', 'https://preview.example.test/qa', ''];
    let displayedSummary = '';
    let executedOptions: Record<string, unknown> = {};

    const started = await runInteractiveAuditFlow({
      inputs: ['https://preview.example.test/page'],
      requestedOptions: {
        autoInstallBrowser: false,
        timeoutMs: 12_345,
        maxTabStops: 33,
        maxLinksPerPage: 44
      },
      initialAuditor: 'Automated',
      reportName: 'custom.xlsx',
      question: async () => answers.shift() ?? '',
      write: (message) => { displayedSummary += message; },
      executeApproved: async (request) => { executedOptions = request.options; }
    });

    expect(started).toBe(true);
    expect(displayedSummary).toContain('Auditor: Named Auditor');
    expect(displayedSummary).toContain('Landing page: https://preview.example.test/qa');
    expect(displayedSummary).toContain('Limits: 12345 ms per operation; 33 keyboard tab stops; 44 same-origin links per page');
    expect(displayedSummary).toContain('automatic Chromium install off');
    expect(displayedSummary).toContain('Output: ');
    expect(displayedSummary).toContain('/custom.xlsx');
    expect(executedOptions).toEqual(expect.objectContaining({
      auditor: 'Named Auditor',
      landingPageUrl: 'https://preview.example.test/qa',
      timeoutMs: 12_345,
      maxTabStops: 33,
      maxLinksPerPage: 44,
      autoInstallBrowser: false
    }));
  });

  it('requires fresh CLI confirmation if saved browser state changes after the summary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cli-auth-confirmation-'));
    const statePath = join(directory, 'session.json');
    const outputDir = join(directory, 'results');
    const state = (value: string) => ({
      cookies: [{
        name: 'session', value, domain: 'preview.example.test', path: '/', expires: -1,
        httpOnly: true, secure: true, sameSite: 'Lax'
      }],
      origins: []
    });
    await writeFile(statePath, JSON.stringify(state('approved-value')));
    await chmod(statePath, 0o600);
    let questionCount = 0;
    try {
      await expect(runInteractiveAuditFlow({
        inputs: ['https://preview.example.test/'],
        requestedOptions: { storageState: statePath, outputDir },
        initialAuditor: 'Automated',
        reportName: 'Accessibility_Audit_Report.xlsx',
        question: async () => {
          questionCount += 1;
          if (questionCount === 3) await writeFile(statePath, JSON.stringify(state('changed-value')));
          return '';
        },
        write: () => undefined,
        executeApproved: async (request) => {
          await resolveAuthenticationForExecution(
            { storageState: statePath, outputDir, exactHosts: [], allowedHosts: [] },
            request.inputs,
            request.authentication
          );
        }
      })).rejects.toThrow('saved browser state changed after confirmation');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
