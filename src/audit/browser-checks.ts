import type { Locator, Page } from '@playwright/test';
import type {
  DisclosureCheckResult,
  DomCheckResult,
  KeyboardCheckResult,
  LinkCheckMetadata,
  LinkCheckResult,
  ResponsiveCheckResult,
  TabCheckResult
} from '../types.js';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(',');

export async function runDomChecks(page: Page, axeTargetSizeSelectors: string[] = []): Promise<DomCheckResult> {
  return page.evaluate(({ focusables, targetSizeSelectors }) => {
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.left >= innerWidth) return false;
      if (element.closest('[hidden], [inert], [aria-hidden="true"], .slick-cloned:not(.slick-active)')) return false;
      let current: Element | null = element;
      while (current) {
        const style = getComputedStyle(current);
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || style.visibility === 'collapse'
          || style.contentVisibility === 'hidden'
          || Number.parseFloat(style.opacity || '1') === 0
          || style.pointerEvents === 'none'
        ) return false;
        current = current.parentElement;
      }
      if (rect.top < innerHeight && rect.bottom > 0) {
        const samplePoints = [
          [Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2))],
          [Math.max(0, Math.min(innerWidth - 1, rect.left + 2)), Math.max(0, Math.min(innerHeight - 1, rect.top + 2))]
        ];
        const hit = samplePoints.some(([x, y]) => {
          const top = document.elementFromPoint(x!, y!);
          return Boolean(top && (top === element || element.contains(top) || top.contains(element)));
        });
        if (!hit) return false;
      }
      return true;
    };
    const cssPath = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.documentElement && current !== document.body && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        const stableClasses = [...current.classList].filter((name) => !/\d{3,}/.test(name)).slice(0, 2);
        if (stableClasses.length) part += `.${stableClasses.map((name) => CSS.escape(name)).join('.')}`;
        if (current.parentElement) {
          const siblings = [...current.parentElement.children].filter((sibling) => sibling.tagName === current?.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };
    const descendantTextAlternative = (node: Node): string => {
      if (node instanceof Text) return node.textContent?.trim() ?? '';
      if (!(node instanceof Element) || node.getAttribute('aria-hidden') === 'true') return '';
      if (node instanceof HTMLImageElement) return node.alt.trim();
      if (node instanceof HTMLInputElement && node.type === 'image') return node.alt.trim();
      return [...node.childNodes].map(descendantTextAlternative).filter(Boolean).join(' ').trim();
    };
    const descendantTextWithoutImages = (node: Node): string => {
      if (node instanceof Text) return node.textContent?.trim() ?? '';
      if (!(node instanceof Element) || node.getAttribute('aria-hidden') === 'true') return '';
      if (node instanceof HTMLImageElement || (node instanceof HTMLInputElement && node.type === 'image')) return '';
      return [...node.childNodes].map(descendantTextWithoutImages).filter(Boolean).join(' ').trim();
    };
    const name = (element: Element): string => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .filter(Boolean)
          .join(' ');
        if (text) return text;
      }
      const ariaLabel = element.getAttribute('aria-label')?.trim();
      if (ariaLabel) return ariaLabel;
      if (element instanceof HTMLImageElement) return element.alt.trim();
      if (element instanceof HTMLInputElement && /^(button|submit|reset)$/i.test(element.type)) return element.value.trim();
      if (
        element instanceof HTMLButtonElement
        || element instanceof HTMLInputElement
        || element instanceof HTMLSelectElement
        || element instanceof HTMLTextAreaElement
        || element instanceof HTMLMeterElement
        || element instanceof HTMLProgressElement
        || element instanceof HTMLOutputElement
      ) {
        const labelText = [...(element.labels ?? [])]
          .map((label) => descendantTextAlternative(label))
          .filter(Boolean)
          .join(' ')
          .trim();
        if (labelText) return labelText;
      }
      return descendantTextAlternative(element) || element.getAttribute('title')?.trim() || '';
    };
    const fieldHasLabel = (element: Element): boolean => {
      if (element.getAttribute('aria-label')?.trim() || element.getAttribute('aria-labelledby')?.trim()) return true;
      const id = element.id;
      if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return true;
      return Boolean(element.closest('label'));
    };

    const missingAltImages = [...document.querySelectorAll('img')]
      .filter((image) => !image.hasAttribute('alt'))
      .map((image) => ({ selector: cssPath(image), html: image.outerHTML.slice(0, 500) }));
    const linkedImagesForReview = [...document.querySelectorAll('a[href]')]
      .filter(visible)
      .flatMap((link) => {
        const image = link.querySelector('img');
        if (!image) return [];
        // This heuristic is only for image-only links. A text link that also
        // contains a decorative or status icon already derives its purpose
        // from non-image content and must not be treated as a linked logo.
        if (descendantTextWithoutImages(link)) return [];
        const accessibleName = name(link);
        const alt = image.getAttribute('alt') ?? '';
        const generic = /^(logo|company logo|site logo|image|home|homepage)$/i.test(accessibleName);
        if (!generic) return [];
        return [{
          selector: cssPath(link),
          name: accessibleName,
          alt,
          href: (link as HTMLAnchorElement).href,
          reason: 'The linked image has a generic accessible name.'
        }];
      });
    const emptyLinks = [...document.querySelectorAll('a[href], a[role="link"]')]
      .filter(visible)
      .filter((link) => !name(link))
      .map((link) => ({
        selector: cssPath(link),
        html: link.outerHTML.slice(0, 500),
        href: link.getAttribute('href') ?? ''
      }));
    const emptyNamedControls = [...document.querySelectorAll(focusables)]
      .filter(visible)
      .filter((element) => element.tagName.toLowerCase() !== 'a')
      .filter((element) => !name(element))
      .map((element) => ({ selector: cssPath(element), tag: element.tagName.toLowerCase(), html: element.outerHTML.slice(0, 500) }));
    const unlabeledFields = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]
      .filter(visible)
      .filter((element) => !fieldHasLabel(element))
      .map((element) => ({ selector: cssPath(element), html: element.outerHTML.slice(0, 500) }));
    const idCounts = new Map<string, number>();
    document.querySelectorAll('[id]').forEach((element) => idCounts.set(element.id, (idCounts.get(element.id) ?? 0) + 1));
    const duplicateIds = [...idCounts].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
    const landmarkElements = [...document.querySelectorAll('nav, aside, [role="navigation"], [role="complementary"]')];
    const roleFor = (element: Element): string => element.getAttribute('role') ?? element.tagName.toLowerCase();
    const groupedLandmarks = new Map<string, Element[]>();
    landmarkElements.filter(visible).forEach((element) => {
      const role = roleFor(element);
      groupedLandmarks.set(role, [...(groupedLandmarks.get(role) ?? []), element]);
    });
    const unnamedLandmarks = [...groupedLandmarks.entries()].flatMap(([role, elements]) =>
      elements.length > 1
        ? elements.filter((element) => !name(element)).map((element) => ({ selector: cssPath(element), role }))
        : []
    );
    const rounded = (value: number): number => Math.round(value * 10) / 10;
    const hasAxeTargetSizeSignal = (element: Element): boolean => targetSizeSelectors.some((selector) => {
      try {
        return element.matches(selector);
      } catch {
        return false;
      }
    });
    const pointerTargets = [...document.querySelectorAll(focusables)]
      .filter(visible)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }));
    const inlineExceptionFor = (element: Element): boolean => {
      if (!(element instanceof HTMLAnchorElement)) return false;
      const container = element.closest('p, dd, dt, figcaption, caption, blockquote');
      if (!container || !/^inline(?:-block)?$/.test(getComputedStyle(element).display)) return false;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        if (!element.contains(textNode) && textNode.textContent?.trim()) return true;
        textNode = walker.nextNode();
      }
      return false;
    };
    const groupSelectorFor = (element: Element): string => {
      const group = element.closest([
        '[role="tablist"]', '[role="toolbar"]', '[role="group"]',
        '[class*="pagination" i]', '[class*="pager" i]', '[class*="dots" i]',
        '[class*="carousel" i]', '[class*="slider" i]', '[class*="controls" i]',
        '[class*="actions" i]', 'nav', 'form', 'section', 'article', 'main'
      ].join(','));
      return cssPath(group ?? element.parentElement ?? element);
    };
    const centerDistance = (first: DOMRect, second: DOMRect): number => Math.hypot(
      first.left + first.width / 2 - (second.left + second.width / 2),
      first.top + first.height / 2 - (second.top + second.height / 2)
    );
    const clearanceCircleIntersects = (target: DOMRect, other: DOMRect): boolean => {
      const targetX = target.left + target.width / 2;
      const targetY = target.top + target.height / 2;
      const otherIsUndersized = other.width < 24 || other.height < 24;
      if (otherIsUndersized) return centerDistance(target, other) < 24;
      const closestX = Math.max(other.left, Math.min(targetX, other.right));
      const closestY = Math.max(other.top, Math.min(targetY, other.bottom));
      return Math.hypot(targetX - closestX, targetY - closestY) < 12;
    };
    const smallTargets = pointerTargets
      .filter(({ element, rect }) => rect.width < 24 || rect.height < 24 || hasAxeTargetSizeSignal(element))
      .map(({ element, rect }) => {
        const nearbyTargets = pointerTargets
          .filter(({ element: otherElement, rect: otherRect }) => (
            otherElement !== element
            && !element.contains(otherElement)
            && !otherElement.contains(element)
            && clearanceCircleIntersects(rect, otherRect)
          ))
          .slice(0, 12)
          .map(({ element: otherElement, rect: otherRect }) => ({
            selector: cssPath(otherElement),
            name: name(otherElement),
            width: rounded(otherRect.width),
            height: rounded(otherRect.height),
            centerDistance: rounded(centerDistance(rect, otherRect))
          }));
        return {
          selector: cssPath(element),
          name: name(element),
          width: rounded(rect.width),
          height: rounded(rect.height),
          groupSelector: groupSelectorFor(element),
          inlineException: inlineExceptionFor(element),
          hitTested: rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
          spacingRisk: nearbyTargets.length > 0,
          axeTargetSizeSignal: hasAxeTargetSizeSignal(element),
          nearbyTargets
        };
      });
    const tablesForReview = [...document.querySelectorAll('table')]
      .filter(visible)
      .flatMap((table) => {
        const reasons: string[] = [];
        if (!table.querySelector('th')) reasons.push('No header cells were found.');
        if (!table.querySelector('caption') && !table.getAttribute('aria-label') && !table.getAttribute('aria-labelledby')) {
          reasons.push('No programmatic table name was found.');
        }
        return reasons.length ? [{ selector: cssPath(table), reason: reasons.join(' ') }] : [];
      });
    const autoplayMedia = [...document.querySelectorAll('audio[autoplay], video[autoplay]')]
      .filter(visible)
      .map((element) => ({ selector: cssPath(element), tag: element.tagName.toLowerCase() }));

    return {
      h1Count: document.querySelectorAll('h1').length,
      mainCount: document.querySelectorAll('main, [role="main"]').length,
      unnamedLandmarks,
      missingAltImages,
      linkedImagesForReview,
      emptyLinks,
      emptyNamedControls,
      unlabeledFields,
      duplicateIds,
      smallTargets,
      tablesForReview,
      autoplayMedia
    };
  }, { focusables: focusableSelector, targetSizeSelectors: axeTargetSizeSelectors });
}

