import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { AuditJourneyDefinition } from './types.js';
import {
  JOURNEY_DRAFT_KIND,
  JOURNEY_DRAFT_SCHEMA_VERSION,
  type JourneyDraftDocument
} from './journey-drafts.js';
import { JourneyValidationError, parseJourneyDocument } from './journey-validation.js';
import { singleLineText } from './text.js';

export type JourneyApprovalErrorCode =
  | 'file-read'
  | 'invalid-json'
  | 'invalid-draft'
  | 'invalid-schema'
  | 'file-exists'
  | 'file-write';

export class JourneyApprovalError extends Error {
  readonly name = 'JourneyApprovalError';

  constructor(
    readonly code: JourneyApprovalErrorCode,
    message: string,
    readonly issues: string[] = []
  ) {
    super(message);
  }
}

export interface ApprovedJourneyDocument {
  journeys: AuditJourneyDefinition[];
}

export interface JourneyApprovalSummary {
  path: string;
  journeyCount: number;
  stepCount: number;
}

function validValidationSnapshot(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.valid === 'boolean'
    && Array.isArray(snapshot.issues)
    && snapshot.issues.every((issue) => typeof issue === 'string');
}

function validDraftTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export function parseJourneyDraftForApproval(source: string): JourneyDraftDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new JourneyApprovalError('invalid-json', 'The journey draft is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new JourneyApprovalError('invalid-draft', 'Expected a versioned accessibility-audit journey draft.');
  }
  const draft = parsed as Record<string, unknown>;
  if (
    draft.kind !== JOURNEY_DRAFT_KIND
    || draft.schemaVersion !== JOURNEY_DRAFT_SCHEMA_VERSION
    || draft.status !== 'draft'
    || !validDraftTimestamp(draft.createdAt)
    || !validDraftTimestamp(draft.updatedAt)
    || !Array.isArray(draft.candidateJourneys)
    || !validValidationSnapshot(draft.validation)
  ) {
    throw new JourneyApprovalError(
      'invalid-draft',
      `Expected a ${JOURNEY_DRAFT_KIND} draft with schemaVersion ${JOURNEY_DRAFT_SCHEMA_VERSION}.`
    );
  }
  return draft as unknown as JourneyDraftDocument;
}

export function approveJourneyDraft(source: string): ApprovedJourneyDocument {
  const draft = parseJourneyDraftForApproval(source);
  try {
    return { journeys: parseJourneyDocument(JSON.stringify(draft.candidateJourneys)) };
  } catch (error) {
    if (error instanceof JourneyValidationError) {
      throw new JourneyApprovalError(
        error.code === 'invalid-json' ? 'invalid-json' : 'invalid-schema',
        error.message,
        error.issues
      );
    }
    throw error;
  }
}

export function defaultApprovedJourneyPath(inputPath: string): string {
  const absolute = resolve(inputPath);
  const extension = extname(absolute);
  const stem = extension ? basename(absolute, extension) : basename(absolute);
  const approvedStem = stem.endsWith('.draft')
    ? `${stem.slice(0, -'.draft'.length)}.journeys`
    : `${stem}.approved`;
  return join(dirname(absolute), `${approvedStem}.json`);
}

export async function approveJourneyDraftFile(
  inputPath: string,
  outputPath = defaultApprovedJourneyPath(inputPath)
): Promise<JourneyApprovalSummary> {
  let source: string;
  try {
    source = await readFile(resolve(inputPath), 'utf8');
  } catch {
    throw new JourneyApprovalError(
      'file-read',
      `Could not read the journey draft "${inputPath}". Check that the path exists and is readable.`
    );
  }
  const approved = approveJourneyDraft(source);
  const path = resolve(outputPath);
  try {
    await writeFile(path, `${JSON.stringify(approved, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'EEXIST') {
      throw new JourneyApprovalError(
        'file-exists',
        `Refusing to overwrite the existing approved journey file "${path}". Choose a different --output path.`
      );
    }
    throw new JourneyApprovalError(
      'file-write',
      `Could not write the approved journey file "${path}". Check that its parent directory exists and is writable.`
    );
  }
  return {
    path,
    journeyCount: approved.journeys.length,
    stepCount: approved.journeys.reduce((total, journey) => total + journey.steps.length, 0)
  };
}

export function formatJourneyApprovalSummary(summary: JourneyApprovalSummary): string {
  return `Journey draft approved: ${singleLineText(summary.path)}\n`
    + `${summary.journeyCount} ${summary.journeyCount === 1 ? 'journey' : 'journeys'}, `
    + `${summary.stepCount} ${summary.stepCount === 1 ? 'step' : 'steps'}.\n`
    + 'No audit was started. Use this file with --config or the GitHub Action journeys-file input.\n';
}
