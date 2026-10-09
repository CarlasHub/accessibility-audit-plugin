import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AuditComparison, AuditSummary, Finding, FindingComparisonRecord } from './types.js';
import { findingFingerprint } from './reporting/finding-id.js';

const fingerprintPattern = /^a11y-fp-v[1-9][0-9]*:[a-f0-9]{64}$/;
const classifications = new Set(['confirmed', 'review', 'blocker', 'manual']);
const severities = new Set(['Critical', 'Serious', 'Moderate', 'Minor', 'Advisory']);

function effectiveBrowserEngine(
  value: unknown,
  auditLabel: 'Current audit' | 'Baseline audit'
): NonNullable<AuditSummary['browserEngine']> {
  if (value === undefined) return 'chromium';
  if (value === 'chromium' || value === 'firefox' || value === 'webkit') return value;
  throw new Error(`${auditLabel} has an invalid browserEngine field.`);
}

interface AuditScope {
  requestedUrls: Set<string>;
  requestedViewportsByUrl: Map<string, Set<string>>;
  successfullyAuditedViewportsByUrl: Map<string, Set<string>>;
  incompleteUrls: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Baseline finding ${index + 1} has an invalid ${field} field.`);
  }
  return value;
}

function optionalString(value: unknown, field: string, index: number): void {
  if (value !== undefined) requiredString(value, field, index);
}

function canonicalStringArray(value: unknown, field: string, index: number): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Baseline finding ${index + 1} has an invalid ${field} field.`);
  }
  return [...new Set(value)].sort((left, right) => left.localeCompare(right));
}

function legacyFingerprint(value: Record<string, unknown>, index: number): string {
  requiredString(value.ruleId, 'ruleId', index);
  requiredString(value.component, 'component', index);
  requiredString(value.issue, 'issue', index);
  requiredString(value.remediation, 'remediation', index);
  canonicalStringArray(value.wcag, 'wcag', index);
  canonicalStringArray(value.urls, 'urls', index);
  optionalString(value.sharedComponentKey, 'sharedComponentKey', index);
  optionalString(value.componentName, 'componentName', index);
  optionalString(value.componentLocation, 'componentLocation', index);
  return findingFingerprint(value as unknown as Finding);
}

function fingerprintFor(value: Record<string, unknown>, index: number): string {
  if (value.fingerprint === undefined) return legacyFingerprint(value, index);
  const fingerprint = requiredString(value.fingerprint, 'fingerprint', index);
  if (!fingerprintPattern.test(fingerprint)) {
    throw new Error(`Baseline finding ${index + 1} has an unsupported fingerprint.`);
  }
  return fingerprint;
}

function comparisonRecord(value: unknown, index: number): FindingComparisonRecord {
  if (!isRecord(value)) throw new Error(`Baseline finding ${index + 1} must be an object.`);
  const classification = requiredString(value.classification, 'classification', index);
  const severity = requiredString(value.severity, 'severity', index);
  if (!classifications.has(classification)) {
    throw new Error(`Baseline finding ${index + 1} has an unsupported classification.`);
  }
  if (!severities.has(severity)) {
    throw new Error(`Baseline finding ${index + 1} has an unsupported severity.`);
  }
  const urls = canonicalStringArray(value.urls, 'urls', index);
  if (urls.length === 0) throw new Error(`Baseline finding ${index + 1} has an invalid urls field.`);
  const viewports = value.viewports === undefined
    ? []
    : canonicalStringArray(value.viewports, 'viewports', index);
  return {
    fingerprint: fingerprintFor(value, index),
    ...(typeof value.id === 'string' && value.id ? { id: value.id } : {}),
    classification: classification as Finding['classification'],
    severity: severity as Finding['severity'],
    summary: requiredString(value.summary, 'summary', index),
    urls,
    viewports
  };
}

function findingRecord(finding: Finding): FindingComparisonRecord {
  return {
    fingerprint: finding.fingerprint ?? findingFingerprint(finding),
    ...(finding.id ? { id: finding.id } : {}),
    classification: finding.classification,
    severity: finding.severity,
    summary: finding.summary,
    urls: [...new Set(finding.urls)].sort((left, right) => left.localeCompare(right)),
    viewports: [...new Set(finding.viewports)].sort((left, right) => left.localeCompare(right))
  };
}

