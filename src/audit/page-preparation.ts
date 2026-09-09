import type { Frame, Locator, Page } from 'playwright';
import type { ConsentHandlingResult, ElementContext, InteractionBlocker } from '../types.js';

const consentSurfaceSelector = [
  '#onetrust-banner-sdk',
  '#CybotCookiebotDialog',
  '#truste-consent-track',
  '#system-ialert',
  '[id*="ialert" i][role="dialog"]',
  '[id*="ialert" i][role="alertdialog"]',
  '[class*="ialert" i][role="dialog"]',
  '[class*="ialert" i][role="alertdialog"]',
  '[role="dialog"][aria-label*="cookie" i]',
  '[role="dialog"][aria-label*="consent" i]',
  '[id*="cookie" i]',
  '[class*="cookie" i]',
  '[id*="consent" i]',
  '[class*="consent" i]'
].join(', ');

const consentActions = [
  {
    action: 'reject' as const,
    name: /^(reject|reject all|decline|decline all|do not accept|deny|deny all|recusar|recusar todos|rejeitar|rejeitar todos|não aceitar|nao aceitar|rechazar|rechazar todo|rechazar todos|ablehnen|alle ablehnen|weigeren|alles weigeren|refuser|tout refuser|tolak|tolak semua)$/i
  },
  {
    action: 'necessary' as const,
    name: /^(only necessary|necessary only|essential only|use necessary cookies|continue without accepting|apenas necessários|apenas necessarios|somente necessários|somente necessarios|solo necesarias|solo necesarios|nur notwendige|nur erforderliche|alleen noodzakelijk|uniquement nécessaires|cookies nécessaires uniquement)$/i
  },
  {
    action: 'accept' as const,
    name: /^(accept|accept all|allow|allow all|agree|i agree|ok|okay|aceitar|aceitar todos|aceptar|aceptar todo|aceptar todos|akzeptieren|alle akzeptieren|accepteren|alles accepteren|accepter|tout accepter|terima|terima semua)$/i
  }
];

function emptyConsentResult(): ConsentHandlingResult {
  return {
    found: false,
    dismissed: false,
    action: 'none',
    buttonName: '',
    surfaceSelector: '',
    frameUrl: ''
  };
}

async function visibleConsentSurfaces(frame: Frame): Promise<Locator[]> {
  const roots = frame.locator(consentSurfaceSelector);
  const result: Locator[] = [];
  const count = Math.min(await roots.count().catch(() => 0), 100);
  for (let index = 0; index < count; index += 1) {
    const root = roots.nth(index);
    if (!(await root.isVisible().catch(() => false))) continue;
    const qualifies = await root.evaluate((element) => {
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const knownProvider = /onetrust|cookiebot|truste|ialert/i.test(`${element.id} ${element.className}`);
      const modal = ['dialog', 'alertdialog'].includes(element.getAttribute('role') ?? '');
      const overlay = ['fixed', 'sticky'].includes(style.position) && rect.width * rect.height >= 4_000;
      return /cookie|consent|privacy/i.test(text) && (knownProvider || modal || overlay);
    }).catch(() => false);
    if (qualifies) result.push(root);
  }
  return result;
}

/** Returns a visible modal surface that would invalidate page-level interaction coverage. */
export async function detectInteractionBlocker(page: Page): Promise<InteractionBlocker | null> {
  for (const frame of page.frames()) {
    const candidates = frame.locator([
      '[role="dialog"][aria-modal="true"]',
      '[role="alertdialog"]',
      '[aria-modal="true"]',
      '#system-ialert'
    ].join(', '));
    const count = Math.min(await candidates.count().catch(() => 0), 50);
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const details = await candidate.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const viewportCoverage = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left))
          * Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
        const viewportArea = Math.max(1, innerWidth * innerHeight);
        const role = element.getAttribute('role') || (element.id === 'system-ialert' ? 'dialog surface' : element.tagName.toLowerCase());
        const labelledBy = element.getAttribute('aria-labelledby');
        const labelledText = labelledBy
          ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim()
          : '';
        const name = (
          element.getAttribute('aria-label')
          || labelledText
          || element.querySelector('h1, h2, h3, [role="heading"]')?.textContent
          || ''
        ).replace(/\s+/g, ' ').trim().slice(0, 160);
        const selector = element.id
          ? `#${CSS.escape(element.id)}`
          : `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 2).map((value) => `.${CSS.escape(value)}`).join('')}`;
        return { selector, role, name, coversViewport: viewportCoverage / viewportArea >= 0.08 };
      }).catch(() => null);
      if (!details) continue;
      if (!details.coversViewport && !/dialog/i.test(details.role)) continue;
      return {
        selector: details.selector,
        role: details.role,
        name: details.name,
        reason: 'A visible modal or blocking surface remained active before page-level interaction tests.'
      };
    }
  }
  return null;
}

