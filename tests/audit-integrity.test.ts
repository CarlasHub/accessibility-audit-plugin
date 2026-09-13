import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertCanonicalAuditSummary,
  assertCollectionCompleteness,
  AUDIT_CHECK_IDS
} from '../src/audit/canonical-validation.js';
import { findingsFromPage } from '../src/audit/findings.js';
import { AUDIT_QUALITY_CONTRACT } from '../src/audit/quality-contract.js';
import { assertLosslessConsolidation, consolidateFindings } from '../src/reporting/consolidate.js';
import { assignFindingIds } from '../src/reporting/finding-id.js';
import { writeJsonReport } from '../src/reporting/json.js';
import type { AuditSummary, CollectionOutcome, PageAudit, ViewportAudit } from '../src/types.js';

function viewport(overrides: Partial<ViewportAudit> = {}): ViewportAudit {
  return {
    viewport: { name: 'desktop', width: 1200, height: 800 },
    url: 'https://fixture.example/page#state',
    finalUrl: 'https://fixture.example/page#state',
    status: 200,
    title: 'Controlled fixture',
    axe: [],
    axeRun: { completed: true, violationCount: 0, incompleteCount: 0, passCount: 0, passes: [] },
    dom: {
      h1Count: 1,
      mainCount: 1,
      unnamedLandmarks: [],
      missingAltImages: [],
      linkedImagesForReview: [],
      emptyLinks: [],
      emptyNamedControls: [],
      unlabeledFields: [],
      duplicateIds: [],
      smallTargets: [],
      tablesForReview: [],
      autoplayMedia: []
    },
    keyboard: { sequence: [], journeys: [], completedCycle: true, truncated: false, scope: 'document' },
    responsive: {
      completed: true,
      horizontalOverflow: 0,
      overflowElements: [],
      textSpacingOverflow: 0,
      clippedElements: [],
      overlapPairs: [],
      lostInteractiveElements: []
    },
    disclosures: [],
    tabs: [],
    links: [],
    linkRun: { completed: true, candidateCount: 0, checkedCount: 0, truncated: false, scope: 'desktop-same-origin' },
    consent: {
      found: false,
      dismissed: false,
      action: 'none',
      buttonName: '',
      surfaceSelector: '',
      frameUrl: ''
    },
    interactionBlocker: null,
    elementContexts: [],
    screenshot: '',
    elementScreenshots: [],
    errors: [],
    ...overrides
  };
}

function page(audit: ViewportAudit): PageAudit {
  return { url: audit.url, viewports: [audit] };
}

function strictOutcomes(domObservations = 1): CollectionOutcome[] {
  return AUDIT_CHECK_IDS.map((checkId) => checkId === 'dom'
    ? { checkId, status: 'completed', observationCount: domObservations }
    : { checkId, status: 'not-applicable', observationCount: 0 });
}

function strictSummary(audit: ViewportAudit): AuditSummary {
  return {
    status: 'completed',
    generatedAt: '2026-09-13T12:00:00.000Z',
    auditor: 'Integrity gate',
    source: 'controlled fixture',
    wcagLevel: 'AA',
    conformanceTarget: 'AA',
    humanAssessmentRequired: true,
    conformanceDecision: 'not-determined',
    qualityContract: { ...AUDIT_QUALITY_CONTRACT },
    landingPageUrl: audit.url,
    requestedUrls: [audit.url],
    auditedUrls: [audit.url],
    skippedUrls: [],
    pages: [page(audit)],
    coverage: [],
    findings: assignFindingIds(findingsFromPage(page(audit))),
    manualChecks: [],
    limitations: []
  };
}

function normalizeFixtureFindings(audit: ViewportAudit) {
  return findingsFromPage(page(audit)).map((finding) => ({
    ruleId: finding.ruleId,
    classification: finding.classification,
    severity: finding.severity,
    wcag: finding.wcag,
    selectors: finding.selectors,
    evidence: finding.evidence.map((item) => item.detail)
  }));
}

