import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compareAuditSummaries, safeBaselineSource } from './comparison.js';
import type {
  AuditComparison,
  AuditHistory,
  AuditHistoryDelta,
  AuditHistoryPoint,
  AuditSummary,
  Finding
} from './types.js';

const maximumHistoryFiles = 50;

function effectiveBrowserEngine(summary: Pick<AuditSummary, 'browserEngine'>): NonNullable<AuditSummary['browserEngine']> {
  const value: unknown = summary.browserEngine;
  if (value === undefined) return 'chromium';
  if (value === 'chromium' || value === 'firefox' || value === 'webkit') return value;
  throw new Error('Audit summary has an invalid browserEngine field.');
}

interface LoadedHistorySummary {
  source: string;
  path: string;
  summary: AuditSummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validGeneratedAt(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && Number.isFinite(Date.parse(value));
}

function validateHistorySummary(current: AuditSummary, value: unknown, source: string): AuditSummary {
  if (!isRecord(value)) {
    throw new Error(`History audit ${source} must be a CarlasHub audit JSON object.`);
  }
  if (!validGeneratedAt(value.generatedAt)) {
    throw new Error(`History audit ${source} has an invalid generatedAt field.`);
  }
  if (value.status !== 'completed' && value.status !== 'cancelled') {
    throw new Error(`History audit ${source} has an invalid status field.`);
  }
  try {
    compareAuditSummaries(current, value, source);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'the report is invalid';
    throw new Error(`History audit ${source} is invalid: ${message}`);
  }
  return value as unknown as AuditSummary;
}

async function loadHistorySummary(current: AuditSummary, historyPath: string): Promise<LoadedHistorySummary> {
  const path = resolve(historyPath);
  const source = safeBaselineSource(historyPath);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof SyntaxError ? 'the file is not valid JSON' : 'the file could not be read';
    throw new Error(`Could not load history audit JSON ${source}: ${message}.`);
  }
  return { path, source, summary: validateHistorySummary(current, value, source) };
}

function delta(comparison: AuditComparison): AuditHistoryDelta {
  return {
    coverage: comparison.coverage,
    newCount: comparison.newFindings.length,
    unchangedCount: comparison.unchangedFindings.length,
    resolvedCount: comparison.resolvedFindings.length,
    indeterminateCurrentCount: comparison.indeterminateCurrentFindings.length,
    unobservedPreviousCount: comparison.unobservedBaselineFindings.length
  };
}

function point(summary: AuditSummary, source: string, comparison?: AuditComparison): AuditHistoryPoint {
  const findings = summary.findings as Finding[];
  return {
    source,
    browserEngine: effectiveBrowserEngine(summary),
    generatedAt: summary.generatedAt,
    status: summary.status,
    requestedPageCount: summary.requestedUrls.length,
    auditedPageCount: summary.auditedUrls.length,
    findingCount: findings.length,
    confirmedCount: findings.filter((finding) => finding.classification === 'confirmed').length,
    reviewCount: findings.filter((finding) => finding.classification === 'review').length,
    blockerCount: findings.filter((finding) => finding.classification === 'blocker').length,
    manualCount: findings.filter((finding) => finding.classification === 'manual').length,
    criticalConfirmedCount: findings.filter((finding) => (
      finding.classification === 'confirmed' && finding.severity === 'Critical'
    )).length,
    seriousConfirmedCount: findings.filter((finding) => (
      finding.classification === 'confirmed' && finding.severity === 'Serious'
    )).length,
    ...(comparison ? { comparisonToPrevious: delta(comparison) } : {})
  };
}

export async function createAuditHistory(
  current: AuditSummary,
  historyPaths: string[]
): Promise<AuditHistory> {
  if (historyPaths.length === 0) {
    throw new Error('Audit history requires at least one prior audit JSON path.');
  }
  if (historyPaths.length > maximumHistoryFiles) {
    throw new Error(`Audit history accepts at most ${maximumHistoryFiles} prior audit JSON files.`);
  }

  const loaded = await Promise.all(historyPaths.map((historyPath) => loadHistorySummary(current, historyPath)));
  const duplicatePath = loaded.find((entry, index) => loaded.findIndex((other) => other.path === entry.path) !== index);
  if (duplicatePath) throw new Error(`History audit ${duplicatePath.source} was supplied more than once.`);
  const duplicateSource = loaded.find((entry, index) => loaded.findIndex((other) => other.source === entry.source) !== index);
  if (duplicateSource) {
    throw new Error(`History audit filename ${duplicateSource.source} is ambiguous; use unique filenames.`);
  }

  const currentTime = Date.parse(current.generatedAt);
  if (!Number.isFinite(currentTime)) throw new Error('Current audit has an invalid generatedAt field.');
  for (const entry of loaded) {
    if (Date.parse(entry.summary.generatedAt) > currentTime) {
      throw new Error(`History audit ${entry.source} is newer than the current audit.`);
    }
  }

  loaded.sort((left, right) => (
    Date.parse(left.summary.generatedAt) - Date.parse(right.summary.generatedAt)
      || left.source.localeCompare(right.source)
  ));
  const ordered = [
    ...loaded,
    { source: 'Current audit', path: '', summary: current }
  ];
  const points: AuditHistoryPoint[] = [];
  const limitations: string[] = [];
  ordered.forEach((entry, index) => {
    if (index === 0) {
      points.push(point(entry.summary, entry.source));
      return;
    }
    const previous = ordered[index - 1];
    if (!previous) return;
    const comparison = compareAuditSummaries(entry.summary, previous.summary, previous.source);
    points.push(point(entry.summary, entry.source, comparison));
    if (comparison.coverage === 'partial') {
      const previousBrowserEngine = effectiveBrowserEngine(previous.summary);
      const currentBrowserEngine = effectiveBrowserEngine(entry.summary);
      const browserEngineChanged = previousBrowserEngine !== currentBrowserEngine;
      limitations.push(
        browserEngineChanged
          ? `The trend from ${previous.source} to ${entry.source} is partial because the browser engine changed from ${previousBrowserEngine} to ${currentBrowserEngine}; unmatched findings are not claimed as new or resolved.`
          : `The trend from ${previous.source} to ${entry.source} is partial; unmatched findings outside equivalently observed browser, URL, and viewport scope are not claimed as new or resolved.`
      );
    }
  });

  return { kind: 'audit-history', points, limitations };
}
