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

const configSchema = z.object({
  auditor: z.string().min(1).default(DEFAULT_AUDITOR),
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
  viewports: z.array(viewportSchema).min(1).default(DEFAULT_VIEWPORTS)
});

export type AuditConfigInput = z.input<typeof configSchema>;

export function resolveOptions(input: Partial<AuditConfigInput> = {}): AuditOptions {
  const parsed = configSchema.parse(input);
  return {
    auditor: parsed.auditor,
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
    ...(parsed.channel ? { channel: parsed.channel } : {}),
    ...(parsed.executablePath ? { executablePath: parsed.executablePath } : {})
  };
}

export async function loadConfig(path?: string): Promise<AuditOptions> {
  if (!path) return resolveOptions();
  const raw = JSON.parse(await readFile(resolve(path), 'utf8')) as AuditConfigInput;
  return resolveOptions(raw);
}
