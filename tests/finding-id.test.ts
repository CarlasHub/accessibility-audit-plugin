import { describe, expect, it } from 'vitest';
import { assignFindingIds, findingFingerprint } from '../src/reporting/finding-id.js';
import type { Finding } from '../src/types.js';

function finding(key: string, id?: string): Finding {
  return {
    ...(id ? { id } : {}),
    key,
    ruleId: 'button-name',
    classification: 'confirmed',
    severity: 'Serious',
    wcag: ['4.1.2'],
    summary: 'Button has no accessible name',
    issue: 'The button has no accessible name.',
    impact: 'The control purpose is unavailable.',
    testing: 'Inspect the accessible name.',
    remediation: 'Add an accessible name.',
    component: '#save',
    urls: ['https://example.com/'],
    viewports: ['desktop'],
    selectors: ['#save'],
    evidence: [],
    assignment: 'Development',
    effort: 'Small',
    translationRequired: 'No'
  };
}

describe('finding identity', () => {
  it('keeps report IDs while adding versioned fingerprints', () => {
    const [assigned] = assignFindingIds([finding('button-name:save', 'A11Y900')]);

    expect(assigned?.id).toBe('A11Y900');
    expect(assigned?.fingerprint).toMatch(/^a11y-fp-v1:[a-f0-9]{64}$/);
  });

  it('keeps fingerprints stable when report ordering changes', () => {
    const first = finding('button-name:save');
    const second = finding('button-name:cancel');
    const forward = assignFindingIds([first, second]);
    const reversed = assignFindingIds([second, first]);

    expect(forward[0]?.id).not.toBe(reversed[1]?.id);
    expect(forward[0]?.fingerprint).toBe(reversed[1]?.fingerprint);
    expect(forward[1]?.fingerprint).toBe(reversed[0]?.fingerprint);
  });

  it('canonicalizes set-like fields before fingerprinting', () => {
    const original = finding('button-name:save');
    original.urls = ['https://example.com/b', 'https://example.com/a'];
    original.wcag = ['4.1.2', '2.5.3'];
    original.selectors = ['#save', '.primary'];
    const reordered = {
      ...original,
      urls: [...original.urls].reverse(),
      wcag: [...original.wcag].reverse(),
      selectors: [...original.selectors].reverse()
    };

    expect(findingFingerprint(original)).toBe(findingFingerprint(reordered));
  });

  it('changes the fingerprint when the finding identity changes', () => {
    const changed = finding('button-name:cancel');
    changed.component = '#cancel';
    changed.selectors = ['#cancel'];

    expect(findingFingerprint(finding('button-name:save')))
      .not.toBe(findingFingerprint(changed));
  });
});
