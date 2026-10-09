import { readFile } from 'node:fs/promises';
import { resolveOptions, strictAuditJourneySchema } from './config.js';
import type { AuditJourneyDefinition } from './types.js';
import { singleLineText } from './text.js';

export type JourneyValidationErrorCode = 'file-read' | 'invalid-json' | 'invalid-schema';

export interface JourneyValidationSummary {
  valid: true;
  path: string;
  journeyCount: number;
  stepCount: number;
  journeys: Array<{
    id: string;
    title: string;
    stepCount: number;
  }>;
}

export interface JourneyValidationFailure {
  valid: false;
  code: JourneyValidationErrorCode;
  message: string;
  issues: string[];
}

export class JourneyValidationError extends Error {
  readonly code: JourneyValidationErrorCode;
  readonly issues: string[];

  constructor(code: JourneyValidationErrorCode, message: string, issues: string[] = []) {
    super(message);
    this.name = 'JourneyValidationError';
    this.code = code;
    this.issues = issues;
  }
}

function issuePath(path: PropertyKey[]): string {
  return path.reduce<string>((result, part) => {
    if (typeof part === 'number') return `${result}[${part}]`;
    return result ? `${result}.${String(part)}` : String(part);
  }, 'journeys');
}

function jsonErrorLocation(message: string): string | undefined {
  return message.match(/(?:at position \d+)(?: \(line \d+ column \d+\))?/i)?.[0]
    ?? message.match(/(?:at line \d+ column \d+)/i)?.[0];
}

export function parseJourneyDocument(source: string): AuditJourneyDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const location = jsonErrorLocation(detail);
    throw new JourneyValidationError(
      'invalid-json',
      `The journey file is not valid JSON${location ? ` (${location})` : ''}.`
    );
  }

  if (
    parsed
    && typeof parsed === 'object'
    && 'kind' in parsed
    && parsed.kind === 'accessibility-audit-journey-draft'
  ) {
    throw new JourneyValidationError(
      'invalid-schema',
      'Journey drafts are non-runnable. Approve the draft before using it as a journey file.'
    );
  }

  let journeys: unknown;
  if (Array.isArray(parsed)) {
    journeys = parsed;
  } else if (parsed && typeof parsed === 'object' && 'journeys' in parsed) {
    const wrapper = parsed as Record<string, unknown>;
    const unknownKeys = Object.keys(wrapper).filter((key) => key !== 'journeys');
    if (unknownKeys.length > 0) {
      const issues = unknownKeys.map((key) => `$.${key}: Unrecognized field.`);
      throw new JourneyValidationError(
        'invalid-schema',
        `Found ${issues.length} journey document schema ${issues.length === 1 ? 'issue' : 'issues'}:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
        issues
      );
    }
    journeys = wrapper.journeys;
  }
  if (!Array.isArray(journeys)) {
    throw new JourneyValidationError(
      'invalid-schema',
      'Expected a JSON array of journeys or an object containing a journeys array.'
    );
  }

  const result = strictAuditJourneySchema.array().max(100).safeParse(journeys);
  if (!result.success) {
    const issues = result.error.issues.flatMap((issue) => issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => `${issuePath([...issue.path, key])}: Unrecognized field.`)
      : [`${issuePath(issue.path)}: ${issue.message}`]);
    throw new JourneyValidationError(
      'invalid-schema',
      `Found ${issues.length} journey schema ${issues.length === 1 ? 'issue' : 'issues'}:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
      issues
    );
  }

  return resolveOptions({ journeys: result.data }).journeys;
}

export async function loadJourneyFile(path: string): Promise<AuditJourneyDefinition[]> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    throw new JourneyValidationError(
      'file-read',
      `Could not read the journey file "${path}". Check that the path exists and is readable.`
    );
  }

  return parseJourneyDocument(source);
}

export async function validateJourneyFile(path: string): Promise<JourneyValidationSummary> {
  const journeys = await loadJourneyFile(path);
  const summaries = journeys.map((journey) => ({
    id: journey.id,
    title: journey.title,
    stepCount: journey.steps.length
  }));
  return {
    valid: true,
    path,
    journeyCount: journeys.length,
    stepCount: summaries.reduce((total, journey) => total + journey.stepCount, 0),
    journeys: summaries
  };
}

export function formatJourneyValidationSummary(summary: JourneyValidationSummary): string {
  const count = `${summary.journeyCount} ${summary.journeyCount === 1 ? 'journey' : 'journeys'}`;
  const steps = `${summary.stepCount} ${summary.stepCount === 1 ? 'step' : 'steps'}`;
  const details = summary.journeys.length > 0
    ? `\n${summary.journeys.map((journey) => `  - ${singleLineText(journey.id)}: ${singleLineText(journey.title)} (${journey.stepCount} ${journey.stepCount === 1 ? 'step' : 'steps'})`).join('\n')}`
    : '';
  return `Valid journey file: ${singleLineText(summary.path)}\n${count}, ${steps}.${details}\n`;
}

export function toJourneyValidationFailure(error: JourneyValidationError): JourneyValidationFailure {
  return {
    valid: false,
    code: error.code,
    message: error.message,
    issues: error.issues
  };
}
