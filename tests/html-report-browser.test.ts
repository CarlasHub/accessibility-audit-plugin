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

      const topActionLinks = await page.locator('#top-actions .top-action h3 a').evaluateAll((links) => (
        links.map((link) => link.getAttribute('href'))
      ));
      expect(topActionLinks).toEqual(['#finding-A11Y001', '#finding-A11Y002']);
      await page.locator('#top-actions .top-action h3 a').first().click();
      expect(new URL(page.url()).hash).toBe('#finding-A11Y001');
      expect(await page.locator('#finding-A11Y001').count()).toBe(1);

      await page.setViewportSize({ width: 320, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await page.locator('#top-actions .top-action').evaluateAll((cards) => cards.every((card) => {
        const bounds = card.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth;
      }))).toBe(true);
      await page.setViewportSize({ width: 1280, height: 720 });

      const resultCount = page.locator('#result-count');
      expect(await resultCount.textContent()).toBe('2 of 2 findings');
      await page.locator('#finding-search').fill('image');
      expect(await resultCount.textContent()).toBe('1 of 2 findings');
      expect(await page.locator('#finding-rows tr[hidden]').count()).toBe(1);
      await page.locator('#finding-search').fill('');
      await page.locator('#classification-filter').selectOption('review');
      expect(await resultCount.textContent()).toBe('1 of 2 findings');
      expect(await page.locator('#finding-rows tr[hidden]').count()).toBe(1);
      await page.locator('#classification-filter').selectOption('');

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: (value: string) => {
              (globalThis as typeof globalThis & { copiedTicket?: string }).copiedTicket = value;
              return Promise.resolve();
            }
          }
        });
      });
      const firstDetails = page.locator('#finding-rows details').first();
      await firstDetails.locator('summary').click();
      await firstDetails.locator('.copy-ticket').click();
      expect(await page.evaluate(() => (
        globalThis as typeof globalThis & { copiedTicket?: string }
      ).copiedTicket)).toContain('[A11Y001] Image is missing alternative text');
      expect(await page.locator('#copy-status-A11Y001').textContent()).toBe('Copied A11Y001 ticket.');

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
        Object.defineProperty(document, 'execCommand', {
          configurable: true,
          value: (command: string) => {
            (globalThis as typeof globalThis & { fallbackTicket?: string }).fallbackTicket =
              document.querySelector('textarea')?.value ?? '';
            return command === 'copy';
          }
        });
      });
      const secondDetails = page.locator('#finding-rows details').nth(1);
      await secondDetails.locator('summary').click();
      await secondDetails.locator('.copy-ticket').click();
      expect(await page.evaluate(() => (
        globalThis as typeof globalThis & { fallbackTicket?: string }
      ).fallbackTicket)).toContain('Evidence type: Requires human validation');
      expect(await page.locator('#copy-status-A11Y002').textContent()).toBe('Copied A11Y002 ticket.');

      await page.evaluate(() => {
        Object.defineProperty(document, 'execCommand', {
          configurable: true,
          value: () => false
        });
      });
      await secondDetails.locator('.copy-ticket').click();
      expect(await page.locator('#copy-status-A11Y002').textContent()).toBe(
        'Could not copy this ticket. Select the finding details and copy them manually.',
      );

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: () => new Promise<void>((resolve, reject) => {
              (globalThis as typeof globalThis & {
                settleClipboard?: (outcome: 'resolve' | 'reject') => void;
              }).settleClipboard = (outcome) => outcome === 'resolve' ? resolve() : reject(new Error('Denied'));
            })
          }
        });
      });
      const firstButton = firstDetails.locator('.copy-ticket');
      await firstButton.focus();
      await page.keyboard.press('Enter');
      expect(await firstButton.isDisabled()).toBe(true);
      expect(await page.locator('#copy-status-A11Y001').textContent()).toBe('Copying ticket…');
      await firstButton.evaluate((button) => (button as HTMLButtonElement).blur());
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
      await page.evaluate(() => (
        globalThis as typeof globalThis & {
          settleClipboard?: (outcome: 'resolve' | 'reject') => void;
        }
      ).settleClipboard?.('resolve'));
      await expect.poll(() => firstButton.isDisabled()).toBe(false);
      expect(await page.locator('#copy-status-A11Y001').textContent()).toBe('Copied A11Y001 ticket.');
      expect(await page.locator(':focus').getAttribute('data-finding-id')).toBe('A11Y001');

      await firstButton.focus();
      await page.keyboard.press('Enter');
      expect(await firstButton.isDisabled()).toBe(true);
      await firstButton.evaluate((button) => (button as HTMLButtonElement).blur());
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
      await page.evaluate(() => (
        globalThis as typeof globalThis & {
          settleClipboard?: (outcome: 'resolve' | 'reject') => void;
        }
      ).settleClipboard?.('reject'));
      await expect.poll(() => firstButton.isDisabled()).toBe(false);
      expect(await page.locator('#copy-status-A11Y001').textContent()).toBe(
        'Could not copy this ticket. Select the finding details and copy them manually.',
      );
      expect(await page.locator(':focus').getAttribute('data-finding-id')).toBe('A11Y001');

      await firstButton.focus();
      await page.keyboard.press('Enter');
      await page.locator('#finding-search').focus();
      await page.evaluate(() => (
        globalThis as typeof globalThis & {
          settleClipboard?: (outcome: 'resolve' | 'reject') => void;
        }
      ).settleClipboard?.('resolve'));
      await expect.poll(() => firstButton.isDisabled()).toBe(false);
      expect(await page.locator(':focus').getAttribute('id')).toBe('finding-search');
    } finally {
      await browser.close();
    }
  });
});
