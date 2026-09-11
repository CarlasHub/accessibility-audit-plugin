import { describe, expect, it } from 'vitest';
import { buildCoverageMatrix } from '../src/audit/coverage.js';
import type { Finding, ViewportAudit } from '../src/types.js';

function viewport(overrides: Partial<ViewportAudit> = {}): ViewportAudit {
  return {
    viewport: { name: 'desktop', width: 1440, height: 1000 },
    url: 'https://test.example/page',
    finalUrl: 'https://test.example/page',
    status: 200,
    title: 'Example page',
    axe: [],
    axeRun: {
      completed: true,
      violationCount: 0,
      incompleteCount: 0,
      passCount: 25,
      passes: [{ id: 'document-title', tags: ['wcag2a'], nodeCount: 1 }]
    },
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
    keyboard: { sequence: [], journeys: [], completedCycle: false, truncated: false, scope: 'unknown' },
    responsive: {
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
    consent: { found: false, dismissed: false, action: 'none', buttonName: '', surfaceSelector: '', frameUrl: '' },
    interactionBlocker: null,
    elementContexts: [],
    screenshot: '',
    elementScreenshots: [],
    errors: [],
    ...overrides
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    key: 'disclosure-state:menu',
    ruleId: 'disclosure-state-not-updated',
    classification: 'confirmed',
    severity: 'Serious',
    wcag: ['4.1.2'],
    summary: 'State mismatch',
    issue: 'Visible and exposed states differ.',
    impact: 'State is misleading.',
    testing: 'Activate and compare state.',
    remediation: 'Synchronize aria-expanded.',
    component: 'header menu',
    componentName: 'Open main menu button',
    urls: ['https://test.example/page'],
    viewports: ['desktop'],
    selectors: ['#menu'],
    evidence: [],
    assignment: 'Development',
    effort: 'Small',
    translationRequired: 'No',
    ...overrides
  };
}

describe('coverage matrix', () => {
  it('never turns incomplete manual areas into passes', () => {
    const coverage = buildCoverageMatrix([{ url: 'https://test.example/page', viewports: [viewport()] }], []);
    const assessments = coverage[0]!.viewports[0]!.assessments;
    expect(assessments.find((item) => item.area === 'page-title')?.status).toBe('tested-inconclusive');
    expect(assessments.find((item) => item.area === 'automated-axe')?.status).toBe('confirmed-passed');
    expect(assessments.find((item) => item.area === 'keyboard-only')?.status).toBe('tested-inconclusive');
    expect(assessments.find((item) => item.area === 'dynamic-content-and-status')?.status).toBe('not-tested');
    expect(assessments.find((item) => item.area === 'manual-assessment')?.status).toBe('manual-review-required');
  });

  it('does not treat an axe run containing incomplete results as a pass', () => {
    const inconclusive = viewport({
      axeRun: {
        completed: true,
        violationCount: 0,
        incompleteCount: 1,
        passCount: 24,
        passes: [{ id: 'document-title', tags: ['wcag2a'], nodeCount: 1 }]
      }
    });
    const coverage = buildCoverageMatrix([{ url: inconclusive.url, viewports: [inconclusive] }], []);
    expect(coverage[0]!.viewports[0]!.assessments.find((item) => item.area === 'automated-axe')?.status)
      .toBe('tested-inconclusive');
  });

  it('records when the link limit leaves rendered candidates untested', () => {
    const truncated = viewport({
      linkRun: {
        completed: true,
        candidateCount: 350,
        checkedCount: 200,
        truncated: true,
        scope: 'desktop-same-origin'
      }
    });
    const coverage = buildCoverageMatrix([{ url: truncated.url, viewports: [truncated] }], []);
    const links = coverage[0]!.viewports[0]!.assessments.find((item) => item.area === 'broken-or-misleading-links');
    expect(links).toEqual(expect.objectContaining({ status: 'tested-inconclusive' }));
    expect(links?.detail).toContain('Checked 200 of 350');
    expect(links?.detail).toContain('left candidates untested');
  });

  it('ties confirmed link and title failures to explicit finding evidence', () => {
    const audit = viewport({ title: '' });
    const coverage = buildCoverageMatrix(
      [{ url: audit.url, viewports: [audit] }],
      [
        finding({ key: 'title', ruleId: 'axe-document-title', wcag: ['2.4.2'] }),
        finding({ key: 'link', ruleId: 'link-broken-destination', wcag: ['2.4.4'] })
      ]
    );
    const assessments = coverage[0]!.viewports[0]!.assessments;
    expect(assessments.find((item) => item.area === 'page-title')).toEqual({
      area: 'page-title',
      status: 'confirmed-failed',
      detail: 'Confirmed finding(s): axe-document-title.'
    });
    expect(assessments.find((item) => item.area === 'broken-or-misleading-links')).toEqual({
      area: 'broken-or-misleading-links',
      status: 'confirmed-failed',
      detail: 'Confirmed finding(s): link-broken-destination.'
    });
  });

  it('marks the specific affected area failed without claiming complete coverage elsewhere', () => {
    const coverage = buildCoverageMatrix(
      [{ url: 'https://test.example/page', viewports: [viewport()] }],
      [finding()]
    );
    const assessments = coverage[0]!.viewports[0]!.assessments;
    expect(assessments.find((item) => item.area === 'names-roles-states-relationships')?.status).toBe('confirmed-failed');
    expect(assessments.find((item) => item.area === 'forms-errors-and-validation')?.status).toBe('tested-inconclusive');
  });

  it('records a blocking modal as inconclusive keyboard coverage', () => {
    const blocked = viewport({
      interactionBlocker: {
        selector: '#privacy-dialog',
        role: 'dialog',
        name: 'Privacy choices',
        reason: 'The modal remained open.'
      }
    });
    const coverage = buildCoverageMatrix([{ url: blocked.url, viewports: [blocked] }], []);
    const keyboard = coverage[0]!.viewports[0]!.assessments.find((item) => item.area === 'keyboard-only');
    expect(keyboard).toEqual(expect.objectContaining({ status: 'tested-inconclusive' }));
    expect(keyboard?.detail).toContain('#privacy-dialog');
  });

  it('never turns an audit blocker into a WCAG failure', () => {
    const blockedFinding = finding({ classification: 'blocker' });
    const coverage = buildCoverageMatrix(
      [{ url: 'https://test.example/page', viewports: [viewport()] }],
      [blockedFinding]
    );
    const namesAndRoles = coverage[0]!.viewports[0]!.assessments
      .find((item) => item.area === 'names-roles-states-relationships');

    expect(namesAndRoles?.status).toBe('tested-inconclusive');
    expect(namesAndRoles?.detail).not.toContain('Confirmed finding');
  });

  it('reports every area as not tested when the page cannot load', () => {
    const unavailable = viewport({ status: 503 });
    const assessments = buildCoverageMatrix(
      [{ url: unavailable.url, viewports: [unavailable] }],
      []
    )[0]!.viewports[0]!.assessments;

    expect(assessments).toHaveLength(19);
    expect(new Set(assessments.map((item) => item.area))).toHaveLength(19);
    expect(assessments.every((item) => item.status === 'not-tested')).toBe(true);
    expect(assessments.find((item) => item.area === 'viewport-render')?.detail).toContain('503');
  });
});
