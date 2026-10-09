import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compareAuditFindings,
  compareAuditSummaries,
  compareAuditWithBaseline,
  safeBaselineSource
} from '../src/comparison.js';
import { findingFingerprint } from '../src/reporting/finding-id.js';
import type { AuditSummary, Finding } from '../src/types.js';

const temporaryDirectories: string[] = [];
const primaryUrl = 'https://preview.example.test/';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function finding(summary: string, overrides: Partial<Finding> = {}): Finding {
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
    urls: [primaryUrl],
    viewports: ['desktop'],
    selectors: ['#save'],
    evidence: [],
    assignment: 'Development',
    effort: 'Small',
    translationRequired: 'No',
    ...overrides
  };
}

interface SummaryOptions {
  status?: 'completed' | 'cancelled';
  requestedUrls?: string[];
  auditedUrls?: string[];
  partialUrls?: string[];
  cancelledUrls?: string[];
  generatedAt?: string;
  viewportOverrides?: Record<string, unknown>;
  viewportNames?: string[];
  viewportOverridesByName?: Record<string, Record<string, unknown>>;
  browserEngine?: 'chromium' | 'firefox' | 'webkit';
}

function auditSummary(findings: Finding[], options: SummaryOptions = {}): AuditSummary {
  const requestedUrls = options.requestedUrls ?? [primaryUrl];
  const auditedUrls = options.auditedUrls ?? requestedUrls;
  const partialUrls = new Set(options.partialUrls ?? []);
  const cancelledUrls = new Set(options.cancelledUrls ?? []);
  return {
    status: options.status ?? 'completed',
    generatedAt: options.generatedAt ?? '2026-10-01T12:00:00.000Z',
    auditor: 'Comparison test',
    source: 'test',
    browserEngine: options.browserEngine ?? 'chromium',
    wcagLevel: 'AA',
    landingPageUrl: requestedUrls[0] ?? '',
    requestedUrls,
    auditedUrls,
    skippedUrls: [],
    pages: auditedUrls.map((url) => ({
      url,
      partial: partialUrls.has(url),
      viewports: (options.viewportNames ?? ['desktop']).map((name) => ({
        viewport: { name, width: name === 'mobile' ? 390 : 1440, height: 1000 },
        cancelled: cancelledUrls.has(url),
        partial: partialUrls.has(url),
        interactionBlocker: null,
        axeRun: { completed: true },
        status: 200,
        finalUrl: url,
        ...options.viewportOverrides,
        ...options.viewportOverridesByName?.[name]
      }))
    })),
    coverage: [],
    findings,
    manualChecks: [],
    limitations: []
  } as unknown as AuditSummary;
}

