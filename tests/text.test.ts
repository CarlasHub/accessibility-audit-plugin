import { describe, expect, it } from 'vitest';
import { singleLineText } from '../src/text.js';

describe('single-line display text', () => {
  it('removes terminal control characters, collapses whitespace, and limits length', () => {
    expect(singleLineText('Page\n\u001b[31m title\t', 12)).toBe('Page [31m ti');
  });
});
