import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({ executeAudit: vi.fn() }));

vi.mock('../src/service.js', () => ({ executeAudit: serviceMocks.executeAudit }));

import {
  evaluateGate,
  formatProgress,
  parseBooleanInput,
  parseBrowserEngine,
  parseFailurePolicy,
  parseJourneysInput,
  parseListInput,
  parsePositiveInteger,
  parseWcagLevel,
  reportActionFailure,
  resolveAllowedHosts,
  runGitHubAction
} from '../src/github-action.js';

afterEach(() => {
  serviceMocks.executeAudit.mockReset();
});

describe('GitHub Action inputs', () => {
  it('redacts credentials from progress logs while retaining useful public context', () => {
    const output = formatProgress({
      phase: 'browser',
      current: 1,
      total: 2,
      message: 'Testing https://public.example/path?access%252525255Ftoken=action-secret&next=/public'
    });

    expect(output).toBe(
      '[accessibility-audit:browser] (1/2) Testing https://public.example/path?access%252525255Ftoken=[redacted]&next=/public'
    );
    expect(output).not.toContain('action-secret');
  });

  it('redacts credentials from workflow failure annotations', () => {
    const previousExitCode = process.exitCode;
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      reportActionFailure(new Error(
        String.raw`Authorization: Digest realm=\"Private \\\"hidden; request do not expose\\\" tail\", nonce=\"action-secret\". Please retry https://public.example/login`
      ));

      const annotation = write.mock.calls.flatMap((call) => call).join('');
      expect(annotation).toContain(
        'Authorization: [redacted]. Please retry https://public.example/login'
      );
      expect(annotation).not.toMatch(/Private|action-secret|nonce/);
      expect(process.exitCode).toBe(1);
    } finally {
      write.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it('reads one URL per line and JSON arrays without treating URL commas as separators', () => {
    expect(parseListInput('https://example.test/a,b\nhttps://example.test/c')).toEqual([
      'https://example.test/a,b',
      'https://example.test/c'
    ]);
    expect(parseListInput('["https://example.test/a", "https://example.test/b"]')).toEqual([
      'https://example.test/a',
      'https://example.test/b'
    ]);
    expect(parseListInput(
      'https://loreal.runmytests.eu/en  https://loreal.runmytests.eu/en/search-jobs https://loreal.runmytests.eu/en/saved-jobs'
    )).toEqual([
      'https://loreal.runmytests.eu/en',
      'https://loreal.runmytests.eu/en/search-jobs',
      'https://loreal.runmytests.eu/en/saved-jobs'
    ]);
    expect(parseListInput(
      '- https://example.test/a,b;c\n2. https://example.test/jobs;  * https://example.test/contact'
    )).toEqual([
      'https://example.test/a,b;c',
      'https://example.test/jobs',
      'https://example.test/contact'
    ]);
  });

  it.each([
    ['not-a-url\nhttps://example.test/two', 'Invalid explicit URL list entry 1'],
    ['https://example.test/one\nftp://example.test/two', 'Invalid explicit URL list entry 2'],
    ['https://example.test/one\nhttps://user:secret@example.test/two', 'Invalid explicit URL list entry 2'],
    ['["https://example.test/"', 'Invalid explicit URL list JSON syntax'],
    ['["https://example.test/", 42]', 'Invalid explicit URL list entry 2']
  ])('rejects malformed URL-list input before starting an audit: %s', async (urls, message) => {
    await expect(runGitHubAction({ INPUT_URLS: urls })).rejects.toThrow(message);
    expect(serviceMocks.executeAudit).not.toHaveBeenCalled();
  });

  it('validates boolean and failure policy values', () => {
    expect(parseBooleanInput('yes', false)).toBe(true);
    expect(parseBooleanInput('0', true)).toBe(false);
    expect(parseFailurePolicy('SERIOUS')).toBe('serious');
    expect(parseFailurePolicy('NEW')).toBe('new');
    expect(() => parseFailurePolicy('review')).toThrow(/fail-on must be one of/);
    expect(parseWcagLevel('aaa')).toBe('AAA');
    expect(() => parseWcagLevel('A')).toThrow(/AA or AAA/);
    expect(parseBrowserEngine('')).toBe('chromium');
    expect(parseBrowserEngine(' FIREFOX ')).toBe('firefox');
    expect(parseBrowserEngine('webkit')).toBe('webkit');
    expect(() => parseBrowserEngine('safari')).toThrow(/chromium, firefox, webkit/);
  });

  it('enforces the documented Action concurrency range', () => {
    expect(parsePositiveInteger('', 2, 'concurrency', 8)).toBe(2);
    expect(parsePositiveInteger('8', 2, 'concurrency', 8)).toBe(8);
    expect(() => parsePositiveInteger('9', 2, 'concurrency', 8)).toThrow('between 1 and 8');
    expect(parsePositiveInteger('50000', 1, 'max-pages', 50_000)).toBe(50_000);
    expect(() => parsePositiveInteger('50001', 1, 'max-pages', 50_000)).toThrow('between 1 and 50000');
  });

  it('rejects an out-of-range page ceiling before starting the audit', async () => {
    await expect(runGitHubAction({
      INPUT_URLS: 'https://example.test/',
      'INPUT_MAX-PAGES': '50001'
    })).rejects.toThrow('max-pages must be between 1 and 50000');
    expect(serviceMocks.executeAudit).not.toHaveBeenCalled();
  });

  it('validates configured keyboard and interaction journeys', () => {
    expect(parseJourneysInput(JSON.stringify({ journeys: [{
      id: 'open-menu',
      title: 'Open the primary menu',
      categories: ['keyboard', 'interaction'],
      steps: [
        { action: 'focus', selector: '#menu' },
        { action: 'press', key: 'Enter' },
        { action: 'assert', expectation: 'expanded', selector: '#menu' }
      ]
    }] }))).toEqual([expect.objectContaining({ id: 'open-menu', categories: ['keyboard', 'interaction'] })]);
    expect(() => parseJourneysInput('[{"id":"unsafe","title":"Missing assertions","categories":["keyboard"],"steps":[]}]')).toThrow();
  });

  it('derives a safe hostname allowlist when users provide only URLs', () => {
    expect(resolveAllowedHosts([
      'https://example.test/',
      'https://example.test/contact',
      'https://docs.example.test/'
    ], [])).toEqual(['example.test', 'docs.example.test']);
    expect(resolveAllowedHosts(['https://example.test/'], ['preview.example.test'])).toEqual(['preview.example.test']);
    expect(() => resolveAllowedHosts(['pages.csv'], [])).toThrow(/explicit HTTP\(S\) URLs only/);
    expect(() => resolveAllowedHosts(['https://user:secret@example.test/'], [])).toThrow(/without embedded credentials/);
  });
});

describe('GitHub Action quality gate', () => {
  const findings = [
    { classification: 'confirmed' as const, severity: 'Critical' as const },
    { classification: 'confirmed' as const, severity: 'Serious' as const },
    { classification: 'confirmed' as const, severity: 'Moderate' as const },
    { classification: 'confirmed' as const, severity: 'Minor' as const },
    { classification: 'confirmed' as const, severity: 'Advisory' as const },
    { classification: 'review' as const, severity: 'Critical' as const },
    { classification: 'manual' as const, severity: 'Critical' as const },
    { classification: 'blocker' as const, severity: 'Critical' as const }
  ];

  it.each([
    ['none', false, 0, 'Informational only'],
    ['blockers', true, 1, 'Audit blockers'],
    ['confirmed', true, 5, 'Confirmed findings'],
    ['critical', true, 1, 'Confirmed critical or higher findings'],
    ['serious', true, 2, 'Confirmed serious or higher findings'],
    ['moderate', true, 3, 'Confirmed moderate or higher findings'],
    ['minor', true, 4, 'Confirmed minor or higher findings']
  ] as const)('preserves the %s gate boundary', (policy, failed, matchedCount, label) => {
    expect(evaluateGate(policy, findings, { newFindings: [{
      fingerprint: 'a11y-fp-v1:new-review',
      classification: 'review',
      severity: 'Critical',
      summary: 'A new review candidate must not change an existing gate',
      urls: ['https://example.test/'],
      viewports: ['desktop']
    }] })).toEqual({ policy, failed, matchedCount, label });
    expect(evaluateGate(policy, [])).toMatchObject({ failed: false, matchedCount: 0 });
  });

  it('fails only for findings classified as new by a baseline comparison', () => {
    const comparison = {
      newFindings: [{
        fingerprint: 'a11y-fp-v1:new',
        classification: 'review' as const,
        severity: 'Moderate' as const,
        summary: 'New comparison finding',
        urls: ['https://example.test/'],
        viewports: ['desktop']
      }]
    };
    expect(evaluateGate('new', findings, comparison)).toMatchObject({
      failed: true,
      matchedCount: 1,
      label: 'New findings since baseline'
    });
    expect(evaluateGate('new', findings, { newFindings: [] })).toMatchObject({ failed: false, matchedCount: 0 });
  });
});

describe('GitHub Action baseline gate', () => {
  it('requires a baseline for fail-on new before starting an audit', async () => {
    await expect(runGitHubAction({
      INPUT_URLS: 'https://example.test/',
      'INPUT_FAIL-ON': 'new'
    })).rejects.toThrow('fail-on new requires baseline-path');
    expect(serviceMocks.executeAudit).not.toHaveBeenCalled();
  });

  it('resolves a workspace baseline, passes it to the audit, and publishes a failed gate', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'github-action-baseline-'));
    const baselinePath = join(workspace, 'baseline.json');
    const jsonPath = join(workspace, 'audit-results.json');
    const outputPath = join(workspace, 'github-output.txt');
    const summaryPath = join(workspace, 'github-summary.md');
    try {
      await writeFile(baselinePath, JSON.stringify({ findings: [] }), 'utf8');
      await writeFile(jsonPath, JSON.stringify({
        findings: [],
        history: {
          kind: 'audit-history',
          limitations: [],
          points: [{
            source: 'prior_[audit].json',
            generatedAt: '2026-09-01T12:00:00.000Z',
            status: 'completed',
            requestedPageCount: 1,
            auditedPageCount: 1,
            findingCount: 0,
            confirmedCount: 0,
            reviewCount: 0,
            blockerCount: 0,
            manualCount: 0,
            criticalConfirmedCount: 0,
            seriousConfirmedCount: 0
          }, {
            source: 'Current audit',
            generatedAt: '2026-10-01T12:00:00.000Z',
            status: 'completed',
            requestedPageCount: 1,
            auditedPageCount: 1,
            findingCount: 1,
            confirmedCount: 1,
            reviewCount: 0,
            blockerCount: 0,
            manualCount: 0,
            criticalConfirmedCount: 0,
            seriousConfirmedCount: 1,
            comparisonToPrevious: {
              coverage: 'complete',
              newCount: 1,
              unchangedCount: 0,
              resolvedCount: 0,
              indeterminateCurrentCount: 0,
              unobservedPreviousCount: 0
            }
          }]
        },
        comparison: {
          coverage: 'partial',
          newFindings: [{
            fingerprint: 'a11y-fp-v1:new',
            classification: 'confirmed',
            severity: 'Serious',
            summary: 'New regression',
            urls: ['https://example.test/'],
            viewports: ['desktop']
          }],
          unchangedFindings: [{
            fingerprint: 'a11y-fp-v1:persistent',
            classification: 'review',
            severity: 'Moderate',
            summary: 'Persistent review item',
            urls: ['https://example.test/'],
            viewports: ['desktop']
          }],
          resolvedFindings: [{
            fingerprint: 'a11y-fp-v1:resolved',
            classification: 'confirmed',
            severity: 'Serious',
            summary: 'Resolved barrier',
            urls: ['https://example.test/'],
            viewports: ['desktop']
          }],
          indeterminateCurrentFindings: [{
            fingerprint: 'a11y-fp-v1:current-indeterminate',
            classification: 'review',
            severity: 'Minor',
            summary: 'Current scope differs',
            urls: ['https://example.test/new'],
            viewports: ['desktop']
          }],
          unobservedBaselineFindings: [{
            fingerprint: 'a11y-fp-v1:baseline-indeterminate',
            classification: 'review',
            severity: 'Minor',
            summary: 'Baseline scope was not observed',
            urls: ['https://example.test/old'],
            viewports: ['desktop']
          }]
        }
      }), 'utf8');
      serviceMocks.executeAudit.mockResolvedValue({
        status: 'complete',
        reportPath: join(workspace, 'report.xlsx'),
        htmlPath: join(workspace, 'report.html'),
        jsonPath,
        csvPath: join(workspace, 'findings.csv'),
        sarifPath: join(workspace, 'results.sarif'),
        archivePath: join(workspace, 'evidence.zip'),
        requestedPageCount: 1,
        auditedPageCount: 1,
        skippedPageCount: 0,
        completedPageCount: 1,
        partialPageCount: 0,
        notStartedPageCount: 0,
        confirmedCount: 1,
        blockerCount: 0,
        reviewCount: 0,
        manualCheckCount: 0,
        imageInventoryCount: 0,
        validation: {
          valid: true,
          findingRows: 1,
          imageInventoryRows: 0,
          errors: [],
          warnings: [],
          auditor: 'GitHub Actions'
        }
      });

      await expect(runGitHubAction({
        GITHUB_WORKSPACE: workspace,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        INPUT_URLS: 'https://example.test/',
        'INPUT_BASELINE-PATH': 'baseline.json',
        'INPUT_HISTORY-PATHS': 'history/august.json\nhistory/september.json',
        INPUT_BROWSER: 'firefox',
        'INPUT_FAIL-ON': 'new',
        'INPUT_EXACT-HOSTS': 'example.test',
        'INPUT_MAX-PAGES': '10',
        'INPUT_COMMENT-ON-PR': 'false'
      })).rejects.toThrow('New findings since baseline policy matched 1 finding.');

      expect(serviceMocks.executeAudit).toHaveBeenCalledWith(expect.objectContaining({
        baselinePath,
        historyPaths: [
          join(workspace, 'history/august.json'),
          join(workspace, 'history/september.json')
        ],
        options: expect.objectContaining({
          exactHosts: ['example.test'],
          maxPages: 10,
          browserEngine: 'firefox'
        })
      }));
      expect(await readFile(outputPath, 'utf8')).toContain('gate-result=failed');
      const summary = await readFile(summaryPath, 'utf8');
      expect(summary).toContain('### Changes since baseline');
      expect(summary).toContain('| New findings | 1 |');
      expect(summary).toContain('| Persistent findings | 1 |');
      expect(summary).toContain('| Resolved findings | 1 |');
      expect(summary).toContain('Comparison coverage is partial. 1 current finding and 1 baseline finding remain indeterminate');
      expect(summary).toContain('### Latest history trend');
      expect(summary).toContain('Compared with prior\\_\\[audit\\].json (complete scope coverage):');
      expect(summary).toContain('| New findings | 1 |');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