function uniqueRecords(records: FindingComparisonRecord[], source: string): Map<string, FindingComparisonRecord> {
  const unique = new Map<string, FindingComparisonRecord>();
  for (const record of records) {
    if (unique.has(record.fingerprint)) {
      throw new Error(`${source} contains duplicate finding fingerprint ${record.fingerprint}.`);
    }
    unique.set(record.fingerprint, record);
  }
  return unique;
}

function derivedScope(records: FindingComparisonRecord[]): AuditScope {
  const urls = new Set(records.flatMap((record) => record.urls));
  const viewportsByUrl = new Map<string, Set<string>>();
  for (const record of records) {
    for (const url of record.urls) {
      const viewports = viewportsByUrl.get(url) ?? new Set<string>();
      record.viewports.forEach((viewport) => viewports.add(viewport));
      viewportsByUrl.set(url, viewports);
    }
  }
  return {
    requestedUrls: urls,
    requestedViewportsByUrl: viewportsByUrl,
    successfullyAuditedViewportsByUrl: new Map(
      [...viewportsByUrl].map(([url, viewports]) => [url, new Set(viewports)])
    ),
    incompleteUrls: new Set()
  };
}

function viewportName(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.viewport === 'string' && value.viewport.trim()) return value.viewport;
  if (isRecord(value.viewport) && typeof value.viewport.name === 'string' && value.viewport.name.trim()) {
    return value.viewport.name;
  }
  return undefined;
}

function viewportWasSuccessfullyAudited(value: unknown): boolean {
  if (!isRecord(value) || value.cancelled === true || value.partial === true) return false;
  if (value.interactionBlocker !== undefined && value.interactionBlocker !== null) return false;
  if (!isRecord(value.axeRun) || value.axeRun.completed !== true) return false;
  const statusSucceeded = typeof value.status === 'number'
    && Number.isFinite(value.status)
    && value.status < 400;
  const localDocumentSucceeded = typeof value.finalUrl === 'string' && /^(?:data|file):/iu.test(value.finalUrl);
  return statusSucceeded || localDocumentSucceeded;
}

function summaryScope(value: Record<string, unknown>, label: string): AuditScope | undefined {
  const scopeFields = ['status', 'requestedUrls', 'auditedUrls', 'pages'];
  if (!scopeFields.some((field) => field in value)) return undefined;
  if (value.status !== 'completed' && value.status !== 'cancelled') {
    throw new Error(`${label} has an invalid status field.`);
  }
  if (!Array.isArray(value.requestedUrls) || value.requestedUrls.some((url) => typeof url !== 'string' || !url.trim())) {
    throw new Error(`${label} has an invalid requestedUrls field.`);
  }
  if (!Array.isArray(value.auditedUrls) || value.auditedUrls.some((url) => typeof url !== 'string' || !url.trim())) {
    throw new Error(`${label} has an invalid auditedUrls field.`);
  }
  if (!Array.isArray(value.pages) || value.pages.some((page) => !isRecord(page))) {
    throw new Error(`${label} has an invalid pages field.`);
  }
  const auditedUrls = new Set(value.auditedUrls);
  const requestedViewportsByUrl = new Map<string, Set<string>>();
  const successfullyAuditedViewportsByUrl = new Map<string, Set<string>>();
  const incompleteUrls = new Set<string>();
  for (const pageValue of value.pages) {
    const page = pageValue as Record<string, unknown>;
    if (typeof page.url !== 'string' || !page.url.trim() || !Array.isArray(page.viewports)) {
      throw new Error(`${label} contains invalid page coverage metadata.`);
    }
    const viewportNames = page.viewports.map(viewportName);
    requestedViewportsByUrl.set(page.url, new Set(viewportNames.filter((name): name is string => Boolean(name))));
    const successfulViewports = new Set<string>();
    if (auditedUrls.has(page.url)) {
      page.viewports.forEach((viewport, index) => {
        const name = viewportNames[index];
        if (name !== undefined && viewportWasSuccessfullyAudited(viewport)) successfulViewports.add(name);
      });
    }
    successfullyAuditedViewportsByUrl.set(page.url, successfulViewports);
    if (page.partial === true
      || page.viewports.length === 0
      || viewportNames.some((name) => name === undefined)
      || successfulViewports.size !== page.viewports.length) incompleteUrls.add(page.url);
  }
  return {
    requestedUrls: new Set(value.requestedUrls),
    requestedViewportsByUrl,
    successfullyAuditedViewportsByUrl,
    incompleteUrls
  };
}

