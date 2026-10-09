#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REQUIRED_MANUAL_CHECKS } from './audit/manual-checks.js';
import {
  DEFAULT_AUDITOR,
  DEFAULT_OUTPUT_DIR,
  DEFAULT_REPORT_NAME,
  buildEmbeddedAuditInstructions
} from './instructions.js';
import { validateExcelReport } from './reporting/validate.js';
import { executeAudit } from './service.js';
import type { AuditExecutionContext, AuditProgressEvent } from './types.js';
import { PLUGIN_VERSION } from './version.js';
import { isDirectInvocation } from './invocation.js';
import { auditJourneySchema, resolveOptions } from './config.js';
import {
  formatPreAuditSummary,
  preparePreAuditSummary,
  type PreAuditSummary
} from './pre-audit-summary.js';
import { redactAuditProgressEvent, toActionableAuditError } from './errors.js';
import {
  isAuthenticationConfirmationStaleError,
  resolveAuthenticationForExecution
} from './auth-preflight.js';

const actionableAuditErrorOutputSchema = z.object({
  code: z.enum([
    'invalid-input',
    'scope-restricted',
    'authentication-preflight-failed',
    'browser-unavailable',
    'browser-install-failed',
    'template-invalid',
    'output-unavailable',
    'report-validation-failed',
    'audit-failed'
  ]),
  message: z.string(),
  nextSteps: z.array(z.string()),
  retryable: z.boolean()
}).strict();

const workbookValidationOutputSchema = z.object({
  valid: z.boolean(),
  findingRows: z.number().int().nonnegative(),
  evidenceRows: z.number().int().nonnegative().optional(),
  imageInventoryRows: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  auditor: z.string()
}).strict();

const proposedAuditOutputSchema = z.object({
  targets: z.array(z.string()),
  scopeMode: z.literal('supplied-pages-only'),
  inputCount: z.number().int().nonnegative(),
  source: z.string(),
  pageCount: z.number().int().nonnegative(),
  pages: z.array(z.string().url()),
  remainingPageCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  skipped: z.array(z.object({ url: z.string(), reason: z.string() }).strict()),
  hosts: z.array(z.string()),
  preset: z.enum(['standard', 'thorough', 'debug']),
  auditor: z.string(),
  landingPageUrl: z.string(),
  browserMode: z.enum(['headless', 'headed']),
  browserEngine: z.enum(['chromium', 'firefox', 'webkit']),
  browserSelection: z.string(),
  autoInstallBrowser: z.boolean(),
  savedBrowserState: z.boolean(),
  captureScreenshots: z.boolean(),
  concurrency: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  maxTabStops: z.number().int().positive(),
  maxLinksPerPage: z.number().int().positive(),
  coverage: z.string(),
  viewports: z.array(z.string()),
  journeyCount: z.number().int().nonnegative(),
  journeys: z.array(z.string()),
  historyCount: z.number().int().nonnegative(),
  historySources: z.array(z.string()),
  outputDir: z.string(),
  reportName: z.string(),
  templatePath: z.string().optional(),
  allowedHosts: z.array(z.string()),
  exactHosts: z.array(z.string()),
  maxPages: z.number().int().positive().nullable(),
  stagingOnly: z.boolean(),
  confirmationDigest: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

const artifactDescriptorBaseShape = {
  uri: z.string().url().startsWith('file:'),
  name: z.string(),
  title: z.string(),
  description: z.string()
};

const htmlArtifactOutputSchema = z.object({
  type: z.literal('html-report'),
  ...artifactDescriptorBaseShape,
  mimeType: z.literal('text/html'),
  available: z.literal(true)
}).strict();
const excelArtifactOutputSchema = z.object({
  type: z.literal('excel-workbook'),
  ...artifactDescriptorBaseShape,
  mimeType: z.literal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  available: z.literal(true)
}).strict();
const jsonArtifactOutputSchema = z.object({
  type: z.literal('json-results'),
  ...artifactDescriptorBaseShape,
  mimeType: z.literal('application/json'),
  available: z.literal(true)
}).strict();
const availableScreenshotArtifactOutputSchema = z.object({
  type: z.literal('screenshot-directory'),
  ...artifactDescriptorBaseShape,
  mimeType: z.literal('inode/directory'),
  available: z.literal(true),
  count: z.number().int().positive()
}).strict();
const unavailableScreenshotArtifactOutputSchema = z.object({
  type: z.literal('screenshot-directory'),
  ...artifactDescriptorBaseShape,
  mimeType: z.literal('inode/directory'),
  available: z.literal(false),
  count: z.literal(0)
}).strict();
const screenshotArtifactOutputSchema = z.union([
  availableScreenshotArtifactOutputSchema,
  unavailableScreenshotArtifactOutputSchema
]);
const archiveArtifactOutputSchema = z.object({
  type: z.literal('portable-archive'),
  ...artifactDescriptorBaseShape,
  mimeType: z.literal('application/zip'),
  available: z.literal(true)
}).strict();

export const artifactDescriptorOutputSchema = z.union([
  htmlArtifactOutputSchema,
  excelArtifactOutputSchema,
  jsonArtifactOutputSchema,
  availableScreenshotArtifactOutputSchema,
  unavailableScreenshotArtifactOutputSchema,
  archiveArtifactOutputSchema
]);

const auditArtifactsOutputSchema = z.tuple([
  htmlArtifactOutputSchema,
  excelArtifactOutputSchema,
  jsonArtifactOutputSchema,
  screenshotArtifactOutputSchema,
  archiveArtifactOutputSchema
]);

const auditRunOutputShape = {
  reportPath: z.string(),
  htmlPath: z.string(),
  jsonPath: z.string(),
  csvPath: z.string(),
  sarifPath: z.string(),
  archivePath: z.string(),
  requestedPageCount: z.number().int().nonnegative(),
  auditedPageCount: z.number().int().nonnegative(),
  skippedPageCount: z.number().int().nonnegative(),
  completedPageCount: z.number().int().nonnegative(),
  partialPageCount: z.number().int().nonnegative(),
  notStartedPageCount: z.number().int().nonnegative(),
  confirmedCount: z.number().int().nonnegative(),
  blockerCount: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  manualCheckCount: z.number().int().nonnegative(),
  imageInventoryCount: z.number().int().nonnegative(),
  validation: workbookValidationOutputSchema,
  artifacts: auditArtifactsOutputSchema
};

const auditFailureOutputShape = {
  stage: z.enum(['preparation', 'execution', 'validation']),
  error: actionableAuditErrorOutputSchema,
  code: actionableAuditErrorOutputSchema.shape.code,
  message: z.string(),
  nextSteps: z.array(z.string()),
  retryable: z.boolean(),
  nextAction: z.string()
};

export const auditToolOutputVariantSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed'), ...auditRunOutputShape }).strict(),
  z.object({ status: z.literal('cancelled'), ...auditRunOutputShape }).strict(),
  z.object({
    status: z.literal('confirmation-required'),
    auditStarted: z.literal(false),
    proposedRun: proposedAuditOutputSchema,
    nextAction: z.string()
  }).strict(),
  z.object({
    status: z.literal('confirmation-stale'),
    auditStarted: z.literal(false),
    message: z.string(),
    proposedRun: proposedAuditOutputSchema,
    nextAction: z.string()
  }).strict(),
  z.object({
    status: z.literal('cancelled-before-start'),
    auditStarted: z.literal(false)
  }).strict(),
  z.object({ status: z.literal('failed'), ...auditFailureOutputShape }).strict()
]);

