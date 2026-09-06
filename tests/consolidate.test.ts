import { describe, expect, it } from 'vitest';
import type { Finding } from '../src/types.js';
import { createSharedComponentKey } from '../src/audit/findings.js';
import { assertRemediationOnlyNotes, consolidateFindings } from '../src/reporting/consolidate.js';

function finding(url: string, sharedComponentKey?: string): Finding {
  return {
    key: 'image-missing-alt:shared',
    ruleId: 'image-missing-alt',
    classification: 'confirmed',
    severity: 'Serious',
    wcag: ['1.1.1'],
    summary: 'Image has no alternative',
    issue: 'Missing alt.',
    impact: 'Image purpose is unavailable.',
    testing: 'DOM inspection.',
    remediation: 'Add purpose-appropriate alt text or alt="" when decorative.',
    component: 'header.logo',
    componentName: '“Example” home link',
    componentLocation: 'Within the Primary navigation landmark',
    ...(sharedComponentKey ? { sharedComponentKey } : {}),
    urls: [url],
    viewports: ['desktop'],
    selectors: ['header .logo'],
    evidence: [{ kind: 'dom', pageUrl: url, detail: 'missing alt' }],
    assignment: 'Content',
    effort: 'Small',
    translationRequired: 'Review'
  };
}

describe('finding consolidation', () => {
  it('normalizes generated relationship identifiers without merging different component content', () => {
    const first = createSharedComponentKey('header button.menu', '<button id="menu-a1b2c3d4e5f6" aria-controls="panel-a1b2c3d4e5f6">Menu</button>');
    const second = createSharedComponentKey('header button.menu', '<button id="menu-fedcba987654" aria-controls="panel-fedcba987654">Menu</button>');
    const different = createSharedComponentKey('header button.menu', '<button id="menu-fedcba987654" aria-controls="panel-fedcba987654">Search</button>');
    expect(first).toBe(second);
    expect(first).not.toBe(different);
  });

  it('merges the same reusable component and root cause and preserves both URLs', () => {
    const result = consolidateFindings([
      finding('https://test.example/a', 'site-header-logo'),
      finding('https://test.example/b', 'site-header-logo')
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.urls).toEqual(['https://test.example/a', 'https://test.example/b']);
    expect(result[0]?.evidence).toHaveLength(2);
  });

  it('merges translated rendered names when the stable reusable-component evidence matches', () => {
    const english = finding('https://test.example/en', 'site-header-language-picker');
    english.componentName = '“English” button';
    const portuguese = finding('https://test.example/pt', 'site-header-language-picker');
    portuguese.componentName = '“Português” button';
    const result = consolidateFindings([english, portuguese]);
    expect(result).toHaveLength(1);
    expect(result[0]?.urls).toEqual(['https://test.example/en', 'https://test.example/pt']);
    expect(result[0]?.componentName).toBe('“English” button; “Português” button');
  });

  it('rolls related definition-list and list-item signals into one component/root-cause finding', () => {
    const list = finding('https://test.example/job');
    list.key = 'axe-definition-list:list';
    list.ruleId = 'axe-definition-list';
    list.component = 'dl.job-details';
    list.componentName = 'Job details description list';
    list.componentLocation = 'Within the job header';
    const item = { ...finding('https://test.example/job'), evidence: [...finding('https://test.example/job').evidence] };
    item.key = 'axe-dlitem:item';
    item.ruleId = 'axe-dlitem';
    item.component = 'dt.job-id';
    item.componentName = '“Job ID” term';
    item.componentLocation = 'Within the job header';
    const result = consolidateFindings([list, item]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      ruleId: 'axe-description-list-structure',
      summary: 'Description-list markup has an invalid parent/child structure'
    }));
    expect(result[0]?.selectors).toEqual(['header .logo']);
    expect(result[0]?.evidence).toHaveLength(2);
  });

  it('keeps different failing colour treatments separate on the same host', () => {
    const first = finding('https://test.example/a', 'contrast-blue');
    first.ruleId = 'axe-color-contrast';
    first.component = 'text colour treatment #0066cc on #ffffff';
    first.componentName = 'Primary link';
    first.issue = 'The same rendered colour treatment does not meet contrast. #0066cc foreground on #ffffff background measured 3.1:1; 4.5:1 is required.';
    const second = finding('https://test.example/b', 'contrast-pink');
    second.ruleId = 'axe-color-contrast';
    second.component = 'text colour treatment #e72582 on #ffffff';
    second.componentName = 'Call-to-action link';
    second.issue = 'The same rendered colour treatment does not meet contrast. #e72582 foreground on #ffffff background measured 3.8:1; 4.5:1 is required.';
    const result = consolidateFindings([first, second]);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.component)).toEqual([
      'text colour treatment #0066cc on #ffffff',
      'text colour treatment #e72582 on #ffffff'
    ]);
  });

  it('merges an identical failing colour treatment across proven shared occurrences', () => {
    const first = finding('https://test.example/a', 'contrast-blue');
    first.ruleId = 'axe-color-contrast';
    first.component = 'text colour treatment #0066cc on #ffffff';
    first.issue = 'The same rendered colour treatment does not meet contrast. #0066cc foreground on #ffffff background measured 3.1:1; 4.5:1 is required.';
    const second = { ...first, urls: ['https://test.example/b'], evidence: [{ ...first.evidence[0]!, pageUrl: 'https://test.example/b' }] };
    expect(consolidateFindings([first, second])).toEqual([
      expect.objectContaining({
        component: 'text colour treatment #0066cc on #ffffff',
        urls: ['https://test.example/a', 'https://test.example/b']
      })
    ]);
  });

  it('does not combine confirmed state failure with optional relationship-only review evidence', () => {
    const staleState = finding('https://test.example/a', 'site-header-language');
    staleState.ruleId = 'disclosure-state-and-relationship';
    staleState.classification = 'confirmed';
    staleState.wcag = ['4.1.2'];
    staleState.component = 'header .language-toggle';
    staleState.componentName = '“English” button';
    const relationshipOnly = finding('https://test.example/b', 'site-header-language');
    relationshipOnly.ruleId = 'disclosure-controls-review';
    relationshipOnly.classification = 'review';
    relationshipOnly.wcag = ['Best Practice'];
    relationshipOnly.component = 'header .language-toggle';
    relationshipOnly.componentName = '“Português” button';
    const result = consolidateFindings([staleState, relationshipOnly]);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.classification).sort()).toEqual(['confirmed', 'review']);
    expect(result.find((item) => item.classification === 'confirmed')?.urls).toEqual(['https://test.example/a']);
    expect(result.find((item) => item.classification === 'review')?.urls).toEqual(['https://test.example/b']);
  });

  it('is byte-stable when finding input order is reversed', () => {
    const first = finding('https://test.example/b', 'site-header-logo');
    first.componentName = 'Zulu';
    const second = finding('https://test.example/a', 'site-header-logo');
    second.componentName = 'Alpha';
    expect(JSON.stringify(consolidateFindings([first, second])))
      .toBe(JSON.stringify(consolidateFindings([second, first])));
  });

  it('merges one repeated interaction blocker across pages while retaining every page and evidence item', () => {
    const first = finding('https://test.example/a', 'audit-interaction-blocker:#privacy-dialog');
    first.key = 'interaction-blocker:#privacy-dialog:desktop';
    first.ruleId = 'interaction-coverage-blocked';
    first.classification = 'blocker';
    first.wcag = ['None'];
    first.component = '#privacy-dialog';
    const second = {
      ...first,
      urls: ['https://test.example/b'],
      evidence: [{ ...first.evidence[0]!, pageUrl: 'https://test.example/b' }]
    };
    const result = consolidateFindings([first, second]);
    expect(result).toHaveLength(1);
    expect(result[0]?.urls).toEqual(['https://test.example/a', 'https://test.example/b']);
    expect(result[0]?.evidence).toHaveLength(2);
  });

  it('groups missing fragments only within the same rendered in-page navigation component', () => {
    const first = finding('https://test.example/job-one');
    first.key = 'link-broken-destination:#overview';
    first.ruleId = 'link-broken-destination';
    first.component = 'nav.job-sections';
    first.componentLocation = 'Within the job-page section navigation';
    first.evidence = [{ ...first.evidence[0]!, detail: 'The in-page fragment #overview is missing.' }];
    const second = { ...first, key: 'link-broken-destination:#benefits', evidence: [{ ...first.evidence[0]!, detail: 'The in-page fragment #benefits is missing.' }] };
    const distinct = finding('https://test.example/job-one');
    distinct.key = 'link-broken-destination:#why';
    distinct.ruleId = 'link-broken-destination';
    distinct.component = 'a.hero-cta';
    distinct.componentLocation = 'Within the job-page hero';
    distinct.evidence = [{ ...distinct.evidence[0]!, detail: 'The in-page fragment #why is missing.' }];

    const result = consolidateFindings([first, second, distinct]);
    expect(result).toHaveLength(2);
    expect(result.find((item) => item.component === 'nav.job-sections')).toEqual(expect.objectContaining({
      wcag: ['Best Practice'],
      selectors: ['header .logo']
    }));
    expect(result.find((item) => item.component === 'a.hero-cta')?.ruleId).toBe('link-broken-destination');
  });

  it('groups equivalent placeholder links within one reusable rendered component', () => {
    const first = finding('https://test.example/a');
    first.key = 'link-destination-review:first';
    first.ruleId = 'link-destination-review';
    first.classification = 'review';
    first.wcag = ['Best Practice'];
    first.component = '#first-location';
    first.selectors = ['#first-location'];
    first.componentName = '“First location” link';
    first.componentLocation = 'Within the location-suggestions component';
    first.issue = '“First location” points to #. The link uses an empty or placeholder destination.';
    first.evidence = [{
      kind: 'network',
      pageUrl: first.urls[0]!,
      selector: '#first-location',
      detail: JSON.stringify({ href: '#', reason: 'The link uses an empty or placeholder destination.' })
    }];
    const second = finding('https://test.example/b');
    second.key = 'link-destination-review:second';
    second.ruleId = 'link-destination-review';
    second.classification = 'review';
    second.wcag = ['Best Practice'];
    second.component = '#second-location';
    second.selectors = ['#second-location'];
    second.componentName = '“Second location” link';
    second.componentLocation = first.componentLocation;
    second.issue = '“Second location” points to #. The link uses an empty or placeholder destination.';
    second.evidence = [{
      kind: 'network',
      pageUrl: second.urls[0]!,
      selector: '#second-location',
      detail: JSON.stringify({ href: '#', reason: 'The link uses an empty or placeholder destination.' })
    }];
    const action = { ...second, key: 'link-destination-review:action', evidence: [{
      kind: 'network' as const,
      pageUrl: second.urls[0]!,
      selector: '#action',
      detail: JSON.stringify({ href: 'javascript:void(0)', reason: 'The anchor uses a javascript: destination.' })
    }] };

    const result = consolidateFindings([first, second, action]);
    expect(result).toHaveLength(2);
    const grouped = result.find((item) => item.summary === 'Review placeholder links in the same component');
    expect(grouped).toEqual(expect.objectContaining({
      urls: ['https://test.example/a', 'https://test.example/b'],
      selectors: ['#first-location', '#second-location'],
      componentName: '“First location” link; “Second location” link',
      issue: expect.stringContaining('2 listed link occurrence(s)')
    }));
    expect(result.find((item) => item.key === 'link-destination-review:action')).toBeDefined();
  });

  it('keeps matching page findings separate without evidence of a shared component', () => {
    const result = consolidateFindings([finding('https://test.example/a'), finding('https://test.example/b')]);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.urls)).toEqual([
      ['https://test.example/a'],
      ['https://test.example/b']
    ]);
  });

  it('keeps different root causes separate even on the same reusable component', () => {
    const first = finding('https://test.example/a', 'site-header-logo');
    const second = finding('https://test.example/b', 'site-header-logo');
    second.issue = 'The image has an empty alternative despite communicating the organisation identity.';
    const result = consolidateFindings([first, second]);
    expect(result).toHaveLength(2);
  });

  it('does not merge a generic fingerprint used by components in different rendered locations', () => {
    const first = finding('https://test.example/a', 'generic-role-button');
    first.componentName = 'Unnamed button';
    first.componentLocation = 'Within the “Application steps” section';
    const second = finding('https://test.example/b', 'generic-role-button');
    second.componentName = 'Unnamed button';
    second.componentLocation = 'Within the “Map” section';
    expect(consolidateFindings([first, second])).toHaveLength(2);
  });

  it('merges the same page component and root cause even when responsive markup produces different fingerprints', () => {
    const desktop = finding('https://test.example/a', 'desktop-component-fingerprint');
    const mobile = finding('https://test.example/a', 'mobile-component-fingerprint');
    mobile.viewports = ['mobile'];
    const result = consolidateFindings([desktop, mobile]);
    expect(result).toHaveLength(1);
    expect(result[0]?.viewports).toEqual(['desktop', 'mobile']);
  });

  it('merges the same finding across viewports on one page without a shared-component key', () => {
    const desktop = finding('https://test.example/a');
    const mobile = finding('https://test.example/a');
    mobile.viewports = ['mobile'];
    const result = consolidateFindings([desktop, mobile]);
    expect(result).toHaveLength(1);
    expect(result[0]?.viewports).toEqual(['desktop', 'mobile']);
  });

  it('rejects Jira text or empty remediation Notes', () => {
    const invalid = finding('https://test.example/a');
    invalid.remediation = 'Create a JIRA ticket.';
    expect(() => assertRemediationOnlyNotes([invalid])).toThrow('Jira reference');
    invalid.remediation = '';
    expect(() => assertRemediationOnlyNotes([invalid])).toThrow('empty remediation');
  });
});
