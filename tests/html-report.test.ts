import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AuditSummary, Finding, FindingClassification } from '../src/types.js';
import { findingActionGuidance, findingTicketText, writeHtmlReport } from '../src/reporting/html.js';

function ticketFinding(classification: FindingClassification): Finding {
  return {
    key: classification,
    ruleId: `rule-${classification}`,
    classification,
    severity: 'Moderate',
    wcag: ['1.3.1'],
    standards: ['Section 508 E205.4'],
    summary: `${classification} result`,
    issue: 'An accessibility issue needs attention.',
    impact: 'People may be unable to complete the task.',
    testing: 'Repeat the documented check.',
    remediation: 'Correct the component and retest it.',
    component: 'test component',
    urls: ['https://example.test/task'],
    viewports: ['desktop'],
    selectors: ['#test-component'],
    evidence: [],
    assignment: 'Development',
    effort: 'Small',
    translationRequired: 'No'
  };
}

describe('finding explanations', () => {
  it.each([
    ['confirmed', 'Treat this as a reproduced barrier'],
    ['review', 'Validate this evidence with human judgement'],
    ['blocker', 'Restore access or remove the blocking condition'],
    ['manual', 'Complete the documented human procedure']
  ] as const)('explains the next action for %s results', (classification, expected) => {
    expect(findingActionGuidance(classification)).toContain(expected);
  });

  it.each([
    ['confirmed', 'Evidence type: Confirmed barrier', 'Impact / priority: Moderate'],
    ['review', 'Evidence type: Requires human validation', 'Impact / priority: Review priority: Moderate'],
    ['blocker', 'Evidence type: Coverage blocker (not a conformance result)', 'Impact / priority: Coverage blocked'],
    ['manual', 'Evidence type: Manual check required', 'Impact / priority: Human check']
  ] as const)('keeps %s ticket evidence and priority labels distinct', (classification, evidence, priority) => {
    const ticket = findingTicketText(ticketFinding(classification), 0);
    expect(ticket).toContain(evidence);
    expect(ticket).toContain(priority);
    expect(ticket).toContain('WCAG / standard: 1.3.1, Section 508 E205.4');
  });
});

