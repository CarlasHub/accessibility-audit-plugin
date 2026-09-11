import type { Locator, Page } from 'playwright';
import type {
  DisclosureCheckResult,
  DisclosureStateSnapshot,
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
        outsideViewport: rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight,
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

  const journeys: KeyboardCheckResult['journeys'] = [];
  if (sequence.length >= 2) {
    const expected = sequence.slice(0, Math.min(sequence.length, 21)).map((item) => item.selector).reverse().slice(1);
    const actual: string[] = [];
    const lastSelector = sequence[Math.min(sequence.length, 21) - 1]!.selector;
    const focused = await page.locator(lastSelector).first().focus().then(() => true).catch(() => false);
    if (focused) {
      for (let index = 0; index < expected.length; index += 1) {
        await page.keyboard.press('Shift+Tab');
        actual.push(await page.evaluate(() => {
          const target = document.activeElement;
          if (!target || target === document.body) return 'document-body';
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
        }));
      }
    }
    const matches = focused && expected.every((selector, index) => actual[index] === selector);
    journeys.push({
      id: 'forward-reverse-focus-order',
      title: 'Forward and reverse focus order',
      status: focused ? (matches ? 'passed' : 'failed') : 'inconclusive',
      steps: [
        `Recorded ${sequence.length} forward Tab stop${sequence.length === 1 ? '' : 's'}.`,
        `Replayed ${actual.length} Shift+Tab stop${actual.length === 1 ? '' : 's'} from ${lastSelector}.`
      ],
      detail: focused
        ? matches
          ? 'The sampled reverse sequence matched the forward sequence in reverse order.'
          : 'The sampled Shift+Tab sequence did not reverse the recorded Tab sequence; review focus management and dynamic page state.'
        : 'The last sampled focus target could not be restored for deterministic reverse traversal.'
    });
  } else {
    journeys.push({
      id: 'forward-reverse-focus-order',
      title: 'Forward and reverse focus order',
      status: 'inconclusive',
      steps: [`Recorded ${sequence.length} forward Tab stops.`],
      detail: 'At least two stable focus targets are required to compare forward and reverse focus order.'
    });
  }

  const bypass = await page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const link = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
      .find((candidate) => candidate.hash.length > 1 && visible(candidate));
    if (!link) return null;
    const id = decodeURIComponent(link.hash.slice(1));
    const target = document.getElementById(id) ?? document.getElementsByName(id)[0] ?? null;
    return {
      linkSelector: link.id ? `#${CSS.escape(link.id)}` : `a[href="${CSS.escape(link.getAttribute('href') ?? '')}"]`,
      name: (link.getAttribute('aria-label') ?? link.textContent ?? '').trim(),
      targetId: id,
      targetExists: Boolean(target)
    };
  });
  if (!bypass) {
    journeys.push({
      id: 'bypass-blocks',
      title: 'Bypass repeated blocks',
      status: 'not-applicable',
      steps: ['Searched the rendered page for a visible in-page fragment link.'],
      detail: 'No visible in-page bypass link was found; a human must determine whether repeated content requires another bypass mechanism.'
    });
  } else if (!bypass.targetExists) {
    journeys.push({
      id: 'bypass-blocks',
      title: 'Bypass repeated blocks',
      status: 'failed',
      steps: [`Found “${bypass.name || bypass.linkSelector}”.`, `Resolved fragment target #${bypass.targetId}.`],
      detail: 'The visible in-page link points to a target that does not exist.'
    });
  } else {
    const activated = await page.locator(bypass.linkSelector).first().focus().then(async () => {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(50);
      return page.evaluate((targetId) => {
        const target = document.getElementById(targetId) ?? document.getElementsByName(targetId)[0] ?? null;
        const active = document.activeElement;
        if (!target) return false;
        const rect = target.getBoundingClientRect();
        const focusedTarget = active === target || target.contains(active);
        const targetReached = location.hash === `#${targetId}` && rect.bottom > 0 && rect.top < innerHeight;
        return focusedTarget || targetReached;
      }, bypass.targetId);
    }).catch(() => false);
    journeys.push({
      id: 'bypass-blocks',
      title: 'Bypass repeated blocks',
      status: activated ? 'passed' : 'failed',
      steps: [`Focused “${bypass.name || bypass.linkSelector}”.`, 'Pressed Enter.', `Checked target #${bypass.targetId}.`],
      detail: activated
        ? 'The bypass link moved focus or the viewport to its declared target.'
        : 'Activating the bypass link did not move focus or the viewport to its declared target.'
    });
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
    journeys,
    ...(modalOnly && modalSelector ? { modalSelector } : {})
  };
}

