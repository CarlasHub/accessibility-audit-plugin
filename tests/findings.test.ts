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
    keyboard: { sequence: [], completedCycle: false, truncated: false, scope: 'unknown' },
    responsive: { horizontalOverflow: 0, overflowElements: [], textSpacingOverflow: 0 },
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
  it('groups one shared contrast treatment into one finding while preserving every affected element', () => {
    const findings = findingsFromPage(page(viewport({
      axe: [{
        id: 'color-contrast',
        impact: 'serious',
        tags: ['wcag2aa', 'wcag143'],
        description: 'Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds',
        help: 'Elements must meet minimum color contrast ratio thresholds',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/color-contrast',
        nodes: [
          {
            html: '<button id="first">First</button>',
            target: ['#first'],
            failureSummary: 'Element has insufficient color contrast of 4.08 (foreground color: #0066cc, background color: #c2e0ff, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1'
          },
          {
            html: '<button id="second">Second</button>',
            target: ['#second'],
            failureSummary: 'Element has insufficient color contrast of 4.08 (foreground color: #0066cc, background color: #c2e0ff, font size: 12.0pt (16px), font weight: bold). Expected contrast ratio of 4.5:1'
          }
        ]
      }],
      elementContexts: [
        {
          selector: '#first',
          tagName: 'button',
          role: 'button',
          accessibleName: 'First',
          visibleText: 'First',
          componentName: '“First” button',
          location: 'Within the jobs tablist',
          captureSelector: '#jobs'
        },
        {
          selector: '#second',
          tagName: 'button',
          role: 'button',
          accessibleName: 'Second',
          visibleText: 'Second',
          componentName: '“Second” button',
          location: 'Within the jobs tablist',
          captureSelector: '#jobs'
        }
      ]
    })));
    const contrast = findings.filter((finding) => finding.ruleId === 'axe-color-contrast');
    expect(contrast).toHaveLength(1);
    expect(contrast[0]).toEqual(expect.objectContaining({
      classification: 'confirmed',
      component: 'text colour treatment #0066cc on #c2e0ff',
      componentName: '“First” button; “Second” button',
      selectors: ['#first', '#second']
    }));
    expect(contrast[0]?.issue).not.toContain('font weight');
  });

  it('groups repeated disclosure relationship reviews by component family and does not require Escape', () => {
    const disclosures = ['category', 'country', 'region'].map((name) => ({
      selector: `#${name}-toggle`,
      name: name[0]!.toUpperCase() + name.slice(1),
      controls: null,
      activationTargetVerified: true,
      enterTestCompleted: true,
      enterSettled: true,
      beforeExpanded: 'false',
      afterExpanded: 'true',
      controlledVisibleBefore: null,
      controlledVisibleAfterOpen: null,
      firstTabSelector: null,
      tabEnteredControlledRegion: null
    }));
    const findings = findingsFromPage(page(viewport({
      disclosures,
      elementContexts: disclosures.map((disclosure) => ({
        selector: disclosure.selector,
        tagName: 'button',
        role: 'button',
        accessibleName: disclosure.name,
        visibleText: disclosure.name,
        componentName: `“${disclosure.name}” button`,
        location: 'Within the “Filter Results” section',
        captureSelector: disclosure.selector.replace('-toggle', '-filters-section')
      }))
    })));
    const relationshipReviews = findings.filter((finding) => finding.ruleId === 'disclosure-controls-review');
    expect(relationshipReviews).toHaveLength(0);
    expect(findings.some((finding) => finding.ruleId.includes('escape'))).toBe(false);
  });

  it('reports a confirmed disclosure state mismatch without treating missing aria-controls as the failure', () => {
    const findings = findingsFromPage(page(viewport({
      disclosures: [{
        selector: '#filters-toggle',
        name: 'Filters',
        controls: null,
        activationTargetVerified: true,
        enterTestCompleted: true,
        enterSettled: true,
        beforeExpanded: 'false',
        afterExpanded: 'false',
        controlledVisibleBefore: false,
        controlledVisibleAfterOpen: true,
        firstTabSelector: null,
        tabEnteredControlledRegion: null
      }]
    })));
    expect(findings.filter((finding) => finding.ruleId.startsWith('disclosure-'))).toHaveLength(1);
    expect(findings[0]).toEqual(expect.objectContaining({
      ruleId: 'disclosure-state-not-updated',
      classification: 'confirmed',
      wcag: ['4.1.2']
    }));
    expect(findings[0]?.issue).not.toContain('aria-controls');
  });

  it('does not promote unchanged aria-expanded with unresolved visibility to a finding', () => {
    const findings = findingsFromPage(page(viewport({
      disclosures: [{
        selector: '#accordion-toggle',
        name: 'More information',
        controls: null,
        activationTargetVerified: true,
        enterTestCompleted: true,
        enterSettled: true,
        beforeExpanded: 'false',
        afterExpanded: 'false',
        controlledVisibleBefore: null,
        controlledVisibleAfterOpen: null,
        firstTabSelector: null,
        tabEnteredControlledRegion: null
      }]
    })));
    expect(findings).toEqual([]);
  });

  it('does not report an initially expanded disclosure whose visible and exposed states still agree', () => {
    const findings = findingsFromPage(page(viewport({
      disclosures: [{
        selector: '#initially-open',
        name: 'Details',
        controls: 'details-panel',
        activationTargetVerified: true,
        enterTestCompleted: true,
        enterSettled: true,
        beforeExpanded: 'true',
        afterExpanded: 'true',
        controlledVisibleBefore: true,
        controlledVisibleAfterOpen: true,
        firstTabSelector: null,
        tabEnteredControlledRegion: null
      }]
    })));
    expect(findings.filter((finding) => finding.ruleId.startsWith('disclosure-'))).toEqual([]);
  });

  it('does not promote a state mismatch when the live target or settled final state was not verified', () => {
    const baseDisclosure = {
      selector: '#menu-toggle',
      name: 'Menu',
      controls: 'menu-panel',
      enterTestCompleted: true,
      beforeExpanded: 'false',
      afterExpanded: 'false',
      controlledVisibleBefore: false,
      controlledVisibleAfterOpen: true,
      firstTabSelector: null,
      tabEnteredControlledRegion: null
    };
    const findings = findingsFromPage(page(viewport({
      disclosures: [
        { ...baseDisclosure, activationTargetVerified: false, enterSettled: true },
        { ...baseDisclosure, selector: '#slow-menu-toggle', activationTargetVerified: true, enterSettled: false }
      ]
    })));
    expect(findings.filter((finding) => finding.ruleId.startsWith('disclosure-'))).toEqual([]);
  });

  it('does not use an unsettled Space result as failure evidence', () => {
    const findings = findingsFromPage(page(viewport({
      disclosures: [{
        selector: '#menu-toggle',
        name: 'Menu',
        controls: 'menu-panel',
        activationTargetVerified: true,
        enterTestCompleted: true,
        enterSettled: true,
        beforeExpanded: 'false',
        afterExpanded: 'true',
        controlledVisibleBefore: false,
        controlledVisibleAfterOpen: true,
        spaceTestCompleted: true,
        spaceSettled: false,
        spaceAfterExpanded: 'false',
        controlledVisibleAfterSpace: true,
        firstTabSelector: null,
        tabEnteredControlledRegion: null
      }]
    })));
    expect(findings.filter((finding) => finding.ruleId.startsWith('disclosure-'))).toEqual([]);
  });

  it('keeps valid Enter mismatch evidence when the later Space target cannot be verified', () => {
    const findings = findingsFromPage(page(viewport({
      disclosures: [{
        selector: '#menu-toggle',
        name: 'Menu',
        controls: 'menu-panel',
        activationTargetVerified: true,
        enterTargetVerified: true,
        enterTestCompleted: true,
        enterSettled: true,
        beforeExpanded: 'false',
        afterExpanded: 'false',
        controlledVisibleBefore: false,
        controlledVisibleAfterOpen: true,
        spaceTestCompleted: false,
        spaceTargetVerified: false,
        firstTabSelector: null,
        tabEnteredControlledRegion: null,
        restorationError: 'The control detached before the Space test.'
      }]
    })));
    expect(findings.filter((finding) => finding.ruleId === 'disclosure-state-not-updated')).toHaveLength(1);
  });

  it('retains an incomplete disclosure interaction in raw evidence without creating a finding', () => {
    const findings = findingsFromPage(page(viewport({
      disclosures: [{
        selector: '#third-party-toggle',
        name: 'Map controls',
        controls: null,
        beforeExpanded: null,
        afterExpanded: null,
        controlledVisibleBefore: null,
        controlledVisibleAfterOpen: null,
        firstTabSelector: null,
        tabEnteredControlledRegion: null,
        error: 'Element was detached during interaction'
      }]
    })));
    expect(findings.filter((finding) => finding.ruleId.startsWith('disclosure-'))).toEqual([]);
  });

  it('groups duplicate landmarks with the same role and name into one review finding', () => {
    const findings = findingsFromPage(page(viewport({
      axe: [{
        id: 'landmark-unique',
        impact: 'moderate',
        tags: ['best-practice'],
        description: 'Ensure landmarks are unique',
        help: 'Landmarks should have a unique role or role and name combination',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/landmark-unique',
        nodes: [
          { html: '<form role="search" aria-label="Site search"></form>', target: ['#header-search'] },
          { html: '<form role="search" aria-label="Site search"></form>', target: ['#body-search'] }
        ]
      }],
      elementContexts: [
        {
          selector: '#header-search',
          tagName: 'form',
          role: 'search',
          accessibleName: 'Site search',
          visibleText: '',
          componentName: '“Site search” search landmark',
          location: 'Within the header',
          captureSelector: '#header-search'
        },
        {
          selector: '#body-search',
          tagName: 'form',
          role: 'search',
          accessibleName: 'Site search',
          visibleText: '',
          componentName: '“Site search” search landmark',
          location: 'Within main content',
          captureSelector: '#body-search'
        }
      ]
    })));
    const landmarks = findings.filter((finding) => finding.ruleId === 'axe-landmark-unique');
    expect(landmarks).toHaveLength(1);
    expect(landmarks[0]).toEqual(expect.objectContaining({
      classification: 'review',
      selectors: ['#header-search', '#body-search']
    }));
  });

  it('preserves axe related nodes and uses the computed landmark role', () => {
    const findings = findingsFromPage(page(viewport({
      axe: [{
        id: 'landmark-unique',
        impact: 'moderate',
        tags: ['best-practice'],
        description: 'Ensure landmarks are unique',
        help: 'Landmarks should have a unique role or role and name combination',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/landmark-unique',
        nodes: [{
          html: '<form id="search-a" class="search-form"></form>',
          target: ['#search-a'],
          any: [{
            id: 'landmark-is-unique',
            data: { role: 'search', accessibleText: null },
            relatedNodes: [{ html: '<form id="search-b" class="search-form"></form>', target: ['#search-b'] }]
          }]
        }]
      }]
    })));
    expect(findings).toEqual([
      expect.objectContaining({
        component: 'search landmarks without an accessible name',
        selectors: ['#search-a', '#search-b']
      })
    ]);
    expect(findings[0]?.evidence).toHaveLength(2);
  });

  it('parses WCAG tags whose final success-criterion number has two digits', () => {
    const findings = findingsFromPage(page(viewport({
      axe: [{
        id: 'reflow',
        impact: 'serious',
        tags: ['wcag2aa', 'wcag1410'],
        description: 'Ensure content reflows',
        help: 'Content must reflow',
        helpUrl: 'https://example.test/reflow',
        nodes: [{ html: '<main id="main"></main>', target: ['#main'], failureSummary: 'Content does not reflow.' }]
      }]
    })));
    expect(findings[0]?.wcag).toContain('1.4.10');
  });

  it('reports an unresolved interaction surface as an audit coverage blocker', () => {
    const findings = findingsFromPage(page(viewport({
      interactionBlocker: {
        selector: '#privacy-dialog',
        role: 'dialog',
        name: 'Privacy choices',
        reason: 'A visible modal remained active.'
      },
      keyboard: {
        sequence: [],
        completedCycle: false,
        truncated: false,
        scope: 'modal-only',
        modalSelector: '#privacy-dialog'
      }
    })));
    expect(findings).toContainEqual(expect.objectContaining({
      ruleId: 'interaction-coverage-blocked',
      classification: 'blocker',
      wcag: ['None']
    }));
  });

  it('does not flag an organisation-named logo link solely because it points home', () => {
    const base = viewport();
    const findings = findingsFromPage(page(viewport({
      dom: {
        ...base.dom,
        linkedImagesForReview: [{
          selector: '#brand-home',
          name: 'BAT Logo',
          alt: 'BAT Logo',
          href: 'https://test.example/',
          reason: 'The linked image points home but its name does not contain the word home.'
        }]
      }
    })));
    expect(findings.some((finding) => finding.ruleId === 'linked-image-purpose-review')).toBe(false);
  });

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
          hitTested: true,
          spacingRisk: false,
          nearbyTargets: []
        }]
      }
    })));
    expect(findings.some((finding) => finding.ruleId === 'target-size-review')).toBe(false);
  });

  it('does not report an undersized target when viewport hit testing was not completed', () => {
    const findings = findingsFromPage(page(viewport({
      dom: {
        ...viewport().dom,
        smallTargets: [{
          selector: '#hidden-responsive-control',
          name: 'Hidden responsive control',
          width: 18,
          height: 18,
          groupSelector: 'nav',
          inlineException: false,
          hitTested: false,
          spacingRisk: true,
          nearbyTargets: [{
            selector: '#other-responsive-control',
            name: 'Other control',
            width: 18,
            height: 18,
            centerDistance: 12
          }]
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
          hitTested: true,
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
            hitTested: true,
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
            hitTested: true,
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
          hitTested: true,
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

  it('retains generic axe incomplete evidence without promoting it to a workbook finding', () => {
    const audit = viewport({
      axe: [{
        id: 'aria-valid-attr-value',
        resultType: 'incomplete',
        impact: 'critical',
        tags: ['wcag2a', 'wcag412'],
        description: 'Ensure all ARIA attributes have valid values',
        help: 'ARIA attributes must conform to valid values',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/aria-valid-attr-value',
        nodes: [{
          html: '<div role="combobox" aria-controls="generated-list"></div>',
          target: ['#location-picker'],
          failureSummary: 'Fix all of the following: Invalid ARIA attribute value'
        }]
      }],
      axeRun: {
        completed: true,
        violationCount: 0,
        incompleteCount: 1,
        passCount: 0,
        passes: []
      }
    });

    expect(findingsFromPage(page(audit))).toEqual([]);
    expect(audit.axe).toHaveLength(1);
    expect(audit.axeRun.incompleteCount).toBe(1);
  });

  it('retains indeterminate focus-indicator samples without promoting them to findings', () => {
    const findings = findingsFromPage(page(viewport({
      keyboard: {
        completedCycle: true,
        truncated: false,
        scope: 'document',
        sequence: [
          {
            index: 1,
            selector: '#filter-one',
            componentSelector: '#filters',
            role: 'button',
            name: 'Filter one',
            visibleIndicator: false,
            obscured: false
          },
          {
            index: 2,
            selector: '#filter-two',
            componentSelector: '#filters',
            role: 'button',
            name: 'Filter two',
            visibleIndicator: false,
            obscured: false
          },
          {
            index: 3,
            selector: '#sort',
            componentSelector: '#sort-form',
            role: 'combobox',
            name: 'Sort jobs',
            visibleIndicator: false,
            obscured: false
          }
        ]
      }
    })));

    expect(findings.filter((finding) => finding.ruleId === 'focus-indicator-review')).toEqual([]);
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

  it('groups repeated axe nodes from the same rendered component and root cause', () => {
    const failureSummary = 'Element does not have text that is visible to screen readers';
    const findings = findingsFromPage(page(viewport({
      axe: [{
        id: 'link-name',
        impact: 'serious',
        tags: ['wcag2a', 'wcag244'],
        description: 'Ensure links have discernible text',
        help: 'Links must have discernible text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/link-name',
        nodes: [
          { html: '<a href="/one"></a>', target: ['#card-one-link'], failureSummary },
          { html: '<a href="/two"></a>', target: ['#card-two-link'], failureSummary }
        ]
      }],
      elementContexts: [
        {
          selector: '#card-one-link',
          tagName: 'a',
          role: 'link',
          accessibleName: '',
          visibleText: '',
          componentName: 'Unnamed link',
          location: 'Within the first result card',
          captureSelector: '.result-card:nth-of-type(1)'
        },
        {
          selector: '#card-two-link',
          tagName: 'a',
          role: 'link',
          accessibleName: '',
          visibleText: '',
          componentName: 'Unnamed link',
          location: 'Within the second result card',
          captureSelector: '.result-card:nth-of-type(2)'
        }
      ]
    })));
    const links = findings.filter((finding) => finding.ruleId === 'axe-link-name');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual(expect.objectContaining({
      component: '.result-card',
      selectors: ['#card-one-link', '#card-two-link']
    }));
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
