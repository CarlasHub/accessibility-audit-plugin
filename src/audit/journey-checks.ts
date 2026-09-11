import type { Page } from 'playwright';
import type {
  AuditJourneyDefinition,
  AuditJourneyStep,
  KeyboardJourneyResult
} from '../types.js';

type AssertStep = Extract<AuditJourneyStep, { action: 'assert' }>;

function appliesTo(journey: AuditJourneyDefinition, requestedUrl: string, viewportName: string): boolean {
  return (!journey.urlIncludes || requestedUrl.includes(journey.urlIncludes))
    && (!journey.viewports?.length || journey.viewports.includes(viewportName));
}

function requiredSelector(step: AssertStep): boolean {
  return !['url-contains', 'live-region-updated'].includes(step.expectation);
}

function expectedDescription(step: AssertStep): string {
  const target = step.selector ? ` ${step.selector}` : '';
  const value = step.value
    ? step.expectation === 'value-equals'
      ? ` equal to “${step.value}”`
      : ` containing “${step.value}”`
    : '';
  return `${step.expectation}${target}${value}`;
}

async function installLiveRegionObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    type AuditWindow = Window & {
      __carlashubAuditLiveChanges?: Array<{ text: string; element: Element }>;
      __carlashubAuditLiveObserver?: MutationObserver;
    };
    const auditWindow = window as AuditWindow;
    auditWindow.__carlashubAuditLiveObserver?.disconnect();
    auditWindow.__carlashubAuditLiveChanges = [];
    const liveSelector = '[role="alert"], [role="status"], [role="log"], [aria-live]:not([aria-live="off"])';
    const record = (element: Element): void => {
      const live = element.matches(liveSelector) ? element : element.closest(liveSelector);
      const text = live?.textContent?.replace(/\s+/g, ' ').trim();
      if (text && live) auditWindow.__carlashubAuditLiveChanges?.push({ text, element: live });
    };
    auditWindow.__carlashubAuditLiveObserver = new MutationObserver((records) => {
      for (const mutation of records) {
        if (mutation.target instanceof Element) record(mutation.target);
        else if (mutation.target.parentElement) record(mutation.target.parentElement);
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            record(node);
            node.querySelectorAll(liveSelector).forEach(record);
          }
        }
      }
    });
    auditWindow.__carlashubAuditLiveObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-live', 'role']
    });
  });
}

async function assertionMatches(page: Page, step: AssertStep): Promise<boolean> {
  return page.evaluate(({ expectation, selector, value }) => {
    type AuditWindow = Window & {
      __carlashubAuditLiveChanges?: Array<{ text: string; element: Element }>;
    };
    if (expectation === 'url-contains') return typeof value === 'string' && location.href.includes(value);
    if (expectation === 'live-region-updated') {
      const changes = (window as AuditWindow).__carlashubAuditLiveChanges ?? [];
      const target = selector ? document.querySelector(selector) : null;
      const matchingChanges = target
        ? changes.filter((change) => change.element === target)
        : changes;
      return value
        ? matchingChanges.some((change) => change.text.includes(value))
        : matchingChanges.length > 0;
    }
    if (!selector) return false;
    const element = document.querySelector<HTMLElement>(selector);
    if (expectation === 'hidden') {
      if (!element) return true;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display === 'none' || style.visibility === 'hidden' || style.contentVisibility === 'hidden'
        || rect.width === 0 || rect.height === 0;
    }
    if (!element) return false;
    const visible = (): boolean => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && style.contentVisibility !== 'hidden';
    };
    if (expectation === 'focused') return document.activeElement === element;
    if (expectation === 'visible') return visible();
    if (expectation === 'expanded') return element.getAttribute('aria-expanded') === 'true';
    if (expectation === 'collapsed') return element.getAttribute('aria-expanded') === 'false';
    if (expectation === 'pressed') return element.getAttribute('aria-pressed') === 'true';
    if (expectation === 'unpressed') return element.getAttribute('aria-pressed') === 'false';
    if (expectation === 'selected') return element.getAttribute('aria-selected') === 'true';
    if (expectation === 'checked') {
      return element.getAttribute('aria-checked') === 'true'
        || (element instanceof HTMLInputElement && element.checked);
    }
    if (expectation === 'unchecked') {
      return element.getAttribute('aria-checked') === 'false'
        || (element instanceof HTMLInputElement && !element.checked);
    }
    if (expectation === 'invalid') {
      return element.getAttribute('aria-invalid') === 'true'
        || (element.matches('input, select, textarea') && element.matches(':invalid'));
    }
    if (expectation === 'valid') {
      return element.getAttribute('aria-invalid') !== 'true'
        && (!element.matches('input, select, textarea') || element.matches(':valid'));
    }
    if (expectation === 'text-contains') return typeof value === 'string' && (element.textContent ?? '').includes(value);
    if (expectation === 'value-equals') {
      return typeof value === 'string'
        && (element instanceof HTMLInputElement
          || element instanceof HTMLTextAreaElement
          || element instanceof HTMLSelectElement)
        && element.value === value;
    }
    return false;
  }, { expectation: step.expectation, selector: step.selector, value: step.value });
}