export async function runResponsiveChecks(page: Page): Promise<ResponsiveCheckResult> {
  const snapshot = (phase: 'default' | 'text-resize-200' | 'text-spacing') => page.evaluate(({ currentPhase, focusables }) => {
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
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.contentVisibility !== 'hidden';
    };
    const isIntentionalCarouselViewport = (element: Element): boolean => {
      const identity = [
        element.id,
        typeof element.className === 'string' ? element.className : '',
        element.getAttribute('aria-roledescription') ?? '',
        element.getAttribute('data-carousel') === null ? '' : 'carousel'
      ].join(' ');
      if (!/(?:^|[\s_-])(carousel|slider)(?:$|[\s_-])/i.test(identity)) return false;
      return element.querySelectorAll('[data-carousel], [class*="carousel-slide" i], [class~="slide" i], [role="group"]').length >= 2;
    };
    const isIntentionallyVisuallyHidden = (element: Element): boolean => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const clippedOut = style.clip === 'rect(0px, 0px, 0px, 0px)'
        || /^inset\((?:50%|100%)(?:\s+(?:50%|100%)){0,3}\)$/i.test(style.clipPath);
      const tinyClippedBox = rect.width <= 2
        && rect.height <= 2
        && /^(absolute|fixed)$/.test(style.position)
        && /^(hidden|clip)$/.test(style.overflow)
        && (style.whiteSpace === 'nowrap' || clippedOut);
      const authoredHiddenClass = /(?:^|[\s_-])(?:sr-only|screen-reader-only|visually-hidden)(?:$|[\s_-])/i.test(
        typeof node.className === 'string' ? node.className : ''
      );
      return clippedOut || (tinyClippedBox && authoredHiddenClass);
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
    const clippedElements = [...document.body.querySelectorAll('*')]
      .filter(visible)
      .filter((element) => !isIntentionalCarouselViewport(element))
      .filter((element) => !isIntentionallyVisuallyHidden(element))
      .flatMap((element) => {
        const node = element as HTMLElement;
        const style = getComputedStyle(node);
        const horizontal = /^(hidden|clip)$/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 2;
        const vertical = /^(hidden|clip)$/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2;
        if (!horizontal && !vertical) return [];
        return [{
          selector: cssPath(node),
          axis: horizontal && vertical ? 'both' as const : horizontal ? 'horizontal' as const : 'vertical' as const,
          phase: currentPhase,
          clientWidth: node.clientWidth,
          clientHeight: node.clientHeight,
          scrollWidth: node.scrollWidth,
          scrollHeight: node.scrollHeight
        }];
      })
      .slice(0, 50);
    const interactive = [...document.querySelectorAll<HTMLElement>(focusables)].filter(visible).slice(0, 100);
    const overlapPairs: ResponsiveCheckResult['overlapPairs'] = [];
    for (let firstIndex = 0; firstIndex < interactive.length && overlapPairs.length < 30; firstIndex += 1) {
      const first = interactive[firstIndex]!;
      const firstRect = first.getBoundingClientRect();
      for (let secondIndex = firstIndex + 1; secondIndex < interactive.length && overlapPairs.length < 30; secondIndex += 1) {
        const second = interactive[secondIndex]!;
        if (first.contains(second) || second.contains(first)) continue;
        const secondRect = second.getBoundingClientRect();
        const overlapWidth = Math.min(firstRect.right, secondRect.right) - Math.max(firstRect.left, secondRect.left);
        const overlapHeight = Math.min(firstRect.bottom, secondRect.bottom) - Math.max(firstRect.top, secondRect.top);
        if (overlapWidth <= 4 || overlapHeight <= 4) continue;
        overlapPairs.push({
          firstSelector: cssPath(first),
          secondSelector: cssPath(second),
          phase: currentPhase,
          overlapWidth: Math.round(overlapWidth * 10) / 10,
          overlapHeight: Math.round(overlapHeight * 10) / 10
        });
      }
    }
    const visibleInteractiveElements = interactive.map((element) => ({
      selector: cssPath(element),
      name: (element.getAttribute('aria-label') ?? element.textContent ?? element.getAttribute('title') ?? '').replace(/\s+/g, ' ').trim()
    }));
    return {
      horizontalOverflow: Math.max(0, documentWidth - innerWidth),
      overflowElements,
      clippedElements,
      overlapPairs,
      visibleInteractiveElements
    };
  }, { currentPhase: phase, focusables: focusableSelector });

  const base = await snapshot('default');

  const textResizeStyle = await page.addStyleTag({
    content: 'html { font-size: 200% !important; }'
  });
  await page.waitForTimeout(100);
  const resized = await snapshot('text-resize-200');
  await textResizeStyle.evaluate((element) => (element as Element).remove());

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
  const spaced = await snapshot('text-spacing');
  await spacingStyle.evaluate((element) => (element as Element).remove());
  const spacedSelectors = new Set(spaced.visibleInteractiveElements.map((element) => element.selector));
  const resizedSelectors = new Set(resized.visibleInteractiveElements.map((element) => element.selector));
  const lostInteractiveElements = base.visibleInteractiveElements.filter((element) => !spacedSelectors.has(element.selector));
  const textResizeLostInteractiveElements = base.visibleInteractiveElements.filter((element) => !resizedSelectors.has(element.selector));
  const baseClippingKeys = new Set(base.clippedElements.map((item) => `${item.selector}|${item.axis}`));
  const baseOverlapKeys = new Set(base.overlapPairs.map((item) => [item.firstSelector, item.secondSelector].sort().join('|')));
  return {
    completed: true,
    horizontalOverflow: base.horizontalOverflow,
    overflowElements: base.overflowElements,
    textResizeOverflow: resized.horizontalOverflow,
    textSpacingOverflow: spaced.horizontalOverflow,
    clippedElements: [
      ...base.clippedElements,
      ...resized.clippedElements.filter((item) => !baseClippingKeys.has(`${item.selector}|${item.axis}`)),
      ...spaced.clippedElements.filter((item) => !baseClippingKeys.has(`${item.selector}|${item.axis}`))
    ],
    overlapPairs: [
      ...base.overlapPairs,
      ...resized.overlapPairs.filter((item) => !baseOverlapKeys.has([item.firstSelector, item.secondSelector].sort().join('|'))),
      ...spaced.overlapPairs.filter((item) => !baseOverlapKeys.has([item.firstSelector, item.secondSelector].sort().join('|')))
    ],
    lostInteractiveElements,
    textResizeLostInteractiveElements
  };
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

