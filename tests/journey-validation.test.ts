import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  JourneyValidationError,
  formatJourneyValidationSummary,
  parseJourneyDocument,
  toJourneyValidationFailure,
  validateJourneyFile
} from '../src/journey-validation.js';

const journey = {
  id: 'open-menu',
  title: 'Open the account menu',
  categories: ['keyboard', 'interaction'],
  steps: [
    { action: 'press', selector: '#menu-button', key: 'Enter' },
    { action: 'assert', selector: '#menu-button', expectation: 'expanded' }
  ]
};

describe('standalone journey validation', () => {
  it('accepts the established array and configuration-object shapes', () => {
    expect(parseJourneyDocument(JSON.stringify([journey]))).toHaveLength(1);
    expect(parseJourneyDocument(JSON.stringify({ journeys: [journey] }))).toHaveLength(1);
  });

  it('reports all schema issues with actionable JSON paths', () => {
    expect.assertions(4);
    try {
      parseJourneyDocument(JSON.stringify([{ id: 'not valid!', title: '', categories: [], steps: [] }]));
    } catch (error) {
      expect(error).toBeInstanceOf(JourneyValidationError);
      expect((error as JourneyValidationError).issues.length).toBe(4);
      expect((error as Error).message).toContain('journeys[0].id');
      expect((error as Error).message).toContain('journeys[0].steps');
    }
  });

  it('distinguishes malformed JSON from an invalid document shape', () => {
    expect(() => parseJourneyDocument('{')).toThrowError(expect.objectContaining({ code: 'invalid-json' }));
    expect(() => parseJourneyDocument('{"items":[]}')).toThrowError(expect.objectContaining({ code: 'invalid-schema' }));
  });

  it('identifies draft envelopes as non-runnable journey files', () => {
    expect(() => parseJourneyDocument(JSON.stringify({
      kind: 'accessibility-audit-journey-draft',
      status: 'draft',
      candidateJourneys: [journey]
    }))).toThrow('Journey drafts are non-runnable');
    expect(() => parseJourneyDocument(JSON.stringify({
      kind: 'accessibility-audit-journey-draft',
      status: 'unsupported',
      journeys: [journey]
    }))).toThrow('Journey drafts are non-runnable');
  });

  it('rejects every unknown wrapper field with an actionable root JSON path', () => {
    try {
      parseJourneyDocument(JSON.stringify({ journeys: [journey], typo: true, version: 1 }));
      throw new Error('Expected validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(JourneyValidationError);
      expect((error as JourneyValidationError).issues).toEqual([
        '$.typo: Unrecognized field.',
        '$.version: Unrecognized field.'
      ]);
    }
  });

  it('does not echo malformed source content in JSON syntax errors', () => {
    const secret = 'SECRET_ACCESS_TOKEN=super-secret-value';
    try {
      parseJourneyDocument(secret);
      throw new Error('Expected parsing to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(JourneyValidationError);
      expect((error as Error).message).toContain('not valid JSON');
      expect((error as Error).message).not.toContain('SECRET');
      expect((error as Error).message).not.toContain('super-secret-value');
    }
  });

  it('rejects unknown journey and step fields with their exact paths', () => {
    const invalid = {
      ...journey,
      urlInclude: '/account',
      steps: [
        { action: 'press', key: 'Enter', selectorTypo: '#submit' },
        { action: 'assert', expectation: 'visible', valueTypo: 'ready' }
      ]
    };
    try {
      parseJourneyDocument(JSON.stringify([invalid]));
      throw new Error('Expected validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(JourneyValidationError);
      expect((error as JourneyValidationError).issues).toEqual(expect.arrayContaining([
        'journeys[0].urlInclude: Unrecognized field.',
        'journeys[0].steps[0].selectorTypo: Unrecognized field.',
        'journeys[0].steps[1].valueTypo: Unrecognized field.'
      ]));
    }
  });

  it('reads a file and returns a concise validation summary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-validation-'));
    const path = join(directory, 'journeys.json');
    await writeFile(path, JSON.stringify([journey]));
    try {
      const summary = await validateJourneyFile(path);
      expect(summary).toEqual(expect.objectContaining({ valid: true, path, journeyCount: 1, stepCount: 2 }));
      expect(formatJourneyValidationSummary(summary)).toContain('open-menu: Open the account menu (2 steps)');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects unknown wrapper fields when validating a standalone file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-validation-wrapper-'));
    const path = join(directory, 'journeys.json');
    await writeFile(path, JSON.stringify({ journeys: [journey], typo: true }));
    try {
      await expect(validateJourneyFile(path)).rejects.toThrow('$.typo');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('sanitizes human output while JSON output safely escapes structured values', () => {
    const summary = {
      valid: true as const,
      path: '/tmp/file\r\n\t\u001b[31m.json',
      journeyCount: 1,
      stepCount: 2,
      journeys: [{ id: 'open-menu', title: 'Safe\r\n\t\u001b[31mFAKE FAILURE', stepCount: 2 }]
    };
    const human = formatJourneyValidationSummary(summary);
    for (const character of ['\r', '\t', String.fromCharCode(27)]) expect(human).not.toContain(character);
    expect(human.split('\n')).toHaveLength(4);
    expect(human).not.toContain('\nFAKE FAILURE');
    expect(human).toContain('Safe [31mFAKE FAILURE');

    const failure = toJourneyValidationFailure(new JourneyValidationError(
      'invalid-schema',
      'Invalid\nfield',
      ['journeys[0].title: Invalid\nfield']
    ));
    expect(JSON.parse(JSON.stringify(failure))).toEqual(failure);
  });

  it('preserves each failure code through human and JSON CLI modes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-failures-'));
    const missing = join(directory, 'missing.json');
    const malformed = join(directory, 'malformed.json');
    const invalid = join(directory, 'invalid.json');
    await writeFile(malformed, 'SECRET_ACCESS_TOKEN=super-secret-value');
    await writeFile(invalid, JSON.stringify([{ ...journey, urlInclude: '/account' }]));
    try {
      for (const [path, code] of [
        [missing, 'file-read'],
        [malformed, 'invalid-json'],
        [invalid, 'invalid-schema']
      ] as const) {
        const human = spawnSync(
          process.execPath,
          ['--import', 'tsx', 'src/cli.ts', 'journeys', 'validate', path],
          { cwd: process.cwd(), encoding: 'utf8' }
        );
        expect(human.status).toBe(1);
        expect(human.stderr).toContain(`Journey validation failed (${code}).`);

        const json = spawnSync(
          process.execPath,
          ['--import', 'tsx', 'src/cli.ts', 'journeys', 'validate', path, '--json'],
          { cwd: process.cwd(), encoding: 'utf8' }
        );
        expect(json.status).toBe(1);
        expect(json.stderr).toBe('');
        expect(JSON.parse(json.stdout)).toEqual(expect.objectContaining({ valid: false, code }));
      }
      const malformedHuman = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'src/cli.ts', 'journeys', 'validate', malformed],
        { cwd: process.cwd(), encoding: 'utf8' }
      );
      expect(malformedHuman.stderr).not.toContain('SECRET_ACCESS_TOKEN');
      expect(malformedHuman.stderr).not.toContain('super-secret-value');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
