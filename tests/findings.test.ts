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
    consent: {
      found: false,
      dismissed: false,
      action: 'none',
      buttonName: '',
      surfaceSelector: '',
      frameUrl: ''
    },
    elementContexts: [],
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

  it('does not turn an isolated undersized target into a workbook finding', () => {
    const findings = findingsFromPage(page(viewport({
      dom: {
        ...viewport().dom,
        smallTargets: [{
          selector: '#isolated-save',
          name: 'Save',
          width: 20,
          height: 20,
          groupSelector: 'main',
          inlineException: false,
          spacingRisk: false,
          nearbyTargets: []
        }]
      }
    })));
    expect(findings.some((finding) => finding.ruleId === 'target-size-review')).toBe(false);
  });

  it('does not report a target that meets the inline exception', () => {
    const findings = findingsFromPage(page(viewport({
      dom: {
        ...viewport().dom,
        smallTargets: [{
          selector: 'p > a',
          name: 'privacy policy',
          width: 82,
          height: 18,
          groupSelector: 'main',
          inlineException: true,
          spacingRisk: true,
          nearbyTargets: [{
            selector: 'p > a:nth-of-type(2)',
            name: 'terms',
            width: 42,
            height: 18,
            centerDistance: 20
          }]
        }]
      }
    })));
    expect(findings.some((finding) => finding.ruleId === 'target-size-review')).toBe(false);
  });

  it('groups nearby undersized controls into one component review with explicit limits', () => {
    const findings = findingsFromPage(page(viewport({
      dom: {
        ...viewport().dom,
        smallTargets: [
          {
            selector: '#slide-one',
            name: 'Go to slide 1',
            width: 12,
            height: 12,
            groupSelector: '.carousel-dots',
            inlineException: false,
            spacingRisk: true,
            nearbyTargets: [{
              selector: '#slide-two',
              name: 'Go to slide 2',
              width: 12,
              height: 12,
              centerDistance: 16
            }]
          },
          {
            selector: '#slide-two',
            name: 'Go to slide 2',
            width: 12,
            height: 12,
            groupSelector: '.carousel-dots',
            inlineException: false,
            spacingRisk: true,
            nearbyTargets: [{
              selector: '#slide-one',
              name: 'Go to slide 1',
              width: 12,
              height: 12,
              centerDistance: 16
            }]
          }
        ]
      },
      elementContexts: [
        {
          selector: '#slide-one',
          tagName: 'button',
          role: 'button',
          accessibleName: 'Go to slide 1',
          visibleText: '',
          componentName: '“Go to slide 1” button',
          location: 'Within the “Featured stories” carousel region',
          captureSelector: '.carousel-dots'
        },
        {
          selector: '#slide-two',
          tagName: 'button',
          role: 'button',
          accessibleName: 'Go to slide 2',
          visibleText: '',
          componentName: '“Go to slide 2” button',
          location: 'Within the “Featured stories” carousel region',
          captureSelector: '.carousel-dots'
        }
      ]
    })));
    const targetFindings = findings.filter((finding) => finding.ruleId === 'target-size-review');
    expect(targetFindings).toHaveLength(1);
    expect(targetFindings[0]).toEqual(expect.objectContaining({
      classification: 'review',
      severity: 'Minor',
      componentName: '“Go to slide 1” button; “Go to slide 2” button',
      componentLocation: 'Within the “Featured stories” carousel region',
      summary: 'Pointer targets may not provide the required size or spacing',
      issue: expect.stringContaining('review issue rather than a confirmed WCAG failure'),
      testing: expect.stringContaining('Actual: “Go to slide 1” 12×12 CSS pixels')
    }));
    expect(targetFindings[0]?.selectors).toEqual(['#slide-one', '#slide-two']);
  });

  it('keeps an axe incomplete target-size result in review even when the measured box exceeds 24 pixels', () => {
    const findings = findingsFromPage(page(viewport({
      axe: [{
        id: 'target-size',
        resultType: 'incomplete',
        impact: 'serious',
        tags: ['wcag22aa', 'wcag258'],
        description: 'Ensure touch targets have sufficient size and space',
        help: 'Touch targets must have sufficient size and space',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/target-size',
        nodes: [{ html: '<button id="small">Save</button>', target: ['#small'] }]
      }],
      dom: {
        ...viewport().dom,
        smallTargets: [{
          selector: '#small',
          name: 'Save',
          width: 26,
          height: 37,
          groupSelector: '.job-card-actions',
          inlineException: false,
          spacingRisk: false,
          axeTargetSizeSignal: true,
          nearbyTargets: []
        }]
      }
    })));
    expect(findings.some((finding) => finding.ruleId === 'axe-target-size')).toBe(false);
    expect(findings.find((finding) => finding.ruleId === 'target-size-review')).toEqual(expect.objectContaining({
      classification: 'review',
      wcag: ['2.5.8'],
      issue: expect.stringContaining('may not provide a 24×24 CSS pixel target or sufficient separation')
    }));
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

  it('does not apply link-purpose criteria to an unnamed non-link control', () => {
    const findings = findingsFromPage(page(viewport({
      dom: {
        ...viewport().dom,
        emptyNamedControls: [{
          selector: '#email',
          tag: 'input',
          html: '<input id="email" type="email">'
        }]
      }
    })));
    const finding = findings.find((item) => item.ruleId === 'interactive-control-no-name');
    expect(finding).toEqual(expect.objectContaining({
      classification: 'confirmed',
      wcag: ['4.1.2'],
      summary: 'Interactive control has no accessible name'
    }));
    expect(finding?.wcag).not.toContain('2.4.4');
  });

  it('adds the rendered component name and page location to a finding', () => {
    const findings = findingsFromPage(page(viewport({
      axe: [{
        id: 'button-name',
        impact: 'serious',
        tags: ['wcag2a', 'wcag412'],
        description: 'Ensure buttons have discernible text',
        help: 'Buttons must have discernible text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/button-name',
        nodes: [{ html: '<button id="search-toggle"></button>', target: ['#search-toggle'] }]
      }],
      elementContexts: [{
        selector: '#search-toggle',
        tagName: 'button',
        role: 'button',
        accessibleName: '',
        visibleText: '',
        componentName: 'Unnamed button',
        location: 'Within the “Primary” navigation landmark',
        captureSelector: 'nav'
      }]
    })));
    expect(findings[0]).toEqual(expect.objectContaining({
      componentName: 'Unnamed button',
      componentLocation: 'Within the “Primary” navigation landmark',
      summary: 'Button has no accessible name',
      issue: expect.stringContaining('button has no accessible name'),
      testing: expect.stringContaining('Actual:')
    }));
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
