import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AuditSummary } from '../src/types.js';
import { writeHtmlReport } from '../src/reporting/html.js';

describe('HTML accessibility report', () => {
  it('writes an accessible, portable report and escapes audit content', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'a11y-html-'));
    const outputPath = join(outputDir, 'Accessibility_Audit_Report.html');
    const summary: AuditSummary = {
      status: 'completed',
      generatedAt: '2026-09-09T12:00:00.000Z',
      auditor: 'CarlasHub <script>alert(1)</script>',
      source: 'direct input, direct input',
      wcagLevel: 'AA',
      landingPageUrl: 'https://example.test/',
      requestedUrls: ['https://example.test/'],
      auditedUrls: ['https://example.test/'],
      skippedUrls: [],
      pages: [],
      coverage: [],
      findings: [{
        key: 'button-name',
        ruleId: 'button-name',
        classification: 'confirmed',
        severity: 'Serious',
        wcag: ['4.1.2'],
        summary: 'Button has no accessible name',
        issue: 'Assistive technology cannot identify the control.',
        impact: 'Screen-reader users cannot determine its purpose.',
        testing: 'Inspect the computed accessible name.',
        remediation: 'Add visible text or an accurate accessible name.',
        component: 'button',
        componentName: 'Submit button',
        componentLocation: 'Checkout',
        urls: ['https://example.test/'],
        viewports: ['desktop'],
        selectors: ['button.submit'],
        evidence: [{
          kind: 'axe',
          pageUrl: 'https://example.test/',
          viewport: 'desktop',
          selector: 'button.submit',
          detail: 'Element failed button-name.',
          screenshot: join(outputDir, 'screenshots', 'elements', 'button.png')
        }],
        assignment: 'Development',
        effort: 'Small',
        translationRequired: 'No'
      }],
      manualChecks: [{ id: 'MAN-001', classification: 'manual', title: 'Screen reader flow', wcag: ['1.3.1'], procedure: 'Review reading order.', applicableTo: 'All pages' }],
      limitations: ['Manual assistive-technology testing remains required.']
    };

    await writeHtmlReport(summary, outputPath);
    const html = await readFile(outputPath, 'utf8');

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Skip to report');
    expect(html).toContain('<caption>Automated and evidence-backed findings</caption>');
    expect(html).toContain('screenshots/elements/button.png');
    expect(html).toContain('CarlasHub &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<strong>Source:</strong> direct input</span>');
    expect(html).not.toContain('direct input, direct input');
    expect(html).not.toContain('CarlasHub <script>alert(1)</script>');
    expect(html).not.toMatch(/https?:\/\/[^"']+\.(?:css|js)/i);
  });
});
