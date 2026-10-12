import { createHash } from 'node:crypto';

export type DiscoveryCategory = 'content' | 'jobs' | 'taxonomy' | 'utility' | 'query-variant';

export interface DiscoveryCandidate {
  url: string;
  title?: string;
  category: DiscoveryCategory;
  recommended: boolean;
  reason?: string;
}

export interface PageDiscoveryResult {
  seedUrl: string;
  origin: string;
  candidates: DiscoveryCandidate[];
  fetchedPageCount: number;
  discoveryLimit: number;
  maxDepth: number;
  truncated: boolean;
  errors: Array<{ url: string; message: string }>;
  discoveryDigest: string;
}

export interface PageDiscoveryOptions {
  maxPages?: number;
  maxDepth?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const DEFAULT_MAX_PAGES = 200;
const MAX_PAGE_LIMIT = 500;
const DEFAULT_MAX_DEPTH = 5;
const MAX_DEPTH_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i;
const NON_PAGE_EXTENSION = /\.(?:7z|avi|avif|bmp|css|csv|docx?|eot|epub|gif|gz|ico|jpe?g|js|json|map|mkv|mov|mp3|mp4|mpeg|ogg|otf|pdf|png|pptx?|rar|rss|svg|tar|tiff?|tsv|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i;

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: '\u00a0', quot: '"'
  };
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (entity, decimal, hexadecimal, name) => {
    const numericValue = decimal
      ? Number.parseInt(decimal, 10)
      : hexadecimal
        ? Number.parseInt(hexadecimal, 16)
        : undefined;
    if (numericValue !== undefined) {
      return Number.isInteger(numericValue)
        && numericValue >= 0
        && numericValue <= 0x10ffff
        && !(numericValue >= 0xd800 && numericValue <= 0xdfff)
        ? String.fromCodePoint(numericValue)
        : '\ufffd';
    }
    return named[String(name).toLowerCase()] ?? entity;
  });
}

function stripMarkup(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function sanitizeDiscoveredTitle(value: string): string {
  let sanitized = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    const isBidirectionalFormatting = codePoint === 0x061c
      || codePoint === 0x200e
      || codePoint === 0x200f
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069);
    sanitized += isControl || isBidirectionalFormatting ? ' ' : character;
  }
  return [...sanitized.replace(/\s+/g, ' ').trim()].slice(0, 160).join('');
}

const RAW_TEXT_ELEMENTS = new Set(['iframe', 'noembed', 'noframes', 'noscript', 'script', 'style', 'textarea', 'xmp']);
const INERT_ELEMENTS = new Set([...RAW_TEXT_ELEMENTS, 'plaintext', 'template']);

interface HtmlTagToken {
  name: string;
  closing: boolean;
  end: number;
}

function readHtmlTag(html: string, start: number): HtmlTagToken | null {
  if (html[start] !== '<') return null;
  let cursor = start + 1;
  let closing = false;
  if (html[cursor] === '/') {
    closing = true;
    cursor += 1;
  }
  const nameStart = cursor;
  while (/[a-z0-9:-]/i.test(html[cursor] ?? '')) cursor += 1;
  if (cursor === nameStart) return null;
  const name = html.slice(nameStart, cursor).toLowerCase();
  let quote: '"' | "'" | null = null;
  for (; cursor < html.length; cursor += 1) {
    const character = html[cursor];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return { name, closing, end: cursor + 1 };
    }
  }
  return null;
}

function findRawTextClosingTag(html: string, start: number, tagName: string): HtmlTagToken | null {
  const pattern = new RegExp(`<\\/${tagName}\\b`, 'gi');
  pattern.lastIndex = start;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    const token = readHtmlTag(html, match.index);
    if (token?.closing && token.name === tagName) return token;
  }
  return null;
}

