import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseJourneysInput } from '../src/github-action.js';
import {
  approveJourneyDraft,
  approveJourneyDraftFile,
  defaultApprovedJourneyPath,
  formatJourneyApprovalSummary,
  parseJourneyDraftForApproval
} from '../src/journey-approval.js';
import { createJourneyDraft } from '../src/journey-drafts.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-approval-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const completeJourney = {
  id: 'checkout-errors',
  title: 'Submit an invalid checkout form',
  categories: ['forms', 'dynamic-content'],
  urlIncludes: '/checkout',
  steps: [
    { action: 'press', selector: '#submit', key: 'Enter' },
    { action: 'assert', expectation: 'live-region-updated', selector: '#errors', value: 'required' }
  ]
};

describe('journey draft approval', () => {
  it('freshly validates candidates and exports the established runnable config shape', () => {
    const draft = createJourneyDraft([completeJourney]);
    draft.validation = { valid: false, issues: ['stale snapshot'] };

    const approved = approveJourneyDraft(JSON.stringify(draft));

    expect(approved).toEqual({ journeys: [completeJourney] });
    expect(parseJourneysInput(JSON.stringify(approved))).toEqual([completeJourney]);
  });

  it.each([
    ['plain journey config', { journeys: [completeJourney] }, 'invalid-draft'],
    ['wrong version', { ...createJourneyDraft([completeJourney]), schemaVersion: 2 }, 'invalid-draft'],
    ['wrong status', { ...createJourneyDraft([completeJourney]), status: 'approved' }, 'invalid-draft'],
    ['empty created timestamp', { ...createJourneyDraft([completeJourney]), createdAt: '' }, 'invalid-draft'],
    ['invalid updated timestamp', { ...createJourneyDraft([completeJourney]), updatedAt: 'not-a-date' }, 'invalid-draft'],
    ['impossible timestamp', { ...createJourneyDraft([completeJourney]), createdAt: '2026-02-31T10:00:00.000Z' }, 'invalid-draft'],
    ['missing metadata', { kind: 'accessibility-audit-journey-draft', candidateJourneys: [completeJourney] }, 'invalid-draft']
  ])('rejects %s instead of silently approving it', (_label, value, code) => {
    expect(() => parseJourneyDraftForApproval(JSON.stringify(value))).toThrowError(expect.objectContaining({ code }));
  });

  it('returns every strict candidate issue and does not trust a stale valid snapshot', () => {
    const draft = createJourneyDraft([{ title: 'Incomplete', steps: [] }]);
    draft.validation = { valid: true, issues: [] };

    expect(() => approveJourneyDraft(JSON.stringify(draft))).toThrowError(expect.objectContaining({
      code: 'invalid-schema',
      issues: expect.arrayContaining([
        expect.stringContaining('journeys[0].id'),
        expect.stringContaining('journeys[0].categories'),
        expect.stringContaining('journeys[0].steps')
      ])
    }));
  });

  it('uses predictable adjacent output names', () => {
    expect(defaultApprovedJourneyPath('/tmp/checkout.draft.json')).toBe('/tmp/checkout.journeys.json');
    expect(defaultApprovedJourneyPath('/tmp/review.json')).toBe('/tmp/review.approved.json');
    expect(defaultApprovedJourneyPath('/tmp/review')).toBe('/tmp/review.approved.json');
  });

  it('writes approved configuration without changing the draft or overwriting an output', async () => {
    const directory = await temporaryDirectory();
    const input = join(directory, 'checkout.draft.json');
    const draft = createJourneyDraft([completeJourney], '2026-10-08T10:00:00.000Z');
    await writeFile(input, JSON.stringify(draft));

    const summary = await approveJourneyDraftFile(input);

    expect(summary).toEqual({
      path: join(directory, 'checkout.journeys.json'),
      journeyCount: 1,
      stepCount: 2
    });
    expect(JSON.parse(await readFile(summary.path, 'utf8'))).toEqual({ journeys: [completeJourney] });
    expect(JSON.parse(await readFile(input, 'utf8'))).toEqual(draft);
    await expect(approveJourneyDraftFile(input)).rejects.toThrowError(expect.objectContaining({ code: 'file-exists' }));
  });

  it('sanitizes paths and states that approval did not start an audit', () => {
    const summary = formatJourneyApprovalSummary({
      path: '/tmp/approved\r\n\t\u001b[31m.json',
      journeyCount: 1,
      stepCount: 2
    });
    for (const character of ['\r', '\t', String.fromCharCode(27)]) expect(summary).not.toContain(character);
    expect(summary).toContain('No audit was started');
    expect(summary).toContain('--config');
    expect(summary).toContain('journeys-file');
  });
});