interface DisclosureIdentity {
  selector: string;
  name: string;
  tagName: string;
  role: string;
  id: string;
  controls: string | null;
}

interface DisclosureSnapshotRead {
  state?: DisclosureStateSnapshot;
  error?: string;
}

interface DisclosureActivationResult {
  state?: DisclosureStateSnapshot;
  targetVerified: boolean;
  settled: boolean;
  elapsedMs: number;
  error?: string;
}

const disclosureSelector = 'button[aria-expanded], [role="button"][aria-expanded]';
const disclosureMarkerAttribute = 'data-accessibility-audit-disclosure-target';
let disclosureActivationSerial = 0;

async function waitForDisclosureInventorySettled(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  })).catch(() => undefined);

  const started = Date.now();
  let previous = '';
  let stableSince = started;
  while (Date.now() - started < 1_500) {
    const current = await page.evaluate((selector) => [...document.querySelectorAll(selector)]
      .map((element) => [
        element.tagName,
        element.id,
        element.getAttribute('role'),
        element.getAttribute('aria-label'),
        element.getAttribute('aria-expanded'),
        element.getAttribute('aria-controls'),
        element.hasAttribute('hidden'),
        element.closest('[hidden], [inert], [aria-hidden="true"]') !== null
      ].join('|'))
      .join('\n'), disclosureSelector).catch(() => '');
    const now = Date.now();
    if (current !== previous) {
      previous = current;
      stableSince = now;
    }
    if (now - started >= 600 && now - stableSince >= 250) return;
    await page.waitForTimeout(50);
  }
}

