import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import axe from 'axe-core';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { writeHtmlReport } from '../src/reporting/html.js';
import type { AuditSummary, Finding, FindingClassification } from '../src/types.js';

function finding(classification: FindingClassification, index: number): Finding {
  return {
    key: `${classification}-${index}`,
    ruleId: classification === 'confirmed' ? 'axe-image-alt' : 'target-size-review',
    classification,
    severity: classification === 'confirmed' ? 'Serious' : 'Moderate',
    wcag: [classification === 'confirmed' ? '1.1.1' : '2.5.8'],
    summary: classification === 'confirmed' ? 'Image is missing alternative text' : 'Target size needs review',
    issue: 'The rendered component needs accessibility attention.',
    impact: 'Some people may be unable to perceive or operate the component.',
    testing: 'Inspect the component and repeat the documented check.',
    remediation: 'Update the component to meet the mapped WCAG requirement.',
    component: 'test component',
    urls: ['https://example.test/app#special'],
    viewports: ['desktop'],
    selectors: [`#component-${index}`],
    evidence: [{
      kind: classification === 'confirmed' ? 'axe' : 'dom',
      pageUrl: 'https://example.test/app#special',
      viewport: 'desktop',
      selector: `#component-${index}`,
      detail: 'Browser evidence was captured.'
    }],
    assignment: 'Development',
    effort: 'Small',
    translationRequired: 'No'
  };
}

function reportFixture(): AuditSummary {
  return {
    status: 'completed',
    generatedAt: '2026-09-10T12:00:00.000Z',
    auditor: 'CarlasHub',
    source: 'rendered report regression',
    wcagLevel: 'AA',
    landingPageUrl: 'https://example.test/app#special',
    requestedUrls: ['https://example.test/app#special'],
    auditedUrls: ['https://example.test/app#special'],
    skippedUrls: [],
    pages: [],
    coverage: [],
    findings: [finding('confirmed', 1), finding('review', 2)],
    manualChecks: [{
      id: 'MAN-SR-001',
      classification: 'manual',
      title: 'Screen-reader reading order',
      wcag: ['1.3.2'],
      applicableTo: 'All content',
      procedure: 'Read the page with a supported screen reader and record the spoken order.'
    }],
    limitations: ['Human conformance assessment remains required.']
  };
}

describe.skipIf(process.env.RUN_BROWSER_INTEGRATION !== '1')('rendered HTML report', () => {
  it('passes automated checks and keeps keyboard, structure, tables, and filters usable', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'a11y-html-browser-'));
    const outputPath = join(outputDir, 'Accessibility_Audit_Report.html');
    await writeHtmlReport(reportFixture(), outputPath);

    const channel = process.env.A11Y_TEST_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined);
    const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
    try {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(outputPath).href);
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const result = await (globalThis as unknown as {
          axe: { run: (root: Document) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> };
        }).axe.run(document);
        return result.violations.map(({ id, impact }) => ({ id, impact }));
      });
      expect(violations).toEqual([]);

      await page.keyboard.press('Tab');
      expect(await page.locator(':focus').textContent()).toContain('Skip to report');
      const focusStyle = await page.locator(':focus').evaluate((element) => {
        const style = getComputedStyle(element);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
      });
      expect(focusStyle.outlineStyle).not.toBe('none');
      expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThan(0);

      const headingLevels = await page.locator('h1,h2,h3,h4,h5,h6').evaluateAll((headings) => (
        headings.map((heading) => Number(heading.tagName.slice(1)))
      ));
      expect(headingLevels.filter((level) => level === 1)).toHaveLength(1);
      expect(headingLevels.every((level, index) => index === 0 || level <= headingLevels[index - 1]! + 1)).toBe(true);
      expect(await page.locator('table').count()).toBeGreaterThan(0);
      expect(await page.locator('table:not(:has(caption))').count()).toBe(0);
      expect(await page.locator('th:not([scope="col"])').count()).toBe(0);

      const resultCount = page.locator('#result-count');
      expect(await resultCount.textContent()).toBe('2 of 2 findings');
      await page.locator('#finding-search').fill('image');
      expect(await resultCount.textContent()).toBe('1 of 2 findings');
      expect(await page.locator('#finding-rows tr[hidden]').count()).toBe(1);
      await page.locator('#finding-search').fill('');
      await page.locator('#classification-filter').selectOption('review');
      expect(await resultCount.textContent()).toBe('1 of 2 findings');
      expect(await page.locator('#finding-rows tr[hidden]').count()).toBe(1);
    } finally {
      await browser.close();
    }
  });
});
