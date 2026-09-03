#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { REQUIRED_MANUAL_CHECKS } from './audit/manual-checks.js';
import {
  DEFAULT_AUDITOR,
  DEFAULT_OUTPUT_DIR,
  DEFAULT_REPORT_NAME,
  buildEmbeddedAuditInstructions
} from './instructions.js';
import { validateExcelReport } from './reporting/validate.js';
import { executeAudit } from './service.js';
import { singleLineText } from './text.js';
import type { AuditExecutionContext, AuditProgressEvent } from './types.js';
import { PLUGIN_VERSION } from './version.js';
import { isDirectInvocation } from './invocation.js';

export interface AccessibilityAuditMcpDependencies {
  executeAudit?: typeof executeAudit;
}

export function createAccessibilityAuditMcpServer(
  dependencies: AccessibilityAuditMcpDependencies = {}
): McpServer {
  const server = new McpServer({ name: 'accessibility-audit', version: PLUGIN_VERSION });
  const execute = dependencies.executeAudit ?? executeAudit;

  const requestAuditConfirmation = async (
    targets: string[],
    auditor: string,
    landingPageUrl?: string,
    autoInstallBrowser = true
  ): Promise<{ confirmed: boolean; auditor: string; landingPageUrl?: string } | null> => {
    if (!server.server.getClientCapabilities()?.elicitation?.form) return null;
    const safeTarget = (value: string): string => singleLineText(value, 300);
    const targetSummary = targets.length <= 8
      ? targets.map(safeTarget).join('\n')
      : `${targets.slice(0, 8).map(safeTarget).join('\n')}\n…and ${targets.length - 8} more input(s)`;
    const response = await server.server.elicitInput({
      mode: 'form',
      message: `Confirm this headless accessibility audit. It includes desktop, mobile, 320px reflow, keyboard/component checks, same-origin link validation, and element screenshot evidence.${autoInstallBrowser ? ' If no supported browser is available, Playwright Chromium will be installed once in plugin-owned storage.' : ''}\n\nPages/input:\n${targetSummary}`,
      requestedSchema: {
        type: 'object',
        properties: {
          auditor: {
            type: 'string',
            title: 'Auditor',
            description: 'Name written to the workbook. The editable default is Automated.',
            default: auditor
          },
          landingPageUrl: {
            type: 'string',
            title: 'Landing-page QA URL',
            description: 'The single landing-page URL written to Accessibility Overview. Leave empty to use the first resolved URL.',
            default: landingPageUrl ?? targets.find((target) => /^https?:\/\//i.test(target)) ?? ''
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
    if (response.action !== 'accept') return { confirmed: false, auditor, ...(landingPageUrl ? { landingPageUrl } : {}) };
    const confirmedAuditor = typeof response.content?.auditor === 'string' && response.content.auditor.trim()
      ? response.content.auditor.trim()
      : auditor;
    const confirmedLandingPage = typeof response.content?.landingPageUrl === 'string' && response.content.landingPageUrl.trim()
      ? response.content.landingPageUrl.trim()
      : landingPageUrl;
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
      const progressToken = extra._meta?.progressToken;
      if (progressToken !== undefined) {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress, message: event.message }
        }).catch(() => undefined);
      }
      await extra.sendNotification({
        method: 'notifications/message',
        params: { level: 'info', logger: 'accessibility-audit', data: event }
      }).catch(() => undefined);
    };
    return { signal: extra.signal, onProgress };
  };

  const commonInput = {
    auditor: z.string().min(1).default(DEFAULT_AUDITOR).describe('Name written to the workbook overview.'),
    landingPageUrl: z.string().url().optional().describe('Single landing-page QA URL written to Accessibility Overview; defaults to the first resolved URL.'),
    outputDir: z.string().min(1).default(DEFAULT_OUTPUT_DIR).describe('Isolated directory for JSON, screenshots, and XLSX.'),
    allowedHosts: z.array(z.string()).default([]).describe('Exact hosts or parent domains permitted for the run.'),
    stagingOnly: z.boolean().default(false).describe('Reject hosts that do not look like staging, QA, preview, test, or local hosts.'),
    channel: z.string().optional().describe('Installed Playwright browser channel, for example chrome.'),
    headless: z.boolean().default(true).describe('Run Chromium without opening a visible browser window.'),
    autoInstallBrowser: z.boolean().default(true).describe('Install Playwright Chromium automatically if neither bundled Chromium nor a supported system browser is available.'),
    concurrency: z.number().int().min(1).max(8).default(2),
    timeoutMs: z.number().int().positive().default(30_000),
    maxTabStops: z.number().int().min(1).max(500).default(120),
    maxLinksPerPage: z.number().int().min(1).max(1000).default(200),
    captureScreenshots: z.boolean().default(true).describe('Capture linked full-page and element screenshots only for confirmed failures and page blockers.'),
    templatePath: z.string().optional().describe('Optional replacement for the bundled Excel template.'),
    reportName: z.string().default(DEFAULT_REPORT_NAME)
  };

  server.registerTool(
    'run_accessibility_audit',
    {
      description: 'Professional one-shot entry point. Confirm pages and auditor, run headless desktop/mobile/reflow checks with progress, validate same-origin links, capture element evidence, and generate validated complete or partial Excel/JSON reports. Client cancellation preserves completed output.',
      inputSchema: {
        targets: z.array(z.string().min(1)).min(1).describe('Authorized HTTP(S) URLs and/or one XLSX, CSV, TXT, or JSON page-list path.'),
        ...commonInput,
        confirmed: z.boolean().default(false).describe('Set true only after the user confirms the page inputs and auditor. When false, compatible clients display a confirmation form.')
      }
    },
    async ({ targets, auditor, landingPageUrl, outputDir, allowedHosts, stagingOnly, channel, headless, autoInstallBrowser, concurrency, timeoutMs, maxTabStops, maxLinksPerPage, captureScreenshots, templatePath, reportName, confirmed }, extra) => {
      let effectiveAuditor = auditor;
      let effectiveLandingPageUrl = landingPageUrl;
      if (!confirmed) {
        const confirmation = await requestAuditConfirmation(targets, auditor, landingPageUrl, autoInstallBrowser);
        if (confirmation === null) {
          const result = {
            status: 'confirmation-required',
            auditStarted: false,
            proposedRun: { targets, auditor, landingPageUrl, browserMode: headless ? 'headless' : 'headed', autoInstallBrowser, captureScreenshots },
            nextAction: `Confirm the listed pages, landing-page QA URL, and auditor (default: ${auditor}), then retry with confirmed true.`
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
      const result = await execute({
        inputs: targets,
        options: {
          auditor: effectiveAuditor,
          ...(effectiveLandingPageUrl ? { landingPageUrl: effectiveLandingPageUrl } : {}),
          outputDir,
          allowedHosts,
          stagingOnly,
          headless,
          autoInstallBrowser,
          concurrency,
          timeoutMs,
          maxTabStops,
          maxLinksPerPage,
          captureScreenshots,
          ...(channel ? { channel } : {})
        },
        ...(templatePath ? { templatePath } : {}),
        reportName,
        execution: mcpExecution(extra)
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: JSON.parse(JSON.stringify(result)) as Record<string, unknown>
      };
    }
  );

  server.registerTool(
    'get_audit_instructions',
    {
      description: 'Return the embedded site-independent workflow for clients that need detailed orchestration guidance. Normal usage should call run_accessibility_audit directly.',
      inputSchema: {
        targets: z.string().optional().describe('Explicit URLs or a page-list path.'),
        auditor: z.string().min(1).default(DEFAULT_AUDITOR),
        landingPageUrl: z.string().url().optional(),
        outputDir: z.string().min(1).default(DEFAULT_OUTPUT_DIR),
        allowedHosts: z.array(z.string()).default([]),
        stagingOnly: z.boolean().optional()
      }
    },
    async ({ targets, auditor, landingPageUrl, outputDir, allowedHosts, stagingOnly }) => {
      const instructions = buildEmbeddedAuditInstructions({
        ...(targets ? { targets } : {}),
        auditor,
        ...(landingPageUrl ? { landingPageUrl } : {}),
        outputDir,
        allowedHosts,
        ...(stagingOnly === undefined ? {} : { stagingOnly })
      });
      return {
        content: [{ type: 'text', text: instructions }],
        structuredContent: {
          instructions,
          defaults: { auditor, landingPageUrl, outputDir, reportName: DEFAULT_REPORT_NAME, headless: true, captureScreenshots: true },
          supportedInputs: ['urls', 'xlsx', 'csv', 'txt', 'json']
        }
      };
    }
  );

  server.registerPrompt(
    'run-accessibility-audit',
    {
      title: 'Run full accessibility audit',
      description: 'Confirm and run a generic WCAG 2.2 A/AA page audit with one professional tool call.',
      argsSchema: {
        targets: z.string().optional().describe('URLs or a project-relative page-list path.'),
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
            : 'Ask for URL(s) or one XLSX/CSV/TXT/JSON page-list path, then call run_accessibility_audit once. Let the tool confirm the pages and editable default auditor before starting.'
        }
      }]
    })
  );

  server.registerTool(
    'audit_pages',
    {
      description: 'Audit explicit page URLs at desktop, mobile, and 320px reflow sizes; run axe, DOM, keyboard, link, component, and screenshot checks; consolidate repeated component defects; and write JSON plus the standard Excel workbook.',
      inputSchema: { urls: z.array(z.string().url()).min(1), ...commonInput }
    },
    async ({ urls, auditor, landingPageUrl, outputDir, allowedHosts, stagingOnly, channel, headless, autoInstallBrowser, concurrency, timeoutMs, maxTabStops, maxLinksPerPage, captureScreenshots, templatePath, reportName }, extra) => {
      const result = await execute({
        inputs: urls,
        options: { auditor, ...(landingPageUrl ? { landingPageUrl } : {}), outputDir, allowedHosts, stagingOnly, headless, autoInstallBrowser, concurrency, timeoutMs, maxTabStops, maxLinksPerPage, captureScreenshots, ...(channel ? { channel } : {}) },
        ...(templatePath ? { templatePath } : {}),
        reportName,
        execution: mcpExecution(extra)
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: JSON.parse(JSON.stringify(result)) as Record<string, unknown> };
    }
  );

  server.registerTool(
    'audit_from_file',
    {
      description: 'Read URLs from an XLSX page list or text/CSV/JSON file, then run the full headless desktop/mobile accessibility audit and generate the standard Excel report.',
      inputSchema: { inputPath: z.string().min(1), ...commonInput }
    },
    async ({ inputPath, auditor, landingPageUrl, outputDir, allowedHosts, stagingOnly, channel, headless, autoInstallBrowser, concurrency, timeoutMs, maxTabStops, maxLinksPerPage, captureScreenshots, templatePath, reportName }, extra) => {
      const result = await execute({
        inputs: [inputPath],
        options: { auditor, ...(landingPageUrl ? { landingPageUrl } : {}), outputDir, allowedHosts, stagingOnly, headless, autoInstallBrowser, concurrency, timeoutMs, maxTabStops, maxLinksPerPage, captureScreenshots, ...(channel ? { channel } : {}) },
        ...(templatePath ? { templatePath } : {}),
        reportName,
        execution: mcpExecution(extra)
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: JSON.parse(JSON.stringify(result)) as Record<string, unknown> };
    }
  );

  server.registerTool(
    'validate_accessibility_report',
    {
      description: 'Verify the required workbook sheets, 32-column report defaults, remediation, relative screenshot links, landing-page QA URL, auditor, and absence of placeholders or obsolete screen-reader sheets.',
      inputSchema: { workbookPath: z.string().min(1) }
    },
    async ({ workbookPath }) => {
      const result = await validateExcelReport(workbookPath);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: JSON.parse(JSON.stringify(result)) as Record<string, unknown>,
        isError: !result.valid
      };
    }
  );

  server.registerTool(
    'list_guided_manual_checks',
    {
      description: 'Return the assistive-technology, visual, content, physical-device, and judgment-based WCAG checks that automation does not prove.',
      inputSchema: {}
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
