import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { AuditConfigInput } from './config.js';
import { isJourneyDraftDocument } from './journey-drafts.js';
import { loadJourneyFile } from './journey-validation.js';

interface AuditConfigFile extends Partial<AuditConfigInput> {
  journeysFile?: unknown;
}

function nonEmptyPath(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty file path.`);
  }
  return value;
}

/**
 * Loads ordinary audit configuration and, when requested, replaces inline
 * journeys with a reusable strict-validated journey file.
 */
export async function loadAuditConfigFile(
  configPath?: string,
  journeysFileOverride?: string,
  storageStateOverride?: string
): Promise<Partial<AuditConfigInput>> {
  let fileConfig: AuditConfigFile = {};
  let configDirectory = process.cwd();

  if (configPath) {
    const absoluteConfigPath = resolve(configPath);
    configDirectory = dirname(absoluteConfigPath);
    const parsed: unknown = JSON.parse(await readFile(absoluteConfigPath, 'utf8'));
    if (isJourneyDraftDocument(parsed)) {
      throw new Error(
        'Journey drafts are non-runnable and cannot be used as audit configuration. '
        + 'Keep editing candidateJourneys until the draft is ready for approval.'
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Audit configuration must be a JSON object.');
    }
    fileConfig = { ...(parsed as AuditConfigFile) };
  }

  const hasInlineJourneys = Object.hasOwn(fileConfig, 'journeys');
  const configuredJourneysFile = fileConfig.journeysFile;
  delete fileConfig.journeysFile;

  if (journeysFileOverride !== undefined) {
    fileConfig.journeys = await loadJourneyFile(resolve(nonEmptyPath(journeysFileOverride, '--journeys-file')));
  } else if (configuredJourneysFile !== undefined) {
    if (hasInlineJourneys) {
      throw new Error('Audit configuration cannot contain both "journeys" and "journeysFile". Keep one journey source, or override both with --journeys-file.');
    }
    const path = resolve(configDirectory, nonEmptyPath(configuredJourneysFile, 'journeysFile'));
    fileConfig.journeys = await loadJourneyFile(path);
  }

  if (storageStateOverride !== undefined) {
    fileConfig.storageState = resolve(nonEmptyPath(storageStateOverride, '--storage-state'));
  } else if (fileConfig.storageState !== undefined) {
    fileConfig.storageState = resolve(configDirectory, nonEmptyPath(fileConfig.storageState, 'storageState'));
  }

  return fileConfig;
}