async function collectDisclosureIdentities(page: Page): Promise<DisclosureIdentity[]> {
  await waitForDisclosureInventorySettled(page);
  return page.evaluate(({ selector, limit }) => {
    const cssPath = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
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
    const accessibleName = (element: Element): string => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean).join(' ')
        : '';
      return (
        labelledText
        || element.getAttribute('aria-label')?.trim()
        || element.textContent?.trim()
        || element.getAttribute('title')?.trim()
        || ''
      ).replace(/\s+/g, ' ').trim();
    };
    const visuallyRendered = (element: Element): boolean => {
      if (element.closest('[hidden]')) return false;
      let current: Element | null = element;
      while (current) {
        const style = getComputedStyle(current);
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || style.visibility === 'collapse'
          || style.contentVisibility === 'hidden'
          || Number.parseFloat(style.opacity || '1') === 0
        ) return false;
        current = current.parentElement;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const activeControl = (element: Element): boolean => (
      visuallyRendered(element)
      && !element.closest('[inert], [aria-hidden="true"], .slick-cloned:not(.slick-active), .swiper-slide-duplicate:not(.swiper-slide-active)')
    );

    const identities = [...document.querySelectorAll(selector)]
      .filter(activeControl)
      .slice(0, limit)
      .map((element) => ({
        selector: cssPath(element),
        name: accessibleName(element),
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute('role') ?? (element.tagName === 'BUTTON' ? 'button' : element.tagName.toLowerCase()),
        id: element.id,
        controls: element.getAttribute('aria-controls')
      }));
    return identities.filter((identity, index) => identities.findIndex((item) => (
      item.selector === identity.selector
      && item.name === identity.name
      && item.role === identity.role
      && item.controls === identity.controls
    )) === index);
  }, { selector: disclosureSelector, limit: 30 });
}

