import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { createAccessibilityAuditMcpServer } from '../src/mcp.js';

const completedAuditResult = {
  status: 'completed' as const,
  reportPath: '/tmp/report.xlsx',
  jsonPath: '/tmp/audit-results.json',
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

describe('MCP server', () => {
  it('publishes only the supported audit, validation, instruction, and manual-check tools', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createAccessibilityAuditMcpServer();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.listTools();
      expect(response.tools.map((tool) => tool.name).sort()).toEqual([
        'audit_from_file',
        'audit_pages',
        'get_audit_instructions',
        'list_guided_manual_checks',
        'run_accessibility_audit',
        'validate_accessibility_report'
      ]);
      expect(response.tools.some((tool) => /guidepup/i.test(`${tool.name} ${tool.description}`))).toBe(false);
      expect(JSON.stringify(response.tools)).not.toContain('screenReader');
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
      expect(response.structuredContent).toEqual(expect.objectContaining({ status: 'confirmation-required', auditStarted: false }));
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
    client.setRequestHandler(ElicitRequestSchema, async () => ({
      action: 'accept',
      content: { auditor: 'Test Auditor', landingPageUrl: 'https://preview.example.test/', confirm: true }
    }));
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({
        name: 'run_accessibility_audit',
        arguments: { targets: ['https://preview.example.test/'] }
      });
      expect(response.structuredContent).toEqual(expect.objectContaining({ status: 'completed' }));
      expect(receivedAuditor).toBe('Test Auditor');
      expect(receivedLandingPage).toBe('https://preview.example.test/');
      expect(receivedHeadless).toBe(true);
      expect(receivedAutoInstallBrowser).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('forwards audit progress through standard MCP progress notifications', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createAccessibilityAuditMcpServer({
      executeAudit: async (request) => {
        await request.execution?.onProgress?.({ phase: 'browser', message: 'Testing desktop viewport.' });
        await request.execution?.onProgress?.({ phase: 'reporting', message: 'Writing workbook.' });
        return completedAuditResult;
      }
    });
    const client = new Client({ name: 'progress-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const messages: string[] = [];
    try {
      await client.callTool(
        { name: 'run_accessibility_audit', arguments: { targets: ['https://preview.example.test/'], confirmed: true } },
        undefined,
        { onprogress: (event) => { if (event.message) messages.push(event.message); } }
      );
      expect(messages).toEqual(['Testing desktop viewport.', 'Writing workbook.']);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