const validationFailureEnvelopeShape = {
  status: z.literal('failed'),
  stage: z.literal('validation'),
  error: actionableAuditErrorOutputSchema,
  code: actionableAuditErrorOutputSchema.shape.code,
  message: z.string(),
  nextSteps: z.array(z.string()),
  retryable: z.boolean(),
  nextAction: z.string()
};

export const validationToolOutputVariantSchema = z.union([
  workbookValidationOutputSchema.extend({ valid: z.literal(true) }).strict(),
  z.object(validationFailureEnvelopeShape).strict(),
  workbookValidationOutputSchema.extend({
    valid: z.literal(false),
    ...validationFailureEnvelopeShape
  }).strict()
]);

function objectVariantOutputSchema<T extends z.ZodRawShape>(
  shape: T,
  variants: z.ZodType
): z.ZodObject<T> {
  const variantJsonSchema = {
    ...z.toJSONSchema(variants, { target: 'draft-7', io: 'output' })
  } as Record<string, unknown>;
  delete variantJsonSchema.$schema;

  const schema = z.object(shape).strict().superRefine((value, context) => {
    const parsed = variants.safeParse(value);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  });

  // The MCP SDK only publishes root object schemas. Preserve that root while
  // exposing the exact status-specific variants to clients as JSON Schema.
  schema._zod.toJSONSchema = () => ({ type: 'object', ...variantJsonSchema });
  schema._zod.parent = undefined;
  return schema as unknown as z.ZodObject<T>;
}

