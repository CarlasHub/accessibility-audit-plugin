import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  parseBooleanInput,
  parseFailurePolicy,
  parseListInput,
  parsePositiveInteger,
  parseWcagLevel
} from '../src/github-action.js';

describe('GitHub Action inputs', () => {
  it('reads one URL per line and JSON arrays without treating URL commas as separators', () => {
    expect(parseListInput('https://example.test/a,b\nhttps://example.test/c')).toEqual([
      'https://example.test/a,b',
      'https://example.test/c'
    ]);
    expect(parseListInput('["https://example.test/a", "https://example.test/b"]')).toEqual([
      'https://example.test/a',
      'https://example.test/b'
    ]);
  });

  it('validates boolean and failure policy values', () => {
    expect(parseBooleanInput('yes', false)).toBe(true);
    expect(parseBooleanInput('0', true)).toBe(false);
    expect(parseFailurePolicy('SERIOUS')).toBe('serious');
    expect(() => parseFailurePolicy('review')).toThrow(/fail-on must be one of/);
    expect(parseWcagLevel('aaa')).toBe('AAA');
    expect(() => parseWcagLevel('A')).toThrow(/AA or AAA/);
  });

  it('enforces the documented Action concurrency range', () => {
    expect(parsePositiveInteger('', 2, 'concurrency', 8)).toBe(2);
    expect(parsePositiveInteger('8', 2, 'concurrency', 8)).toBe(8);
    expect(() => parsePositiveInteger('9', 2, 'concurrency', 8)).toThrow('between 1 and 8');
  });
});

describe('GitHub Action quality gate', () => {
  const findings = [
    { classification: 'confirmed' as const, severity: 'Critical' as const },
    { classification: 'confirmed' as const, severity: 'Moderate' as const },
    { classification: 'review' as const, severity: 'Serious' as const },
    { classification: 'blocker' as const, severity: 'Advisory' as const }
  ];

  it('keeps the default informational and excludes review findings from confirmed gates', () => {
    expect(evaluateGate('none', findings)).toMatchObject({ failed: false, matchedCount: 0 });
    expect(evaluateGate('serious', findings)).toMatchObject({ failed: true, matchedCount: 1 });
    expect(evaluateGate('confirmed', findings)).toMatchObject({ failed: true, matchedCount: 2 });
  });

  it('supports an explicit audit-blocker gate', () => {
    expect(evaluateGate('blockers', findings)).toMatchObject({ failed: true, matchedCount: 1 });
    expect(evaluateGate('critical', [])).toMatchObject({ failed: false, matchedCount: 0 });
  });
});
