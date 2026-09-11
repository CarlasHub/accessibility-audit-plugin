import { describe, expect, it } from 'vitest';
import { buildCoverageMatrix } from '../src/audit/coverage.js';
import { findingsFromPage } from '../src/audit/findings.js';
import { REQUIRED_MANUAL_CHECKS } from '../src/audit/manual-checks.js';
import { consolidateFindings } from '../src/reporting/consolidate.js';
import type { PageAudit, ViewportAudit } from '../src/types.js';

function viewport(overrides: Partial<ViewportAudit> = {}): ViewportAudit {
  return {
    viewport: { name: 'desktop', width: 1280, height: 720 },
    url: 'https://contract.example/page',
    finalUrl: 'https://contract.example/page',
    status: 200,
    title: 'Classification contract',
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

function page(audit: ViewportAudit): PageAudit {
  return { url: audit.url, viewports: [audit] };
}

const cases: Array<{
  name: string;
  audit: ViewportAudit;
  expectedRule: string;
  expectedClassification: 'confirmed' | 'review' | 'blocker';
}> = [
  {
    name: 'completed WCAG-tagged axe violation',
    audit: viewport({
      axe: [{
        id: 'image-alt',
        impact: 'critical',
        tags: ['wcag2a', 'wcag111'],
        description: 'Ensure images have alternative text',
        help: 'Images must have alternative text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/image-alt',
        nodes: [{ html: '<img id="hero">', target: ['#hero'] }]
      }],
      axeRun: { completed: true, violationCount: 1, incompleteCount: 0, passCount: 0, passes: [] }
    }),
    expectedRule: 'axe-image-alt',
    expectedClassification: 'confirmed'
  },
  {
    name: 'best-practice axe result without a WCAG criterion',
    audit: viewport({
      axe: [{
        id: 'region',
        impact: 'moderate',
        tags: ['best-practice'],
        description: 'Ensure content is contained by landmarks',
        help: 'All page content should be contained by landmarks',
        helpUrl: 'https://dequeuniversity.com/rules/axe/region',
        nodes: [{ html: '<div id="content">Content</div>', target: ['#content'] }]
      }],
      axeRun: { completed: true, violationCount: 1, incompleteCount: 0, passCount: 0, passes: [] }
    }),
    expectedRule: 'axe-region',
    expectedClassification: 'review'
  },
  {
    name: 'exception-dependent target-size signal',
    audit: viewport({
      dom: {
        ...viewport().dom,
        smallTargets: [{
          selector: '#one', name: 'One', width: 12, height: 12, groupSelector: '.pager', inlineException: false,
          hitTested: true, spacingRisk: true,
          nearbyTargets: [{ selector: '#two', name: 'Two', width: 12, height: 12, centerDistance: 16 }]
        }]
      }
    }),
    expectedRule: 'target-size-review',
    expectedClassification: 'review'
  },
  {
    name: 'rendered interaction blocker',
    audit: viewport({
      interactionBlocker: { selector: '#backdrop', role: '', name: '', reason: 'A full-screen surface blocks the page.' },
      keyboard: { sequence: [], journeys: [], completedCycle: false, truncated: false, scope: 'unknown' }
    }),
    expectedRule: 'interaction-coverage-blocked',
    expectedClassification: 'blocker'
  }
];

describe('finding classification contract', () => {
  it.each(cases)('$name is $expectedClassification', ({ audit, expectedRule, expectedClassification }) => {
    const findings = findingsFromPage(page(audit));
    expect(findings.find((finding) => finding.ruleId === expectedRule)).toEqual(expect.objectContaining({
      classification: expectedClassification
    }));
  });

  it('retains incomplete axe evidence only as an inconclusive JSON/coverage result', () => {
    const audit = viewport({
      axe: [{
        id: 'aria-valid-attr-value',
        resultType: 'incomplete',
        impact: 'critical',
        tags: ['wcag2a', 'wcag412'],
        description: 'Ensure ARIA attribute values are valid',
        help: 'ARIA attributes must conform to valid values',
        helpUrl: 'https://dequeuniversity.com/rules/axe/aria-valid-attr-value',
        nodes: [{ html: '<div id="picker" role="combobox">', target: ['#picker'] }]
      }],
      axeRun: { completed: true, violationCount: 0, incompleteCount: 1, passCount: 0, passes: [] }
    });
    const findings = findingsFromPage(page(audit));
    const axeCoverage = buildCoverageMatrix([page(audit)], findings)[0]!.viewports[0]!.assessments
      .find((item) => item.area === 'automated-axe');

    expect(audit.axe).toHaveLength(1);
    expect(findings).toEqual([]);
    expect(axeCoverage?.status).toBe('tested-inconclusive');
  });

  it('classifies screen-reader and contextual judgment checks as manual work', () => {
    expect(REQUIRED_MANUAL_CHECKS).toContainEqual(expect.objectContaining({
      id: 'manual-wcag-4-1-3',
      classification: 'manual'
    }));
    const audit = viewport();
    const manualCoverage = buildCoverageMatrix([page(audit)], [])[0]!.viewports[0]!.assessments
      .find((item) => item.area === 'manual-assessment');
    expect(manualCoverage?.status).toBe('manual-review-required');
  });

  it('reports equivalent axe and DOM image-alt evidence as one unit', () => {
    const base = viewport();
    const audit = viewport({
      axe: [{
        id: 'image-alt',
        impact: 'critical',
        tags: ['wcag2a', 'wcag111'],
        description: 'Ensure images have alternative text',
        help: 'Images must have alternative text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/image-alt',
        nodes: [{ html: '<img id="hero">', target: ['#hero'] }]
      }],
      axeRun: { completed: true, violationCount: 1, incompleteCount: 0, passCount: 0, passes: [] },
      dom: {
        ...base.dom,
        missingAltImages: [{ selector: '#hero', html: '<img id="hero" src="/hero.jpg">' }]
      }
    });
    const findings = consolidateFindings(findingsFromPage(page(audit)));
    expect(findings.filter((finding) => ['axe-image-alt', 'image-missing-alt'].includes(finding.ruleId))).toHaveLength(1);
  });

  it('reports equivalent axe and DOM form-label evidence as one unit even when selectors differ', () => {
    const base = viewport();
    const html = '<select name="country"><option>UK</option></select>';
    const audit = viewport({
      axe: [{
        id: 'select-name',
        impact: 'critical',
        tags: ['wcag2a', 'wcag412'],
        description: 'Ensure select elements have an accessible name',
        help: 'Select element must have an accessible name',
        helpUrl: 'https://dequeuniversity.com/rules/axe/select-name',
        nodes: [{ html, target: ['select'] }]
      }],
      axeRun: { completed: true, violationCount: 1, incompleteCount: 0, passCount: 0, passes: [] },
      dom: {
        ...base.dom,
        emptyNamedControls: [{ selector: 'main > form > select', tag: 'select', html }],
        unlabeledFields: [{ selector: 'main > form > select', html }]
      }
    });
    const findings = consolidateFindings(findingsFromPage(page(audit)));
    expect(findings.filter((finding) => [
      'axe-select-name',
      'form-field-no-label',
      'interactive-control-no-name'
    ].includes(finding.ruleId))).toHaveLength(1);
  });
});