export const auditToolOutputContractSchema = objectVariantOutputSchema({
  status: z.enum([
    'completed',
    'cancelled',
    'confirmation-required',
    'confirmation-stale',
    'cancelled-before-start',
    'failed'
  ]),
  auditStarted: z.boolean().optional(),
  proposedRun: proposedAuditOutputSchema.optional(),
  reportPath: z.string().optional(),
  htmlPath: z.string().optional(),
  jsonPath: z.string().optional(),
  csvPath: z.string().optional(),
  sarifPath: z.string().optional(),
  archivePath: z.string().optional(),
  requestedPageCount: z.number().int().nonnegative().optional(),
  auditedPageCount: z.number().int().nonnegative().optional(),
  skippedPageCount: z.number().int().nonnegative().optional(),
  completedPageCount: z.number().int().nonnegative().optional(),
  partialPageCount: z.number().int().nonnegative().optional(),
  notStartedPageCount: z.number().int().nonnegative().optional(),
  confirmedCount: z.number().int().nonnegative().optional(),
  blockerCount: z.number().int().nonnegative().optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  manualCheckCount: z.number().int().nonnegative().optional(),
  imageInventoryCount: z.number().int().nonnegative().optional(),
  validation: workbookValidationOutputSchema.optional(),
  artifacts: auditArtifactsOutputSchema.optional(),
  stage: z.enum(['preparation', 'execution', 'validation']).optional(),
  error: actionableAuditErrorOutputSchema.optional(),
  code: actionableAuditErrorOutputSchema.shape.code.optional(),
  message: z.string().optional(),
  nextSteps: z.array(z.string()).optional(),
  retryable: z.boolean().optional(),
  nextAction: z.string().optional()
}, auditToolOutputVariantSchema);

export const validationToolOutputContractSchema = objectVariantOutputSchema({
  valid: z.boolean().optional(),
  findingRows: z.number().int().nonnegative().optional(),
  evidenceRows: z.number().int().nonnegative().optional(),
  imageInventoryRows: z.number().int().nonnegative().optional(),
  errors: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  auditor: z.string().optional(),
  status: z.literal('failed').optional(),
  stage: z.literal('validation').optional(),
  error: actionableAuditErrorOutputSchema.optional(),
  code: actionableAuditErrorOutputSchema.shape.code.optional(),
  message: z.string().optional(),
  nextSteps: z.array(z.string()).optional(),
  retryable: z.boolean().optional(),
  nextAction: z.string().optional()
}, validationToolOutputVariantSchema);

const manualCheckOutputSchema = z.object({
  id: z.string(),
  classification: z.literal('manual'),
  title: z.string(),
  wcag: z.array(z.string()),
  procedure: z.string(),
  applicableTo: z.string(),
  expectedEvidence: z.string().optional()
});

export interface AccessibilityAuditMcpDependencies {
  executeAudit?: typeof executeAudit;
}

