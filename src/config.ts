import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { AuditOptions, ViewportDefinition } from './types.js';
import { DEFAULT_AUDITOR, DEFAULT_OUTPUT_DIR } from './instructions.js';

export const DEFAULT_VIEWPORTS: ViewportDefinition[] = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
  { name: 'reflow-320', width: 320, height: 800, isMobile: true }
];

export const AUDIT_PRESETS = {
  standard: {
    description: 'Recommended WCAG 2.2 AA audit with the established coverage defaults.',
    options: {}
  },
  thorough: {
    description: 'Adds AAA advisory checks and raises time, keyboard, and link limits for release readiness.',
    options: { aaaAdvisory: true, timeoutMs: 45_000, maxTabStops: 240, maxLinksPerPage: 500 }
  },
  debug: {
    description: 'Runs the same core checks visibly and one page at a time with a longer timeout.',
    options: { headless: false, concurrency: 1, timeoutMs: 60_000 }
  }
} as const;

export type AuditPresetName = keyof typeof AUDIT_PRESETS;

const viewportSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  isMobile: z.boolean().optional()
});

const focusStepShape = { action: z.literal('focus'), selector: z.string().min(1).max(1000) };
const pressStepShape = { action: z.literal('press'), key: z.string().min(1).max(80), selector: z.string().min(1).max(1000).optional() };
const typeStepShape = { action: z.literal('type'), selector: z.string().min(1).max(1000), text: z.string().max(10_000) };
const waitStepShape = { action: z.literal('wait'), milliseconds: z.number().int().min(0).max(5_000) };
const assertStepShape = {
    action: z.literal('assert'),
    expectation: z.enum([
      'focused',
      'visible',
      'hidden',
      'expanded',
      'collapsed',
      'pressed',
      'unpressed',
      'selected',
      'checked',
      'unchecked',
      'invalid',
      'valid',
      'url-contains',
      'text-contains',
      'value-equals',
      'live-region-updated'
    ]),
    selector: z.string().min(1).max(1000).optional(),
    value: z.string().max(10_000).optional(),
    timeoutMs: z.number().int().min(0).max(10_000).optional()
};

const journeyStepSchema = z.discriminatedUnion('action', [
  z.object(focusStepShape),
  z.object(pressStepShape),
  z.object(typeStepShape),
  z.object(waitStepShape),
  z.object(assertStepShape)
]);

const journeyShape = {
  id: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/i),
  title: z.string().min(1).max(200),
  categories: z.array(z.enum(['keyboard', 'forms', 'interaction', 'dynamic-content'])).min(1).max(4),
  urlIncludes: z.string().min(1).max(2000).optional(),
  viewports: z.array(z.string().min(1).max(100)).min(1).max(20).optional(),
  steps: z.array(journeyStepSchema).min(1).max(100)
};

export const auditJourneySchema = z.object(journeyShape);

/** Strict schema for explicit validation; runtime config parsing remains backward-compatible and strips unknown fields. */
export const strictAuditJourneySchema = z.strictObject({
  ...journeyShape,
  steps: z.array(z.discriminatedUnion('action', [
    z.strictObject(focusStepShape),
    z.strictObject(pressStepShape),
    z.strictObject(typeStepShape),
    z.strictObject(waitStepShape),
    z.strictObject(assertStepShape)
  ])).min(1).max(100)
});

