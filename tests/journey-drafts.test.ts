import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseJourneysInput } from '../src/github-action.js';
import {
  JOURNEY_DRAFT_KIND,
  createJourneyDraft,
  createJourneyDraftFile,
  createJourneyDraftFromSource,
  defaultJourneyDraftPath,
  formatJourneyDraftSummary,
  isJourneyDraftDocument,
  saveJourneyDraft
} from '../src/journey-drafts.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-draft-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const completeJourney = {
  id: 'open-menu',
  title: 'Open the menu',
  categories: ['keyboard'],
  steps: [{ action: 'press', selector: '#menu', key: 'Enter' }]
};

describe('journey drafts', () => {
  it('preserves incomplete fields and records strict validation issues without rejecting the save', () => {
    const partial = { title: 'Work in progress', steps: [] };
    const draft = createJourneyDraftFromSource(JSON.stringify(partial), '2026-10-08T10:00:00.000Z');

    expect(draft).toEqual(expect.objectContaining({
      kind: JOURNEY_DRAFT_KIND,
      schemaVersion: 1,
      status: 'draft',
      createdAt: '2026-10-08T10:00:00.000Z',
      updatedAt: '2026-10-08T10:00:00.000Z',
      candidateJourneys: [partial],
      validation: expect.objectContaining({ valid: false })
    }));
    expect(draft.validation.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('journeys[0].id'),
      expect.stringContaining('journeys[0].categories'),
      expect.stringContaining('journeys[0].steps')
    ]));
    expect(isJourneyDraftDocument(draft)).toBe(true);
    expect(isJourneyDraftDocument({ kind: 'something-else' })).toBe(false);
  });

  it('accepts established array and config shapes and marks complete candidates valid', () => {
    for (const source of [JSON.stringify([completeJourney]), JSON.stringify({ journeys: [completeJourney] })]) {
      const draft = createJourneyDraftFromSource(source);
      expect(draft.candidateJourneys).toEqual([completeJourney]);
      expect(draft.validation).toEqual({ valid: true, issues: [] });
    }
  });

  it('creates a useful blank draft and rejects malformed, primitive, or nested draft sources', () => {
    const blank = createJourneyDraft();
    expect(blank.candidateJourneys).toEqual([{}]);
    expect(blank.validation.valid).toBe(false);
    expect(() => createJourneyDraftFromSource('{')).toThrowError(expect.objectContaining({ code: 'invalid-json' }));
    expect(() => createJourneyDraftFromSource('"text"')).toThrowError(expect.objectContaining({ code: 'invalid-schema' }));
    expect(() => createJourneyDraftFromSource(JSON.stringify(blank))).toThrow('already a journey draft');
  });

  it('uses a predictable adjacent output name', () => {
    expect(defaultJourneyDraftPath('/tmp/team.journeys.json')).toBe('/tmp/team.journeys.draft.json');
    expect(defaultJourneyDraftPath('/tmp/team')).toBe('/tmp/team.draft.json');
  });

  it('writes a versioned draft without overwriting an existing file', async () => {
    const directory = await temporaryDirectory();
    const output = join(directory, 'candidate.json');
    const draft = createJourneyDraft([completeJourney], '2026-10-08T10:00:00.000Z');
    const summary = await saveJourneyDraft(draft, output);

    expect(summary).toEqual({ path: output, journeyCount: 1, valid: true, issueCount: 0 });
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(draft);
    await expect(saveJourneyDraft(draft, output)).rejects.toThrow('Refusing to overwrite');
  });

  it('loads a partial source file and creates the default adjacent draft', async () => {
    const directory = await temporaryDirectory();
    const input = join(directory, 'checkout.json');
    await writeFile(input, JSON.stringify({ title: 'Checkout' }));

    const summary = await createJourneyDraftFile(input, undefined, '2026-10-08T10:00:00.000Z');
    expect(summary.path).toBe(join(directory, 'checkout.draft.json'));
    expect(summary.valid).toBe(false);
  });

  it('cannot be mistaken for a GitHub Action journeys payload', () => {
    const draft = createJourneyDraft([completeJourney]);
    expect(() => parseJourneysInput(JSON.stringify(draft))).toThrow('Journey drafts are non-runnable');
  });

  it('sanitizes draft paths in human-readable output', () => {
    const summary = formatJourneyDraftSummary({
      path: '/tmp/draft\r\n\t\u001b[31m.json',
      journeyCount: 1,
      valid: false,
      issueCount: 2
    });
    for (const character of ['\r', '\t', String.fromCharCode(27)]) expect(summary).not.toContain(character);
    expect(summary).toContain('Drafts are never run by an audit');
  });
});