describe('HTML accessibility report', () => {
  it('writes an accessible, portable report and escapes audit content', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'a11y-html-'));
    const outputPath = join(outputDir, 'Accessibility_Audit_Report.html');
    const summary: AuditSummary = {
      status: 'completed',
      generatedAt: '2026-09-09T12:00:00.000Z',
      auditor: 'CarlasHub <script>alert(1)</script>',
      source: 'direct input, direct input',
      browserEngine: 'webkit',
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
      manualChecks: [{
        id: 'MAN-001',
        classification: 'manual',
        title: 'Screen reader flow',
        wcag: ['1.3.1'],
        procedure: 'Review reading order.',
        applicableTo: 'All pages',
        expectedEvidence: 'Page, screen reader, reading sequence, announcement, and verdict.'
      }],
      limitations: ['Manual assistive-technology testing remains required.']
    };

    await writeHtmlReport(summary, outputPath);
    const html = await readFile(outputPath, 'utf8');
    const ticket = findingTicketText(summary.findings[0]!, 0);

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Skip to report');
    expect(html).toContain(
      '<caption>Findings and evidence requiring action or validation</caption>',
    );
    expect(html).toContain('screenshots/elements/button.png');
    expect(html).toContain('CarlasHub &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<strong>Source:</strong> direct input</span>');
    expect(html).toContain('<strong>Browser:</strong> webkit</span>');
    expect(html).toContain('Page, screen reader, reading sequence, announcement, and verdict.');
    expect(html).toContain('Configured task journeys');
    expect(html).toContain('No configured task journeys were supplied');
    expect(html).toContain('<h2 id="executive-summary-title">Executive summary</h2>');
    expect(html).toContain('1 confirmed barrier rated Serious or Critical requires priority remediation.');
    expect(html).toContain('<h3>Current position</h3>');
    expect(html).toContain('<h3>Recommended next step</h3>');
    expect(html).toContain('WCAG conformance remains not determined pending qualified human assessment.');
    expect(html).toContain('aria-label="Start reviewing this report"');
    expect(html).toContain('<a href="#top-actions">Start with top actions</a>');
    expect(html).toContain('<a href="#findings">Review findings</a>');
    expect(html).toContain('<a href="#criteria">Check WCAG criteria</a>');
    expect(html).toContain('<a href="#pages">Inspect page coverage</a>');
    expect(html).toContain('<h2 id="top-actions-title">Top actions</h2>');
    expect(html).toContain('aria-label="Evidence type: Confirmed barrier">Confirmed</span>');
    expect(html).toContain('<a href="#finding-A11Y001"><span class="finding-id">A11Y001</span> Button has no accessible name</a>');
    expect(html).toContain('<strong>Owner:</strong> Development');
    expect(html).toContain('<strong>Effort:</strong> Small');
    expect(html).toContain('1 affected page');
    expect(html).toContain('<summary>Understand and resolve this finding</summary>');
    expect(html).toContain('<strong>What to do with this result:</strong> Treat this as a reproduced barrier');
    expect(html).toContain('<h3>Why this matters</h3>');
    expect(html).toContain('<h3>How this was checked</h3>');
    expect(html).toContain('<h3>How to fix it</h3>');
    expect(html).toContain('<h3>Affected component</h3>');
    expect(html).toContain('<h3>Technical selectors</h3>');
    expect(html).toContain('<h3>Evidence screenshots</h3>');
    expect(html).toContain('class="copy-ticket"');
    expect(html).toContain('aria-describedby="copy-status-A11Y001"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(ticket).toContain('[A11Y001] Button has no accessible name');
    expect(ticket).toContain('Evidence type: Confirmed barrier');
    expect(ticket).toContain('Impact / priority: Serious');
    expect(ticket).toContain('WCAG / standard: 4.1.2');
    expect(ticket).toContain('Component / location: Submit button — Checkout');
    expect(ticket).toContain('Affected pages:\n- https://example.test/');
    expect(ticket).toContain('Technical selectors:\n- button.submit');
    expect(html.indexOf('id="executive-summary"')).toBeLessThan(html.indexOf('class="metrics"'));
    expect(html.indexOf('id="executive-summary"')).toBeLessThan(html.indexOf('id="top-actions"'));
    expect(html.indexOf('id="top-actions"')).toBeLessThan(html.indexOf('class="metrics"'));
    expect(html.indexOf('class="metrics"')).toBeLessThan(html.indexOf('class="notice warning"'));
    expect(html).not.toContain('direct input, direct input');
    expect(html).not.toContain('CarlasHub <script>alert(1)</script>');
    expect(html).not.toContain('id="comparison"');
    expect(html).not.toContain('Baseline comparison</a>');
    expect(html).not.toMatch(/https?:\/\/[^"']+\.(?:css|js)/i);

    summary.comparison = {
      kind: 'baseline-comparison',
      coverage: 'partial',
      baselineSource: 'baseline <script>alert(2)</script>.json',
      baselineGeneratedAt: '2026-09-01T09:00:00.000Z',
      baselineFindingCount: 2,
      currentFindingCount: 2,
      newFindings: [{ fingerprint: 'new-key', id: 'A11Y002', classification: 'confirmed', severity: 'Serious', summary: 'New <img src=x onerror=alert(3)> issue', urls: ['https://example.test/new', 'javascript:alert(4)'], viewports: ['desktop'] }],
      unchangedFindings: [{ fingerprint: 'same-key', classification: 'review', severity: 'Moderate', summary: 'Review remains', urls: ['https://example.test/'], viewports: ['mobile'] }],
      resolvedFindings: [],
      indeterminateCurrentFindings: [],
      unobservedBaselineFindings: [],
      limitations: ['Mobile baseline scope was unavailable.']
    };
    const comparisonPath = join(outputDir, 'Accessibility_Audit_Comparison_Report.html');
    await writeHtmlReport(summary, comparisonPath);
    const comparisonHtml = await readFile(comparisonPath, 'utf8');
    expect(comparisonHtml).toContain('<section id="comparison" aria-labelledby="comparison-title">');
    expect(comparisonHtml).toContain('Partial comparison: 1 finding new, 1 finding unchanged and 0 findings resolved');
    expect(comparisonHtml).toContain('<a href="#comparison">Review baseline changes</a>');
    expect(comparisonHtml).toContain('<a href="#comparison">Baseline comparison</a>');
    expect(comparisonHtml).toContain('baseline &lt;script&gt;alert(2)&lt;/script&gt;.json');
    expect(comparisonHtml).not.toContain('baseline <script>alert(2)</script>.json');
    expect(comparisonHtml).toContain('New &lt;img src=x onerror=alert(3)&gt; issue');
    expect(comparisonHtml).toContain('href="https://example.test/new"');
    expect(comparisonHtml).toContain('<li>javascript:alert(4)</li>');
    expect(comparisonHtml).not.toContain('href="javascript:alert(4)"');
    expect(comparisonHtml).toContain('Resolved means the finding was not observed when the same URL and viewport scope was successfully rerun');
    expect(comparisonHtml).toContain('Mobile baseline scope was unavailable.');

    summary.history = {
      kind: 'audit-history',
      points: [{
        source: 'prior & audit.json', generatedAt: '2026-08-09T12:00:00.000Z', status: 'completed',
        requestedPageCount: 2, auditedPageCount: 2, findingCount: 3, confirmedCount: 2, reviewCount: 1,
        blockerCount: 0, manualCount: 0, criticalConfirmedCount: 0, seriousConfirmedCount: 2
      }, {
        source: 'Current audit', generatedAt: summary.generatedAt, status: summary.status,
        browserEngine: 'webkit',
        requestedPageCount: 1, auditedPageCount: 1, findingCount: 1, confirmedCount: 1, reviewCount: 0,
        blockerCount: 0, manualCount: 0, criticalConfirmedCount: 0, seriousConfirmedCount: 1,
        comparisonToPrevious: {
          coverage: 'partial', newCount: 1, unchangedCount: 0, resolvedCount: 0,
          indeterminateCurrentCount: 0, unobservedPreviousCount: 3
        }
      }],
      limitations: ['Scope <changed> between snapshots.']
    };
    const historyPath = join(outputDir, 'Accessibility_Audit_History_Report.html');
    await writeHtmlReport(summary, historyPath);
    const historyHtml = await readFile(historyPath, 'utf8');
    expect(historyHtml).toContain('<section id="history" aria-labelledby="history-title">');
    expect(historyHtml).toContain('<caption>Audit history from oldest to latest</caption>');
    expect(historyHtml).toContain('<a href="#history">Review audit trends</a>');
    expect(historyHtml).toContain('<a href="#history">History and trends</a>');
    expect(historyHtml).toContain('prior &amp; audit.json');
    expect(historyHtml).toContain('Partial scope: 1 new, 0 unchanged, 0 resolved, 0 indeterminate, 3 previously observed but not re-observed');
    expect(historyHtml).toContain('Scope &lt;changed&gt; between snapshots.');
    expect(historyHtml).not.toContain('Scope <changed> between snapshots.');
  });
});
