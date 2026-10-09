import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditHistory } from '../src/history.js';
import type { AuditSummary, Finding } from '../src/types.js';

const temporaryDirectories: string[] = [];
const primaryUrl = 'https://preview.example.test/';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function finding(summary: string, classification: Finding['classification'] = 'confirmed'): Finding {
  return {
    key: summary.toLowerCase().replaceAll(' ', '-'),
    ruleId: 'axe-button-name',
    classification,
    severity: classification === 'confirmed' ? 'Serious' : 'Advisory',
    wcag: ['4.1.2'],
    summary,
    issue: `${summary} issue`,
    impact: `${summary} impact`,
    testing: `${summary} testing`,
    remediation: `${summary} remediation`,
    component: 'Button',
    urls: [primaryUrl],
    viewports: ['desktop'],
    selectors: [`#${summary.toLowerCase().replaceAll(' ', '-')}`],
    evidence: [],
    assignment: 'Development',
    effort: 'Small',
    translationRequired: 'No'
  };
}

function summary(
  generatedAt: string,
  findings: Finding[],
  partial = false,
  browserEngine: AuditSummary['browserEngine'] = 'chromium'
): AuditSummary {
  return {
    status: 'completed',
    generatedAt,
    auditor: 'History test',
    source: 'test',
    browserEngine,
    wcagLevel: 'AA',
    landingPageUrl: primaryUrl,
    requestedUrls: [primaryUrl],
    auditedUrls: [primaryUrl],
    skippedUrls: [],
    pages: [{
      url: primaryUrl,
      partial,
      viewports: [{
        viewport: { name: 'desktop', width: 1440, height: 1000 },
        cancelled: false,
        partial,
        interactionBlocker: null,
        axeRun: { completed: true },
        status: 200,
        finalUrl: primaryUrl
      }]
    }],
    coverage: [],
    findings,
    manualChecks: [],
    limitations: []
  } as unknown as AuditSummary;
}

async function historyFile(directory: string, name: string, value: AuditSummary): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, JSON.stringify(value), 'utf8');
  return path;
}