describe('baseline audit comparison', () => {
  it('does not claim new or resolved findings across different browser engines', () => {
    const currentOnly = finding('Firefox-only finding', { selectors: ['#firefox'] });
    const baselineOnly = finding('Chromium-only finding', { selectors: ['#chromium'] });
    const comparison = compareAuditSummaries(
      auditSummary([currentOnly], { browserEngine: 'firefox' }),
      auditSummary([baselineOnly], { browserEngine: 'chromium' })
    );

    expect(comparison.coverage).toBe('partial');
    expect(comparison.newFindings).toEqual([]);
    expect(comparison.resolvedFindings).toEqual([]);
    expect(comparison.indeterminateCurrentFindings.map((item) => item.summary)).toEqual(['Firefox-only finding']);
    expect(comparison.unobservedBaselineFindings.map((item) => item.summary)).toEqual(['Chromium-only finding']);
    expect(comparison.limitations).toContain(
      'The current and baseline audits used different browser engines (firefox and chromium), so unmatched findings are not claimed as new or resolved.'
    );
  });

  it.each(['firefox', 'webkit'] as const)(
    'treats a legacy baseline without browser metadata as Chromium when comparing with %s',
    (browserEngine) => {
      const currentOnly = finding(`${browserEngine} finding`, { selectors: [`#${browserEngine}`] });
      const baselineOnly = finding('Legacy Chromium finding', { selectors: ['#legacy'] });
      const baseline = auditSummary([baselineOnly]);
      delete baseline.browserEngine;

      const comparison = compareAuditSummaries(
        auditSummary([currentOnly], { browserEngine }),
        baseline
      );

      expect(comparison.coverage).toBe('partial');
      expect(comparison.newFindings).toEqual([]);
      expect(comparison.resolvedFindings).toEqual([]);
      expect(comparison.indeterminateCurrentFindings).toHaveLength(1);
      expect(comparison.unobservedBaselineFindings).toHaveLength(1);
      expect(comparison.limitations.join(' ')).toContain(`(${browserEngine} and chromium)`);
    }
  );

  it('keeps comparisons with legacy browser-less baselines complete for Chromium audits', () => {
    const added = finding('New Chromium finding', { selectors: ['#new'] });
    const resolved = finding('Resolved legacy finding', { selectors: ['#resolved'] });
    const baseline = auditSummary([resolved]);
    delete baseline.browserEngine;

    const comparison = compareAuditSummaries(auditSummary([added]), baseline);

    expect(comparison.coverage).toBe('complete');
    expect(comparison.newFindings.map((item) => item.summary)).toEqual(['New Chromium finding']);
    expect(comparison.resolvedFindings.map((item) => item.summary)).toEqual(['Resolved legacy finding']);
  });

  it.each(['chromium', 'firefox', 'webkit'] as const)(
    'accepts an explicitly supported %s engine in imported evidence',
    (browserEngine) => {
      const unchanged = finding(`${browserEngine} finding`);
      const comparison = compareAuditSummaries(
        auditSummary([unchanged], { browserEngine }),
        auditSummary([unchanged], { browserEngine })
      );

      expect(comparison.coverage).toBe('complete');
      expect(comparison.unchangedFindings).toHaveLength(1);
    }
  );

  it('rejects every present unsupported browser engine instead of assuming Chromium', () => {
    const malformedValues: unknown[] = ['safari', '', null, 42, false];
    for (const browserEngine of malformedValues) {
      const baseline = auditSummary([]) as unknown as Record<string, unknown>;
      baseline.browserEngine = browserEngine;

      expect(() => compareAuditSummaries(auditSummary([finding('Current')]), baseline)).toThrow(
        'Baseline audit has an invalid browserEngine field.'
      );
    }
  });

  it('rejects an unsupported current browser engine before classifying findings', () => {
    const current = auditSummary([finding('Current')]) as unknown as Record<string, unknown>;
    current.browserEngine = 'safari';

    expect(() => compareAuditSummaries(current as unknown as AuditSummary, auditSummary([]))).toThrow(
      'Current audit has an invalid browserEngine field.'
    );
  });

  it('reports new, unchanged, and resolved findings by stable fingerprint regardless of order', () => {
    const unchanged = finding('Unchanged finding');
    const added = finding('New finding', { selectors: ['#new'] });
    const resolved = finding('Resolved finding', { selectors: ['#old'] });
    const baseline = {
      generatedAt: '2026-10-01T12:00:00.000Z',
      findings: [
        { ...resolved, id: 'A11Y001', fingerprint: findingFingerprint(resolved) },
        { ...unchanged, id: 'A11Y002', fingerprint: findingFingerprint(unchanged) }
      ]
    };

    const comparison = compareAuditFindings([added, unchanged], baseline, './baseline.json');

    expect(comparison).toMatchObject({
      kind: 'baseline-comparison',
      coverage: 'complete',
      baselineSource: './baseline.json',
      baselineGeneratedAt: '2026-10-01T12:00:00.000Z',
      baselineFindingCount: 2,
      currentFindingCount: 2
    });
    expect(comparison.newFindings.map((item) => item.summary)).toEqual(['New finding']);
    expect(comparison.unchangedFindings.map((item) => item.summary)).toEqual(['Unchanged finding']);
    expect(comparison.resolvedFindings.map((item) => item.summary)).toEqual(['Resolved finding']);
    expect(comparison.indeterminateCurrentFindings).toEqual([]);
    expect(comparison.unobservedBaselineFindings).toEqual([]);
  });

  it('derives fingerprints for complete legacy reports that predate persisted fingerprints', () => {
    const legacy = finding('Legacy finding');
    const comparison = compareAuditFindings([legacy], { findings: [legacy] });
    expect(comparison.newFindings).toEqual([]);
    expect(comparison.unchangedFindings).toHaveLength(1);
    expect(comparison.resolvedFindings).toEqual([]);
  });

  it('loads a baseline JSON file and exposes only its safe filename', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-comparison-'));
    temporaryDirectories.push(directory);
    const baselinePath = join(directory, 'baseline.json');
    await writeFile(baselinePath, JSON.stringify(auditSummary([finding('Stored finding')])), 'utf8');

    const comparison = await compareAuditWithBaseline(auditSummary([finding('Stored finding')]), baselinePath);
    expect(comparison.baselineSource).toBe('baseline.json');
    expect(comparison.unchangedFindings).toHaveLength(1);
  });

  it('sanitizes POSIX, Windows, UNC, file-URI, suffix, repeatedly encoded, and control-character source spellings', () => {
    expect(safeBaselineSource('/Users/alice/private/client/baseline.json')).toBe('baseline.json');
    expect(safeBaselineSource('C:\\Users\\alice\\private\\baseline.json')).toBe('baseline.json');
    expect(safeBaselineSource('\\\\server\\private\\client\\baseline.json')).toBe('baseline.json');
    expect(safeBaselineSource('file:///Users/alice/private/audit%20baseline.json')).toBe('audit baseline.json');
    expect(safeBaselineSource('/private/baseline.json?token=secret#fragment')).toBe('baseline.json');
    expect(safeBaselineSource('/private/%2E%2E%2Fsecret.json')).toBe('secret.json');
    expect(safeBaselineSource('%2FUsers%2FCarla%2FPrivate%2Fbaseline.json')).toBe('baseline.json');
    expect(safeBaselineSource('file:%2F%2F%2FC:%5CUsers%5CCarla%5CPrivate%5Cbaseline.json')).toBe('baseline.json');
    expect(safeBaselineSource('%252FUsers%252FCarla%252FPrivate%252Fbaseline.json')).toBe('baseline.json');
    expect(safeBaselineSource('%5C%5Cserver%5Cshare%5Cprivate%5Cbaseline.json')).toBe('baseline.json');
    expect(safeBaselineSource('%2Fprivate%2Fbaseline.json%3Ftoken%3Dsecret%23fragment')).toBe('baseline.json');
    expect(safeBaselineSource('/private/base\u0000line.json')).toBe('baseline.json');
  });

  it('does not expose parent paths when a baseline cannot be parsed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-private-comparison-'));
    temporaryDirectories.push(directory);
    const baselinePath = join(directory, 'private-baseline.json');
    await writeFile(baselinePath, '{not-json', 'utf8');

    await expect(compareAuditWithBaseline(auditSummary([]), baselinePath)).rejects.toThrow(
      'Could not load baseline audit JSON private-baseline.json: the file is not valid JSON.'
    );
  });

  it('canonicalizes record and finding order for byte-stable comparison output', () => {
    const secondUrl = `${primaryUrl}two`;
    const first = finding('First finding', { urls: [secondUrl, primaryUrl] });
    const second = finding('Second finding', { urls: [primaryUrl, secondUrl] });
    const currentA = auditSummary([second, first], { requestedUrls: [primaryUrl, secondUrl] });
    const currentB = auditSummary([
      { ...first, urls: [...first.urls].reverse() },
      { ...second, urls: [...second.urls].reverse() }
    ], { requestedUrls: [primaryUrl, secondUrl] });
    const baselineA = auditSummary([first, second], { requestedUrls: [primaryUrl, secondUrl] });
    const baselineB = auditSummary([
      { ...second, urls: [...second.urls].reverse() },
      { ...first, urls: [...first.urls].reverse() }
    ], { requestedUrls: [secondUrl, primaryUrl] });

    expect(JSON.stringify(compareAuditSummaries(currentA, baselineA))).toBe(
      JSON.stringify(compareAuditSummaries(currentB, baselineB))
    );
  });

  it('rejects incomplete legacy identities, malformed arrays, and duplicate identities', () => {
    const valid = finding('Valid legacy finding');
    expect(() => compareAuditFindings([], {
      findings: [{ classification: 'confirmed', severity: 'Serious', summary: 'Incomplete', urls: [primaryUrl] }]
    })).toThrow(/ruleId/);
    expect(() => compareAuditFindings([], { findings: [{ ...valid, wcag: ['4.1.2', 2] }] })).toThrow(/wcag/);
    expect(() => compareAuditFindings([], { findings: [{ ...valid, urls: [''] }] })).toThrow(/urls/);
    expect(() => compareAuditFindings([], { findings: [{ ...valid, componentName: 42 }] })).toThrow(/componentName/);
    expect(() => compareAuditFindings([], { findings: [valid, valid] })).toThrow(/duplicate finding fingerprint/);
  });

  it('does not claim resolution when a current audit is cancelled', () => {
    const oldFinding = finding('Previously observed finding');
    const comparison = compareAuditSummaries(
      auditSummary([], { status: 'cancelled', cancelledUrls: [primaryUrl] }),
      auditSummary([oldFinding])
    );
    expect(comparison.coverage).toBe('partial');
    expect(comparison.resolvedFindings).toEqual([]);
    expect(comparison.unobservedBaselineFindings.map((item) => item.summary)).toEqual(['Previously observed finding']);
  });

  it('does not claim resolution for omitted or partially observed current URLs', () => {
    const secondUrl = `${primaryUrl}second`;
    const oldFinding = finding('Second-page finding', { urls: [secondUrl] });
    const baseline = auditSummary([oldFinding], { requestedUrls: [primaryUrl, secondUrl] });
    const subset = auditSummary([], { requestedUrls: [primaryUrl], auditedUrls: [primaryUrl] });
    const partial = auditSummary([], {
      requestedUrls: [primaryUrl, secondUrl],
      auditedUrls: [primaryUrl, secondUrl],
      partialUrls: [secondUrl]
    });

    for (const current of [subset, partial]) {
      const comparison = compareAuditSummaries(current, baseline);
      expect(comparison.coverage).toBe('partial');
      expect(comparison.resolvedFindings).toEqual([]);
      expect(comparison.unobservedBaselineFindings.map((item) => item.summary)).toEqual(['Second-page finding']);
    }
  });

  it.each([
    ['an interaction blocker', { interactionBlocker: { selector: '#consent' } }],
    ['an incomplete axe run', { axeRun: { completed: false } }],
    ['a failed HTTP response', { status: 500 }]
  ])('does not claim resolution when a viewport has %s', (_label, viewportOverrides) => {
    const oldFinding = finding('Unobserved after failed viewport');
    const comparison = compareAuditSummaries(
      auditSummary([], { viewportOverrides }),
      auditSummary([oldFinding])
    );

    expect(comparison.coverage).toBe('partial');
    expect(comparison.resolvedFindings).toEqual([]);
    expect(comparison.unobservedBaselineFindings.map((item) => item.summary)).toEqual([
      'Unobserved after failed viewport'
    ]);
    expect(comparison.limitations).toContain(
      'Some current audit URLs were not completely observed, so unmatched baseline findings in that scope are not reported as resolved.'
    );
  });

  it('keeps a mobile-only baseline finding unobserved after a desktop-only current audit', () => {
    const mobileFinding = finding('Mobile-only baseline finding', { viewports: ['mobile'] });
    const comparison = compareAuditSummaries(
      auditSummary([], { viewportNames: ['desktop'] }),
      auditSummary([mobileFinding], { viewportNames: ['mobile'] })
    );

    expect(comparison.coverage).toBe('partial');
    expect(comparison.resolvedFindings).toEqual([]);
    expect(comparison.unobservedBaselineFindings.map((item) => item.summary)).toEqual([
      'Mobile-only baseline finding'
    ]);
    expect(comparison.limitations).toContain(
      'The current and baseline audits cover different requested viewport scopes.'
    );
  });

  it('does not call a mobile finding new when the baseline audited only desktop', () => {
    const mobileFinding = finding('Mobile finding with no mobile baseline', { viewports: ['mobile'] });
    const comparison = compareAuditSummaries(
      auditSummary([mobileFinding], { viewportNames: ['mobile'] }),
      auditSummary([], { viewportNames: ['desktop'] })
    );

    expect(comparison.coverage).toBe('partial');
    expect(comparison.newFindings).toEqual([]);
    expect(comparison.indeterminateCurrentFindings.map((item) => item.summary)).toEqual([
      'Mobile finding with no mobile baseline'
    ]);
  });

  it('compares findings when both audits completely cover the same multi-viewport scope', () => {
    const resolved = finding('Resolved across equivalent viewports', { viewports: ['mobile'] });
    const added = finding('New across equivalent viewports', { viewports: ['desktop'] });
    const comparison = compareAuditSummaries(
      auditSummary([added], { viewportNames: ['mobile', 'desktop'] }),
      auditSummary([resolved], { viewportNames: ['desktop', 'mobile'] })
    );

    expect(comparison.coverage).toBe('complete');
    expect(comparison.newFindings.map((item) => item.summary)).toEqual(['New across equivalent viewports']);
    expect(comparison.resolvedFindings.map((item) => item.summary)).toEqual([
      'Resolved across equivalent viewports'
    ]);
    expect(comparison.indeterminateCurrentFindings).toEqual([]);
    expect(comparison.unobservedBaselineFindings).toEqual([]);
  });

  it('can resolve a desktop finding when desktop succeeded but a sibling mobile viewport failed', () => {
    const desktopFinding = finding('Resolved desktop finding', { viewports: ['desktop'] });
    const comparison = compareAuditSummaries(
      auditSummary([], {
        viewportNames: ['desktop', 'mobile'],
        viewportOverridesByName: { mobile: { status: 500, axeRun: { completed: false } } }
      }),
      auditSummary([desktopFinding], { viewportNames: ['desktop', 'mobile'] })
    );

    expect(comparison.coverage).toBe('partial');
    expect(comparison.resolvedFindings.map((item) => item.summary)).toEqual(['Resolved desktop finding']);
    expect(comparison.unobservedBaselineFindings).toEqual([]);
  });

  it('can identify a desktop finding as new when desktop succeeded but baseline mobile failed', () => {
    const desktopFinding = finding('New desktop finding', { viewports: ['desktop'] });
    const comparison = compareAuditSummaries(
      auditSummary([desktopFinding], { viewportNames: ['desktop', 'mobile'] }),
      auditSummary([], {
        viewportNames: ['desktop', 'mobile'],
        viewportOverridesByName: { mobile: { status: 500, axeRun: { completed: false } } }
      })
    );

    expect(comparison.coverage).toBe('partial');
    expect(comparison.newFindings.map((item) => item.summary)).toEqual(['New desktop finding']);
    expect(comparison.indeterminateCurrentFindings).toEqual([]);
  });

  it('reports genuine resolutions only when both audits fully cover the same scope', () => {
    const oldFinding = finding('Resolved after complete audit');
    const comparison = compareAuditSummaries(auditSummary([]), auditSummary([oldFinding]));
    expect(comparison.coverage).toBe('complete');
    expect(comparison.resolvedFindings.map((item) => item.summary)).toEqual(['Resolved after complete audit']);
    expect(comparison.unobservedBaselineFindings).toEqual([]);
  });

  it('does not classify findings as new when the baseline did not completely observe their scope', () => {
    const currentFinding = finding('Cannot establish as new');
    const comparison = compareAuditSummaries(
      auditSummary([currentFinding]),
      auditSummary([], { partialUrls: [primaryUrl] })
    );
    expect(comparison.newFindings).toEqual([]);
    expect(comparison.indeterminateCurrentFindings.map((item) => item.summary)).toEqual(['Cannot establish as new']);
    expect(comparison.limitations).toContain(
      'Some baseline audit URLs were not completely observed, so unmatched current findings in that scope are not reported as new.'
    );
  });
});