const configSchema = z.object({
  preset: z.enum(['standard', 'thorough', 'debug']).default('standard'),
  auditor: z.string().min(1).default(DEFAULT_AUDITOR),
  wcagLevel: z.enum(['AA', 'AAA']).default('AA'),
  aaaAdvisory: z.boolean().default(false),
  outputDir: z.string().min(1).default(DEFAULT_OUTPUT_DIR),
  landingPageUrl: z.string().url().optional(),
  allowedHosts: z.array(z.string().min(1)).default([]),
  exactHosts: z.array(z.string().min(1)).default([]),
  maxPages: z.number().int().min(1).max(50_000).optional(),
  stagingOnly: z.boolean().default(false),
  headless: z.boolean().default(true),
  browserEngine: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  autoInstallBrowser: z.boolean().default(true),
  storageState: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
  executablePath: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().default(30_000),
  maxTabStops: z.number().int().min(1).max(500).default(120),
  maxLinksPerPage: z.number().int().min(1).max(1000).default(200),
  concurrency: z.number().int().min(1).max(8).default(2),
  captureScreenshots: z.boolean().default(true),
  viewports: z.array(viewportSchema).min(1).default(DEFAULT_VIEWPORTS),
  journeys: z.array(auditJourneySchema).max(100).default([])
});

export type AuditConfigInput = z.input<typeof configSchema>;

export function resolveOptions(input: Partial<AuditConfigInput> = {}): AuditOptions {
  const preset = z.enum(['standard', 'thorough', 'debug']).default('standard').parse(input.preset);
  const parsed = configSchema.parse({ ...AUDIT_PRESETS[preset].options, ...input, preset });
  if (parsed.browserEngine !== 'chromium' && parsed.channel) {
    throw new Error('Browser channels are supported only with the Chromium engine. Remove channel or select browserEngine "chromium".');
  }
  const aaaAdvisory = parsed.aaaAdvisory || parsed.wcagLevel === 'AAA';
  return {
    preset: parsed.preset,
    auditor: parsed.auditor,
    wcagLevel: aaaAdvisory ? 'AAA' : 'AA',
    aaaAdvisory,
    outputDir: resolve(parsed.outputDir),
    ...(parsed.landingPageUrl ? { landingPageUrl: parsed.landingPageUrl } : {}),
    allowedHosts: parsed.allowedHosts.map((host) => host.toLowerCase()),
    exactHosts: parsed.exactHosts.map((host) => host.toLowerCase()),
    ...(parsed.maxPages !== undefined ? { maxPages: parsed.maxPages } : {}),
    stagingOnly: parsed.stagingOnly,
    headless: parsed.headless,
    browserEngine: parsed.browserEngine,
    autoInstallBrowser: parsed.autoInstallBrowser,
    ...(parsed.storageState ? { storageState: resolve(parsed.storageState) } : {}),
    timeoutMs: parsed.timeoutMs,
    maxTabStops: parsed.maxTabStops,
    maxLinksPerPage: parsed.maxLinksPerPage,
    concurrency: parsed.concurrency,
    captureScreenshots: parsed.captureScreenshots,
    viewports: parsed.viewports.map((viewport) => ({
      name: viewport.name,
      width: viewport.width,
      height: viewport.height,
      ...(viewport.isMobile !== undefined ? { isMobile: viewport.isMobile } : {})
    })),
    journeys: parsed.journeys.map((journey) => ({
      id: journey.id,
      title: journey.title,
      categories: journey.categories,
      steps: journey.steps.map((step) => {
        if (step.action === 'press') return { action: step.action, key: step.key, ...(step.selector ? { selector: step.selector } : {}) };
        if (step.action === 'assert') return {
          action: step.action,
          expectation: step.expectation,
          ...(step.selector ? { selector: step.selector } : {}),
          ...(step.value !== undefined ? { value: step.value } : {}),
          ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {})
        };
        return step;
      }),
      ...(journey.urlIncludes ? { urlIncludes: journey.urlIncludes } : {}),
      ...(journey.viewports ? { viewports: journey.viewports } : {})
    })),
    ...(parsed.channel ? { channel: parsed.channel } : {}),
    ...(parsed.executablePath ? { executablePath: parsed.executablePath } : {})
  };
}

export async function loadConfig(path?: string): Promise<AuditOptions> {
  if (!path) return resolveOptions();
  const absolutePath = resolve(path);
  const raw = JSON.parse(await readFile(absolutePath, 'utf8')) as AuditConfigInput;
  if (raw.storageState) raw.storageState = resolve(dirname(absolutePath), raw.storageState);
  return resolveOptions(raw);
}
