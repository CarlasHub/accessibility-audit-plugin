import { describe, expect, it } from 'vitest';
import { normalizeCliArguments } from '../src/cli.js';

describe('professional CLI invocation', () => {
  it('routes a direct target to the audit command', () => {
    expect(normalizeCliArguments(['node', 'accessibility-audit', 'https://test.example/'])).toEqual([
      'node',
      'accessibility-audit',
      'audit',
      'https://test.example/'
    ]);
  });

  it('preserves explicit commands', () => {
    expect(normalizeCliArguments(['node', 'accessibility-audit', 'validate', 'report.xlsx'])).toEqual([
      'node',
      'accessibility-audit',
      'validate',
      'report.xlsx'
    ]);
  });
});