async function buttonName(button: Locator): Promise<string> {
  return button.evaluate((element) => (
    element.getAttribute('aria-label')
    || (element instanceof HTMLInputElement ? element.value : '')
    || element.textContent
    || element.getAttribute('title')
    || ''
  ).replace(/\s+/g, ' ').trim()).catch(() => '');
}

/**
 * Dismisses a visible consent surface before keyboard checks and screenshot capture.
 * Reject/necessary choices are preferred so the audit does not opt into optional tracking.
 */
export async function dismissConsentBanner(page: Page): Promise<ConsentHandlingResult> {
  const result = emptyConsentResult();
  try {
    for (const frame of page.frames()) {
      const surfaces = await visibleConsentSurfaces(frame);
      if (surfaces.length === 0) continue;
      result.found = true;
      for (const surface of surfaces) {
        for (const candidate of consentActions) {
          const buttons = surface.getByRole('button', { name: candidate.name });
          const count = Math.min(await buttons.count().catch(() => 0), 20);
          for (let index = 0; index < count; index += 1) {
            const button = buttons.nth(index);
            if (!(await button.isVisible().catch(() => false))) continue;
            result.action = candidate.action;
            result.buttonName = await buttonName(button);
            result.surfaceSelector = await surface.evaluate((element) => {
              if (element.id) return `#${CSS.escape(element.id)}`;
              const classes = [...element.classList].slice(0, 2);
              return `${element.tagName.toLowerCase()}${classes.length ? `.${classes.map((value) => CSS.escape(value)).join('.')}` : ''}`;
            }).catch(() => consentSurfaceSelector);
            result.frameUrl = frame.url();
            await button.click({ timeout: 3_000 });
            await page.waitForTimeout(400);
            const remaining = (await Promise.all(page.frames().map(visibleConsentSurfaces))).flat();
            result.dismissed = remaining.length === 0;
            return result;
          }
        }
      }
    }
    return result;
  } catch (error) {
    return {
      ...result,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/** Collects stable human-readable evidence labels from the rendered DOM. */
export async function collectElementContexts(page: Page, selectors: string[]): Promise<ElementContext[]> {
  const contexts: ElementContext[] = [];
  for (const selector of [...new Set(selectors.map((value) => value.trim()).filter((value) => value && value !== 'page'))].slice(0, 300)) {
    try {
      const matches = page.locator(selector);
      const count = await matches.count();
      if (count === 0) continue;
      let target = matches.first();
      for (let index = 0; index < Math.min(count, 20); index += 1) {
        const candidate = matches.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
          target = candidate;
          break;
        }
      }
      const context = await target.evaluate((element, originalSelector) => {
        const clean = (value: string | null | undefined, limit = 160): string => (
          value ?? ''
        ).replace(/\s+/g, ' ').trim().slice(0, limit);
        const cssPath = (target: Element): string => {
          if (target.id) return `#${CSS.escape(target.id)}`;
          const parts: string[] = [];
          let current: Element | null = target;
          while (current && current !== document.documentElement && parts.length < 6) {
            let part = current.tagName.toLowerCase();
            const stableClasses = [...current.classList].filter((value) => !/\d{3,}/.test(value)).slice(0, 2);
            if (stableClasses.length) part += `.${stableClasses.map((value) => CSS.escape(value)).join('.')}`;
            if (current.parentElement) {
              const siblings = [...current.parentElement.children].filter((sibling) => sibling.tagName === current?.tagName);
              if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            }
            parts.unshift(part);
            current = current.parentElement;
          }
          return parts.join(' > ');
        };
        const textAlternative = (node: Node): string => {
          if (node instanceof Text) return clean(node.textContent, 120);
          if (!(node instanceof Element) || node.getAttribute('aria-hidden') === 'true') return '';
          if (node instanceof HTMLImageElement) return clean(node.alt, 120);
          if (node instanceof HTMLInputElement && /^(button|submit|reset|image)$/i.test(node.type)) return clean(node.value || node.alt, 120);
          return clean([...node.childNodes].map(textAlternative).filter(Boolean).join(' '), 120);
        };
        const accessibleName = (target: Element): string => {
          const labelledBy = target.getAttribute('aria-labelledby');
          if (labelledBy) {
            const labelledText = clean(labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '), 120);
            if (labelledText) return labelledText;
          }
          const ariaLabel = clean(target.getAttribute('aria-label'), 120);
          if (ariaLabel) return ariaLabel;
          if ('labels' in target) {
            const labels = (target as HTMLInputElement).labels;
            const labelText = clean([...(labels ?? [])].map((label) => textAlternative(label)).join(' '), 120);
            if (labelText) return labelText;
          }
          return textAlternative(target) || clean(target.getAttribute('title'), 120);
        };
        const explicitName = (target: Element): string => {
          const labelledBy = target.getAttribute('aria-labelledby');
          if (labelledBy) {
            const labelledText = clean(labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '), 120);
            if (labelledText) return labelledText;
          }
          return clean(target.getAttribute('aria-label'), 120);
        };
        const implicitRole = (target: Element): string => {
          const explicit = clean(target.getAttribute('role'), 40).split(' ')[0];
          if (explicit) return explicit;
          const tag = target.tagName.toLowerCase();
          if (tag === 'a' && target.hasAttribute('href')) return 'link';
          if (tag === 'a') return 'anchor';
          if (tag === 'button') return 'button';
          if (tag === 'select') return 'combobox';
          if (tag === 'textarea') return 'textbox';
          if (tag === 'img') return 'image';
          if (tag === 'nav') return 'navigation';
          if (tag === 'main') return 'main';
          if (tag === 'header') return 'banner';
          if (tag === 'footer') return 'contentinfo';
          if (tag === 'form' && /search/i.test(`${target.getAttribute('role') ?? ''} ${target.getAttribute('action') ?? ''} ${target.className}`)) return 'search';
          if (tag === 'form' && explicitName(target)) return 'form';
          if (/^h[1-6]$/.test(tag)) return 'heading';
          if (target instanceof HTMLInputElement) {
            if (['button', 'submit', 'reset', 'image'].includes(target.type)) return 'button';
            if (target.type === 'checkbox') return 'checkbox';
            if (target.type === 'radio') return 'radio';
            return 'textbox';
          }
          return tag;
        };
        const structuralSelector = [
          '[role="tablist"]', '[role="dialog"]', '[role="region"]',
          '[data-component]', '[data-module]', 'fieldset',
          '[class*="form-group" i]', '[class*="form-field" i]', '[class*="field-wrapper" i]',
          '[class*="input-wrapper" i]', '[class*="card" i]',
          'article', 'section', 'form', 'nav', 'header', 'footer',
          '[role="banner"]', '[role="contentinfo"]'
        ].join(',');
        const componentRoot = element.matches(structuralSelector) ? element : element.closest(structuralSelector);
        let heading = '';
        let current: Element | null = element;
        while (current && current !== document.body && !heading) {
          heading = clean(current.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6')?.textContent, 100);
          current = current.parentElement;
        }
        const landmark = element.closest('nav, main, header, footer, aside, [role="navigation"], [role="main"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="region"]');
        if (!heading) {
          const headingScope = landmark ?? document.body;
          const precedingHeadings = [...headingScope.querySelectorAll('h1, h2, h3, h4, h5, h6')]
            .filter((candidate) => Boolean(candidate.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
          heading = clean(precedingHeadings.at(-1)?.textContent, 100);
        }
        const landmarkRole = landmark ? implicitRole(landmark) : '';
        const landmarkName = landmark ? explicitName(landmark) : '';
        const role = implicitRole(element);
        const name = accessibleName(element);
        const visibleText = clean((element as HTMLElement).innerText || element.textContent, 120);
        const componentName = name
          ? `“${name}” ${role}`
          : visibleText
            ? `“${visibleText}” ${role}`
            : `Unnamed ${role}`;
        const places = [
          heading ? `the “${heading}” section` : '',
          landmarkName ? `the “${landmarkName}” ${landmarkRole} landmark` : landmarkRole ? `the ${landmarkRole} landmark` : ''
        ].filter(Boolean);
        return {
          selector: originalSelector,
          tagName: element.tagName.toLowerCase(),
          role,
          accessibleName: name,
          visibleText,
          componentName,
          location: places.length ? `Within ${places.join(' inside ')}` : 'Within the rendered page content',
          captureSelector: componentRoot ? cssPath(componentRoot) : cssPath(element.parentElement ?? element)
        };
      }, selector);
      contexts.push(context);
    } catch {
      // Invalid, detached, or unsupported selectors remain available as technical locators in the report.
    }
  }
  return contexts;
}
