import { describe, expect, it } from 'vitest';
import { findingsFromPage } from '../src/audit/findings.js';
import type { PageAudit, ViewportAudit } from '../src/types.js';

function viewport(overrides: Partial<ViewportAudit> = {}): ViewportAudit {
  return {
    viewport: { name: 'desktop', width: 1200, height: 800 },
    url: 'https://test.example/page',
    finalUrl: 'https://test.example/page',
    status: 200,
    title: 'Test',
    axe: [],
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
    keyboard: { sequence: [] },
    responsive: { horizontalOverflow: 0, overflowElements: [], textSpacingOverflow: 0 },
    disclosures: [],
    tabs: [],
    links: [],
    screenshot: '/tmp/page.png',
    elementScreenshots: [],
    errors: [],
    ...overrides
  };
}

function page(audit: ViewportAudit): PageAudit {
  return { url: audit.url, viewports: [audit] };
}

describe('evidence-gated link and tab findings', () => {
  it('keeps axe best-practice signals in review when they have no WCAG criterion tag', () => {
    const findings = findingsFromPage(page(viewport({
      axe: [{
        id: 'region',
        impact: 'moderate',
        tags: ['best-practice'],
        description: 'Ensure content is contained by landmarks',
        help: 'All page content should be contained by landmarks',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/region',
        nodes: [
          {
            html: '<div>Content</div>',
            target: ['#content'],
            failureSummary: 'Some page content is not contained by landmarks'
          },
          {
            html: '<aside>Related</aside>',
            target: ['#related'],
            failureSummary: 'Some page content is not contained by landmarks'
          }
        ]
      }]
    })));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.classification).toBe('review');
    expect(findings[0]?.wcag).toEqual(['Best Practice']);
    expect(findings[0]?.component).toBe('page structure');
    expect(findings[0]?.selectors).toEqual(['#content', '#related']);
    expect(findings[0]?.evidence.every((item) => !item.screenshot)).toBe(true);
  });

  it('does not duplicate axe unnamed-link and unnamed-control findings from DOM heuristics', () => {
    const findings = findingsFromPage(page(viewport({
      axe: [
        {
          id: 'link-name',
          impact: 'serious',
          tags: ['wcag2a', 'wcag244'],
          description: 'Ensure links have discernible text',
          help: 'Links must have discernible text',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/link-name',
          nodes: [{ html: '<a href="#"><br></a>', target: ['a[href="#"]'] }]
        },
        {
          id: 'aria-command-name',
          impact: 'serious',
          tags: ['wcag2a', 'wcag412'],
          description: 'Ensure ARIA commands have accessible names',
          help: 'ARIA commands must have an accessible name',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/aria-command-name',
          nodes: [{ html: '<div role="button" tabindex="0">', target: ['div[role="button"]'] }]
        }
      ],
      dom: {
        ...viewport().dom,
        emptyLinks: [{ selector: '#different-link-selector', html: '<a href="#"><br></a>', href: '#' }],
        emptyNamedControls: [{ selector: '#different-control-selector', tag: 'div', html: '<div role="button" tabindex="0"><img alt=""></div>' }]
      }
    })));
    expect(findings.filter((finding) => finding.ruleId === 'axe-link-name')).toHaveLength(1);
    expect(findings.filter((finding) => finding.ruleId === 'axe-aria-command-name')).toHaveLength(1);
    expect(findings.some((finding) => finding.ruleId === 'link-empty-accessible-name')).toBe(false);
    expect(findings.some((finding) => finding.ruleId === 'interactive-control-no-name')).toBe(false);
  });

  it('reports an unavailable page only as a blocker and does not infer component failures from the empty fallback DOM', () => {
    const findings = findingsFromPage(page(viewport({ status: null })));
    expect(findings.map((finding) => finding.ruleId)).toEqual(['page-unavailable']);
    expect(findings[0]?.classification).toBe('blocker');
  });

  it('flags a doubly-confirmed broken destination and keeps a server error as review', () => {
    const findings = findingsFromPage(page(viewport({
      links: [
        {
          selector: '#missing',
          name: 'Missing page',
          href: 'https://test.example/missing',
          status: 404,
          classification: 'confirmed',
          reason: 'Two independent same-origin GET checks returned HTTP 404.'
        },
        {
          selector: '#unstable',
          name: 'Unstable page',
          href: 'https://test.example/unstable',
          status: 503,
          classification: 'review',
          reason: 'The destination returned HTTP 503; confirm this was not transient.'
        }
      ]
    })));
    expect(findings.find((finding) => finding.ruleId === 'link-broken-destination')?.classification).toBe('confirmed');
    expect(findings.find((finding) => finding.ruleId === 'link-destination-review')?.classification).toBe('review');
  });

  it('does not treat optional Home and End tab behavior as a failure', () => {
    const findings = findingsFromPage(page(viewport({
      tabs: [{
        selector: '#tabs',
        name: 'Information',
        tabCount: 2,
        selectedCount: 1,
        tabbableCount: 1,
        navigationKey: 'ArrowRight',
        navigationMovedToTab: true,
        activationWorked: true,
        homeMovedToFirst: false,
        endMovedToLast: false,
        structuralFailures: [],
        structuralReviews: []
      }]
    })));
    expect(findings.filter((finding) => finding.ruleId.startsWith('tabs-'))).toEqual([]);
  });

  it('separates deterministic broken tab relationships from relationship reviews', () => {
    const findings = findingsFromPage(page(viewport({
      tabs: [{
        selector: '#tabs',
        name: 'Information',
        tabCount: 2,
        selectedCount: 1,
        tabbableCount: 1,
        navigationKey: 'ArrowRight',
        navigationMovedToTab: true,
        activationWorked: true,
        homeMovedToFirst: true,
        endMovedToLast: true,
        structuralFailures: ['First references missing panel #panel-one.'],
        structuralReviews: ['Second has no aria-controls relationship.']
      }]
    })));
    expect(findings.find((finding) => finding.ruleId === 'tabs-broken-relationships')?.classification).toBe('confirmed');
    expect(findings.find((finding) => finding.ruleId === 'tabs-relationships-review')?.classification).toBe('review');
  });

  it('confirms unreachable tabs but reviews an operable non-standard Tab sequence', () => {
    const baseTab = {
      selector: '#tabs',
      name: 'Information',
      tabCount: 2,
      selectedCount: 1,
      navigationKey: 'ArrowRight' as const,
      navigationMovedToTab: false,
      activationWorked: false,
      homeMovedToFirst: false,
      endMovedToLast: false,
      structuralFailures: [],
      structuralReviews: []
    };
    const unreachable = findingsFromPage(page(viewport({ tabs: [{ ...baseTab, tabbableCount: 1 }] })));
    const nonStandard = findingsFromPage(page(viewport({ tabs: [{ ...baseTab, tabbableCount: 2 }] })));
    expect(unreachable.find((finding) => finding.ruleId === 'tabs-keyboard-unreachable')?.classification).toBe('confirmed');
    expect(nonStandard.find((finding) => finding.ruleId === 'tabs-arrow-key-navigation-review')?.classification).toBe('review');
  });
});