function removeInertMarkup(html: string): string {
  let visibleMarkup = '';
  let cursor = 0;
  let scanFrom = 0;
  const suppressedElements: string[] = [];

  while (scanFrom < html.length) {
    const currentElement = suppressedElements.at(-1);
    if (currentElement && RAW_TEXT_ELEMENTS.has(currentElement)) {
      const closingTag = findRawTextClosingTag(html, scanFrom, currentElement);
      if (!closingTag) return visibleMarkup;
      suppressedElements.pop();
      scanFrom = closingTag.end;
      cursor = scanFrom;
      continue;
    }

    const tagStart = html.indexOf('<', scanFrom);
    if (tagStart === -1) {
      if (suppressedElements.length === 0) visibleMarkup += html.slice(cursor);
      return visibleMarkup;
    }

    if (html.startsWith('<!--', tagStart)) {
      if (suppressedElements.length === 0) visibleMarkup += html.slice(cursor, tagStart);
      const commentEnd = html.indexOf('-->', tagStart + 4);
      if (commentEnd === -1) return visibleMarkup;
      scanFrom = commentEnd + 3;
      cursor = scanFrom;
      continue;
    }

    const token = readHtmlTag(html, tagStart);
    if (!token) {
      scanFrom = tagStart + 1;
      continue;
    }

    const currentlySuppressed = suppressedElements.length > 0;
    if (!token.closing && INERT_ELEMENTS.has(token.name)) {
      if (!currentlySuppressed) visibleMarkup += html.slice(cursor, tagStart);
      if (token.name === 'plaintext') return visibleMarkup;
      suppressedElements.push(token.name);
      cursor = token.end;
    } else if (currentlySuppressed && token.closing && token.name === currentElement) {
      suppressedElements.pop();
      cursor = token.end;
    }
    scanFrom = token.end;
  }

  if (suppressedElements.length === 0) visibleMarkup += html.slice(cursor);
  return visibleMarkup;
}

function canonicalizeUrl(value: string | URL, origin?: string): URL | null {
  try {
    const url = value instanceof URL ? new URL(value.href) : new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (origin && url.origin !== origin) return null;
    url.hash = '';
    const parameters = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMETER.test(key))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
      ));
    url.search = '';
    for (const [key, parameterValue] of parameters) url.searchParams.append(key, parameterValue);
    return url;
  } catch {
    return null;
  }
}

function isPageUrl(url: URL): boolean {
  return !NON_PAGE_EXTENSION.test(url.pathname) && !/\/(?:feed|rss|atom)\/?$/i.test(url.pathname);
}

export function classifyDiscoveredPage(url: string): Pick<DiscoveryCandidate, 'category' | 'recommended' | 'reason'> {
  const parsed = new URL(url);
  const segments = parsed.pathname.toLowerCase().split('/').filter(Boolean);
  const queryKeys = [...parsed.searchParams.keys()].map((key) => key.toLowerCase());
  const year = (segment: string | undefined): boolean => /^\d{4}$/.test(segment ?? '');
  const month = (segment: string | undefined): boolean => /^(?:0?[1-9]|1[0-2])$/.test(segment ?? '');
  const day = (segment: string | undefined): boolean => /^(?:0?[1-9]|[12]\d|3[01])$/.test(segment ?? '');
  const terminalDateArchive = year(segments.at(-1))
    || (year(segments.at(-2)) && month(segments.at(-1)))
    || (year(segments.at(-3)) && month(segments.at(-2)) && day(segments.at(-1)));

  if (segments.some((segment) => /^(?:careers?|jobs?|recruit(?:ment|ing)?|vacanc(?:y|ies)|work-with-us)$/.test(segment))) {
    return { category: 'jobs', recommended: false, reason: 'Jobs or recruitment page; left unchecked by default.' };
  }
  if (
    terminalDateArchive
    || segments.some((segment) => /^(?:authors?|categor(?:y|ies)|tags?|topics?|archives?|page)$/.test(segment))
    || segments.some((segment, index) => segments[index - 1] === 'page' && /^\d+$/.test(segment))
    || queryKeys.some((key) => /^(?:author|cat|category|filter|page|paged|sort|tag|topic)$/.test(key))
  ) {
    return { category: 'taxonomy', recommended: false, reason: 'Category, tag, archive, filter, or paginated listing; left unchecked by default.' };
  }
  if (segments.some((segment) => /^(?:admin|cart|checkout|login|logout|register|sign-in|signin|sign-up|signup|wp-admin)$/.test(segment))) {
    return { category: 'utility', recommended: false, reason: 'Account, administration, or transaction utility page; left unchecked by default.' };
  }
  if (
    segments.some((segment) => /^(?:search|search-results|results)$/.test(segment))
    || queryKeys.some((key) => /^(?:q|query|s|search)$/.test(key))
  ) {
    return { category: 'utility', recommended: false, reason: 'Search or generated results page; left unchecked by default.' };
  }
  if (parsed.search) {
    return { category: 'query-variant', recommended: false, reason: 'Query-string variant; left unchecked to avoid generated duplicates.' };
  }
  return { category: 'content', recommended: true };
}