async function readDisclosureSnapshot(page: Page, identity: DisclosureIdentity): Promise<DisclosureSnapshotRead> {
  return page.evaluate(({ identity: expected, selector }) => {
    const cssPath = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
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
    const accessibleName = (element: Element): string => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean).join(' ')
        : '';
      return (
        labelledText
        || element.getAttribute('aria-label')?.trim()
        || element.textContent?.trim()
        || element.getAttribute('title')?.trim()
        || ''
      ).replace(/\s+/g, ' ').trim();
    };
    const visuallyRendered = (element: Element): boolean => {
      if (element.closest('[hidden]')) return false;
      let current: Element | null = element;
      while (current) {
        const style = getComputedStyle(current);
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || style.visibility === 'collapse'
          || style.contentVisibility === 'hidden'
          || Number.parseFloat(style.opacity || '1') === 0
        ) return false;
        current = current.parentElement;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
      return [...element.querySelectorAll('*')].some((child) => {
        const childRect = child.getBoundingClientRect();
        return childRect.width > 0 && childRect.height > 0;
      });
    };
    const activeControl = (element: Element): boolean => (
      visuallyRendered(element)
      && !element.closest('[inert], [aria-hidden="true"], .slick-cloned:not(.slick-active), .swiper-slide-duplicate:not(.swiper-slide-active)')
    );
    const role = (element: Element): string => element.getAttribute('role')
      ?? (element.tagName === 'BUTTON' ? 'button' : element.tagName.toLowerCase());
    const fingerprintMatches = (element: Element): boolean => (
      element.tagName.toLowerCase() === expected.tagName
      && role(element) === expected.role
      && accessibleName(element) === expected.name
      && (!expected.id || element.id === expected.id)
    );

    const allControls = [...document.querySelectorAll(selector)];
    let selectorMatches: Element[] = [];
    try {
      selectorMatches = [...document.querySelectorAll(expected.selector)].filter(fingerprintMatches);
    } catch {
      selectorMatches = [];
    }
    let matches = selectorMatches;
    if (matches.length !== 1) {
      matches = allControls.filter(fingerprintMatches);
      if (matches.length > 1 && expected.controls) {
        const sameRelationship = matches.filter((element) => element.getAttribute('aria-controls') === expected.controls);
        if (sameRelationship.length === 1) matches = sameRelationship;
      }
    }
    if (matches.length !== 1) {
      return {
        error: matches.length === 0
          ? `The disclosure control could not be re-queried after the DOM changed: ${expected.selector}`
          : `The disclosure identity resolved to ${matches.length} controls after the DOM changed: ${expected.selector}`
      };
    }

    const control = matches[0]!;
    const rect = control.getBoundingClientRect();
    const intersectsViewport = rect.width > 0
      && rect.height > 0
      && rect.right > 0
      && rect.bottom > 0
      && rect.left < innerWidth
      && rect.top < innerHeight;
    const points = intersectsViewport ? [
      [Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2))],
      [Math.max(0, Math.min(innerWidth - 1, rect.left + Math.min(4, rect.width / 4))), Math.max(0, Math.min(innerHeight - 1, rect.top + Math.min(4, rect.height / 4)))]
    ] : [];
    const topmost = points.some(([x, y]) => {
      const hit = document.elementFromPoint(x!, y!);
      return Boolean(hit && (hit === control || control.contains(hit)));
    });
    const controls = control.getAttribute('aria-controls');
    const controlledIds = controls?.split(/\s+/).filter(Boolean) ?? [];
    const allIds = [...document.querySelectorAll('[id]')];
    const panels = controlledIds.flatMap((id) => allIds.filter((element) => element.id === id));
    const controlledMatchCount = panels.length;
    const controlledVisible = controlledIds.length > 0 && controlledMatchCount === controlledIds.length
      ? panels.some(visuallyRendered)
      : null;
    const controlledExposed = controlledIds.length > 0 && controlledMatchCount === controlledIds.length
      ? panels.some((panel) => visuallyRendered(panel) && !panel.closest('[inert], [aria-hidden="true"]'))
      : null;
    const animations = new Set<Animation>();
    for (const element of [control, ...panels]) {
      for (const animation of element.getAnimations({ subtree: true })) animations.add(animation);
    }
    const runningAnimations = [...animations].filter((animation) => animation.playState === 'running' || animation.pending).length;
    return {
      state: {
        selector: cssPath(control),
        name: accessibleName(control),
        tagName: control.tagName.toLowerCase(),
        role: role(control),
        expanded: control.getAttribute('aria-expanded'),
        controls,
        controlMatchCount: matches.length,
        controlledMatchCount,
        controlledVisible,
        controlledExposed,
        rendered: activeControl(control),
        topmost,
        focused: document.activeElement === control,
        runningAnimations
      }
    };
  }, { identity, selector: disclosureSelector });
}

function disclosureStateSignature(state: DisclosureStateSnapshot): string {
  return JSON.stringify([
    state.selector,
    state.expanded,
    state.controls,
    state.controlledMatchCount,
    state.controlledVisible
  ]);
}

async function waitForDisclosureSettled(
  page: Page,
  identity: DisclosureIdentity,
  before: DisclosureStateSnapshot
): Promise<DisclosureActivationResult> {
  const started = Date.now();
  const beforeSignature = disclosureStateSignature(before);
  let latestRead = await readDisclosureSnapshot(page, identity);
  if (!latestRead.state) {
    return {
      targetVerified: true,
      settled: false,
      elapsedMs: Date.now() - started,
      error: latestRead.error ?? 'The disclosure final state could not be read.'
    };
  }
  let latest = latestRead.state;
  let latestSignature = disclosureStateSignature(latest);
  let stableSince = Date.now();
  let observedChange = latestSignature !== beforeSignature;

  while (Date.now() - started < 1_800) {
    await page.waitForTimeout(50);
    latestRead = await readDisclosureSnapshot(page, identity);
    if (!latestRead.state) {
      return {
        targetVerified: true,
        settled: false,
        elapsedMs: Date.now() - started,
        error: latestRead.error ?? 'The disclosure final state could not be read.'
      };
    }
    latest = latestRead.state;
    const signature = disclosureStateSignature(latest);
    const now = Date.now();
    if (signature !== latestSignature) {
      latestSignature = signature;
      stableSince = now;
    }
    if (signature !== beforeSignature) observedChange = true;
    const elapsedMs = now - started;
    const stateStable = now - stableSince >= 200;
    const minimumObservationComplete = elapsedMs >= 300;
    const unchangedObservationComplete = observedChange || elapsedMs >= 1_200;
    if (minimumObservationComplete && unchangedObservationComplete && stateStable && latest.runningAnimations === 0) {
      return { state: latest, targetVerified: true, settled: true, elapsedMs };
    }
  }
  return {
    state: latest,
    targetVerified: true,
    settled: false,
    elapsedMs: Date.now() - started,
    error: 'The disclosure state did not settle within 1800ms after activation.'
  };
}