export function createAccessibilityAuditMcpServer(
  dependencies: AccessibilityAuditMcpDependencies = {}
): McpServer {
  const server = new McpServer(
    { name: 'accessibility-audit', version: PLUGIN_VERSION },
    { capabilities: { logging: {} } },
  );
  const execute = dependencies.executeAudit ?? executeAudit;

  const auditToolResult = (result: Awaited<ReturnType<typeof executeAudit>>) => {
    const artifacts = [
      {
        type: 'html-report' as const,
        uri: pathToFileURL(result.htmlPath).href,
        name: 'Accessibility audit HTML report',
        title: 'Open accessibility audit report',
        description: result.status === 'cancelled'
          ? 'Open the partial HTML report from the cancelled audit.'
          : 'Open the completed HTML report.',
        mimeType: 'text/html',
        available: true as const,
        priority: 1
      },
      {
        type: 'excel-workbook' as const,
        uri: pathToFileURL(result.reportPath).href,
        name: 'Accessibility audit Excel workbook',
        title: 'Open accessibility audit workbook',
        description: result.status === 'cancelled'
          ? 'Open the partial Excel workbook from the cancelled audit.'
          : 'Open the completed Excel workbook.',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        available: true as const,
        priority: 0.95
      },
      {
        type: 'json-results' as const,
        uri: pathToFileURL(result.jsonPath).href,
        name: 'Machine-readable accessibility audit results',
        title: 'Open accessibility audit JSON',
        description: result.status === 'cancelled'
          ? 'Open the partial machine-readable results from the cancelled audit.'
          : 'Open the complete machine-readable audit results.',
        mimeType: 'application/json',
        available: true as const,
        priority: 0.9
      },
      {
        type: 'screenshot-directory' as const,
        uri: pathToFileURL(resolve(dirname(result.reportPath), 'screenshots')).href,
        name: 'Accessibility evidence screenshots',
        title: 'Open accessibility evidence screenshots',
        description: result.imageInventoryCount > 0
          ? `Open the directory containing ${result.imageInventoryCount} linked evidence screenshot${result.imageInventoryCount === 1 ? '' : 's'}.`
          : 'No evidence screenshots were captured for this audit.',
        mimeType: 'inode/directory',
        available: result.imageInventoryCount > 0,
        count: result.imageInventoryCount,
        priority: 0.85
      },
      {
        type: 'portable-archive' as const,
        uri: pathToFileURL(result.archivePath).href,
        name: 'Portable accessibility audit archive',
        title: 'Share accessibility audit report',
        description: result.status === 'cancelled'
          ? 'Share the complete partial report package. Extract the ZIP before opening its HTML report.'
          : 'Share the complete report package. Extract the ZIP before opening its HTML report.',
        mimeType: 'application/zip',
        available: true as const,
        priority: 0.9
      }
    ];
    const artifactDescriptors = artifacts.map((artifact) => ({
      type: artifact.type,
      uri: artifact.uri,
      name: artifact.name,
      title: artifact.title,
      description: artifact.description,
      mimeType: artifact.mimeType,
      available: artifact.available,
      ...(artifact.type === 'screenshot-directory' ? { count: artifact.count } : {})
    }));
    const structuredResult = { ...result, artifacts: artifactDescriptors };
    const links = artifacts
      .filter((artifact) => artifact.available)
      .map((artifact) => ({
        type: 'resource_link' as const,
        uri: artifact.uri,
        name: artifact.name,
        title: artifact.title,
        description: artifact.description,
        mimeType: artifact.mimeType,
        annotations: { audience: ['user' as const], priority: artifact.priority }
      }));
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(structuredResult, null, 2) },
        ...links
      ],
      structuredContent: JSON.parse(JSON.stringify(structuredResult)) as Record<string, unknown>
    };
  };

  const mcpFailureResult = (
    error: unknown,
    stage: 'preparation' | 'execution' | 'validation',
    details: Record<string, unknown> = {}
  ) => {
    const actionableError = toActionableAuditError(error);
    const result = {
      ...details,
      status: 'failed' as const,
      stage,
      error: actionableError,
      code: actionableError.code,
      message: actionableError.message,
      nextSteps: actionableError.nextSteps,
      retryable: actionableError.retryable,
      nextAction: actionableError.nextSteps[0]
    };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: true
    };
  };

  const requestAuditConfirmation = async (
    summary: PreAuditSummary
  ): Promise<{ confirmed: boolean; auditor: string; landingPageUrl?: string } | null> => {
    if (!server.server.getClientCapabilities()?.elicitation?.form) return null;
    const response = await server.server.elicitInput({
      mode: 'form',
      message: `Confirm this ${summary.browserMode === 'headless' ? 'headless' : 'visible-browser'} accessibility audit.${summary.autoInstallBrowser ? ` If no supported browser is available, Playwright ${summary.browserEngine === 'firefox' ? 'Firefox' : summary.browserEngine === 'webkit' ? 'WebKit' : 'Chromium'} will be installed once in plugin-owned storage.` : ''}\n\n${formatPreAuditSummary(summary)}`,
      requestedSchema: {
        type: 'object',
        properties: {
          auditor: {
            type: 'string',
            title: 'Auditor',
            description: 'Name written to the workbook. The editable default is Automated.',
            default: summary.auditor
          },
          landingPageUrl: {
            type: 'string',
            title: 'Landing-page QA URL',
            description: 'The single landing-page URL written to Audit Summary. Leave empty to use the first resolved URL.',
            default: summary.landingPageUrl
          },
          confirm: {
            type: 'boolean',
            title: 'Start audit',
            default: false
          }
        },
        required: ['auditor', 'confirm']
      }
    });
    if (response.action !== 'accept') return { confirmed: false, auditor: summary.auditor, landingPageUrl: summary.landingPageUrl };
    const confirmedAuditor = typeof response.content?.auditor === 'string' && response.content.auditor.trim()
      ? response.content.auditor.trim()
      : summary.auditor;
    const confirmedLandingPage = typeof response.content?.landingPageUrl === 'string' && response.content.landingPageUrl.trim()
      ? response.content.landingPageUrl.trim()
      : summary.landingPageUrl;
    return {
      confirmed: response.content?.confirm === true,
      auditor: confirmedAuditor,
      ...(confirmedLandingPage ? { landingPageUrl: confirmedLandingPage } : {})
    };
  };

  const mcpExecution = (
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ): AuditExecutionContext => {
    let progress = 0;
    const onProgress = async (event: AuditProgressEvent): Promise<void> => {
      progress += 1;
      const safeEvent = redactAuditProgressEvent(event);
      const progressToken = extra._meta?.progressToken;
      if (progressToken !== undefined) {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress, message: safeEvent.message }
        }).catch(() => undefined);
      }
      await extra.sendNotification({
        method: 'notifications/message',
        params: { level: 'info', logger: 'accessibility-audit', data: safeEvent }
      }).catch(() => undefined);
    };
    return { signal: extra.signal, onProgress };
  };

  const commonInput = {
    preset: z.enum(['standard', 'thorough', 'debug']).default('standard').describe('Reusable audit setup: standard keeps established defaults, thorough expands advisory depth and limits, and debug runs visibly one page at a time.'),
    auditor: z.string().min(1).default(DEFAULT_AUDITOR).describe('Name written to the workbook overview.'),
    landingPageUrl: z.string().url().optional().describe('Single landing-page QA URL written to Audit Summary; defaults to the first resolved URL.'),
    outputDir: z.string().min(1).default(DEFAULT_OUTPUT_DIR).describe('Isolated directory for HTML, JSON, CSV, SARIF, screenshots, and XLSX.'),
    allowedHosts: z.array(z.string()).default([]).describe('Hosts or parent domains permitted for the run; parent domains also permit their descendants.'),
    exactHosts: z.array(z.string()).default([]).describe('Only these literal hosts are permitted; descendants are not permitted.'),
    maxPages: z.number().int().min(1).max(50_000).optional().describe('Maximum authorized unique pages accepted before the audit starts. Omit for unlimited.'),
    stagingOnly: z.boolean().default(false).describe('Reject hosts that do not look like staging, QA, preview, test, or local hosts.'),
    browserEngine: z.enum(['chromium', 'firefox', 'webkit']).default('chromium').describe('Browser engine. Chromium remains the default; Firefox and WebKit are opt-in.'),
    channel: z.string().optional().describe('Installed Chromium channel, for example chrome. Valid only when browserEngine is chromium.'),
    wcagLevel: z.enum(['AA', 'AAA']).default('AA').describe('Automation coverage level. AA is the public conformance target; legacy AAA also enables the separate AAA advisory checks.'),
    aaaAdvisory: z.boolean().optional().describe('Include AAA advisory checks without changing the public Level AA conformance target. Explicit values override the selected preset.'),
    headless: z.boolean().optional().describe('Run the selected browser without opening a visible window. Explicit values override the selected preset.'),
    autoInstallBrowser: z.boolean().optional().describe('Install the selected Playwright browser automatically if it is unavailable.'),
    storageState: z.string().min(1).optional().describe('Local Playwright storage-state JSON path for an authorized signed-in session. The path and state contents are not included in reports.'),
    concurrency: z.number().int().min(1).max(8).optional().describe('Concurrent page limit. Explicit values override the selected preset.'),
    timeoutMs: z.number().int().positive().optional().describe('Per-operation timeout in milliseconds. Explicit values override the selected preset.'),
    maxTabStops: z.number().int().min(1).max(500).optional().describe('Keyboard traversal limit. Explicit values override the selected preset.'),
    maxLinksPerPage: z.number().int().min(1).max(1000).optional().describe('Same-origin link limit per page. Explicit values override the selected preset.'),
    captureScreenshots: z.boolean().optional().describe('Capture linked contextual evidence for confirmed, blocker, and review findings; full-page images are limited to page-level findings or unresolved blockers.'),
    journeys: z.array(auditJourneySchema).max(100).default([]).describe('Validated interaction journeys to run on matching pages and viewports.'),
    templatePath: z.string().optional().describe('Optional path to a byte-identical copy of the bundled CarlasHub WCAG 2.2 report template; every other workbook is rejected.'),
    historyPaths: z.array(z.string().min(1)).max(50).default([]).describe('Optional prior audit-results.json paths used only for chronological history and scope-qualified trend reporting.'),
    reportName: z.string().default(DEFAULT_REPORT_NAME)
  };

  server.registerTool(
    'run_accessibility_audit',
    {
      description: 'Run one evidence-backed accessibility pre-audit after scope confirmation. Collect desktop, mobile, reflow, link, keyboard, interaction, and screenshot evidence; export complete or partial HTML, Excel, JSON, CSV, and SARIF reports; and preserve completed output after cancellation.',
      inputSchema: {
        targets: z.array(z.string().min(1)).min(1).describe('Authorized HTTP(S) URLs, pasted whitespace/newline/JSON URL lists, and/or one XLSX, CSV, TXT, JSON, or local URL-set XML sitemap page-list path.'),
        ...commonInput,
        confirmed: z.boolean().default(false).describe('Set true only after the user reviews the complete proposed run, including resolved pages, hosts, coverage, browser mode and selection, limits, journeys, output, landing-page QA URL, and auditor. When false, compatible clients display a confirmation form.'),
        confirmationDigest: z.string().regex(/^[a-f0-9]{64}$/).optional().describe('Digest returned by a prior confirmation-required response. Include it with confirmed true so changed pages or settings are rejected before audit.')
      },
      outputSchema: auditToolOutputContractSchema
    },
    async ({ targets, preset, auditor, landingPageUrl, outputDir, allowedHosts, exactHosts, maxPages, stagingOnly, browserEngine, channel, wcagLevel, aaaAdvisory, headless, autoInstallBrowser, storageState, concurrency, timeoutMs, maxTabStops, maxLinksPerPage, captureScreenshots, journeys, templatePath, historyPaths, reportName, confirmed, confirmationDigest }, extra) => {
      let failureStage: 'preparation' | 'execution' = 'preparation';
      let staleOptions: ReturnType<typeof resolveOptions> | undefined;
      try {
        const requestedOptions = {
          preset,
          auditor,
          ...(landingPageUrl ? { landingPageUrl } : {}),
          outputDir,
          allowedHosts,
          exactHosts,
          ...(maxPages !== undefined ? { maxPages } : {}),
          stagingOnly,
          browserEngine,
          ...(channel ? { channel } : {}),
          wcagLevel,
          ...(aaaAdvisory !== undefined ? { aaaAdvisory } : {}),
          ...(headless !== undefined ? { headless } : {}),
          ...(autoInstallBrowser !== undefined ? { autoInstallBrowser } : {}),
          ...(storageState ? { storageState } : {}),
          ...(concurrency !== undefined ? { concurrency } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(maxTabStops !== undefined ? { maxTabStops } : {}),
          ...(maxLinksPerPage !== undefined ? { maxLinksPerPage } : {}),
          ...(captureScreenshots !== undefined ? { captureScreenshots } : {}),
          journeys
        };
        const previewOptions = resolveOptions(requestedOptions);
        const preparedAudit = await preparePreAuditSummary(targets, previewOptions, {
          reportName,
          ...(templatePath ? { templatePath } : {}),
          ...(historyPaths.length ? { historyPaths } : {})
        });
        let effectiveAuditor = auditor;
        let effectiveLandingPageUrl = landingPageUrl;
        if (confirmed && !confirmationDigest) {
          const result = {
            status: 'confirmation-required' as const,
            auditStarted: false as const,
            proposedRun: {
              targets,
              ...preparedAudit.summary,
              confirmationDigest: preparedAudit.confirmationDigest
            },
            nextAction: 'Review the complete pre-audit summary, then retry with confirmed true and this confirmationDigest.'
          };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], structuredContent: result };
        }
        if (!confirmed) {
          const preAuditSummary = preparedAudit.summary;
          const confirmation = await requestAuditConfirmation(preAuditSummary);
          if (confirmation === null) {
            const result = {
              status: 'confirmation-required',
              auditStarted: false,
              proposedRun: {
                targets,
                ...preAuditSummary,
                confirmationDigest: preparedAudit.confirmationDigest
              },
              nextAction: `Confirm the resolved pages, scope, settings, landing-page QA URL, and auditor (default: ${auditor}), then retry with confirmed true and this confirmationDigest.`
            };
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
          }
          if (!confirmation.confirmed) {
            const result = { status: 'cancelled-before-start', auditStarted: false };
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
          }
          effectiveAuditor = confirmation.auditor;
          effectiveLandingPageUrl = confirmation.landingPageUrl;
        }
        if (confirmed && confirmationDigest && confirmationDigest !== preparedAudit.confirmationDigest) {
          const result = {
            status: 'confirmation-stale',
            auditStarted: false,
            message: 'The resolved pages or effective settings changed after confirmation. No audit was started.',
            proposedRun: {
              targets,
              ...preparedAudit.summary,
              confirmationDigest: preparedAudit.confirmationDigest
            },
            nextAction: 'Review the updated pre-audit summary, then retry with confirmed true and its new confirmationDigest.'
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
        }
        const executionOptions = resolveOptions({
          ...requestedOptions,
          auditor: effectiveAuditor,
          ...(effectiveLandingPageUrl ? { landingPageUrl: effectiveLandingPageUrl } : {})
        });
        staleOptions = executionOptions;
        const authentication = await resolveAuthenticationForExecution(
          executionOptions,
          preparedAudit.resolvedPages,
          preparedAudit.authentication
        );
        failureStage = 'execution';
        const result = await execute({
          inputs: preparedAudit.resolvedPages,
          options: executionOptions,
          authentication,
          ...(templatePath ? { templatePath } : {}),
          ...(historyPaths.length ? { historyPaths } : {}),
          reportName,
          execution: mcpExecution(extra)
        });
        return auditToolResult(result);
      } catch (error: unknown) {
        if (isAuthenticationConfirmationStaleError(error) && staleOptions) {
          try {
            const refreshed = await preparePreAuditSummary(targets, staleOptions, {
              reportName,
              ...(templatePath ? { templatePath } : {}),
              ...(historyPaths.length ? { historyPaths } : {})
            });
            const result = {
              status: 'confirmation-stale' as const,
              auditStarted: false as const,
              message: error.message,
              proposedRun: {
                targets,
                ...refreshed.summary,
                confirmationDigest: refreshed.confirmationDigest
              },
              nextAction: 'Review the updated pre-audit summary, then confirm again using its new confirmationDigest.'
            };
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], structuredContent: result };
          } catch (refreshError: unknown) {
            return mcpFailureResult(refreshError, 'preparation');
          }
        }
        return mcpFailureResult(error, failureStage);
      }
    }
  );

  server.registerTool(
    'get_audit_instructions',
    {
      description: 'Return the embedded site-independent workflow for clients that need detailed orchestration guidance. Normal usage should call run_accessibility_audit directly.',
      inputSchema: {
        targets: z.string().optional().describe('Explicit URLs, a pasted URL list, or a page-list path.'),
        auditor: z.string().min(1).default(DEFAULT_AUDITOR),
        landingPageUrl: z.string().url().optional(),
        outputDir: z.string().min(1).default(DEFAULT_OUTPUT_DIR),
        allowedHosts: z.array(z.string()).default([]),
        exactHosts: z.array(z.string()).default([]),
        maxPages: z.number().int().min(1).max(50_000).optional(),
        stagingOnly: z.boolean().optional()
      },
      outputSchema: {
        instructions: z.string(),
        defaults: z.object({
          auditor: z.string(),
          landingPageUrl: z.string().url().optional(),
          outputDir: z.string(),
          reportName: z.string(),
          headless: z.boolean(),
          captureScreenshots: z.boolean()
        }),
        supportedInputs: z.array(z.enum(['urls', 'url-list', 'xlsx', 'csv', 'txt', 'json', 'xml']))
      }
    },
    async ({ targets, auditor, landingPageUrl, outputDir, allowedHosts, exactHosts, maxPages, stagingOnly }) => {
      const instructions = buildEmbeddedAuditInstructions({
        ...(targets ? { targets } : {}),
        auditor,
        ...(landingPageUrl ? { landingPageUrl } : {}),
        outputDir,
        allowedHosts,
        exactHosts,
        ...(maxPages === undefined ? {} : { maxPages }),
        ...(stagingOnly === undefined ? {} : { stagingOnly })
      });
      return {
        content: [{ type: 'text', text: instructions }],
        structuredContent: {
          instructions,
          defaults: { auditor, landingPageUrl, outputDir, reportName: DEFAULT_REPORT_NAME, headless: true, captureScreenshots: true },
          supportedInputs: ['urls', 'url-list', 'xlsx', 'csv', 'txt', 'json', 'xml']
        }
      };
    }
  );

  server.registerPrompt(
    'run-accessibility-audit',
    {
      title: 'Run accessibility pre-audit',
      description: 'Confirm scope and run an evidence-backed accessibility pre-audit for WCAG 2.2 A/AA with one tool call.',
      argsSchema: {
        targets: z.string().optional().describe('Explicit URLs, a pasted URL list, or a project-relative page-list path.'),
        auditor: z.string().min(1).default(DEFAULT_AUDITOR),
        landingPageUrl: z.string().url().optional(),
        outputDir: z.string().min(1).default(DEFAULT_OUTPUT_DIR)
      }
    },
    async ({ targets, auditor, landingPageUrl, outputDir }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: targets
            ? `Call run_accessibility_audit once with targets [${JSON.stringify(targets)}], auditor ${JSON.stringify(auditor)}, ${landingPageUrl ? `landingPageUrl ${JSON.stringify(landingPageUrl)}, ` : ''}and outputDir ${JSON.stringify(outputDir)}. Let the tool confirm the pages, landing-page QA URL, and editable auditor, then use its headless checks, progress, cancellation, link validation, linked element screenshots, and workbook validation.`
            : 'Ask for URL(s), a pasted URL list, or one XLSX/CSV/TXT/JSON/XML page-list path, then call run_accessibility_audit once. Let the tool confirm the pages and editable default auditor before starting.'
        }
      }]
    })
  );

  server.registerTool(
    'audit_pages',
    {
      description: 'Audit explicit page URLs at desktop, mobile, and 320px reflow sizes; run axe, DOM, keyboard, link, component, and screenshot checks; retain incomplete/blocker/truncation evidence and a page-level coverage matrix; consolidate only equivalent component defects; and write accessible HTML, JSON, CSV, SARIF, and the standard Excel workbook.',
      inputSchema: { urls: z.array(z.string().url()).min(1), ...commonInput },
      outputSchema: auditToolOutputContractSchema
    },
    async ({ urls, preset, auditor, landingPageUrl, outputDir, allowedHosts, exactHosts, maxPages, stagingOnly, browserEngine, channel, wcagLevel, aaaAdvisory, headless, autoInstallBrowser, storageState, concurrency, timeoutMs, maxTabStops, maxLinksPerPage, captureScreenshots, journeys, templatePath, historyPaths, reportName }, extra) => {
      try {
        const result = await execute({
          inputs: urls,
          options: resolveOptions({
            preset, auditor, ...(landingPageUrl ? { landingPageUrl } : {}), outputDir, allowedHosts, exactHosts,
            ...(maxPages !== undefined ? { maxPages } : {}), stagingOnly,
            browserEngine,
            ...(channel ? { channel } : {}),
            wcagLevel,
            ...(aaaAdvisory !== undefined ? { aaaAdvisory } : {}),
            ...(headless !== undefined ? { headless } : {}),
            ...(autoInstallBrowser !== undefined ? { autoInstallBrowser } : {}),
            ...(storageState ? { storageState } : {}),
            ...(concurrency !== undefined ? { concurrency } : {}),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            ...(maxTabStops !== undefined ? { maxTabStops } : {}),
            ...(maxLinksPerPage !== undefined ? { maxLinksPerPage } : {}),
            ...(captureScreenshots !== undefined ? { captureScreenshots } : {}),
            journeys
          }),
          ...(templatePath ? { templatePath } : {}),
          ...(historyPaths.length ? { historyPaths } : {}),
          reportName,
          execution: mcpExecution(extra)
        });
        return auditToolResult(result);
      } catch (error: unknown) {
        return mcpFailureResult(error, 'execution');
      }
    }
  );

  server.registerTool(
    'audit_from_file',
    {
      description: 'Read URLs from an XLSX page list, text/CSV/JSON file, or local URL-set XML sitemap, then run an evidence-backed accessibility pre-audit and export accessible HTML, Excel, JSON, CSV, SARIF, screenshots, and a portable archive.',
      inputSchema: { inputPath: z.string().min(1), ...commonInput },
      outputSchema: auditToolOutputContractSchema
    },
    async ({ inputPath, preset, auditor, landingPageUrl, outputDir, allowedHosts, exactHosts, maxPages, stagingOnly, browserEngine, channel, wcagLevel, aaaAdvisory, headless, autoInstallBrowser, storageState, concurrency, timeoutMs, maxTabStops, maxLinksPerPage, captureScreenshots, journeys, templatePath, historyPaths, reportName }, extra) => {
      try {
        const result = await execute({
          inputs: [inputPath],
          options: resolveOptions({
            preset, auditor, ...(landingPageUrl ? { landingPageUrl } : {}), outputDir, allowedHosts, exactHosts,
            ...(maxPages !== undefined ? { maxPages } : {}), stagingOnly,
            browserEngine,
            ...(channel ? { channel } : {}),
            wcagLevel,
            ...(aaaAdvisory !== undefined ? { aaaAdvisory } : {}),
            ...(headless !== undefined ? { headless } : {}),
            ...(autoInstallBrowser !== undefined ? { autoInstallBrowser } : {}),
            ...(storageState ? { storageState } : {}),
            ...(concurrency !== undefined ? { concurrency } : {}),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            ...(maxTabStops !== undefined ? { maxTabStops } : {}),
            ...(maxLinksPerPage !== undefined ? { maxLinksPerPage } : {}),
            ...(captureScreenshots !== undefined ? { captureScreenshots } : {}),
            journeys
          }),
          ...(templatePath ? { templatePath } : {}),
          ...(historyPaths.length ? { historyPaths } : {}),
          reportName,
          execution: mcpExecution(extra)
        });
        return auditToolResult(result);
      } catch (error: unknown) {
        return mcpFailureResult(error, 'execution');
      }
    }
  );

  server.registerTool(
    'validate_accessibility_report',
    {
      description: 'Verify the seven-sheet CarlasHub workbook structure, 25-column Findings schema, tab colours, formulas, validation rules, remediation fields, scope lists, relative screenshot links, landing-page QA URL, auditor, and absence of placeholders or obsolete screen-reader sheets.',
      inputSchema: { workbookPath: z.string().min(1) },
      outputSchema: validationToolOutputContractSchema
    },
    async ({ workbookPath }) => {
      try {
        const result = await validateExcelReport(workbookPath);
        if (!result.valid) {
          return mcpFailureResult(
            new Error(`Report validation failed: ${result.errors.join(' ') || 'The workbook does not match the required report structure.'}`),
            'validation',
            JSON.parse(JSON.stringify(result)) as Record<string, unknown>
          );
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: JSON.parse(JSON.stringify(result)) as Record<string, unknown>,
          isError: false
        };
      } catch (error: unknown) {
        return mcpFailureResult(error, 'validation');
      }
    }
  );

  server.registerTool(
    'list_guided_manual_checks',
    {
      description: 'Return the assistive-technology, visual, content, physical-device, and judgment-based WCAG checks that automation does not prove.',
      inputSchema: {},
      outputSchema: { checks: z.array(manualCheckOutputSchema) }
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(REQUIRED_MANUAL_CHECKS, null, 2) }],
      structuredContent: { checks: REQUIRED_MANUAL_CHECKS }
    })
  );

  return server;
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  const server = createAccessibilityAuditMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
