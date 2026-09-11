import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AuditOptions, ViewportDefinition } from './types.js';
import { DEFAULT_AUDITOR, DEFAULT_OUTPUT_DIR } from './instructions.js';

export const DEFAULT_VIEWPORTS: ViewportDefinition[] = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
  { name: 'reflow-320', width: 320, height: 800, isMobile: true }
];

const viewportSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  isMobile: z.boolean().optional()
});

const journeyStepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('focus'), selector: z.string().min(1).max(1000) }),
  z.object({ action: z.literal('press'), key: z.string().min(1).max(80), selector: z.string().min(1).max(1000).optional() }),
  z.object({ action: z.literal('type'), selector: z.string().min(1).max(1000), text: z.string().max(10_000) }),
  z.object({ action: z.literal('wait'), milliseconds: z.number().int().min(0).max(5_000) }),
  z.object({
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
  })
]);

const journeySchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/i),
  title: z.string().min(1).max(200),
  categories: z.array(z.enum(['keyboard', 'forms', 'interaction', 'dynamic-content'])).min(1).max(4),
  urlIncludes: z.string().min(1).max(2000).optional(),
  viewports: z.array(z.string().min(1).max(100)).min(1).max(20).optional(),
  steps: z.array(journeyStepSchema).min(1).max(100)
});

const configSchema = z.object({
  auditor: z.string().min(1).default(DEFAULT_AUDITOR),
  wcagLevel: z.enum(['AA', 'AAA']).default('AA'),
  aaaAdvisory: z.boolean().default(false),
  outputDir: z.string().min(1).default(DEFAULT_OUTPUT_DIR),
  landingPageUrl: z.string().url().optional(),
  allowedHosts: z.array(z.string().min(1)).default([]),
  stagingOnly: z.boolean().default(false),
  headless: z.boolean().default(true),
  autoInstallBrowser: z.boolean().default(true),
  channel: z.string().min(1).optional(),
  executablePath: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().default(30_000),
  maxTabStops: z.number().int().min(1).max(500).default(120),
  maxLinksPerPage: z.number().int().min(1).max(1000).default(200),
  concurrency: z.number().int().min(1).max(8).default(2),
  captureScreenshots: z.boolean().default(true),
  viewports: z.array(viewportSchema).min(1).default(DEFAULT_VIEWPORTS),
  journeys: z.array(journeySchema).max(100).default([])
});

export type AuditConfigInput = z.input<typeof configSchema>;

export function resolveOptions(input: Partial<AuditConfigInput> = {}): AuditOptions {
  const parsed = configSchema.parse(input);
  const aaaAdvisory = parsed.aaaAdvisory || parsed.wcagLevel === 'AAA';
  return {
    auditor: parsed.auditor,
    wcagLevel: aaaAdvisory ? 'AAA' : 'AA',
    aaaAdvisory,
    outputDir: resolve(parsed.outputDir),
    ...(parsed.landingPageUrl ? { landingPageUrl: parsed.landingPageUrl } : {}),
    allowedHosts: parsed.allowedHosts.map((host) => host.toLowerCase()),
    stagingOnly: parsed.stagingOnly,
    headless: parsed.headless,
    autoInstallBrowser: parsed.autoInstallBrowser,
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
  const raw = JSON.parse(await readFile(resolve(path), 'utf8')) as AuditConfigInput;
  return resolveOptions(raw);
}
