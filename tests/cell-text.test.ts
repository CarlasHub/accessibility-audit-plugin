import { describe, expect, it } from 'vitest';
import { cellText } from '../src/reporting/cell-text.js';

describe('workbook cell text extraction', () => {
  it('reads hyperlink, formula-result and rich-text values without object-string leakage', () => {
    expect(cellText({ value: { text: 'Best Practice', hyperlink: 'https://example.test' }, text: '[object Object]' })).toBe('Best Practice');
    expect(cellText({ value: { formula: 'A1', result: { text: 'Guidance', hyperlink: 'https://example.test/guidance' } } })).toBe('Guidance');
    expect(cellText({ value: { richText: [{ text: 'One' }, { text: 'Two' }] } })).toBe('One Two');
  });

  it('returns an empty string for unknown object values instead of "[object Object]"', () => {
    expect(cellText({ value: { unsupported: true }, text: '[object Object]' })).toBe('');
  });
});