function extractAttribute(markup: string, attribute: string): string | undefined {
  const match = markup.match(new RegExp(`\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeHtmlEntities(value.trim());
}

function extractPageMetadata(html: string, pageUrl: URL): { title?: string; links: URL[] } {
  const activeHtml = removeInertMarkup(html);
  const titleMatch = activeHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const rawTitle = titleMatch?.[1] === undefined ? undefined : sanitizeDiscoveredTitle(stripMarkup(titleMatch[1]));
  const baseMatch = activeHtml.match(/<base\b[^>]*>/i);
  const baseHref = baseMatch ? extractAttribute(baseMatch[0], 'href') : undefined;
  let baseUrl = pageUrl;
  if (baseHref) {
    try {
      const proposedBase = new URL(baseHref, pageUrl);
      if (proposedBase.origin === pageUrl.origin) baseUrl = proposedBase;
    } catch {
      // An invalid <base> is ignored and relative links remain relative to the fetched page.
    }
  }
  const links: URL[] = [];
  for (const match of activeHtml.matchAll(/<a\b[^>]*>/gi)) {
    const href = extractAttribute(match[0], 'href');
    if (!href || /^(?:#|data:|javascript:|mailto:|tel:)/i.test(href.trim())) continue;
    try {
      links.push(new URL(href, baseUrl));
    } catch {
      // Invalid links are not candidates.
    }
  }
  return { ...(rawTitle ? { title: rawTitle } : {}), links };
}

async function readHtml(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
    throw new Error('HTML response exceeded the 2 MiB discovery limit.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error('HTML response exceeded the 2 MiB discovery limit.');
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function fetchSameOriginHtml(
  initialUrl: URL,
  origin: string,
  fetchPage: typeof fetch,
  timeoutMs: number
): Promise<{ html: string; finalUrl: URL } | null> {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await fetchPage(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9',
        'user-agent': 'AccessibilityAuditPlugin page-discovery'
      }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect response ${response.status} did not include a location.`);
      const redirected = canonicalizeUrl(new URL(location, current), origin);
      if (!redirected) throw new Error('A redirect left the approved origin and was not followed.');
      await response.body?.cancel();
      current = redirected;
      continue;
    }
    if (!response.ok) throw new Error(`Discovery request returned HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) return null;
    return { html: await readHtml(response), finalUrl: current };
  }
  throw new Error('Discovery stopped after more than 5 redirects.');
}

function discoveryDigest(result: Omit<PageDiscoveryResult, 'discoveryDigest'>): string {
  return createHash('sha256').update(JSON.stringify({
    seedUrl: result.seedUrl,
    origin: result.origin,
    candidates: result.candidates.map(({ url, title, category, recommended, reason }) => ({
      url, ...(title ? { title } : {}), category, recommended, ...(reason ? { reason } : {})
    })),
    discoveryLimit: result.discoveryLimit,
    maxDepth: result.maxDepth,
    truncated: result.truncated
  })).digest('hex');
}

export async function discoverPages(seed: string, options: PageDiscoveryOptions = {}): Promise<PageDiscoveryResult> {
  const seedUrl = canonicalizeUrl(seed);
  if (!seedUrl) throw new Error('Page discovery requires one complete HTTP(S) URL without embedded credentials.');
  if (!isPageUrl(seedUrl)) throw new Error('Page discovery requires an HTML page URL, not a document or asset URL.');
  const maxPages = Math.min(Math.max(options.maxPages ?? DEFAULT_MAX_PAGES, 1), MAX_PAGE_LIMIT);
  const maxDepth = Math.min(Math.max(options.maxDepth ?? DEFAULT_MAX_DEPTH, 0), MAX_DEPTH_LIMIT);
  const timeoutMs = Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1);
  const fetchPage = options.fetch ?? fetch;
  const candidates = new Map<string, DiscoveryCandidate>();
  const fetched = new Set<string>();
  const queued = new Set<string>();
  const redirectAliases = new Set<string>();
  const queue: Array<{ url: URL; depth: number }> = [{ url: seedUrl, depth: 0 }];
  const errors: Array<{ url: string; message: string }> = [];
  let fetchedPageCount = 0;
  let truncated = false;

  const addCandidate = (url: URL): boolean => {
    if (redirectAliases.has(url.href)) return true;
    if (candidates.has(url.href)) return true;
    if (candidates.size >= maxPages) {
      truncated = true;
      return false;
    }
    candidates.set(url.href, { url: url.href, ...classifyDiscoveredPage(url.href) });
    return true;
  };
  addCandidate(seedUrl);
  queued.add(seedUrl.href);

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || fetched.has(next.url.href)) continue;
    fetched.add(next.url.href);
    fetchedPageCount += 1;
    try {
      const page = await fetchSameOriginHtml(next.url, seedUrl.origin, fetchPage, timeoutMs);
      if (!page) continue;
      const finalCanonical = canonicalizeUrl(page.finalUrl, seedUrl.origin);
      if (!finalCanonical) continue;
      if (finalCanonical.href !== next.url.href) {
        redirectAliases.add(next.url.href);
        candidates.delete(next.url.href);
        fetched.add(finalCanonical.href);
      }
      addCandidate(finalCanonical);
      const metadata = extractPageMetadata(page.html, finalCanonical);
      const candidate = candidates.get(finalCanonical.href);
      if (candidate && metadata.title) candidate.title = metadata.title;
      if (next.depth >= maxDepth) {
        if (metadata.links.some((link) => {
          const canonical = canonicalizeUrl(link, seedUrl.origin);
          return canonical !== null && isPageUrl(canonical) && !candidates.has(canonical.href);
        })) truncated = true;
        continue;
      }
      for (const link of metadata.links) {
        const canonical = canonicalizeUrl(link, seedUrl.origin);
        if (!canonical || !isPageUrl(canonical)) continue;
        if (!addCandidate(canonical)) continue;
        if (!queued.has(canonical.href)) {
          queued.add(canonical.href);
          queue.push({ url: canonical, depth: next.depth + 1 });
        }
      }
    } catch (error: unknown) {
      errors.push({
        url: next.url.href,
        message: error instanceof Error ? error.message : 'Discovery request failed.'
      });
    }
  }

  const withoutDigest: Omit<PageDiscoveryResult, 'discoveryDigest'> = {
    seedUrl: seedUrl.href,
    origin: seedUrl.origin,
    candidates: [...candidates.values()],
    fetchedPageCount,
    discoveryLimit: maxPages,
    maxDepth,
    truncated,
    errors
  };
  return { ...withoutDigest, discoveryDigest: discoveryDigest(withoutDigest) };
}

export function selectDiscoveredUrls(result: PageDiscoveryResult, selectedUrls: string[]): string[] {
  if (selectedUrls.length === 0) throw new Error('Select at least one discovered page to audit.');
  const available = new Set(result.candidates.map((candidate) => candidate.url));
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const value of selectedUrls) {
    const canonical = canonicalizeUrl(value, result.origin);
    if (!canonical || !available.has(canonical.href)) {
      throw new Error(`The selected URL was not in the current discovery result: ${value}`);
    }
    if (!seen.has(canonical.href)) {
      seen.add(canonical.href);
      selected.push(canonical.href);
    }
  }
  return selected;
}
