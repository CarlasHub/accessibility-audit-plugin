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
    expect(instructions).toContain('Landing-page QA URL: [first resolved URL]');
    expect(instructions).toContain(`Output directory: ${DEFAULT_OUTPUT_DIR}`);
    expect(instructions).toContain('preview.example.test');
    expect(instructions).toContain('run headlessly by default');
    expect(instructions).toContain('write partial HTML and JSON plus a validated partial XLSX workbook');
    expect(instructions).toContain('element screenshot');
    expect(instructions).toContain('both the authenticated request context and an in-page fetch agree');
    expect(instructions).toContain('relative hyperlinks in Findings and Evidence');
    expect(instructions).toContain('seven-sheet CarlasHub WCAG 2.2 workbook');
    expect(instructions).toContain('Page Inventory with one structured row per requested or skipped URL');
    expect(instructions).toContain('Evidence with one structured row per retained evidence item');
    expect(instructions).toContain('scripted screen-reader journey');
    expect(instructions).toContain('qualified human assessment is complete');
    expect(instructions).not.toContain('Screen Reader Failures with');
    expect(instructions).toContain('Do not install dependencies in');
    expect(instructions).toContain('Do not mention Jira');
    expect(instructions).toContain('never assume the target belongs to a previous audit');
    expect(instructions).toContain('customer names, or site-specific rules from an earlier run');
    expect(instructions).toContain('Use one row for the same reusable component implementation and root cause');
    expect(instructions).toContain('same reusable component implementation and root cause');
    expect(instructions).toContain('set every populated Findings row to Open');
    expect(instructions).toContain('populate Owner and Effort from the finding');
    expect(instructions).toContain('Explain the result in plain language');
    expect(instructions).toContain('only supplied URLs were tested');
    expect(instructions).toContain("Open workflow status from evidence confidence");
    expect(instructions).toContain('extract the ZIP');
  });

  it('keeps caller-supplied identity and output values', () => {
    const instructions = buildEmbeddedAuditInstructions({
      auditor: 'Another Auditor',
      landingPageUrl: 'https://preview.example.test/',
      outputDir: 'audit-output'
    });
    expect(instructions).toContain('Auditor: Another Auditor');
    expect(instructions).toContain('Landing-page QA URL: https://preview.example.test/');
    expect(instructions).toContain('Output directory: audit-output');
    expect(instructions).toContain('Browser mode: headless');
  });
});