async function activateDisclosure(
  page: Page,
  identity: DisclosureIdentity,
  key: 'Enter' | 'Space',
  before: DisclosureStateSnapshot
): Promise<DisclosureActivationResult> {
  const currentRead = await readDisclosureSnapshot(page, identity);
  if (!currentRead.state) {
    return {
      targetVerified: false,
      settled: false,
      elapsedMs: 0,
      error: currentRead.error ?? 'The disclosure control could not be re-queried before activation.'
    };
  }
  let current = currentRead.state;
  const currentLocator = page.locator(current.selector);
  const currentCount = await currentLocator.count();
  if (currentCount !== 1) {
    return {
      targetVerified: false,
      settled: false,
      elapsedMs: 0,
      error: `The re-queried disclosure selector resolved to ${currentCount} elements before activation.`
    };
  }
  await currentLocator.scrollIntoViewIfNeeded();
  await currentLocator.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const positionedRead = await readDisclosureSnapshot(page, identity);
  if (!positionedRead.state) {
    return {
      targetVerified: false,
      settled: false,
      elapsedMs: 0,
      error: positionedRead.error ?? 'The disclosure control detached while it was positioned for activation.'
    };
  }
  current = positionedRead.state;
  if (!current.rendered || !current.topmost) {
    return {
      state: current,
      targetVerified: false,
      settled: false,
      elapsedMs: 0,
      error: 'The disclosure control is hidden, inactive, off-screen, or obscured; keyboard activation was not treated as valid evidence.'
    };
  }

  disclosureActivationSerial += 1;
  const marker = `disclosure-${disclosureActivationSerial}`;
  const activationLocator = page.locator(current.selector);
  await activationLocator.evaluate((element, { attribute, value }) => element.setAttribute(attribute, value), {
    attribute: disclosureMarkerAttribute,
    value: marker
  });
  const marked = page.locator(`[${disclosureMarkerAttribute}="${marker}"]`);
  try {
    if ((await marked.count()) !== 1) {
      return {
        targetVerified: false,
        settled: false,
        elapsedMs: 0,
        error: 'The disclosure activation marker did not resolve to exactly one live control.'
      };
    }
    const markerMatchesIdentity = await marked.evaluate((element, expected) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean).join(' ')
        : '';
      const name = (
        labelledText
        || element.getAttribute('aria-label')?.trim()
        || element.textContent?.trim()
        || element.getAttribute('title')?.trim()
        || ''
      ).replace(/\s+/g, ' ').trim();
      const role = element.getAttribute('role') ?? (element.tagName === 'BUTTON' ? 'button' : element.tagName.toLowerCase());
      return element.tagName.toLowerCase() === expected.tagName
        && role === expected.role
        && name === expected.name
        && (!expected.id || element.id === expected.id);
    }, identity);
    if (!markerMatchesIdentity) {
      return {
        targetVerified: false,
        settled: false,
        elapsedMs: 0,
        error: 'The marked disclosure no longer matched the intended control identity before activation.'
      };
    }
    await marked.focus();
    const focused = await marked.evaluate((element) => document.activeElement === element);
    if (!focused) {
      return {
        targetVerified: false,
        settled: false,
        elapsedMs: 0,
        error: 'Focus did not reach the intended disclosure control before activation.'
      };
    }
    await marked.press(key);
  } finally {
    await page.locator(`[${disclosureMarkerAttribute}="${marker}"]`).evaluateAll((elements, attribute) => {
      elements.forEach((element) => element.removeAttribute(attribute));
    }, disclosureMarkerAttribute).catch(() => undefined);
  }
  return waitForDisclosureSettled(page, identity, before);
}

