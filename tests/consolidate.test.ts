import { describe, expect, it } from 'vitest';
import type { Finding } from '../src/types.js';
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
  it('merges the same reusable component and root cause and preserves both URLs', () => {
    const result = consolidateFindings([
      finding('https://test.example/a', 'site-header-logo'),
      finding('https://test.example/b', 'site-header-logo')
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.urls).toEqual(['https://test.example/a', 'https://test.example/b']);
    expect(result[0]?.evidence).toHaveLength(2);
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