describe('controlled defect, mutation, and metamorphic gates', () => {
  it('returns the exact expected missing-alt failure and only while the defect exists', () => {
    const defective = viewport({
      dom: {
        ...viewport().dom,
        missingAltImages: [{ selector: '#hero', html: '<img id="hero" src="hero.jpg">' }]
      }
    });
    const expected = [{
      ruleId: 'image-missing-alt',
      classification: 'confirmed',
      severity: 'Serious',
      wcag: ['1.1.1'],
      selectors: ['#hero'],
      evidence: ['<img id="hero" src="hero.jpg">']
    }];

    expect(normalizeFixtureFindings(defective)).toEqual(expected);
    expect(normalizeFixtureFindings(defective)).toEqual(expected);
    expect(normalizeFixtureFindings(viewport())).toEqual([]);
    expect(normalizeFixtureFindings({ ...defective, title: 'Neutral text mutation' })).toEqual(expected);
  });

  it('is order-independent and preserves duplicate and near-duplicate evidence occurrences', () => {
    const audit = viewport({
      dom: {
        ...viewport().dom,
        missingAltImages: [{ selector: '#hero', html: '<img id="hero" src="hero.jpg">' }]
      }
    });
    const [finding] = findingsFromPage(page(audit));
    expect(finding).toBeDefined();
    const duplicate = structuredClone(finding!);
    const nearDuplicate = structuredClone(finding!);
    nearDuplicate.evidence[0]!.detail = '<img id="hero" src="hero-2.jpg">';
    nearDuplicate.evidence[0]!.provenance!.observed = nearDuplicate.evidence[0]!.detail;
    nearDuplicate.evidence[0]!.provenance!.observationId = 'near-duplicate-observation';
    const forward = consolidateFindings([finding!, duplicate, nearDuplicate]);
    const reverse = consolidateFindings([nearDuplicate, duplicate, finding!]);

    expect(forward).toEqual(reverse);
    expect(forward).toHaveLength(1);
    expect(forward[0]?.evidence).toHaveLength(3);
    expect(() => assertLosslessConsolidation([finding!, duplicate, nearDuplicate], forward)).not.toThrow();
  });
});

describe('canonical-result and renderer integrity gates', () => {
  it('rejects incomplete collection before classification', () => {
    const complete = page(viewport({ collectionOutcomes: strictOutcomes() }));
    expect(() => assertCollectionCompleteness([complete])).not.toThrow();

    const missingCollector = structuredClone(complete);
    missingCollector.viewports[0]!.collectionOutcomes!.pop();
    expect(() => assertCollectionCompleteness([missingCollector])).toThrow(/exactly one outcome/);

    const unfinished = structuredClone(complete);
    unfinished.viewports[0]!.collectionOutcomes![0] = {
      checkId: 'navigation', status: 'not-run', observationCount: 0
    };
    expect(() => assertCollectionCompleteness([unfinished])).toThrow(/still not-run/);
  });

  it('accepts a traceable result and rejects fabricated collector observations', () => {
    const audit = viewport({
      collectionOutcomes: strictOutcomes(),
      dom: {
        ...viewport().dom,
        missingAltImages: [{ selector: '#hero', html: '<img id="hero" src="hero.jpg">' }]
      }
    });
    const summary = strictSummary(audit);
    expect(() => assertCanonicalAuditSummary(summary)).not.toThrow();

    const missingProvenance = structuredClone(summary);
    delete missingProvenance.findings[0]!.evidence[0]!.provenance;
    expect(() => assertCanonicalAuditSummary(missingProvenance)).toThrow(/has no provenance/);

    const fabricatedObservation = strictSummary({ ...audit, collectionOutcomes: strictOutcomes(0) });
    expect(() => assertCanonicalAuditSummary(fabricatedObservation)).toThrow(/recorded no observations/);
  });

  it('rejects incomplete journey evidence and regression data presented as conformance evidence', () => {
    const audit = viewport({
      collectionOutcomes: strictOutcomes(),
      keyboard: {
        sequence: [],
        completedCycle: true,
        truncated: false,
        scope: 'document',
        journeys: [{
          id: 'checkout',
          title: 'Complete checkout',
          status: 'failed',
          steps: ['Focus checkout'],
          detail: 'Focus did not move.',
          source: 'configured',
          failureStep: 1
        }]
      }
    });
    expect(() => assertCanonicalAuditSummary(strictSummary(audit))).toThrow(/has no structured step results/);

    const invalidRegression = strictSummary(viewport({ collectionOutcomes: strictOutcomes() }));
    invalidRegression.regressionSummary = {
      kind: 'software-quality-regression',
      conformanceEvidence: true as false,
      fixtureCount: 1,
      expectedFindingCount: 1,
      exactMatch: true,
      deterministic: true,
      generatedBy: 'test'
    };
    expect(() => assertCanonicalAuditSummary(invalidRegression)).toThrow(/conformance evidence/);
  });

  it('prevents a renderer from serialising a non-canonical result', async () => {
    const audit = viewport({
      collectionOutcomes: strictOutcomes(),
      dom: {
        ...viewport().dom,
        missingAltImages: [{ selector: '#hero', html: '<img id="hero" src="hero.jpg">' }]
      }
    });
    const invalid = strictSummary(audit);
    delete invalid.findings[0]!.evidence[0]!.provenance;
    const outputDir = await mkdtemp(join(tmpdir(), 'audit-integrity-'));
    await expect(writeJsonReport(invalid, join(outputDir, 'report.json'))).rejects.toThrow(/has no provenance/);
  });
});
