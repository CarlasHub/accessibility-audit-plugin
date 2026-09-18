import { describe, expect, it } from 'vitest';
import { standardsForFinding } from '../src/audit/standards.js';

describe('finding standards mappings', () => {
  it('maps a WCAG 2.0 A/AA axe finding to W3C, Section 508 and its Deque rule source', () => {
    expect(standardsForFinding({ ruleId: 'axe-button-name', wcag: ['4.1.2'] })).toEqual([
      'W3C WCAG 2.2 4.1.2',
      'Section 508 E205.4 (WCAG 2.0 4.1.2)',
      'Deque axe-core rule button-name'
    ]);
  });

  it('does not mislabel WCAG 2.1 or 2.2 additions as Section 508 requirements', () => {
    expect(standardsForFinding({ ruleId: 'responsive-interactive-overlap', wcag: ['1.4.10', '2.4.11'] })).toEqual([
      'W3C WCAG 2.2 1.4.10',
      'W3C WCAG 2.2 2.4.11'
    ]);
  });

  it('keeps best-practice axe signals separate from normative WCAG mappings', () => {
    expect(standardsForFinding({ ruleId: 'axe-region', wcag: ['Best Practice'] })).toEqual([
      'Deque axe-core rule region'
    ]);
  });
});