describe('audit history', () => {
  it('orders prior reports chronologically and computes scope-safe adjacent deltas', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-history-'));
    temporaryDirectories.push(directory);
    const persistent = finding('Persistent');
    const resolved = finding('Resolved');
    const added = finding('Added');
    const older = await historyFile(directory, 'older.json', summary('2026-09-01T12:00:00.000Z', [persistent, resolved]));
    const newer = await historyFile(directory, 'newer.json', summary('2026-09-15T12:00:00.000Z', [persistent]));

    const history = await createAuditHistory(summary('2026-10-01T12:00:00.000Z', [persistent, added]), [newer, older]);

    expect(history.kind).toBe('audit-history');
    expect(history.points.map((point) => point.source)).toEqual(['older.json', 'newer.json', 'Current audit']);
    expect(history.points[1]?.comparisonToPrevious).toMatchObject({
      coverage: 'complete', newCount: 0, unchangedCount: 1, resolvedCount: 1
    });
    expect(history.points[2]?.comparisonToPrevious).toMatchObject({
      coverage: 'complete', newCount: 1, unchangedCount: 1, resolvedCount: 0
    });
    expect(history.points[2]).toMatchObject({ findingCount: 2, confirmedCount: 2, seriousConfirmedCount: 2 });
    expect(history.limitations).toEqual([]);
  });

  it('marks incomplete adjacent comparisons as partial without claiming unobserved resolution', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-history-partial-'));
    temporaryDirectories.push(directory);
    const previousFinding = finding('Previous');
    const previous = await historyFile(directory, 'previous.json', summary('2026-09-01T12:00:00.000Z', [previousFinding]));

    const history = await createAuditHistory(summary('2026-10-01T12:00:00.000Z', [], true), [previous]);

    expect(history.points[1]?.comparisonToPrevious).toMatchObject({
      coverage: 'partial', resolvedCount: 0, unobservedPreviousCount: 1
    });
    expect(history.limitations).toHaveLength(1);
  });

  it('records browser engines and treats cross-engine deltas as indeterminate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-history-browser-'));
    temporaryDirectories.push(directory);
    const previousFinding = finding('Previous');
    const currentFinding = finding('Current');
    const previous = await historyFile(
      directory,
      'previous.json',
      summary('2026-09-01T12:00:00.000Z', [previousFinding], false, 'chromium')
    );

    const history = await createAuditHistory(
      summary('2026-10-01T12:00:00.000Z', [currentFinding], false, 'firefox'),
      [previous]
    );

    expect(history.points.map((point) => point.browserEngine)).toEqual(['chromium', 'firefox']);
    expect(history.points[1]?.comparisonToPrevious).toMatchObject({
      coverage: 'partial',
      newCount: 0,
      resolvedCount: 0,
      indeterminateCurrentCount: 1,
      unobservedPreviousCount: 1
    });
    expect(history.limitations.join(' ')).toContain('browser engine changed');
  });

  it.each(['firefox', 'webkit'] as const)(
    'treats a legacy browser-less history point as Chromium before a %s audit',
    async (browserEngine) => {
      const directory = await mkdtemp(join(tmpdir(), `a11y-history-legacy-${browserEngine}-`));
      temporaryDirectories.push(directory);
      const legacy = summary('2026-09-01T12:00:00.000Z', [finding('Legacy')]);
      delete legacy.browserEngine;
      const previous = await historyFile(directory, 'legacy.json', legacy);

      const history = await createAuditHistory(
        summary('2026-10-01T12:00:00.000Z', [finding('Current')], false, browserEngine),
        [previous]
      );

      expect(history.points.map((point) => point.browserEngine)).toEqual(['chromium', browserEngine]);
      expect(history.points[1]?.comparisonToPrevious).toMatchObject({
        coverage: 'partial', newCount: 0, resolvedCount: 0,
        indeterminateCurrentCount: 1, unobservedPreviousCount: 1
      });
      expect(history.limitations.join(' ')).toContain(`changed from chromium to ${browserEngine}`);
    }
  );

  it('rejects present unsupported browser engines in imported history', async () => {
    const malformedValues: unknown[] = ['safari', '', null, 42, false];
    for (const [index, browserEngine] of malformedValues.entries()) {
      const directory = await mkdtemp(join(tmpdir(), `a11y-history-invalid-engine-${index}-`));
      temporaryDirectories.push(directory);
      const invalid = summary('2026-09-01T12:00:00.000Z', []) as unknown as Record<string, unknown>;
      invalid.browserEngine = browserEngine;
      const stored = await historyFile(directory, 'invalid.json', invalid as unknown as AuditSummary);

      await expect(createAuditHistory(summary('2026-10-01T12:00:00.000Z', []), [stored])).rejects.toThrow(
        'History audit invalid.json is invalid: Baseline audit has an invalid browserEngine field.'
      );
    }
  });

  it('does not expose parent paths in points or load errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-private-history-'));
    temporaryDirectories.push(directory);
    const stored = await historyFile(directory, 'prior.json', summary('2026-09-01T12:00:00.000Z', []));
    const history = await createAuditHistory(summary('2026-10-01T12:00:00.000Z', []), [stored]);
    expect(JSON.stringify(history)).not.toContain(directory);

    const invalid = join(directory, 'private-invalid.json');
    await writeFile(invalid, '{invalid', 'utf8');
    await expect(createAuditHistory(summary('2026-10-01T12:00:00.000Z', []), [invalid])).rejects.toThrow(
      'Could not load history audit JSON private-invalid.json: the file is not valid JSON.'
    );
  });

  it('rejects duplicate paths, ambiguous filenames, future reports, invalid reports, and excessive history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-history-validation-'));
    temporaryDirectories.push(directory);
    const prior = await historyFile(directory, 'prior.json', summary('2026-09-01T12:00:00.000Z', []));
    const otherDirectory = await mkdtemp(join(tmpdir(), 'a11y-history-other-'));
    temporaryDirectories.push(otherDirectory);
    const sameName = await historyFile(otherDirectory, 'prior.json', summary('2026-08-01T12:00:00.000Z', []));
    const future = await historyFile(directory, 'future.json', summary('2026-11-01T12:00:00.000Z', []));
    const invalid = join(directory, 'invalid.json');
    await writeFile(invalid, JSON.stringify({ generatedAt: 'not-a-date', status: 'completed', findings: [] }), 'utf8');
    const current = summary('2026-10-01T12:00:00.000Z', []);

    await expect(createAuditHistory(current, [prior, prior])).rejects.toThrow(/supplied more than once/);
    await expect(createAuditHistory(current, [prior, sameName])).rejects.toThrow(/ambiguous/);
    await expect(createAuditHistory(current, [future])).rejects.toThrow(/newer than the current audit/);
    await expect(createAuditHistory(current, [invalid])).rejects.toThrow(/invalid generatedAt/);
    await expect(createAuditHistory(current, Array.from({ length: 51 }, () => prior))).rejects.toThrow(/at most 50/);
  });
});
