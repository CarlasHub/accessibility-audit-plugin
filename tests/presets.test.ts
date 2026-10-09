import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { AUDIT_PRESETS, resolveOptions, type AuditConfigInput } from '../src/config.js';

describe('audit presets', () => {
  it('keeps the established defaults under the recommended standard preset', () => {
    const options = resolveOptions();
    expect(options).toMatchObject({
      preset: 'standard',
      aaaAdvisory: false,
      headless: true,
      timeoutMs: 30_000,
      maxTabStops: 120,
      maxLinksPerPage: 200,
      concurrency: 2,
      captureScreenshots: true
    });
  });

  it('provides additive thorough and same-coverage debug setups', () => {
    expect(resolveOptions({ preset: 'thorough' })).toMatchObject({
      preset: 'thorough',
      aaaAdvisory: true,
      timeoutMs: 45_000,
      maxTabStops: 240,
      maxLinksPerPage: 500
    });
    expect(resolveOptions({ preset: 'debug' })).toMatchObject({
      preset: 'debug',
      headless: false,
      concurrency: 1,
      timeoutMs: 60_000,
      captureScreenshots: true
    });
  });

  it('lets explicit settings override a preset without mutating its definition', () => {
    expect(resolveOptions({ preset: 'thorough', timeoutMs: 12_000, aaaAdvisory: false })).toMatchObject({
      preset: 'thorough',
      timeoutMs: 12_000,
      aaaAdvisory: false
    });
    expect(AUDIT_PRESETS.thorough.options.timeoutMs).toBe(45_000);
  });

  it('keeps the example config preset-neutral so switching presets applies their settings', async () => {
    const example = JSON.parse(
      await readFile(new URL('../audit.config.example.json', import.meta.url), 'utf8')
    ) as AuditConfigInput;

    expect(resolveOptions({ ...example, preset: 'thorough' })).toMatchObject({
      preset: 'thorough',
      aaaAdvisory: true,
      timeoutMs: 45_000,
      maxTabStops: 240,
      maxLinksPerPage: 500
    });
    expect(resolveOptions({ ...example, preset: 'debug' })).toMatchObject({
      preset: 'debug',
      headless: false,
      concurrency: 1,
      timeoutMs: 60_000
    });
  });

  it('rejects unknown preset names', () => {
    expect(() => resolveOptions({ preset: 'unknown' as 'standard' })).toThrow();
  });

  it('keeps page ceilings opt-in and validates their supported range', () => {
    expect(resolveOptions()).not.toHaveProperty('maxPages');
    expect(resolveOptions({ maxPages: 50_000 })).toMatchObject({ maxPages: 50_000 });
    expect(() => resolveOptions({ maxPages: 0 })).toThrow();
    expect(() => resolveOptions({ maxPages: 50_001 })).toThrow();
  });
});