function incompleteDisclosureResult(
  identity: DisclosureIdentity,
  error: string,
  partial: Partial<DisclosureCheckResult> = {}
): DisclosureCheckResult {
  return {
    selector: identity.selector,
    name: identity.name,
    controls: identity.controls,
    baselinePrepared: false,
    activationTargetVerified: false,
    enterTargetVerified: false,
    enterTestCompleted: false,
    beforeExpanded: null,
    afterExpanded: null,
    controlledVisibleBefore: null,
    controlledVisibleAfterOpen: null,
    spaceAfterExpanded: null,
    controlledVisibleAfterSpace: null,
    spaceTestCompleted: false,
    firstTabSelector: null,
    tabEnteredControlledRegion: null,
    ...partial,
    error
  };
}

export async function runDisclosureChecks(page: Page): Promise<DisclosureCheckResult[]> {
  const results: DisclosureCheckResult[] = [];
  const identities = await collectDisclosureIdentities(page);

  for (const identity of identities) {
    try {
      let initialRead = await readDisclosureSnapshot(page, identity);
      if (!initialRead.state) {
        results.push(incompleteDisclosureResult(identity, initialRead.error ?? 'The initial disclosure state could not be read.'));
        continue;
      }
      let initialState = initialRead.state;
      const initialLocator = page.locator(initialState.selector);
      if ((await initialLocator.count()) !== 1) {
        results.push(incompleteDisclosureResult(identity, 'The initial disclosure selector did not resolve to exactly one live control.', { initialState }));
        continue;
      }
      await initialLocator.scrollIntoViewIfNeeded();
      await initialLocator.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      initialRead = await readDisclosureSnapshot(page, identity);
      if (!initialRead.state || !initialRead.state.rendered || !initialRead.state.topmost) {
        results.push(incompleteDisclosureResult(
          identity,
          initialRead.error ?? 'The initial disclosure control is hidden, inactive, off-screen, or obscured.',
          { ...(initialRead.state ? { initialState: initialRead.state } : {}) }
        ));
        continue;
      }
      initialState = initialRead.state;
      if (initialState.expanded !== 'true' && initialState.expanded !== 'false') {
        results.push(incompleteDisclosureResult(identity, 'aria-expanded did not expose a valid true or false state in the final rendered DOM.', { initialState }));
        continue;
      }

      let beforeState = initialState;
      let baselineTargetVerified = true;
      if (initialState.expanded === 'true') {
        const collapsed = await activateDisclosure(page, identity, 'Enter', initialState);
        baselineTargetVerified = baselineTargetVerified && collapsed.targetVerified;
        if (!collapsed.state || !collapsed.settled || collapsed.state.expanded !== 'false' || collapsed.state.controlledVisible === true) {
          results.push(incompleteDisclosureResult(
            identity,
            collapsed.error ?? 'The disclosure started expanded and could not be returned to a settled collapsed baseline with Enter.',
            {
              initialExpanded: initialState.expanded,
              initialState,
              ...(collapsed.state ? {
                beforeState: collapsed.state,
                beforeExpanded: collapsed.state.expanded,
                controlledVisibleBefore: collapsed.state.controlledVisible
              } : {}),
              activationTargetVerified: baselineTargetVerified
            }
          ));
          continue;
        }
        beforeState = collapsed.state;
      }

      const entered = await activateDisclosure(page, identity, 'Enter', beforeState);
      const enterTargetVerified = baselineTargetVerified && entered.targetVerified;
      if (!entered.state || !entered.settled) {
        results.push(incompleteDisclosureResult(
          identity,
          entered.error ?? 'The disclosure did not reach a settled final state after Enter.',
          {
            initialExpanded: initialState.expanded,
            baselinePrepared: true,
            activationTargetVerified: enterTargetVerified,
            enterTargetVerified,
            initialState,
            beforeState,
            beforeExpanded: beforeState.expanded,
            controlledVisibleBefore: beforeState.controlledVisible,
            ...(entered.state ? {
              afterEnterState: entered.state,
              afterExpanded: entered.state.expanded,
              controlledVisibleAfterOpen: entered.state.controlledVisible
            } : {}),
            enterSettled: entered.settled,
            enterSettleMs: entered.elapsedMs
          }
        ));
        continue;
      }
      const afterEnterState = entered.state;

      let tabEnteredControlledRegion: boolean | null = null;
      let firstTabSelector: string | null = null;
      if (
        afterEnterState.focused
        && afterEnterState.expanded === 'true'
        && afterEnterState.controlledVisible === true
        && afterEnterState.controls
      ) {
        const controlledIds = afterEnterState.controls.split(/\s+/).filter(Boolean);
        const panelSelectors = controlledIds.map((id) => `#${id.replaceAll(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')}`);
        const focusable = page.locator(panelSelectors.map((selector) => `${selector} ${focusableSelector}`).join(', '));
        if ((await focusable.count()) > 0) {
          await page.keyboard.press('Tab');
          const active = page.locator(':focus');
          firstTabSelector = (await active.count()) ? (await locatorDescription(active)).selector : null;
          tabEnteredControlledRegion = await active.evaluate((element, ids) => ids.some((id) => document.getElementById(id)?.contains(element)), controlledIds);
        }
      }

      let restorationError: string | undefined;
      let collapsedForSpace = afterEnterState;
      if (afterEnterState.expanded === 'true' || afterEnterState.controlledVisible === true) {
        const collapsed = await activateDisclosure(page, identity, 'Enter', afterEnterState);
        if (!collapsed.state || !collapsed.settled || collapsed.state.expanded !== 'false' || collapsed.state.controlledVisible === true) {
          restorationError = collapsed.error ?? 'The disclosure could not be restored to a collapsed baseline before the Space test.';
        } else {
          collapsedForSpace = collapsed.state;
        }
      }

      let afterSpaceState: DisclosureStateSnapshot | undefined;
      let spaceSettled: boolean | undefined;
      let spaceSettleMs: number | undefined;
      let spaceTargetVerified: boolean | undefined;
      if (!restorationError && collapsedForSpace.expanded === 'false' && collapsedForSpace.controlledVisible !== true) {
        const spaced = await activateDisclosure(page, identity, 'Space', collapsedForSpace);
        spaceTargetVerified = spaced.targetVerified;
        spaceSettled = spaced.settled;
        spaceSettleMs = spaced.elapsedMs;
        if (spaced.state && spaced.settled) afterSpaceState = spaced.state;
        else restorationError = spaced.error ?? 'The disclosure did not reach a settled final state after Space.';
      }

      const latestRead = await readDisclosureSnapshot(page, identity);
      if (latestRead.state) {
        const shouldBeExpanded = initialState.expanded === 'true';
        const isExpanded = latestRead.state.expanded === 'true';
        if (shouldBeExpanded !== isExpanded) {
          const restored = await activateDisclosure(page, identity, 'Enter', latestRead.state);
          if (!restored.state || !restored.settled || (restored.state.expanded === 'true') !== shouldBeExpanded) {
            restorationError = restorationError ?? restored.error ?? 'The original disclosure state could not be restored after testing.';
          }
        }
      } else {
        restorationError = restorationError ?? latestRead.error ?? 'The disclosure could not be re-queried for state restoration.';
      }

      results.push({
        selector: identity.selector,
        name: identity.name,
        controls: beforeState.controls,
        initialExpanded: initialState.expanded,
        baselinePrepared: true,
        activationTargetVerified: enterTargetVerified,
        enterTargetVerified,
        enterTestCompleted: true,
        enterSettled: true,
        enterSettleMs: entered.elapsedMs,
        beforeExpanded: beforeState.expanded,
        afterExpanded: afterEnterState.expanded,
        controlledVisibleBefore: beforeState.controlledVisible,
        controlledVisibleAfterOpen: afterEnterState.controlledVisible,
        spaceAfterExpanded: afterSpaceState?.expanded ?? null,
        controlledVisibleAfterSpace: afterSpaceState?.controlledVisible ?? null,
        spaceTestCompleted: Boolean(afterSpaceState),
        ...(spaceTargetVerified === undefined ? {} : { spaceTargetVerified }),
        ...(spaceSettled === undefined ? {} : { spaceSettled }),
        ...(spaceSettleMs === undefined ? {} : { spaceSettleMs }),
        initialState,
        beforeState,
        afterEnterState,
        ...(afterSpaceState ? { afterSpaceState } : {}),
        firstTabSelector,
        tabEnteredControlledRegion,
        ...(restorationError ? { restorationError } : {})
      });
    } catch (error) {
      results.push(incompleteDisclosureResult(identity, error instanceof Error ? error.message : String(error)));
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
