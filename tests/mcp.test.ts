import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { Ajv } from 'ajv';
import ExcelJS from 'exceljs';
import {
  artifactDescriptorOutputSchema,
  auditToolOutputContractSchema,
  createAccessibilityAuditMcpServer,
  validationToolOutputContractSchema
} from '../src/mcp.js';
import { PUBLIC_SURFACE_V1_8_4 } from './fixtures/public-surface-v1-8-4.js';

const completedAuditResult = {
  status: 'completed' as const,
  reportPath: '/tmp/report.xlsx',
  htmlPath: '/tmp/report.html',
  jsonPath: '/tmp/audit-results.json',
  csvPath: '/tmp/audit-findings.csv',
  sarifPath: '/tmp/audit-results.sarif',
  archivePath: '/tmp/accessibility-audit.zip',
  requestedPageCount: 1,
  auditedPageCount: 1,
  skippedPageCount: 0,
  completedPageCount: 1,
  partialPageCount: 0,
  notStartedPageCount: 0,
  confirmedCount: 0,
  blockerCount: 0,
  reviewCount: 0,
  manualCheckCount: 1,
  imageInventoryCount: 0,
  validation: {
    valid: true,
    findingRows: 0,
    imageInventoryRows: 0,
    errors: [],
    warnings: [],
    auditor: 'Automated'
  }
};

const artifactDescriptorsFor = (result: {
  status: 'completed' | 'cancelled';
  reportPath: string;
  htmlPath: string;
  jsonPath: string;
  archivePath: string;
  imageInventoryCount: number;
}) => [
  {
    type: 'html-report' as const,
    uri: pathToFileURL(result.htmlPath).href,
    name: 'Accessibility audit HTML report',
    title: 'Open accessibility audit report',
    description: result.status === 'cancelled'
      ? 'Open the partial HTML report from the cancelled audit.'
      : 'Open the completed HTML report.',
    mimeType: 'text/html',
    available: true as const
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
    available: true as const
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
    available: true as const
  },
  {
    type: 'screenshot-directory' as const,
    uri: pathToFileURL('/tmp/screenshots').href,
    name: 'Accessibility evidence screenshots',
    title: 'Open accessibility evidence screenshots',
    description: result.imageInventoryCount > 0
      ? `Open the directory containing ${result.imageInventoryCount} linked evidence screenshot${result.imageInventoryCount === 1 ? '' : 's'}.`
      : 'No evidence screenshots were captured for this audit.',
    mimeType: 'inode/directory',
    available: result.imageInventoryCount > 0,
    count: result.imageInventoryCount
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
    available: true as const
  }
] as const;

const completedAuditOutput = {
  ...completedAuditResult,
  artifacts: artifactDescriptorsFor(completedAuditResult)
};

const proposedRunResult = {
  targets: ['https://preview.example.test/'],
  scopeMode: 'supplied-pages-only' as const,
  inputCount: 1,
  source: 'direct',
  pageCount: 1,
  pages: ['https://preview.example.test/'],
  remainingPageCount: 0,
  skippedCount: 0,
  skipped: [],
  hosts: ['preview.example.test'],
  preset: 'standard' as const,
  auditor: 'Automated',
  landingPageUrl: 'https://preview.example.test/',
  browserMode: 'headless' as const,
  browserEngine: 'chromium' as const,
  browserSelection: 'Playwright Chromium or supported system browser',
  autoInstallBrowser: false,
  savedBrowserState: false,
  captureScreenshots: true,
  concurrency: 1,
  timeoutMs: 30_000,
  maxTabStops: 120,
  maxLinksPerPage: 200,
  coverage: 'WCAG 2.2 AA',
  viewports: ['Desktop (1440×900)'],
  journeyCount: 0,
  journeys: [],
  historyCount: 0,
  historySources: [],
  outputDir: './audit-output',
  reportName: 'accessibility-audit.xlsx',
  allowedHosts: [],
  exactHosts: [],
  maxPages: null,
  stagingOnly: false,
  confirmationDigest: 'a'.repeat(64)
};

const actionableFailureResult = {
  status: 'failed' as const,
  stage: 'execution' as const,
  error: {
    code: 'audit-failed' as const,
    message: 'The audit failed.',
    nextSteps: ['Retry the audit.'],
    retryable: true
  },
  code: 'audit-failed' as const,
  message: 'The audit failed.',
  nextSteps: ['Retry the audit.'],
  retryable: true,
  nextAction: 'Retry the audit.'
};

async function requestConfirmationDigest(client: Client, arguments_: Record<string, unknown>): Promise<string> {
  const proposal = await client.callTool({
    name: 'run_accessibility_audit',
    arguments: arguments_
  });
  const digest = (proposal.structuredContent as {
    proposedRun?: { confirmationDigest?: string };
  }).proposedRun?.confirmationDigest;
  if (!digest) throw new Error('Expected the pre-audit proposal to include a confirmation digest.');
  return digest;
}

