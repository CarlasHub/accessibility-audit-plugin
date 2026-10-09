import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAccessibilityAuditCli } from '../src/cli.js';
import { loadAuditConfigFile } from '../src/journey-config.js';

const journey = {
  id: 'open-menu',
  title: 'Open the account menu',
  categories: ['keyboard', 'interaction'],
  steps: [
    { action: 'focus', selector: '#menu-button' },
    { action: 'press', key: 'Enter' },
    { action: 'assert', expectation: 'expanded', selector: '#menu-button' }
  ]
};

describe('reusable journey configuration', () => {
  it('resolves saved browser state relative to config and lets a direct CLI path override it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-storage-state-config-'));
    const configPath = join(directory, 'audit.json');
    const configuredState = join(directory, '.auth', 'configured.json');
    const overrideState = join(directory, 'override.json');
    await writeFile(configPath, JSON.stringify({ storageState: '.auth/configured.json' }));
    const requests: unknown[] = [];
    try {
      expect(await loadAuditConfigFile(configPath)).toEqual({ storageState: configuredState });
      expect(await loadAuditConfigFile(configPath, undefined, overrideState)).toEqual({ storageState: overrideState });

      const program = createAccessibilityAuditCli({
        runAudit: async (request) => { requests.push(request); },
        isInteractiveTerminal: () => false
      });
      await program.parseAsync([
        'node', 'accessibility-audit', 'audit', 'https://test.example/',
        '--config', configPath, '--storage-state', overrideState, '--yes'
      ]);
      expect(requests).toEqual([expect.objectContaining({
        options: expect.objectContaining({ storageState: overrideState })
      })]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('resolves journeysFile relative to its audit configuration and loads an approved object', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-config-'));
    const journeysDirectory = join(directory, 'journeys');
    const configPath = join(directory, 'audit.json');
    const journeyPath = join(journeysDirectory, 'approved.json');
    await mkdir(journeysDirectory);
    await writeFile(journeyPath, JSON.stringify({ journeys: [journey] }));
    await writeFile(configPath, JSON.stringify({ preset: 'thorough', journeysFile: 'journeys/approved.json' }));
    try {
      const config = await loadAuditConfigFile(configPath);
      expect(config).toEqual(expect.objectContaining({
        preset: 'thorough',
        journeys: [expect.objectContaining({ id: 'open-menu' })]
      }));
      expect(config).not.toHaveProperty('journeysFile');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects ambiguous inline and file-backed journeys unless the CLI explicitly overrides both', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-config-conflict-'));
    const configPath = join(directory, 'audit.json');
    const overridePath = join(directory, 'override.json');
    await writeFile(overridePath, JSON.stringify([{ ...journey, id: 'override-menu' }]));
    await writeFile(configPath, JSON.stringify({ journeys: [journey], journeysFile: 'missing.json' }));
    try {
      await expect(loadAuditConfigFile(configPath)).rejects.toThrow('cannot contain both');
      const overridden = await loadAuditConfigFile(configPath, overridePath);
      expect(overridden.journeys).toEqual([expect.objectContaining({ id: 'override-menu' })]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('strictly rejects unknown fields and draft envelopes before returning audit options', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-config-invalid-'));
    const unknownFieldPath = join(directory, 'unknown.json');
    const draftPath = join(directory, 'draft.json');
    await writeFile(unknownFieldPath, JSON.stringify([{ ...journey, urlInclude: '/account' }]));
    await writeFile(draftPath, JSON.stringify({
      kind: 'accessibility-audit-journey-draft',
      schemaVersion: 1,
      status: 'draft',
      candidateJourneys: [journey]
    }));
    try {
      await expect(loadAuditConfigFile(undefined, unknownFieldPath)).rejects.toThrow('urlInclude');
      await expect(loadAuditConfigFile(undefined, draftPath)).rejects.toThrow('drafts are non-runnable');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('passes --journeys-file content to the audit and never starts work when that file is invalid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'a11y-journey-config-cli-'));
    const validPath = join(directory, 'valid.json');
    const invalidPath = join(directory, 'invalid.json');
    const invalidWrapperPath = join(directory, 'invalid-wrapper.json');
    const configPath = join(directory, 'audit.json');
    await writeFile(validPath, JSON.stringify([journey]));
    await writeFile(invalidPath, JSON.stringify([{ ...journey, urlInclude: '/typo' }]));
    await writeFile(invalidWrapperPath, JSON.stringify({ journeys: [journey], typo: true }));
    await writeFile(configPath, JSON.stringify({ journeysFile: 'invalid-wrapper.json' }));
    const requests: unknown[] = [];
    try {
      const program = createAccessibilityAuditCli({
        runAudit: async (request) => { requests.push(request); },
        isInteractiveTerminal: () => false
      });
      await program.parseAsync([
        'node', 'accessibility-audit', 'audit', 'https://test.example/',
        '--journeys-file', validPath, '--yes'
      ]);
      expect(requests).toEqual([expect.objectContaining({
        options: expect.objectContaining({ journeys: [expect.objectContaining({ id: 'open-menu' })] })
      })]);

      const invalidProgram = createAccessibilityAuditCli({
        runAudit: async (request) => { requests.push(request); },
        isInteractiveTerminal: () => false
      });
      await expect(invalidProgram.parseAsync([
        'node', 'accessibility-audit', 'audit', 'https://test.example/',
        '--journeys-file', invalidPath, '--yes'
      ])).rejects.toThrow('urlInclude');
      expect(requests).toHaveLength(1);

      const invalidConfiguredProgram = createAccessibilityAuditCli({
        runAudit: async (request) => { requests.push(request); },
        isInteractiveTerminal: () => false
      });
      await expect(invalidConfiguredProgram.parseAsync([
        'node', 'accessibility-audit', 'audit', 'https://test.example/',
        '--config', configPath, '--yes'
      ])).rejects.toThrow('$.typo');
      expect(requests).toHaveLength(1);

      const invalidOverrideProgram = createAccessibilityAuditCli({
        runAudit: async (request) => { requests.push(request); },
        isInteractiveTerminal: () => false
      });
      await expect(invalidOverrideProgram.parseAsync([
        'node', 'accessibility-audit', 'audit', 'https://test.example/',
        '--journeys-file', invalidWrapperPath, '--yes'
      ])).rejects.toThrow('$.typo');
      expect(requests).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