export async function runLinkChecks(page: Page, maxLinks: number): Promise<{ results: LinkCheckResult[]; metadata: LinkCheckMetadata }> {
  const candidates = await page.evaluate((limit) => {
    const visible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const cssPath = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.documentElement && parts.length < 5) {
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
      if (node instanceof Text) return node.textContent?.trim() ?? '';
      if (!(node instanceof Element) || node.getAttribute('aria-hidden') === 'true') return '';
      if (node instanceof HTMLImageElement) return node.alt.trim();
      return [...node.childNodes].map(textAlternative).filter(Boolean).join(' ').trim();
    };
    const accessibleName = (element: Element): string => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean).join(' ')
        : '';
      return labelledText || element.getAttribute('aria-label')?.trim() || textAlternative(element) || element.getAttribute('title')?.trim() || '';
    };
    const visibleLinks = [...document.querySelectorAll('a[href], a[role="link"]')].filter(visible);
    return {
      candidateCount: visibleLinks.length,
      links: visibleLinks.slice(0, limit).map((link) => ({
        selector: cssPath(link),
        name: accessibleName(link),
        rawHref: link.getAttribute('href') ?? '',
        download: link.hasAttribute('download')
      }))
    };
  }, maxLinks);

  const results: LinkCheckResult[] = [];
  const checked = new Map<string, { status: number; finalUrl: string }>();
  const pageUrl = new URL(page.url());
  for (const candidate of candidates.links) {
    const rawHref = candidate.rawHref.trim();
    if (!candidate.name || candidate.download || /^(mailto|tel|sms|data|blob):/i.test(rawHref)) continue;
    if (!rawHref || rawHref === '#') {
      results.push({
        selector: candidate.selector,
        name: candidate.name,
        href: rawHref,
        status: null,
        classification: 'review',
        reason: 'The link uses an empty or placeholder destination. Confirm whether it should be a button or point to a real resource.'
      });
      continue;
    }
    if (/^javascript:/i.test(rawHref)) {
      results.push({
        selector: candidate.selector,
        name: candidate.name,
        href: rawHref,
        status: null,
        classification: 'review',
        reason: 'The anchor uses a javascript: destination. Confirm whether a native button is required for this action.'
      });
      continue;
    }
    let destination: URL;
    try {
      destination = new URL(rawHref, pageUrl);
    } catch {
      results.push({
        selector: candidate.selector,
        name: candidate.name,
        href: rawHref,
        status: null,
        classification: 'review',
        reason: 'The link destination could not be parsed as a URL.'
      });
      continue;
    }
    const sameDocument = destination.origin === pageUrl.origin && destination.pathname === pageUrl.pathname && destination.search === pageUrl.search;
    if (sameDocument && destination.hash) {
      const targetExists = await page.evaluate((hash) => {
        const id = decodeURIComponent(hash.slice(1));
        return id.length > 0 && Boolean(document.getElementById(id) || document.getElementsByName(id).length);
      }, destination.hash).catch(() => false);
      if (!targetExists) {
        results.push({
          selector: candidate.selector,
          name: candidate.name,
          href: destination.href,
          status: null,
          classification: 'confirmed',
          reason: `The in-page fragment ${destination.hash} does not match an id or named anchor in the rendered document.`
        });
      }
      continue;
    }
    if (!/^https?:$/.test(destination.protocol) || destination.origin !== pageUrl.origin) continue;
    if (/\/(?:logout|log-out|signout|sign-out|delete|remove|unsubscribe)(?:[/?#]|$)/i.test(destination.href)) continue;
    const requestUrl = destination.href.split('#')[0]!;
    let checkedResult = checked.get(requestUrl);
    if (!checkedResult) {
      try {
        const response = await page.context().request.get(requestUrl, {
          failOnStatusCode: false,
          maxRedirects: 8,
          timeout: 10_000
        });
        checkedResult = { status: response.status(), finalUrl: response.url() };
        checked.set(requestUrl, checkedResult);
        await response.dispose();
      } catch {
        continue;
      }
    }
    if (checkedResult.status === 404 || checkedResult.status === 410) {
      const browserStatus = await page.evaluate(async (href) => {
        try {
          const response = await fetch(href, { method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'follow' });
          return response.status;
        } catch {
          return null;
        }
      }, requestUrl).catch(() => null);
      if (browserStatus === checkedResult.status) {
        results.push({
          selector: candidate.selector,
          name: candidate.name,
          href: requestUrl,
          status: checkedResult.status,
          finalUrl: checkedResult.finalUrl,
          classification: 'confirmed',
          reason: `Two independent same-origin GET checks returned HTTP ${checkedResult.status}.`
        });
      }
      continue;
    }
    if (checkedResult.status >= 500) {
      results.push({
        selector: candidate.selector,
        name: candidate.name,
        href: requestUrl,
        status: checkedResult.status,
        finalUrl: checkedResult.finalUrl,
        classification: 'review',
        reason: `The destination returned HTTP ${checkedResult.status}; confirm this was not a transient staging failure.`
      });
    }
  }
  return {
    results,
    metadata: {
      completed: true,
      candidateCount: candidates.candidateCount,
      checkedCount: candidates.links.length,
      truncated: candidates.candidateCount > candidates.links.length,
      scope: 'desktop-same-origin'
    }
  };
}

export async function runKeyboardChecks(page: Page, maxTabStops: number): Promise<KeyboardCheckResult> {
  await page.evaluate(() => {
    const body = document.body;
    body.dataset.auditTemporaryTabindex = String(body.getAttribute('tabindex') ?? '');
    body.tabIndex = -1;
    body.focus();
  });
  const sequence: KeyboardCheckResult['sequence'] = [];
  let repeatedAt: number | undefined;
  const seen = new Set<string>();

  for (let index = 0; index < maxTabStops; index += 1) {
    await page.keyboard.press('Tab');
    const item = await page.evaluate((position) => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const cssPath = (target: Element): string => {
        if (target.id) return `#${CSS.escape(target.id)}`;
        const parts: string[] = [];
        let current: Element | null = target;
        while (current && current !== document.documentElement && current !== document.body && parts.length < 6) {
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
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visibleLeft = Math.max(rect.left, 0);
      const visibleTop = Math.max(rect.top, 0);
      const visibleRight = Math.min(rect.right, innerWidth);
      const visibleBottom = Math.min(rect.bottom, innerHeight);
      const hasVisibleArea = visibleRight > visibleLeft && visibleBottom > visibleTop;
      const insetX = Math.min(4, Math.max(0, (visibleRight - visibleLeft) / 4));
      const insetY = Math.min(4, Math.max(0, (visibleBottom - visibleTop) / 4));
      const points = hasVisibleArea ? [
        [(visibleLeft + visibleRight) / 2, (visibleTop + visibleBottom) / 2],
        [visibleLeft + insetX, visibleTop + insetY],
        [visibleRight - insetX, visibleTop + insetY],
        [visibleLeft + insetX, visibleBottom - insetY],
        [visibleRight - insetX, visibleBottom - insetY]
      ] : [];
      const obscured = points.length > 0 && points.every(([x, y]) => {
        const top = document.elementsFromPoint(x!, y!)[0];
        return Boolean(top && top !== element && !element.contains(top) && !top.contains(element));
      });
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ')
        : '';
      const name = (
        element.getAttribute('aria-label')?.trim() ||
        labelledText.trim() ||
        (element instanceof HTMLImageElement ? element.alt.trim() : '') ||
        element.textContent?.trim() ||
        element.getAttribute('title')?.trim() ||
        ''
      ).trim();
      const visualSignature = (computed: CSSStyleDeclaration): string[] => [
        computed.outlineStyle,
        computed.outlineWidth,
        computed.outlineColor,
        computed.outlineOffset,
        computed.boxShadow,
        computed.borderTopColor,
        computed.borderRightColor,
        computed.borderBottomColor,
        computed.borderLeftColor,
        computed.borderTopWidth,
        computed.borderRightWidth,
        computed.borderBottomWidth,
        computed.borderLeftWidth,
        computed.backgroundColor,
        computed.color,
        computed.textDecorationLine,
        computed.textDecorationColor,
        computed.textDecorationThickness
      ];
      const focusedVisual = visualSignature(style);
      const focusVisible = element.matches(':focus-visible');
      const scrollPosition = { x: scrollX, y: scrollY };
      element.blur();
      document.body.focus({ preventScroll: true });
      const unfocusedVisual = visualSignature(getComputedStyle(element));
      element.focus({ preventScroll: true });
      scrollTo(scrollPosition.x, scrollPosition.y);
      const visibleIndicator = focusVisible && focusedVisual.some((value, index) => value !== unfocusedVisual[index]);
      const modal = element.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"], #system-ialert');
      const pageChrome = element.closest('header, [role="banner"], footer, [role="contentinfo"]');
      const componentRoot = pageChrome
        ?? element.closest('[role="tablist"], form, nav, section, article, main, [role="region"]')
        ?? element;
      return {
        index: position,
        selector: cssPath(element),
        name,
        role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
        visibleIndicator,
        obscured,
        componentSelector: cssPath(componentRoot),
        ...(modal ? { modalSelector: cssPath(modal) } : {})
      };
    }, index + 1);
    if (!item) break;
    const identity = `${item.selector}|${item.name}|${item.role}`;
    if (seen.has(identity)) {
      repeatedAt = index + 1;
      break;
    }
    seen.add(identity);
    sequence.push(item);
  }

  await page.evaluate(() => {
    const body = document.body;
    const original = body.dataset.auditTemporaryTabindex;
    delete body.dataset.auditTemporaryTabindex;
    if (original === '') body.removeAttribute('tabindex');
    else if (original !== undefined) body.setAttribute('tabindex', original);
  });
  const modalSelectors = sequence.map((item) => item.modalSelector).filter((value): value is string => Boolean(value));
  const modalSelector = modalSelectors[0];
  const modalOnly = Boolean(
    repeatedAt !== undefined
    && sequence.length > 0
    && modalSelector
    && modalSelectors.length === sequence.length
    && modalSelectors.every((value) => value === modalSelector)
  );
  return {
    sequence,
    ...(repeatedAt === undefined ? {} : { repeatedAt }),
    completedCycle: repeatedAt !== undefined,
    truncated: repeatedAt === undefined && sequence.length >= maxTabStops,
    scope: modalOnly ? 'modal-only' : sequence.length ? 'document' : 'unknown',
    ...(modalOnly && modalSelector ? { modalSelector } : {})
  };
}

export async function runResponsiveChecks(page: Page): Promise<ResponsiveCheckResult> {
  const base = await page.evaluate(() => {
    const cssPath = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.documentElement && current !== document.body && parts.length < 6) {
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
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const overflowElements = [...document.body.querySelectorAll('*')]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.right > innerWidth + 2 || rect.left < -2)
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .slice(0, 50)
      .map(({ element, rect }) => ({
        selector: cssPath(element),
        right: Math.round(rect.right * 10) / 10,
        width: Math.round(rect.width * 10) / 10
      }));
    return { horizontalOverflow: Math.max(0, documentWidth - innerWidth), overflowElements };
  });

  const spacingStyle = await page.addStyleTag({
    content: `
      html body *:not(svg):not(svg *) {
        line-height: 1.5 !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
      }
      html body p, html body li, html body blockquote {
        margin-bottom: 2em !important;
      }
    `
  });
  await page.waitForTimeout(100);
  const textSpacingOverflow = await page.evaluate(
    () => Math.max(0, Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)
  );
  await spacingStyle.evaluate((element) => (element as Element).remove());
  return { ...base, textSpacingOverflow };
}

function locatorDescription(locator: Locator): Promise<{ name: string; selector: string }> {
  return locator.evaluate((element) => {
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
    return {
      name: (element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '').replace(/\s+/g, ' ').trim(),
      selector: cssPath(element)
    };
  });
}

export async function runDisclosureChecks(page: Page): Promise<DisclosureCheckResult[]> {
  const controls = page.locator('button[aria-expanded], [role="button"][aria-expanded]');
  const results: DisclosureCheckResult[] = [];
  const count = Math.min(await controls.count(), 30);

  for (let index = 0; index < count; index += 1) {
    const toggle = controls.nth(index);
    if (!(await toggle.isVisible().catch(() => false))) continue;
    let description = { name: '', selector: `disclosure-${index + 1}` };
    try {
      description = await locatorDescription(toggle);
      const originalExpanded = await toggle.getAttribute('aria-expanded');
      const controlsId = await toggle.getAttribute('aria-controls');
      if (originalExpanded === 'true') {
        await toggle.focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(150);
      }
      const beforeExpanded = await toggle.getAttribute('aria-expanded');
      const baselinePrepared = originalExpanded !== 'true' || beforeExpanded === 'false';
      if (!baselinePrepared) {
        results.push({
          selector: description.selector,
          name: description.name,
          controls: controlsId,
          initialExpanded: originalExpanded,
          baselinePrepared: false,
          beforeExpanded,
          afterExpanded: null,
          controlledVisibleBefore: null,
          controlledVisibleAfterOpen: null,
          spaceAfterExpanded: null,
          controlledVisibleAfterSpace: null,
          spaceTestCompleted: false,
          firstTabSelector: null,
          tabEnteredControlledRegion: null,
          error: 'The disclosure started expanded and could not be returned to a collapsed baseline with Enter.'
        });
        continue;
      }
      let controlled: Locator | null = null;
      let controlledVisibleBefore: boolean | null = null;
      if (controlsId) {
        controlled = page.locator(`#${controlsId.replaceAll(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')}`);
        if ((await controlled.count()) > 0) {
          controlledVisibleBefore = await controlled.isVisible().catch(() => false);
        }
      }
      await toggle.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      const afterExpanded = await toggle.getAttribute('aria-expanded');
      let controlledVisibleAfterOpen: boolean | null = null;
      let spaceAfterExpanded: string | null = null;
      let controlledVisibleAfterSpace: boolean | null = null;
      let spaceTestCompleted = false;
      let tabEnteredControlledRegion: boolean | null = null;
      let firstTabSelector: string | null = null;
      if (controlsId && controlled && (await controlled.count()) > 0) {
          controlledVisibleAfterOpen = await controlled.isVisible().catch(() => false);
          const focusable = controlled.locator(focusableSelector);
          if ((await focusable.count()) > 0) {
            await page.keyboard.press('Tab');
            const active = page.locator(':focus');
            firstTabSelector = (await active.count()) ? (await locatorDescription(active)).selector : null;
            tabEnteredControlledRegion = await active.evaluate((element, id) => Boolean(document.getElementById(id)?.contains(element)), controlsId);
          }
      }

      await toggle.focus();
      if ((await toggle.getAttribute('aria-expanded')) === 'true') {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(100);
      }
      if ((await toggle.getAttribute('aria-expanded')) === 'false') {
        await toggle.focus();
        await page.keyboard.press('Space');
        await page.waitForTimeout(200);
        spaceAfterExpanded = await toggle.getAttribute('aria-expanded');
        controlledVisibleAfterSpace = controlled && (await controlled.count()) > 0
          ? await controlled.isVisible().catch(() => false)
          : null;
        spaceTestCompleted = true;
      }
      results.push({
        selector: description.selector,
        name: description.name,
        controls: controlsId,
        initialExpanded: originalExpanded,
        baselinePrepared,
        beforeExpanded,
        afterExpanded,
        controlledVisibleBefore,
        controlledVisibleAfterOpen,
        spaceAfterExpanded,
        controlledVisibleAfterSpace,
        spaceTestCompleted,
        firstTabSelector,
        tabEnteredControlledRegion
      });
      if ((await toggle.getAttribute('aria-expanded')) === 'true') {
        await toggle.focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(100);
      }
      if (originalExpanded === 'true' && (await toggle.getAttribute('aria-expanded')) !== 'true') {
        await toggle.focus();
        await page.keyboard.press('Enter');
      }
    } catch (error) {
      results.push({
        selector: description.selector,
        name: description.name,
        controls: null,
        baselinePrepared: false,
        beforeExpanded: null,
        afterExpanded: null,
        controlledVisibleBefore: null,
        controlledVisibleAfterOpen: null,
        spaceAfterExpanded: null,
        controlledVisibleAfterSpace: null,
        spaceTestCompleted: false,
        firstTabSelector: null,
        tabEnteredControlledRegion: null,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return results;
}

export async function runTabChecks(page: Page): Promise<TabCheckResult[]> {
  const tablists = page.locator('[role="tablist"]');
  const results: TabCheckResult[] = [];
  const count = Math.min(await tablists.count(), 20);
  for (let index = 0; index < count; index += 1) {
    const tabs = tablists.nth(index).locator('[role="tab"]');
    if ((await tabs.count()) < 2) continue;
    const first = tabs.first();
    if (!(await first.isVisible().catch(() => false))) continue;
    const tablist = tablists.nth(index);
    const description = await locatorDescription(tablist);
    try {
      const semantics = await tabs.evaluateAll((elements) => {
        const structuralFailures: string[] = [];
        const structuralReviews: string[] = [];
        const selectedCount = elements.filter((element) => element.getAttribute('aria-selected') === 'true').length;
        const tabbableCount = elements.filter((element) => (element as HTMLElement).tabIndex >= 0).length;
        if (selectedCount !== 1) structuralFailures.push(`Expected exactly one aria-selected="true" tab but found ${selectedCount}.`);
        if (tabbableCount !== 1) structuralReviews.push(`The tablist has ${tabbableCount} tabs in the page Tab sequence; review whether its keyboard model is predictable and documented.`);
        for (const [position, element] of elements.entries()) {
          const label = element.getAttribute('aria-label') || element.textContent?.trim() || `tab ${position + 1}`;
          if (!element.hasAttribute('aria-selected')) structuralFailures.push(`${label} has no aria-selected state.`);
          const controls = element.getAttribute('aria-controls');
          if (!controls) {
            structuralReviews.push(`${label} has no aria-controls relationship.`);
            continue;
          }
          const panel = document.getElementById(controls);
          if (!panel) {
            structuralFailures.push(`${label} references missing panel #${controls}.`);
            continue;
          }
          if (panel.getAttribute('role') !== 'tabpanel') structuralFailures.push(`#${controls} does not have role="tabpanel".`);
          const panelLabelledBy = panel.getAttribute('aria-labelledby');
          if (panelLabelledBy) {
            const missingLabels = panelLabelledBy.split(/\s+/).filter((id) => !document.getElementById(id));
            if (missingLabels.length) structuralFailures.push(`#${controls} has aria-labelledby reference(s) with no matching element: ${missingLabels.join(', ')}.`);
            else if (!element.id || !panelLabelledBy.split(/\s+/).includes(element.id)) {
              structuralReviews.push(`#${controls} is not labelled by its owning tab; confirm the alternative accessible name is clear.`);
            }
          } else {
            structuralReviews.push(`#${controls} has no aria-labelledby relationship to its owning tab; confirm the panel has an equivalent accessible name.`);
          }
        }
        return { selectedCount, tabbableCount, structuralFailures, structuralReviews };
      });
      const selected = tabs.locator('[aria-selected="true"]').first();
      const start = (await selected.count()) && await selected.isVisible().catch(() => false) ? selected : first;
      const orientation = await tablist.getAttribute('aria-orientation');
      const navigationKey = orientation === 'vertical' ? 'ArrowDown' as const : 'ArrowRight' as const;
      await start.focus();
      await page.keyboard.press(navigationKey);
      const navigationMovedToTab = await tabs.evaluateAll((elements) => elements.includes(document.activeElement as HTMLElement));
      let activationWorked = false;
      if (navigationMovedToTab) {
        const active = page.locator(':focus');
        activationWorked = (await active.getAttribute('aria-selected')) === 'true';
        if (!activationWorked) {
          await page.keyboard.press('Enter');
          await page.waitForTimeout(100);
          activationWorked = (await active.getAttribute('aria-selected')) === 'true';
        }
        if (!activationWorked) {
          await page.keyboard.press('Space');
          await page.waitForTimeout(100);
          activationWorked = (await active.getAttribute('aria-selected')) === 'true';
        }
      }
      await page.keyboard.press('End');
      const endMovedToLast = await tabs.last().evaluate((element) => document.activeElement === element);
      await page.keyboard.press('Home');
      const homeMovedToFirst = await first.evaluate((element) => document.activeElement === element);
      results.push({
        selector: description.selector,
        name: description.name,
        tabCount: await tabs.count(),
        selectedCount: semantics.selectedCount,
        tabbableCount: semantics.tabbableCount,
        navigationKey,
        navigationMovedToTab,
        activationWorked,
        homeMovedToFirst,
        endMovedToLast,
        structuralFailures: semantics.structuralFailures,
        structuralReviews: semantics.structuralReviews
      });
    } catch (error) {
      results.push({
        selector: description.selector,
        name: description.name,
        tabCount: await tabs.count(),
        selectedCount: 0,
        tabbableCount: 0,
        navigationKey: 'ArrowRight',
        navigationMovedToTab: false,
        activationWorked: false,
        homeMovedToFirst: false,
        endMovedToLast: false,
        structuralFailures: [],
        structuralReviews: [],
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return results;
}