function sameValues(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function scopeCovers(scope: AuditScope, record: FindingComparisonRecord): boolean {
  return record.viewports.length > 0 && record.urls.every((url) => {
    const successfulViewports = scope.successfullyAuditedViewportsByUrl.get(url);
    return successfulViewports !== undefined
      && record.viewports.every((viewport) => successfulViewports.has(viewport));
  });
}

function scopeIsComplete(scope: AuditScope): boolean {
  return [...scope.requestedUrls].every((url) => {
    const requestedViewports = scope.requestedViewportsByUrl.get(url);
    const successfulViewports = scope.successfullyAuditedViewportsByUrl.get(url);
    return !scope.incompleteUrls.has(url)
      && requestedViewports !== undefined
      && requestedViewports.size > 0
      && successfulViewports !== undefined
      && sameValues(requestedViewports, successfulViewports);
  });
}

function sameViewportScope(left: AuditScope, right: AuditScope): boolean {
  return sameValues(left.requestedUrls, right.requestedUrls)
    && [...left.requestedUrls].every((url) => sameValues(
      left.requestedViewportsByUrl.get(url) ?? new Set(),
      right.requestedViewportsByUrl.get(url) ?? new Set()
    ));
}

function compareRecords(
  currentRecords: FindingComparisonRecord[],
  baselineRecords: FindingComparisonRecord[],
  currentScope: AuditScope,
  baselineScope: AuditScope,
  baseline: Record<string, unknown>,
  baselineSource: string,
  currentBrowserEngine?: AuditSummary['browserEngine']
): AuditComparison {
  const baselineByFingerprint = uniqueRecords(baselineRecords, 'Baseline audit');
  const currentByFingerprint = uniqueRecords(currentRecords, 'Current audit');
  const byFingerprint = (left: FindingComparisonRecord, right: FindingComparisonRecord): number => (
    left.fingerprint.localeCompare(right.fingerprint)
  );
  const unmatchedCurrent = currentRecords.filter((record) => !baselineByFingerprint.has(record.fingerprint));
  const unmatchedBaseline = baselineRecords.filter((record) => !currentByFingerprint.has(record.fingerprint));
  const baselineBrowserEngine = effectiveBrowserEngine(baseline.browserEngine, 'Baseline audit');
  const effectiveCurrentBrowserEngine = effectiveBrowserEngine(currentBrowserEngine, 'Current audit');
  const equivalentBrowserEngine = effectiveCurrentBrowserEngine === baselineBrowserEngine;
  const newFindings = equivalentBrowserEngine
    ? unmatchedCurrent.filter((record) => scopeCovers(baselineScope, record)).sort(byFingerprint)
    : [];
  const indeterminateCurrentFindings = unmatchedCurrent
    .filter((record) => !equivalentBrowserEngine || !scopeCovers(baselineScope, record))
    .sort(byFingerprint);
  const resolvedFindings = equivalentBrowserEngine
    ? unmatchedBaseline.filter((record) => scopeCovers(currentScope, record)).sort(byFingerprint)
    : [];
  const unobservedBaselineFindings = unmatchedBaseline
    .filter((record) => !equivalentBrowserEngine || !scopeCovers(currentScope, record))
    .sort(byFingerprint);
  const currentScopeComplete = scopeIsComplete(currentScope);
  const baselineScopeComplete = scopeIsComplete(baselineScope);
  const equivalentUrlScope = sameValues(currentScope.requestedUrls, baselineScope.requestedUrls);
  const equivalentScope = sameViewportScope(currentScope, baselineScope);
  const coverage = equivalentBrowserEngine && currentScopeComplete && baselineScopeComplete && equivalentScope ? 'complete' : 'partial';
  const limitations = [
    ...(!equivalentUrlScope ? ['The current and baseline audits cover different requested URL scopes.'] : []),
    ...(equivalentUrlScope && !equivalentScope
      ? ['The current and baseline audits cover different requested viewport scopes.']
      : []),
    ...(!equivalentBrowserEngine
      ? [`The current and baseline audits used different browser engines (${effectiveCurrentBrowserEngine} and ${baselineBrowserEngine}), so unmatched findings are not claimed as new or resolved.`]
      : []),
    ...(!currentScopeComplete ? ['Some current audit URLs were not completely observed, so unmatched baseline findings in that scope are not reported as resolved.'] : []),
    ...(!baselineScopeComplete ? ['Some baseline audit URLs were not completely observed, so unmatched current findings in that scope are not reported as new.'] : [])
  ];

  return {
    kind: 'baseline-comparison',
    coverage,
    baselineSource,
    ...(typeof baseline.generatedAt === 'string' && baseline.generatedAt
      ? { baselineGeneratedAt: baseline.generatedAt }
      : {}),
    baselineFindingCount: baselineRecords.length,
    currentFindingCount: currentRecords.length,
    newFindings,
    unchangedFindings: currentRecords
      .filter((record) => baselineByFingerprint.has(record.fingerprint))
      .sort(byFingerprint),
    resolvedFindings,
    indeterminateCurrentFindings,
    unobservedBaselineFindings,
    limitations
  };
}

export function compareAuditFindings(
  currentFindings: Finding[],
  baseline: unknown,
  baselineSource = 'baseline audit'
): AuditComparison {
  if (!isRecord(baseline) || !Array.isArray(baseline.findings)) {
    throw new Error('Baseline must be a CarlasHub audit JSON object with a findings array.');
  }
  const baselineRecords = baseline.findings.map(comparisonRecord);
  const currentRecords = currentFindings.map(findingRecord);
  return compareRecords(
    currentRecords,
    baselineRecords,
    derivedScope(currentRecords),
    summaryScope(baseline, 'Baseline audit') ?? derivedScope(baselineRecords),
    baseline,
    baselineSource
  );
}

export function compareAuditSummaries(
  current: AuditSummary,
  baseline: unknown,
  baselineSource = 'baseline audit'
): AuditComparison {
  if (!isRecord(baseline) || !Array.isArray(baseline.findings)) {
    throw new Error('Baseline must be a CarlasHub audit JSON object with a findings array.');
  }
  const baselineRecords = baseline.findings.map(comparisonRecord);
  const currentRecords = current.findings.map(findingRecord);
  return compareRecords(
    currentRecords,
    baselineRecords,
    summaryScope(current as unknown as Record<string, unknown>, 'Current audit') ?? derivedScope(currentRecords),
    summaryScope(baseline, 'Baseline audit') ?? derivedScope(baselineRecords),
    baseline,
    baselineSource,
    current.browserEngine
  );
}

export function safeBaselineSource(value: string): string {
  const stripControlCharacters = (input: string): string => [...input].filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 31 && codePoint !== 127;
  }).join('');
  const decodeEscapes = (input: string): string => {
    try {
      return decodeURIComponent(input);
    } catch {
      return input.replace(/(?:%[0-9a-f]{2})+/giu, (encoded) => {
        try {
          return decodeURIComponent(encoded);
        } catch {
          return encoded.replace(/%(25|2f|5c|3f|23|00|0a|0d)/giu, (_match, hex: string) => (
            String.fromCodePoint(Number.parseInt(hex, 16))
          ));
        }
      });
    }
  };
  let decoded = stripControlCharacters(value);
  for (let pass = 0; pass < 5; pass += 1) {
    const next = decodeEscapes(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  const normalized = stripControlCharacters(decoded).replaceAll('\\', '/');
  const withoutSuffix = normalized.split(/[?#]/u, 1)[0] ?? '';
  const candidate = withoutSuffix.split('/').filter(Boolean).at(-1) ?? '';
  const safe = stripControlCharacters(candidate).replace(/[/\\]/g, '').trim();
  return safe && safe !== '.' && safe !== '..' ? safe : 'baseline.json';
}

export async function compareAuditWithBaseline(
  current: AuditSummary,
  baselinePath: string
): Promise<AuditComparison> {
  const path = resolve(baselinePath);
  const source = safeBaselineSource(baselinePath);
  let baseline: unknown;
  try {
    baseline = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof SyntaxError ? 'the file is not valid JSON' : 'the file could not be read';
    throw new Error(`Could not load baseline audit JSON ${source}: ${message}.`);
  }
  return compareAuditSummaries(current, baseline, source);
}
