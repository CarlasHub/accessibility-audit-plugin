import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDITOR,
  DEFAULT_OUTPUT_DIR,
  buildEmbeddedAuditInstructions
} from '../src/instructions.js';

describe('embedded audit instructions', () => {
  it('uses the editable automated auditor default', () => {
    expect(DEFAULT_AUDITOR).toBe('Automated');
  });

  it('contains the generic isolated workflow and no-friction defaults', () => {
    const instructions = buildEmbeddedAuditInstructions({
      targets: './pages.xlsx',
      allowedHosts: ['preview.example.test'],
      stagingOnly: true
    });
    expect(instructions).toContain('./pages.xlsx');
    expect(instructions).toContain(`Auditor: ${DEFAULT_AUDITOR}`);
    expect(instructions).toContain(`Output directory: ${DEFAULT_OUTPUT_DIR}`);
    expect(instructions).toContain('preview.example.test');
    expect(instructions).toContain('run headlessly by default');
    expect(instructions).toContain('write validated partial JSON and XLSX output');
    expect(instructions).toContain('element screenshot');
    expect(instructions).toContain('both the authenticated request context and an in-page fetch agree');
    expect(instructions).toContain('Image Inventory');
    expect(instructions).not.toMatch(/guidepup/i);
    expect(instructions).not.toContain('Screen Reader Failures with');
    expect(instructions).toContain('Do not install dependencies in');
    expect(instructions).toContain('Do not mention Jira');
    expect(instructions).toContain('never assume the site is Unilever');
    expect(instructions).toContain('Keep findings on separate rows per page by default');
    expect(instructions).toContain('same reusable component implementation and the same root cause');
  });

  it('keeps caller-supplied identity and output values', () => {
    const instructions = buildEmbeddedAuditInstructions({
      auditor: 'Another Auditor',
      outputDir: 'audit-output'
    });
    expect(instructions).toContain('Auditor: Another Auditor');
    expect(instructions).toContain('Output directory: audit-output');
    expect(instructions).toContain('Browser mode: headless');
  });
});
