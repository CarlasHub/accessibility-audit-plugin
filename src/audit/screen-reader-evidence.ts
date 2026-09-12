export type SupportedScreenReader = 'VoiceOver' | 'NVDA';

export interface ScreenReaderJourneyEvidenceStep {
  command: string;
  spokenPhrase: string;
}

export interface ScreenReaderEvidenceDocument {
  schemaVersion: 1;
  generatedAt: string;
  targetUrl: string;
  screenReader: SupportedScreenReader;
  status: 'evidence-captured' | 'inconclusive';
  environment: {
    operatingSystem: string;
    node: string;
    browser: string;
    browserVersion: string;
    guidepup: string;
  };
  journey: ScreenReaderJourneyEvidenceStep[];
  transcript: string[];
  pageInventory: {
    documentTitle: string;
    language: string | null;
    headings: Array<{ level: number; text: string }>;
    landmarks: string[];
    interactiveElementCount: number;
  };
  warnings: string[];
  conformanceNotice: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Reject incomplete native assistive-technology evidence before it is written or
 * uploaded. This validates provenance and completeness; it deliberately does not
 * turn a transcript into a WCAG pass or failure.
 */
export function screenReaderEvidenceValidationErrors(value: unknown): string[] {
  if (!isRecord(value)) return ['evidence must be an object'];
  const errors: string[] = [];
  if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!nonEmptyString(value.generatedAt) || Number.isNaN(Date.parse(value.generatedAt))) errors.push('generatedAt must be an ISO date');
  try {
    const url = new URL(String(value.targetUrl ?? ''));
    if (!['http:', 'https:'].includes(url.protocol)) errors.push('targetUrl must use http or https');
  } catch {
    errors.push('targetUrl must be a valid URL');
  }
  if (value.screenReader !== 'VoiceOver' && value.screenReader !== 'NVDA') errors.push('screenReader must be VoiceOver or NVDA');
  if (value.status !== 'evidence-captured' && value.status !== 'inconclusive') errors.push('status is invalid');

  if (!isRecord(value.environment)) {
    errors.push('environment is required');
  } else {
    for (const field of ['operatingSystem', 'node', 'browser', 'browserVersion', 'guidepup'] as const) {
      if (!nonEmptyString(value.environment[field])) errors.push(`environment.${field} is required`);
    }
  }

  if (!Array.isArray(value.journey) || value.journey.length === 0) {
    errors.push('journey must contain at least one step');
  } else if (value.journey.some((step) => !isRecord(step) || !nonEmptyString(step.command) || typeof step.spokenPhrase !== 'string')) {
    errors.push('every journey step requires a command and spokenPhrase field');
  }
  if (!Array.isArray(value.transcript) || value.transcript.some((phrase) => !nonEmptyString(phrase))) errors.push('transcript must be an array of non-empty phrases');
  if (value.status === 'evidence-captured' && Array.isArray(value.transcript) && value.transcript.length === 0) {
    errors.push('evidence-captured status requires a transcript');
  }

  if (!isRecord(value.pageInventory)) {
    errors.push('pageInventory is required');
  } else {
    if (typeof value.pageInventory.documentTitle !== 'string') errors.push('pageInventory.documentTitle is required');
    if (value.pageInventory.language !== null && typeof value.pageInventory.language !== 'string') errors.push('pageInventory.language is invalid');
    if (!Array.isArray(value.pageInventory.headings)) errors.push('pageInventory.headings is required');
    if (!Array.isArray(value.pageInventory.landmarks)) errors.push('pageInventory.landmarks is required');
    if (!Number.isInteger(value.pageInventory.interactiveElementCount) || Number(value.pageInventory.interactiveElementCount) < 0) {
      errors.push('pageInventory.interactiveElementCount must be a non-negative integer');
    }
  }
  if (!Array.isArray(value.warnings) || value.warnings.some((warning) => !nonEmptyString(warning))) errors.push('warnings must be an array of non-empty strings');
  if (!nonEmptyString(value.conformanceNotice) || !/human/i.test(value.conformanceNotice)) errors.push('conformanceNotice must require human review');
  return errors;
}

export function assertScreenReaderEvidence(value: unknown): asserts value is ScreenReaderEvidenceDocument {
  const errors = screenReaderEvidenceValidationErrors(value);
  if (errors.length > 0) throw new Error(`Invalid screen-reader evidence:\n- ${errors.join('\n- ')}`);
}