describe('MCP server', () => {
  it('rejects malformed pasted URL-list entries during preparation without starting an audit', async () => {
    const executeAudit = vi.fn();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createAccessibilityAuditMcpServer({ executeAudit });
    const client = new Client({ name: 'invalid-url-list-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: {
          targets: ['https://example.test/one\nftp://example.test/two'],
          confirmed: true
        }
      });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response)).toContain('Invalid explicit URL list entry 2');
      expect(executeAudit).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('includes history in approval and forwards the approved paths to execution', async () => {
    const executeAudit = vi.fn(async () => completedAuditResult);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createAccessibilityAuditMcpServer({ executeAudit });
    const client = new Client({ name: 'history-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const arguments_ = {
      targets: ['https://preview.example.test/'],
      historyPaths: ['/private/customer/august.json', '/private/customer/september.json'],
      browserEngine: 'firefox' as const
    };
    try {
      const proposal = await client.callTool({ name: 'run_accessibility_audit', arguments: arguments_ });
      expect(proposal.structuredContent).toEqual(expect.objectContaining({
        status: 'confirmation-required',
        proposedRun: expect.objectContaining({
          historyCount: 2,
          historySources: ['august.json', 'september.json'],
          browserEngine: 'firefox',
          browserSelection: 'Playwright Firefox',
          confirmationDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      }));
      expect(JSON.stringify(proposal.structuredContent)).not.toContain('/private/customer');
      const digest = (proposal.structuredContent as {
        proposedRun?: { confirmationDigest?: string };
      }).proposedRun?.confirmationDigest;

      await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { ...arguments_, confirmed: true, confirmationDigest: digest }
      });

      expect(executeAudit).toHaveBeenCalledWith(expect.objectContaining({
        historyPaths: arguments_.historyPaths,
        options: expect.objectContaining({ browserEngine: 'firefox' })
      }));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('publishes only the supported audit, validation, instruction, and manual-check tools', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createAccessibilityAuditMcpServer();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.listTools();
      const baselineTools = PUBLIC_SURFACE_V1_8_4.mcp.tools;
      expect(response.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(Object.keys(baselineTools))
      );
      expect(response.tools.some((tool) => /guidepup/i.test(`${tool.name} ${tool.description}`))).toBe(false);
      expect(JSON.stringify(response.tools)).not.toContain('screenReader');
      const inputKeys = (name: string): string[] => {
        const tool = response.tools.find((candidate) => candidate.name === name);
        if (!tool) throw new Error(`Missing MCP tool ${name}.`);
        return Object.keys(tool.inputSchema.properties ?? {}).sort();
      };
      for (const [name, baselineInputKeys] of Object.entries(baselineTools)) {
        expect(inputKeys(name)).toEqual(expect.arrayContaining([...baselineInputKeys]));
      }
      const legacyInputValidator = new Ajv({
        strict: false,
        validateFormats: false
      });
      for (const [name, legacyPayload] of Object.entries(PUBLIC_SURFACE_V1_8_4.mcp.legacyPayloads)) {
        const tool = response.tools.find((candidate) => candidate.name === name);
        if (!tool) throw new Error(`Missing MCP tool ${name}.`);
        const currentRequired = [...(tool.inputSchema.required ?? [])].sort();
        expect(currentRequired).toEqual(
          [...PUBLIC_SURFACE_V1_8_4.mcp.requiredInputs[name as keyof typeof PUBLIC_SURFACE_V1_8_4.mcp.requiredInputs]].sort()
        );
        const validateLegacyPayload = legacyInputValidator.compile(tool.inputSchema);
        expect(validateLegacyPayload(legacyPayload), `${name}: ${legacyInputValidator.errorsText(validateLegacyPayload.errors)}`).toBe(true);
      }
      const expectedOutputKeys: Record<string, string[]> = {
        run_accessibility_audit: ['status', 'proposedRun', 'reportPath', 'validation', 'artifacts', 'error'],
        get_audit_instructions: ['instructions', 'defaults', 'supportedInputs'],
        audit_pages: ['status', 'reportPath', 'validation', 'error'],
        audit_from_file: ['status', 'reportPath', 'validation', 'error'],
        validate_accessibility_report: ['valid', 'errors', 'status', 'error'],
        list_guided_manual_checks: ['checks']
      };
      const collectPropertyKeys = (schema: unknown): string[] => {
        if (!schema || typeof schema !== 'object') return [];
        const record = schema as Record<string, unknown>;
        const keys = record.properties && typeof record.properties === 'object'
          ? Object.keys(record.properties)
          : [];
        for (const keyword of ['oneOf', 'anyOf', 'allOf']) {
          const branches = record[keyword];
          if (Array.isArray(branches)) {
            for (const branch of branches) keys.push(...collectPropertyKeys(branch));
          }
        }
        return [...new Set(keys)];
      };
      for (const [name, expectedKeys] of Object.entries(expectedOutputKeys)) {
        const tool = response.tools.find((candidate) => candidate.name === name);
        expect(tool?.inputSchema.type).toBe('object');
        expect(tool?.outputSchema?.type).toBe('object');
        expect(collectPropertyKeys(tool?.outputSchema)).toEqual(
          expect.arrayContaining(expectedKeys)
        );
      }
      const auditOutput = response.tools.find(
        (tool) => tool.name === 'run_accessibility_audit'
      )?.outputSchema as Record<string, unknown>;
      const validationOutput = response.tools.find(
        (tool) => tool.name === 'validate_accessibility_report'
      )?.outputSchema as Record<string, unknown>;
      expect(auditOutput.oneOf).toHaveLength(6);
      expect(validationOutput.anyOf).toHaveLength(3);
      const validatePublishedAuditOutput = new Ajv({
        strict: false,
        validateFormats: false
      }).compile(auditOutput);
      expect(validatePublishedAuditOutput(completedAuditOutput)).toBe(true);
      expect(validatePublishedAuditOutput({
        ...completedAuditOutput,
        artifacts: completedAuditOutput.artifacts.map((artifact) => (
          artifact.type === 'html-report'
            ? { ...artifact, mimeType: 'application/json' }
            : artifact
        ))
      })).toBe(false);
      expect(validatePublishedAuditOutput({
        ...completedAuditOutput,
        artifacts: completedAuditOutput.artifacts.map((artifact) => (
          artifact.type === 'html-report'
            ? { ...artifact, uri: 'https://example.test/report.html' }
            : artifact
        ))
      })).toBe(false);
      expect(validatePublishedAuditOutput({
        ...completedAuditOutput,
        artifacts: completedAuditOutput.artifacts.map((artifact) => (
          artifact.type === 'screenshot-directory'
            ? { ...artifact, available: false, count: 2 }
            : artifact
        ))
      })).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('accepts complete MCP output variants and rejects incomplete status-specific payloads', () => {
    const acceptedAuditOutputs = [
      completedAuditOutput,
      {
        ...completedAuditResult,
        status: 'cancelled' as const,
        artifacts: artifactDescriptorsFor({ ...completedAuditResult, status: 'cancelled' })
      },
      {
        status: 'confirmation-required' as const,
        auditStarted: false as const,
        proposedRun: proposedRunResult,
        nextAction: 'Confirm and retry.'
      },
      {
        status: 'confirmation-stale' as const,
        auditStarted: false as const,
        message: 'The audit settings changed.',
        proposedRun: proposedRunResult,
        nextAction: 'Review and retry.'
      },
      { status: 'cancelled-before-start' as const, auditStarted: false as const },
      actionableFailureResult
    ];
    for (const output of acceptedAuditOutputs) {
      expect(auditToolOutputContractSchema.safeParse(output).success).toBe(true);
    }

    const htmlArtifact = completedAuditOutput.artifacts[0];
    const screenshotArtifact = completedAuditOutput.artifacts[3];
    for (const artifact of [
      { ...htmlArtifact, mimeType: 'application/json' },
      { ...htmlArtifact, uri: 'https://example.test/report.html' },
      { ...screenshotArtifact, available: false, count: 2 },
      { ...screenshotArtifact, available: true, count: 0 }
    ]) {
      expect(artifactDescriptorOutputSchema.safeParse(artifact).success).toBe(false);
    }

    for (const output of [
      { status: 'completed' },
      { status: 'cancelled' },
      { status: 'confirmation-required', auditStarted: false, nextAction: 'Confirm.' },
      {
        status: 'confirmation-stale',
        auditStarted: false,
        proposedRun: proposedRunResult,
        nextAction: 'Retry.'
      },
      { status: 'cancelled-before-start', auditStarted: true },
      { status: 'failed' },
      { ...completedAuditOutput, artifacts: completedAuditOutput.artifacts.slice(0, 4) },
      {
        ...completedAuditOutput,
        artifacts: [...completedAuditOutput.artifacts].reverse()
      }
    ]) {
      expect(auditToolOutputContractSchema.safeParse(output).success).toBe(false);
    }

    const validWorkbook = completedAuditResult.validation;
    const invalidWorkbookFailure = {
      ...validWorkbook,
      valid: false as const,
      status: 'failed' as const,
      stage: 'validation' as const,
      error: {
        code: 'report-validation-failed' as const,
        message: 'Report validation failed.',
        nextSteps: ['Regenerate the report.'],
        retryable: true
      },
      code: 'report-validation-failed' as const,
      message: 'Report validation failed.',
      nextSteps: ['Regenerate the report.'],
      retryable: true,
      nextAction: 'Regenerate the report.'
    };
    const validationException = {
      ...actionableFailureResult,
      stage: 'validation' as const
    };
    for (const output of [validWorkbook, invalidWorkbookFailure, validationException]) {
      expect(validationToolOutputContractSchema.safeParse(output).success).toBe(true);
    }
    for (const output of [{}, { status: 'failed' }, { valid: true }]) {
      expect(validationToolOutputContractSchema.safeParse(output).success).toBe(false);
    }
  });

  it('exposes and forwards validated journeys through every MCP audit tool', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const receivedJourneys: unknown[] = [];
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async (request) => {
        receivedJourneys.push(request.options?.journeys);
        return completedAuditResult;
      }
    });
    const client = new Client({ name: 'journey-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const journeys = [{
      id: 'search-flow',
      title: 'Search for an article',
      categories: ['keyboard', 'forms'],
      urlIncludes: '/search',
      viewports: ['desktop'],
      steps: [
        { action: 'focus', selector: '#search' },
        { action: 'type', selector: '#search', text: 'accessibility' },
        { action: 'press', key: 'Enter', selector: '#search' },
        { action: 'assert', expectation: 'url-contains', value: 'accessibility' }
      ]
    }];
    try {
      const tools = await client.listTools();
      for (const name of ['run_accessibility_audit', 'audit_pages', 'audit_from_file']) {
        const tool = tools.tools.find((candidate) => candidate.name === name);
        expect(tool?.inputSchema.properties).toHaveProperty('journeys');
      }

      const journeyArguments = { targets: ['https://preview.example.test/search'], journeys };
      const journeyDigest = await requestConfirmationDigest(client, journeyArguments);
      await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { ...journeyArguments, confirmed: true, confirmationDigest: journeyDigest }
      });
      await client.callTool({
        name: 'audit_pages',
        arguments: { urls: ['https://preview.example.test/search'], journeys }
      });
      await client.callTool({
        name: 'audit_from_file',
        arguments: { inputPath: 'pages.txt', journeys }
      });

      const invalidResponse = await client.callTool({
        name: 'audit_pages',
        arguments: {
          urls: ['https://preview.example.test/search'],
          journeys: [{ id: 'invalid', title: 'Invalid journey', categories: ['keyboard'], steps: [] }]
        }
      });
      expect(invalidResponse.isError).toBe(true);
      expect(JSON.stringify(invalidResponse.content)).toContain('expected array to have >=1 items');

      expect(receivedJourneys).toEqual([journeys, journeys, journeys]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('exposes WCAG level and AAA advisory controls through every MCP audit tool', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const receivedCoverage: Array<{ wcagLevel?: unknown; aaaAdvisory?: unknown }> = [];
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async (request) => {
        receivedCoverage.push({
          wcagLevel: request.options?.wcagLevel,
          aaaAdvisory: request.options?.aaaAdvisory
        });
        return completedAuditResult;
      }
    });
    const client = new Client({ name: 'coverage-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = await client.listTools();
      for (const name of ['run_accessibility_audit', 'audit_pages', 'audit_from_file']) {
        const properties = tools.tools.find((candidate) => candidate.name === name)?.inputSchema.properties;
        expect(properties).toHaveProperty('wcagLevel');
        expect(properties).toHaveProperty('aaaAdvisory');
      }

      const coverageArguments = {
        targets: ['https://preview.example.test/'],
        wcagLevel: 'AA',
        aaaAdvisory: false
      };
      const coverageDigest = await requestConfirmationDigest(client, coverageArguments);
      await client.callTool({
        name: 'run_accessibility_audit',
        arguments: {
          ...coverageArguments,
          confirmed: true,
          confirmationDigest: coverageDigest
        }
      });
      await client.callTool({
        name: 'audit_pages',
        arguments: {
          urls: ['https://preview.example.test/'],
          wcagLevel: 'AA',
          aaaAdvisory: true
        }
      });
      await client.callTool({
        name: 'audit_from_file',
        arguments: {
          inputPath: 'pages.txt',
          wcagLevel: 'AAA',
          aaaAdvisory: false
        }
      });

      expect(receivedCoverage).toEqual([
        { wcagLevel: 'AA', aaaAdvisory: false },
        { wcagLevel: 'AAA', aaaAdvisory: true },
        { wcagLevel: 'AAA', aaaAdvisory: true }
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('passes saved browser-state paths through every MCP audit tool without making them required', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-auth-state-'));
    const statePath = join(directory, 'session.json');
    await writeFile(statePath, JSON.stringify({
      cookies: [{
        name: 'session', value: 'private-value', domain: 'preview.example.test', path: '/',
        expires: -1, httpOnly: true, secure: true, sameSite: 'Lax'
      }],
      origins: []
    }));
    await chmod(statePath, 0o600);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const receivedStates: Array<string | undefined> = [];
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async (request) => {
        receivedStates.push(request.options?.storageState);
        return completedAuditResult;
      }
    });
    const client = new Client({ name: 'storage-state-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = await client.listTools();
      for (const name of ['run_accessibility_audit', 'audit_pages', 'audit_from_file']) {
        const tool = tools.tools.find((candidate) => candidate.name === name);
        expect(tool?.inputSchema.properties).toHaveProperty('storageState');
        expect(tool?.inputSchema.required ?? []).not.toContain('storageState');
      }

      const storageArguments = { targets: ['https://preview.example.test/'], storageState: statePath };
      const storageDigest = await requestConfirmationDigest(client, storageArguments);
      await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { ...storageArguments, confirmed: true, confirmationDigest: storageDigest }
      });
      await client.callTool({
        name: 'audit_pages',
        arguments: { urls: ['https://preview.example.test/'], storageState: statePath }
      });
      await client.callTool({
        name: 'audit_from_file',
        arguments: { inputPath: 'pages.txt', storageState: statePath }
      });

      expect(receivedStates).toEqual(Array(3).fill(statePath));
    } finally {
      await client.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns typed, safely encoded artifact descriptors and links when an audit is cancelled', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const cancelledAuditResult = {
      ...completedAuditResult,
      status: 'cancelled' as const,
      reportPath: '/tmp/partial report\n#1.xlsx',
      htmlPath: '/tmp/partial report\n#1.html',
      jsonPath: '/tmp/partial report\n#1.json',
      archivePath: '/tmp/partial report\n#1.zip',
      auditedPageCount: 0,
      completedPageCount: 0,
      partialPageCount: 1,
      imageInventoryCount: 2,
      validation: {
        ...completedAuditResult.validation,
        imageInventoryRows: 2
      }
    };
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async () => cancelledAuditResult
    });
    const client = new Client({ name: 'cancelled-artifact-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const cancelledArguments = { targets: ['https://preview.example.test/'] };
      const cancelledDigest = await requestConfirmationDigest(client, cancelledArguments);
      const response = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { ...cancelledArguments, confirmed: true, confirmationDigest: cancelledDigest }
      });
      type AuditResponseContent =
        | { type: 'text'; text: string }
        | { type: 'resource_link'; uri: string; title?: string; description?: string; mimeType?: string };
      const content = response.content as AuditResponseContent[];
      const links = content.filter(
        (item): item is Extract<AuditResponseContent, { type: 'resource_link' }> => item.type === 'resource_link'
      );
      expect(links).toEqual(expect.arrayContaining([
        expect.objectContaining({
          uri: pathToFileURL(cancelledAuditResult.htmlPath).href,
          title: 'Open accessibility audit report',
          description: expect.stringMatching(/partial HTML report/i),
          mimeType: 'text/html'
        }),
        expect.objectContaining({
          uri: pathToFileURL(cancelledAuditResult.reportPath).href,
          title: 'Open accessibility audit workbook',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }),
        expect.objectContaining({
          uri: pathToFileURL(cancelledAuditResult.jsonPath).href,
          title: 'Open accessibility audit JSON',
          mimeType: 'application/json'
        }),
        expect.objectContaining({
          uri: pathToFileURL('/tmp/screenshots').href,
          title: 'Open accessibility evidence screenshots',
          description: expect.stringMatching(/2 linked evidence screenshots/i),
          mimeType: 'inode/directory'
        }),
        expect.objectContaining({
          uri: pathToFileURL(cancelledAuditResult.archivePath).href,
          title: 'Share accessibility audit report',
          description: expect.stringMatching(/partial report package/i),
          mimeType: 'application/zip'
        })
      ]));
      expect(links).toHaveLength(5);
      expect(new Set(links.map((link) => link.uri)).size).toBe(5);
      for (const link of links) {
        expect(link.uri).not.toContain('\n');
      }
      for (const link of links.filter((link) => link.mimeType !== 'inode/directory')) {
        expect(link.uri).toContain('%0A');
        expect(link.uri).toContain('%23');
      }
      const textContent = content.find((item) => item.type === 'text');
      if (textContent?.type !== 'text') throw new Error('Expected audit JSON text content.');
      const expectedResult = {
        ...cancelledAuditResult,
        artifacts: artifactDescriptorsFor(cancelledAuditResult)
      };
      expect(JSON.parse(textContent.text)).toEqual(expectedResult);
      expect(response.structuredContent).toEqual(expectedResult);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('publishes and renders the generic audit prompt', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createAccessibilityAuditMcpServer();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toContain('run-accessibility-audit');
      const response = await client.getPrompt({
        name: 'run-accessibility-audit',
        arguments: { targets: 'https://preview.example.test/', auditor: 'Test Auditor' }
      });
      const content = response.messages[0]?.content;
      expect(content?.type).toBe('text');
      if (content?.type !== 'text') throw new Error('Expected text prompt content.');
      expect(content.text).toContain('https://preview.example.test/');
      expect(content.text).toContain('linked element screenshots');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('requires page and auditor confirmation before starting when the client cannot show a form', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let auditCalls = 0;
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async () => {
        auditCalls += 1;
        return completedAuditResult;
      }
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { targets: ['https://preview.example.test/'] }
      });
      expect(response.structuredContent).toEqual(expect.objectContaining({
        status: 'confirmation-required',
        auditStarted: false,
        proposedRun: expect.objectContaining({
          scopeMode: 'supplied-pages-only',
          pageCount: 1,
          pages: ['https://preview.example.test/'],
          hosts: ['preview.example.test'],
          landingPageUrl: 'https://preview.example.test/',
          browserMode: 'headless',
          browserEngine: 'chromium',
          browserSelection: 'Playwright Chromium or supported system browser',
          autoInstallBrowser: true,
          timeoutMs: 30_000,
          maxTabStops: 120,
          maxLinksPerPage: 200,
          journeys: []
        })
      }));
      expect(auditCalls).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('does not treat confirmed true as consent without the returned digest', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let auditCalls = 0;
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async () => {
        auditCalls += 1;
        return completedAuditResult;
      }
    });
    const client = new Client({ name: 'missing-digest-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { targets: ['https://preview.example.test/'], confirmed: true }
      });
      expect(response.structuredContent).toEqual(expect.objectContaining({
        status: 'confirmation-required',
        auditStarted: false,
        proposedRun: expect.objectContaining({
          confirmationDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      }));
      expect(auditCalls).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('uses one accessible MCP form to confirm targets and edit the default auditor', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let receivedAuditor = '';
    let receivedLandingPage = '';
    let receivedHeadless: boolean | undefined;
    let receivedAutoInstallBrowser: boolean | undefined;
    let confirmationMessage = '';
    let defaultLandingPage = '';
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async (request) => {
        receivedAuditor = String(request.options?.auditor ?? '');
        receivedLandingPage = String(request.options?.landingPageUrl ?? '');
        receivedHeadless = request.options?.headless;
        receivedAutoInstallBrowser = request.options?.autoInstallBrowser;
        return { ...completedAuditResult, validation: { ...completedAuditResult.validation, auditor: receivedAuditor } };
      }
    });
    const client = new Client(
      { name: 'elicitation-client', version: '1.0.0' },
      { capabilities: { elicitation: { form: {} } } }
    );
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      confirmationMessage = request.params.message;
      if (!('requestedSchema' in request.params)) throw new Error('Expected a form elicitation request.');
      const schema = request.params.requestedSchema as {
        properties?: Record<string, { default?: unknown }>;
      };
      defaultLandingPage = String(schema.properties?.landingPageUrl?.default ?? '');
      return {
        action: 'accept',
        content: { auditor: 'Test Auditor', landingPageUrl: 'https://preview.example.test/', confirm: true }
      };
    });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { targets: ['https://preview.example.test/'] }
      });
      expect(response.structuredContent).toEqual(expect.objectContaining({ status: 'completed' }));
      expect(response.structuredContent).toEqual(expect.objectContaining({
        artifacts: expect.arrayContaining([
          expect.objectContaining({ type: 'html-report', available: true }),
          expect.objectContaining({ type: 'excel-workbook', available: true }),
          expect.objectContaining({ type: 'json-results', available: true }),
          expect.objectContaining({ type: 'screenshot-directory', available: false, count: 0 }),
          expect.objectContaining({ type: 'portable-archive', available: true })
        ])
      }));
      expect(receivedAuditor).toBe('Test Auditor');
      expect(receivedLandingPage).toBe('https://preview.example.test/');
      expect(receivedHeadless).toBe(true);
      expect(receivedAutoInstallBrowser).toBe(true);
      expect(defaultLandingPage).toBe('https://preview.example.test/');
      expect(confirmationMessage).toContain('Pre-audit summary');
      expect(confirmationMessage).toContain('1 resolved from 1 input');
      expect(confirmationMessage).toContain('supplied pages only (no crawl)');
      expect(confirmationMessage).toContain('https://preview.example.test/');
      expect(confirmationMessage).toContain('Playwright Chromium or supported system browser');
      expect(confirmationMessage).toContain('automatic Chromium install on');
      expect(confirmationMessage).toContain('30000 ms per operation');
      expect(confirmationMessage).toContain('120 keyboard tab stops');
      expect(confirmationMessage).toContain('200 same-origin links per page');
      expect(confirmationMessage).toContain('Journeys: none');
      expect(response.content).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'resource_link',
          uri: 'file:///tmp/report.html',
          mimeType: 'text/html'
        }),
        expect.objectContaining({
          type: 'resource_link',
          uri: 'file:///tmp/report.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }),
        expect.objectContaining({
          type: 'resource_link',
          uri: 'file:///tmp/audit-results.json',
          mimeType: 'application/json'
        }),
        expect.objectContaining({
          type: 'resource_link',
          uri: 'file:///tmp/accessibility-audit.zip',
          title: 'Share accessibility audit report',
          mimeType: 'application/zip'
        })
      ]));
      expect(response.content).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'resource_link',
          uri: 'file:///tmp/screenshots'
        })
      ]));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('audits the page-list snapshot shown in the MCP confirmation form even if the file changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-form-snapshot-'));
    const pageList = join(directory, 'pages.txt');
    await writeFile(pageList, 'https://preview.example.test/approved\n');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let receivedInputs: string[] = [];
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async (request) => {
        receivedInputs = [...request.inputs];
        return completedAuditResult;
      }
    });
    const client = new Client(
      { name: 'snapshot-client', version: '1.0.0' },
      { capabilities: { elicitation: { form: {} } } }
    );
    client.setRequestHandler(ElicitRequestSchema, async () => {
      await writeFile(pageList, 'https://preview.example.test/changed\n');
      return { action: 'accept', content: { auditor: 'Automated', confirm: true } };
    });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { targets: [pageList] }
      });
      expect(response.structuredContent).toEqual(expect.objectContaining({ status: 'completed' }));
      expect(receivedInputs).toEqual(['https://preview.example.test/approved']);
    } finally {
      await client.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a stale digest when a no-form confirmation page list changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-digest-snapshot-'));
    const pageList = join(directory, 'pages.txt');
    await writeFile(pageList, 'https://preview.example.test/approved\n');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let auditCalls = 0;
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async () => {
        auditCalls += 1;
        return completedAuditResult;
      }
    });
    const client = new Client({ name: 'digest-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const proposal = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { targets: [pageList] }
      });
      const proposedRun = (proposal.structuredContent as {
        proposedRun?: { confirmationDigest?: string };
      }).proposedRun;
      expect(proposedRun?.confirmationDigest).toMatch(/^[a-f0-9]{64}$/);

      await writeFile(pageList, 'https://preview.example.test/changed\n');
      const response = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: {
          targets: [pageList],
          confirmed: true,
          confirmationDigest: proposedRun?.confirmationDigest
        }
      });

      expect(response.structuredContent).toEqual(expect.objectContaining({
        status: 'confirmation-stale',
        auditStarted: false,
        proposedRun: expect.objectContaining({
          pages: ['https://preview.example.test/changed'],
          confirmationDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      }));
      expect(auditCalls).toBe(0);
    } finally {
      await client.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('requires fresh MCP form confirmation if saved browser state changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-auth-form-stale-'));
    const statePath = join(directory, 'session.json');
    const state = (value: string) => ({
      cookies: [{
        name: 'session', value, domain: 'preview.example.test', path: '/', expires: -1,
        httpOnly: true, secure: true, sameSite: 'Lax'
      }],
      origins: []
    });
    await writeFile(statePath, JSON.stringify(state('approved-value')));
    await chmod(statePath, 0o600);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let auditCalls = 0;
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async () => {
        auditCalls += 1;
        return completedAuditResult;
      }
    });
    const client = new Client(
      { name: 'auth-form-stale-client', version: '1.0.0' },
      { capabilities: { elicitation: { form: {} } } }
    );
    client.setRequestHandler(ElicitRequestSchema, async () => {
      await writeFile(statePath, JSON.stringify(state('changed-value')));
      return {
        action: 'accept',
        content: { auditor: 'Automated', landingPageUrl: 'https://preview.example.test/', confirm: true }
      };
    });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { targets: ['https://preview.example.test/'], storageState: statePath }
      });
      expect(response.structuredContent).toEqual(expect.objectContaining({
        status: 'confirmation-stale',
        auditStarted: false
      }));
      expect(auditCalls).toBe(0);
      expect(JSON.stringify(response.structuredContent)).not.toContain('approved-value');
      expect(JSON.stringify(response.structuredContent)).not.toContain(statePath);
    } finally {
      await client.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a stale no-form digest when saved browser state changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-auth-digest-stale-'));
    const statePath = join(directory, 'session.json');
    const state = (value: string) => ({
      cookies: [{
        name: 'session', value, domain: 'preview.example.test', path: '/', expires: -1,
        httpOnly: true, secure: true, sameSite: 'Lax'
      }],
      origins: []
    });
    await writeFile(statePath, JSON.stringify(state('approved-value')));
    await chmod(statePath, 0o600);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let auditCalls = 0;
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async () => {
        auditCalls += 1;
        return completedAuditResult;
      }
    });
    const client = new Client({ name: 'auth-digest-stale-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const proposal = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { targets: ['https://preview.example.test/'], storageState: statePath }
      });
      const digest = (proposal.structuredContent as {
        proposedRun?: { confirmationDigest?: string };
      }).proposedRun?.confirmationDigest;
      expect(digest).toMatch(/^[a-f0-9]{64}$/);

      await writeFile(statePath, JSON.stringify(state('changed-value')));
      const response = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: {
          targets: ['https://preview.example.test/'],
          storageState: statePath,
          confirmed: true,
          confirmationDigest: digest
        }
      });
      expect(response.structuredContent).toEqual(expect.objectContaining({
        status: 'confirmation-stale',
        auditStarted: false
      }));
      expect(auditCalls).toBe(0);
    } finally {
      await client.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { setting: 'report name', changedSettings: { reportName: 'changed.xlsx' } },
    { setting: 'template path', changedSettings: { templatePath: '/tmp/template-changed.xlsx' } }
  ])('rejects a stale digest when the no-form $setting changes', async ({ changedSettings }) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let auditCalls = 0;
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async () => {
        auditCalls += 1;
        return completedAuditResult;
      }
    });
    const client = new Client({ name: 'settings-digest-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const approvedSettings = {
        reportName: 'approved.xlsx',
        templatePath: '/tmp/template-approved.xlsx'
      };
      const proposal = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: {
          targets: ['https://preview.example.test/approved'],
          ...approvedSettings
        }
      });
      const proposedRun = (proposal.structuredContent as {
        proposedRun?: { confirmationDigest?: string };
      }).proposedRun;

      const response = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: {
          targets: ['https://preview.example.test/approved'],
          ...approvedSettings,
          ...changedSettings,
          confirmed: true,
          confirmationDigest: proposedRun?.confirmationDigest
        }
      });

      expect(response.structuredContent).toEqual(expect.objectContaining({
        status: 'confirmation-stale',
        auditStarted: false
      }));
      expect(auditCalls).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('applies MCP presets while allowing explicit settings to override them', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let receivedOptions: Record<string, unknown> = {};
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async (request) => {
        receivedOptions = request.options ?? {};
        return completedAuditResult;
      }
    });
    const client = new Client({ name: 'preset-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const presetArguments = {
        targets: ['https://preview.example.test/'],
        preset: 'thorough',
        timeoutMs: 12_000
      };
      const presetDigest = await requestConfirmationDigest(client, presetArguments);
      await client.callTool({
        name: 'run_accessibility_audit',
        arguments: {
          ...presetArguments,
          confirmed: true,
          confirmationDigest: presetDigest
        }
      });
      expect(receivedOptions).toEqual(expect.objectContaining({
        preset: 'thorough',
        aaaAdvisory: true,
        headless: true,
        timeoutMs: 12_000,
        maxTabStops: 240,
        maxLinksPerPage: 500,
        captureScreenshots: true
      }));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('describes the effective debug preset as visible-browser before confirmation', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let confirmationMessage = '';
    let auditCalls = 0;
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async () => {
        auditCalls += 1;
        return completedAuditResult;
      }
    });
    const client = new Client(
      { name: 'debug-confirmation-client', version: '1.0.0' },
      { capabilities: { elicitation: { form: {} } } }
    );
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      confirmationMessage = request.params.message;
      return { action: 'accept', content: { auditor: 'Automated', confirm: false } };
    });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { targets: ['https://preview.example.test/'], preset: 'debug' }
      });
      expect(confirmationMessage).toContain('visible-browser accessibility audit');
      expect(confirmationMessage).not.toContain('headless accessibility audit');
      expect(auditCalls).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('forwards audit progress through standard MCP progress notifications', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async (request) => {
        await request.execution?.onProgress?.({
          phase: 'browser',
          message: 'Testing https://public.example/path?access%252525255Ftoken=mcp-message-secret&next=/public',
          url: 'https://user:mcp-url-secret@public.example/path#id_token=mcp-fragment-secret'
        });
        await request.execution?.onProgress?.({
          phase: 'browser',
          message: String.raw`Authorization: Digest realm=\"Private \\\"hidden; request do not expose\\\" tail\", nonce=\"mcp-header-secret\". Please retry safely`
        });
        await request.execution?.onProgress?.({ phase: 'reporting', message: 'Writing workbook.' });
        return completedAuditResult;
      }
    });
    const client = new Client({ name: 'progress-client', version: '1.0.0' });
    const loggingData: unknown[] = [];
    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      loggingData.push(notification.params.data);
    });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const messages: string[] = [];
    try {
      const progressArguments = { targets: ['https://preview.example.test/'] };
      const progressDigest = await requestConfirmationDigest(client, progressArguments);
      await client.callTool(
        {
          name: 'run_accessibility_audit',
          arguments: { ...progressArguments, confirmed: true, confirmationDigest: progressDigest }
        },
        undefined,
        { onprogress: (event) => { if (event.message) messages.push(event.message); } }
      );
      expect(messages).toEqual([
        'Testing https://public.example/path?access%252525255Ftoken=[redacted]&next=/public',
        'Authorization: [redacted]. Please retry safely',
        'Writing workbook.'
      ]);
      expect(loggingData[0]).toMatchObject({
        phase: 'browser',
        message: 'Testing https://public.example/path?access%252525255Ftoken=[redacted]&next=/public',
        url: 'https://[redacted]@public.example/path#id_token=[redacted]'
      });
      expect(JSON.stringify(loggingData)).not.toMatch(/mcp-message-secret|mcp-url-secret|mcp-fragment-secret|mcp-header-secret|Private|nonce|user/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([
    ['Chromium', 'chromium'],
    ['Firefox', 'firefox'],
    ['WebKit', 'webkit']
  ] as const)('returns actionable structured %s execution errors without exposing stack traces', async (label, engine) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const executionError = new Error(`No supported ${label} browser is available.`);
    executionError.stack = `Error: No supported ${label} browser is available.\n    at launch (runner.ts:10:2)`;
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async () => { throw executionError; }
    });
    const client = new Client({ name: 'failure-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({
        name: 'audit_pages',
        arguments: { urls: ['https://preview.example.test/'] }
      });
      expect(response.isError).toBe(true);
      expect(response.structuredContent).toEqual(expect.objectContaining({
        status: 'failed',
        stage: 'execution',
        error: expect.objectContaining({
          code: 'browser-unavailable',
          retryable: true,
          nextSteps: expect.arrayContaining([expect.stringContaining(`playwright install ${engine}`)])
        }),
        nextAction: expect.any(String)
      }));
      if (engine !== 'chromium') {
        expect(JSON.stringify(response).toLowerCase()).not.toContain('playwright install chromium');
      }
      expect(JSON.stringify(response)).not.toContain('runner.ts:10:2');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([
    '/Users/carla/private/browsers/chromium',
    '/Users/carla/My Browsers/a(b)/chromium',
    String.raw`C:\Users\Carla\Private\browsers\chromium.exe`,
    String.raw`C:\Users\Carla\My Browsers\a(b)\chromium.exe`,
    String.raw`\\fileserver\private share\a(b)\chromium.exe`,
    'file:///Users/carla/My%20Browsers/a(b)/chromium'
  ])('redacts the local path %s from structured and text MCP failures', async (localPath) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const executionError = Object.assign(
      new Error(`EACCES: permission denied, open '${localPath}'`),
      { code: 'EACCES' }
    );
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async () => { throw executionError; }
    });
    const client = new Client({ name: 'path-redaction-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({
        name: 'audit_pages',
        arguments: { urls: ['https://preview.example.test/'] }
      });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response)).not.toContain(localPath);
      expect(JSON.stringify(response)).not.toContain('My Browsers');
      expect(JSON.stringify(response)).not.toContain('private share');
      expect(JSON.stringify(response)).not.toContain('a(b)');
      if (localPath.startsWith('file://')) expect(JSON.stringify(response)).not.toContain('file://');
      const drivePrefix = /^[A-Za-z]:[\\/]+/.exec(localPath)?.[0];
      if (drivePrefix) expect(JSON.stringify(response)).not.toContain(drivePrefix);
      expect(response.structuredContent).toEqual(expect.objectContaining({
        code: 'output-unavailable',
        message: expect.stringContaining('[local path]'),
        nextSteps: expect.any(Array),
        retryable: true
      }));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('preserves an HTTPS URL with a slash-prefixed query value in MCP failure output', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const publicUrl = 'https://example.test/a/b?next=/c';
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async () => { throw new Error(`Request failed at ${publicUrl}`); }
    });
    const client = new Client({ name: 'url-preservation-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({
        name: 'audit_pages',
        arguments: { urls: ['https://preview.example.test/'] }
      });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response)).toContain(publicUrl);
      expect(response.structuredContent).toEqual(expect.objectContaining({
        message: `Request failed at ${publicUrl}`,
        error: expect.objectContaining({ message: `Request failed at ${publicUrl}` })
      }));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns legacy validation details with the full actionable envelope for an invalid workbook', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-invalid-workbook-'));
    const workbookPath = join(directory, 'invalid.xlsx');
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Incomplete');
    await workbook.xlsx.writeFile(workbookPath);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createAccessibilityAuditMcpServer();
    const client = new Client({ name: 'validation-failure-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({
        name: 'validate_accessibility_report',
        arguments: { workbookPath }
      });
      expect(response.isError).toBe(true);
      expect(response.structuredContent).toEqual(expect.objectContaining({
        valid: false,
        findingRows: 0,
        evidenceRows: 0,
        imageInventoryRows: 0,
        errors: expect.arrayContaining([expect.stringContaining('Missing Audit Summary worksheet')]),
        warnings: expect.arrayContaining([expect.stringContaining('no finding rows')]),
        auditor: '',
        status: 'failed',
        stage: 'validation',
        code: 'report-validation-failed',
        message: expect.stringContaining('Report validation failed'),
        nextSteps: expect.arrayContaining([expect.any(String)]),
        retryable: true,
        nextAction: expect.any(String),
        error: {
          code: 'report-validation-failed',
          message: expect.stringContaining('Report validation failed'),
          nextSteps: expect.arrayContaining([expect.any(String)]),
          retryable: true
        }
      }));
      const textBlock = Array.isArray(response.content)
        ? response.content.find((item): item is { type: 'text'; text: string } => (
          typeof item === 'object'
          && item !== null
          && 'type' in item
          && item.type === 'text'
          && 'text' in item
          && typeof item.text === 'string'
        ))
        : undefined;
      expect(JSON.parse(textBlock?.text ?? '{}')).toEqual(response.structuredContent);
    } finally {
      await client.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns preparation guidance before an audit starts when scope settings are invalid', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let auditCalls = 0;
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async () => {
        auditCalls += 1;
        return completedAuditResult;
      }
    });
    const client = new Client({ name: 'preparation-failure-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: {
          targets: ['https://preview.example.test/'],
          allowedHosts: ['https://preview.example.test/path'],
          confirmed: true
        }
      });
      expect(response.isError).toBe(true);
      expect(response.structuredContent).toEqual(expect.objectContaining({
        status: 'failed',
        stage: 'preparation',
        error: expect.objectContaining({ code: 'scope-restricted' })
      }));
      expect(auditCalls).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
