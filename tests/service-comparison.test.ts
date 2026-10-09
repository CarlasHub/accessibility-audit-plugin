import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findingFingerprint } from '../src/reporting/finding-id.js';
import type { AuditSummary, Finding } from '../src/types.js';

const serviceMocks = vi.hoisted(() => ({
  runAudit: vi.fn(),
  archiveSummaries: [] as AuditSummary[]
}));

vi.mock('../src/audit/runner.js', () => ({ runAudit: serviceMocks.runAudit }));
vi.mock('../src/reporting/excel.js', () => ({ writeExcelReport: vi.fn(async () => undefined) }));
vi.mock('../src/reporting/html.js', () => ({ writeHtmlReport: vi.fn(async () => undefined) }));
vi.mock('../src/reporting/csv.js', () => ({ writeCsvReport: vi.fn(async () => undefined) }));
vi.mock('../src/reporting/sarif.js', () => ({ writeSarifReport: vi.fn(async () => undefined) }));
vi.mock('../src/reporting/validate.js', () => ({
  validateExcelReport: vi.fn(async () => ({
    valid: true,
    findingRows: 0,
    evidenceRows: 0,
    imageInventoryRows: 0,
    errors: [],
    warnings: [],
    auditor: 'Service comparison test'
  }))
}));
vi.mock('../src/reporting/json.js', () => ({
  writeJsonReport: vi.fn(async (summary: AuditSummary, outputPath: string) => {
    const { writeFile: write } = await import('node:fs/promises');
    await write(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    return outputPath;
  })
}));
vi.mock('../src/reporting/archive.js', () => ({
  auditArchivePath: (outputDir: string) => `${outputDir}.zip`,
  createAuditArchive: vi.fn(async (outputDir: string, _excel: string, _html: string, jsonPath: string) => {
    const { readFile: read } = await import('node:fs/promises');
    serviceMocks.archiveSummaries.push(JSON.parse(await read(jsonPath, 'utf8')) as AuditSummary);
    return join(outputDir, 'accessibility-audit.zip');
  })
}));

import { executeAudit } from '../src/service.js';

const temporaryDirectories: string[] = [];
const targetUrl = 'https://preview.example.test/jobs';

afterEach(async () => {
  vi.clearAllMocks();
  serviceMocks.archiveSummaries.splice(0);
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function finding(summary: string): Finding {
  return {
    key: summary.toLowerCase().replaceAll(' ', '-'),
    ruleId: 'axe-button-name',
    classification: 'confirmed',
    severity: 'Serious',
    wcag: ['4.1.2'],
    summary,
    issue: `${summary} issue`,
    impact: `${summary} impact`,
    testing: `${summary} testing`,
    remediation: `${summary} remediation`,
    component: 'Button',
    urls: [targetUrl],
    viewports: ['desktop'],
    selectors: ['#save'],
    evidence: [],
    assignment: 'Development',
    effort: 'Small',
    translationRequired: 'No'
  };
}

function summary(findings: Finding[]): AuditSummary {
  return {
    status: 'completed',
    generatedAt: '2026-10-01T12:00:00.000Z',
    auditor: 'Service comparison test',
    source: targetUrl,
    wcagLevel: 'AA',
    landingPageUrl: targetUrl,
    requestedUrls: [targetUrl],
    auditedUrls: [targetUrl],
    skippedUrls: [],
    pages: [{
      url: targetUrl,
      viewports: [{
        viewport: { name: 'desktop', width: 1440, height: 1000 },
        url: targetUrl,
        finalUrl: targetUrl,
        status: 200,
        axeRun: { completed: true }
      }]
    }],
    coverage: [],
    findings,
    manualChecks: [],
    limitations: []
  } as unknown as AuditSummary;
}

async function setup(
  baselineFindings: Finding[] = [finding('Previous finding')]
): Promise<{ outputDir: string; baselinePath: string }> {
  const outputDir = await mkdtemp(join(tmpdir(), 'a11y-service-comparison-'));
  temporaryDirectories.push(outputDir);
  const baselinePath = join(outputDir, '%2FUsers%2FCarla%2FPrivate%2Fbaseline.json');
  await writeFile(baselinePath, JSON.stringify(summary(baselineFindings)), 'utf8');
  return { outputDir, baselinePath };
}

function comparisonRecord(value: Finding) {
  return {
    fingerprint: findingFingerprint(value),
    classification: value.classification,
    severity: value.severity,
    summary: value.summary,
    urls: value.urls,
    viewports: value.viewports
  };
}

async function persistedSummary(jsonPath: string): Promise<AuditSummary> {
  return JSON.parse(await readFile(jsonPath, 'utf8')) as AuditSummary;
}

describe('service baseline persistence', () => {
  it('rejects malformed nested authentication state before output or browser work', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-service-auth-invalid-'));
    temporaryDirectories.push(directory);
    const statePath = join(directory, 'session.json');
    const outputDir = join(directory, 'must-not-exist');
    await writeFile(statePath, JSON.stringify({
      cookies: [{
        name: 'session', value: 'private', domain: 'preview.example.test', path: '/', expires: -2,
        httpOnly: true, secure: true, sameSite: 'Lax'
      }],
      origins: []
    }));
    await chmod(statePath, 0o600);

    const error = await executeAudit({
      inputs: [targetUrl],
      options: { storageState: statePath, outputDir }
    }).catch((caught: unknown) => caught);
    expect(String(error)).toContain('invalid cookie entry');
    expect(String(error)).not.toContain(statePath);
    expect(String(error)).not.toContain('private');
    expect(serviceMocks.runAudit).not.toHaveBeenCalled();
    await expect(stat(outputDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses one verified authentication snapshot if the source changes before browser launch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-service-auth-snapshot-'));
    temporaryDirectories.push(directory);
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
    serviceMocks.runAudit.mockImplementation(async () => structuredClone(summary([])));

    await executeAudit({
      inputs: [targetUrl],
      options: { storageState: statePath, outputDir },
      execution: {
        onProgress: async (event) => {
          if (event.phase === 'preparing' && event.message.startsWith('Preparing audit output')) {
            await writeFile(statePath, JSON.stringify(state('unverified-value')));
          }
        }
      }
    });

    const authentication = serviceMocks.runAudit.mock.calls[0]?.[5];
    expect(authentication?.storageState?.cookies[0]?.value).toBe('approved-value');
    expect(Object.isFrozen(authentication?.storageState)).toBe(true);
  });

  it('persists a completed comparison in standalone JSON and the JSON packaged in the archive', async () => {
    const unchanged = finding('Unchanged finding');
    const resolved = finding('Resolved finding');
    const added = finding('New finding');
    const { outputDir, baselinePath } = await setup([resolved, unchanged]);
    serviceMocks.runAudit.mockImplementation(async () => structuredClone(summary([added, unchanged])));

    const result = await executeAudit({
      inputs: [targetUrl],
      baselinePath,
      options: {
        outputDir,
        allowedHosts: ['preview.example.test'],
        viewports: [{ name: 'desktop', width: 1440, height: 1000 }]
      }
    });

    const standalone = await persistedSummary(result.jsonPath);
    expect(standalone.comparison).toMatchObject({
      baselineSource: 'baseline.json',
      coverage: 'complete',
      baselineFindingCount: 2,
      currentFindingCount: 2,
      newFindings: [comparisonRecord(added)],
      unchangedFindings: [comparisonRecord(unchanged)],
      resolvedFindings: [comparisonRecord(resolved)]
    });
    expect(serviceMocks.archiveSummaries).toHaveLength(1);
    expect(serviceMocks.archiveSummaries[0]?.comparison).toEqual(standalone.comparison);
  });

  it('persists chronological history in standalone JSON and the JSON packaged in the archive', async () => {
    const { outputDir } = await setup();
    const earlier = summary([finding('Resolved historical finding')]);
    earlier.generatedAt = '2026-08-01T12:00:00.000Z';
    const recent = summary([]);
    recent.generatedAt = '2026-09-01T12:00:00.000Z';
    const earlierPath = join(outputDir, 'august.json');
    const recentPath = join(outputDir, 'september.json');
    await writeFile(earlierPath, JSON.stringify(earlier), 'utf8');
    await writeFile(recentPath, JSON.stringify(recent), 'utf8');
    serviceMocks.runAudit.mockImplementation(async () => structuredClone(summary([finding('Current finding')])));

    const result = await executeAudit({
      inputs: [targetUrl],
      historyPaths: [recentPath, earlierPath],
      options: {
        outputDir,
        allowedHosts: ['preview.example.test'],
        viewports: [{ name: 'desktop', width: 1440, height: 1000 }]
      }
    });

    const standalone = await persistedSummary(result.jsonPath);
    expect(standalone.history?.points.map((point) => point.source)).toEqual([
      'august.json',
      'september.json',
      'Current audit'
    ]);
    expect(standalone.history?.points[1]?.comparisonToPrevious).toMatchObject({ resolvedCount: 1 });
    expect(standalone.history?.points[2]?.comparisonToPrevious).toMatchObject({ newCount: 1 });
    expect(serviceMocks.archiveSummaries[0]?.history).toEqual(standalone.history);
  });

  it('persists identical late-cancelled comparison data in standalone and archived JSON', async () => {
    const { outputDir, baselinePath } = await setup();
    const abortController = new AbortController();
    serviceMocks.runAudit.mockImplementation(async () => {
      abortController.abort('late cancellation');
      return structuredClone(summary([]));
    });

    const result = await executeAudit({
      inputs: [targetUrl],
      baselinePath,
      options: {
        outputDir,
        allowedHosts: ['preview.example.test'],
        viewports: [{ name: 'desktop', width: 1440, height: 1000 }]
      },
      execution: { signal: abortController.signal }
    });

    const standalone = await persistedSummary(result.jsonPath);
    expect(result.status).toBe('cancelled');
    expect(standalone.status).toBe('cancelled');
    expect(standalone.comparison?.baselineSource).toBe('baseline.json');
    expect(serviceMocks.archiveSummaries).toHaveLength(1);
    expect(serviceMocks.archiveSummaries[0]).toEqual(standalone);
  });
});