async function executeAssertion(page: Page, step: AssertStep): Promise<boolean> {
  const timeoutMs = step.timeoutMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await assertionMatches(page, step)) return true;
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  return false;
}

export async function runConfiguredJourneyChecks(
  page: Page,
  definitions: AuditJourneyDefinition[],
  requestedUrl: string,
  viewportName: string,
  preparePage?: () => Promise<void>
): Promise<KeyboardJourneyResult[]> {
  const journeys = definitions.filter((journey) => appliesTo(journey, requestedUrl, viewportName));
  const results: KeyboardJourneyResult[] = [];

  for (const journey of journeys) {
    const completedSteps: string[] = [];
    const selectors = new Set<string>();
    let assertionCount = 0;
    let status: KeyboardJourneyResult['status'] = 'passed';
    let detail = 'Every configured assertion produced the expected result.';
    try {
      await page.goto(requestedUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
      await preparePage?.();
      await installLiveRegionObserver(page);

      for (const step of journey.steps) {
        if ('selector' in step && step.selector) selectors.add(step.selector);
        if (step.action === 'focus') {
          const locator = page.locator(step.selector);
          if (await locator.count() === 0) {
            status = 'inconclusive';
            detail = `Configured focus target ${step.selector} was not found, so the journey could not complete.`;
            break;
          }
          try {
            await locator.first().focus();
          } catch {
            status = 'failed';
            detail = `Configured keyboard target ${step.selector} exists but could not receive focus.`;
            completedSteps.push(`Attempted to focus ${step.selector}`);
            break;
          }
          if (!await locator.first().evaluate((element) => document.activeElement === element)) {
            status = 'failed';
            detail = `Configured keyboard target ${step.selector} exists but did not retain focus.`;
            completedSteps.push(`Attempted to focus ${step.selector}`);
            break;
          }
          completedSteps.push(`Focused ${step.selector}`);
        } else if (step.action === 'press') {
          if (step.selector) {
            const locator = page.locator(step.selector);
            if (await locator.count() === 0) {
              status = 'inconclusive';
              detail = `Configured key target ${step.selector} was not found, so the journey could not complete.`;
              break;
            }
            try {
              await locator.first().focus();
            } catch {
              status = 'failed';
              detail = `Configured keyboard target ${step.selector} exists but could not receive focus before ${step.key}.`;
              completedSteps.push(`Attempted to focus ${step.selector}`);
              break;
            }
            if (!await locator.first().evaluate((element) => document.activeElement === element)) {
              status = 'failed';
              detail = `Configured keyboard target ${step.selector} exists but did not retain focus before ${step.key}.`;
              completedSteps.push(`Attempted to focus ${step.selector}`);
              break;
            }
          }
          await page.keyboard.press(step.key);
          await page.waitForTimeout(50);
          completedSteps.push(`Pressed ${step.key}${step.selector ? ` on ${step.selector}` : ''}`);
        } else if (step.action === 'type') {
          const locator = page.locator(step.selector);
          if (await locator.count() === 0) {
            status = 'inconclusive';
            detail = `Configured text field ${step.selector} was not found, so the journey could not complete.`;
            break;
          }
          await locator.first().fill(step.text);
          completedSteps.push(`Entered configured text in ${step.selector}`);
        } else if (step.action === 'wait') {
          await page.waitForTimeout(step.milliseconds);
          completedSteps.push(`Waited ${step.milliseconds} ms`);
        } else {
          assertionCount += 1;
          if (requiredSelector(step) && !step.selector) {
            status = 'inconclusive';
            detail = `The ${step.expectation} assertion requires a selector.`;
            break;
          }
          if (['url-contains', 'text-contains', 'value-equals'].includes(step.expectation) && step.value === undefined) {
            status = 'inconclusive';
            detail = `The ${step.expectation} assertion requires a value.`;
            break;
          }
          const matched = await executeAssertion(page, step);
          completedSteps.push(`Asserted ${expectedDescription(step)}`);
          if (!matched) {
            status = 'failed';
            detail = `Expected ${expectedDescription(step)}, but the expected state was not observed within ${step.timeoutMs ?? 2_000} ms.`;
            break;
          }
        }
      }
      if (status === 'passed' && assertionCount === 0) {
        status = 'inconclusive';
        detail = 'The configured journey performed actions but contained no assertion, so it did not establish an outcome.';
      }
    } catch (error) {
      status = 'inconclusive';
      detail = `The configured journey could not complete: ${error instanceof Error ? error.message : String(error)}`;
    }

    results.push({
      id: journey.id,
      title: journey.title,
      status,
      steps: completedSteps,
      detail,
      source: 'configured',
      categories: journey.categories,
      assertionCount,
      selectors: [...selectors]
    });
  }
  return results;
}
