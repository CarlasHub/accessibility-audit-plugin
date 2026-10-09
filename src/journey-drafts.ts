import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { JourneyValidationError, parseJourneyDocument } from './journey-validation.js';
import { singleLineText } from './text.js';

export const JOURNEY_DRAFT_KIND = 'accessibility-audit-journey-draft' as const;
export const JOURNEY_DRAFT_SCHEMA_VERSION = 1 as const;

export type JourneyDraftErrorCode =
  | 'file-read'
  | 'invalid-json'
  | 'invalid-schema'
  | 'file-exists'
  | 'file-write';

export class JourneyDraftError extends Error {
  readonly name = 'JourneyDraftError';

  constructor(
    readonly code: JourneyDraftErrorCode,
    message: string
  ) {
    super(message);
  }
}

export interface JourneyDraftDocument {
  kind: typeof JOURNEY_DRAFT_KIND;
  schemaVersion: typeof JOURNEY_DRAFT_SCHEMA_VERSION;
  status: 'draft';
  createdAt: string;
  updatedAt: string;
  candidateJourneys: unknown[];
  validation: {
    valid: boolean;
    issues: string[];
  };
}

export interface JourneyDraftSaveSummary {
  path: string;
  journeyCount: number;
  valid: boolean;
  issueCount: number;
}

export function isJourneyDraftDocument(value: unknown): value is JourneyDraftDocument {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as Record<string, unknown>).kind === JOURNEY_DRAFT_KIND
  );
}

function parseDraftSource(source: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new JourneyDraftError('invalid-json', 'The journey draft source is not valid JSON.');
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (isJourneyDraftDocument(record)) {
      throw new JourneyDraftError(
        'invalid-schema',
        'This file is already a journey draft. Edit its candidateJourneys array directly instead of nesting it in another draft.'
      );
    }
    if (Array.isArray(record.journeys)) return record.journeys;
    return [parsed];
  }

  throw new JourneyDraftError(
    'invalid-schema',
    'A journey draft source must be a journey object, a journey array, or an object containing a journeys array.'
  );
}

function validationSnapshot(candidateJourneys: unknown[]): JourneyDraftDocument['validation'] {
  try {
    parseJourneyDocument(JSON.stringify(candidateJourneys));
    return { valid: true, issues: [] };
  } catch (error) {
    if (error instanceof JourneyValidationError && error.code === 'invalid-schema') {
      return {
        valid: false,
        issues: error.issues.length > 0 ? error.issues : [error.message]
      };
    }
    throw error;
  }
}

export function createJourneyDraft(
  candidateJourneys: unknown[] = [{}],
  timestamp = new Date().toISOString()
): JourneyDraftDocument {
  return {
    kind: JOURNEY_DRAFT_KIND,
    schemaVersion: JOURNEY_DRAFT_SCHEMA_VERSION,
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
    candidateJourneys,
    validation: validationSnapshot(candidateJourneys)
  };
}

export function createJourneyDraftFromSource(
  source: string,
  timestamp = new Date().toISOString()
): JourneyDraftDocument {
  return createJourneyDraft(parseDraftSource(source), timestamp);
}

export function defaultJourneyDraftPath(inputPath?: string): string {
  if (!inputPath) return resolve('journey-draft.json');
  const absolute = resolve(inputPath);
  const extension = extname(absolute);
  const stem = extension ? basename(absolute, extension) : basename(absolute);
  return join(dirname(absolute), `${stem}.draft.json`);
}

export async function saveJourneyDraft(
  draft: JourneyDraftDocument,
  outputPath: string
): Promise<JourneyDraftSaveSummary> {
  const path = resolve(outputPath);
  try {
    await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'EEXIST') {
      throw new JourneyDraftError(
        'file-exists',
        `Refusing to overwrite the existing journey draft "${path}". Choose a different --output path.`
      );
    }
    throw new JourneyDraftError(
      'file-write',
      `Could not write the journey draft "${path}". Check that its parent directory exists and is writable.`
    );
  }
  return {
    path,
    journeyCount: draft.candidateJourneys.length,
    valid: draft.validation.valid,
    issueCount: draft.validation.issues.length
  };
}

export async function createJourneyDraftFile(
  inputPath?: string,
  outputPath = defaultJourneyDraftPath(inputPath),
  timestamp = new Date().toISOString()
): Promise<JourneyDraftSaveSummary> {
  let draft: JourneyDraftDocument;
  if (!inputPath) {
    draft = createJourneyDraft(undefined, timestamp);
  } else {
    let source: string;
    try {
      source = await readFile(resolve(inputPath), 'utf8');
    } catch {
      throw new JourneyDraftError(
        'file-read',
        `Could not read the journey draft source "${inputPath}". Check that the path exists and is readable.`
      );
    }
    draft = createJourneyDraftFromSource(source, timestamp);
  }
  return saveJourneyDraft(draft, outputPath);
}

export function formatJourneyDraftSummary(summary: JourneyDraftSaveSummary): string {
  const validation = summary.valid
    ? 'Its current contents pass strict journey validation and are ready for the approval step.'
    : `${summary.issueCount} validation ${summary.issueCount === 1 ? 'issue is' : 'issues are'} recorded for later correction.`;
  return `Journey draft saved: ${singleLineText(summary.path)}\n` +
    `${summary.journeyCount} candidate ${summary.journeyCount === 1 ? 'journey' : 'journeys'}. ${validation}\n` +
    'Drafts are never run by an audit; edit candidateJourneys until the work is ready for approval.\n';
}
