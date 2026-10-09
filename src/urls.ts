import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { SaxesParser, type SaxesTagNS } from 'saxes';

export interface UrlCollection {
  source: string;
  urls: string[];
  skipped: Array<{ url: string; reason: string }>;
}

const urlPattern = /https?:\/\/[^\s<>'"\])}]+/gi;
const stagingHostPattern = /(?:^|[.-])(?:dev|development|local|localhost|preview|qa|stage|staging|test|testing|uat)(?:[.\d-]|$)/i;
const maximumSitemapBytes = 50 * 1024 * 1024;
const maximumSitemapUrls = 50_000;

export function splitUrlListValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('Invalid explicit URL list JSON syntax. Supply a valid JSON array of HTTP(S) URL strings.');
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('An explicit JSON URL list must contain at least one HTTP(S) URL string.');
    }
    return parsed.map((item, index) => {
      if (typeof item !== 'string') {
        throw new Error(
          `Invalid explicit URL list entry ${index + 1}. JSON URL list entries must be strings containing complete HTTP(S) URLs.`
        );
      }
      return item.trim();
    });
  }

  const listMarker = /^(?:[-*\u2022]|\d+[.)])\s+/i;
  const hasListMarker = /(?:^|\r?\n)\s*(?:[-*\u2022]|\d+[.)])\s+/i.test(trimmed);
  const hasLineBreak = /[\r\n]/.test(trimmed);
  const hasProtocolTokenWithWhitespace = /\s/.test(trimmed) && /(?:^|\s)[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (!hasListMarker && !hasLineBreak && !hasProtocolTokenWithWhitespace) return [trimmed];

  return trimmed
    .split(/\r?\n+/)
    .flatMap((line) => line.trim().replace(listMarker, '').split(/(?:[,;]?[ \t]+)(?:(?:[-*\u2022]|\d+[.)])[ \t]+)?/i))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUrl(value: string): string | null {
  try {
    const trimmed = value.trim();
    if (/\s/.test(trimmed)) return null;
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) {
      throw new Error('URLs containing embedded usernames or passwords are not supported.');
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof Error && error.message.includes('embedded usernames or passwords')) throw error;
    return null;
  }
}

export function normalizeExplicitUrlEntries(entries: string[]): string[] {
  return entries.map((entry, index) => {
    let normalized: string | null;
    try {
      normalized = normalizeUrl(entry);
    } catch {
      normalized = null;
    }
    if (!normalized) {
      throw new Error(
        `Invalid explicit URL list entry ${index + 1}. Supply a complete HTTP(S) URL without embedded credentials.`
      );
    }
    return normalized;
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizeUrl).filter((value): value is string => Boolean(value)))];
}

async function urlsFromWorkbook(path: string): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const preferred: string[] = [];
  const fallback: string[] = [];

  for (const sheet of workbook.worksheets) {
    const headerByColumn = new Map<number, string>();
    const firstRow = sheet.getRow(1);
    firstRow.eachCell((cell, column) => {
      headerByColumn.set(column, String(cell.text ?? '').trim().toLowerCase());
    });
    const preferredColumns = new Set(
      [...headerByColumn.entries()]
        .filter(([, header]) => ['qa page', 'staging url', 'url', 'page url'].includes(header))
        .map(([column]) => column)
    );

    sheet.eachRow((row, rowNumber) => {
      row.eachCell((cell, column) => {
        const text = cell.text || String(cell.value ?? '');
        const matches = text.match(urlPattern) ?? [];
        fallback.push(...matches);
        if (rowNumber > 1 && preferredColumns.has(column)) preferred.push(...matches);
      });
    });
  }
  return unique(preferred.length > 0 ? preferred : fallback);
}

async function urlsFromSitemap(path: string): Promise<string[]> {
  const label = basename(path);
  const xml = await new Promise<string>((resolveXml, rejectXml) => {
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    let settled = false;
    const stream = createReadStream(path);
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      rejectXml(error);
    };

    stream.on('data', (chunk: string | Buffer) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytesRead += buffer.length;
      if (bytesRead > maximumSitemapBytes) {
        stream.destroy();
        rejectOnce(new Error(`Invalid XML sitemap "${label}": the uncompressed file exceeds the 50 MiB sitemap limit.`));
        return;
      }
      chunks.push(buffer);
    });
    stream.once('error', rejectOnce);
    stream.once('end', () => {
      if (settled) return;
      settled = true;
      resolveXml(Buffer.concat(chunks, bytesRead).toString('utf8'));
    });
  });

  const parser = new SaxesParser({ xmlns: true });
  const stack: Array<Pick<SaxesTagNS, 'local' | 'uri'>> = [];
  const urls: string[] = [];
  let root: Pick<SaxesTagNS, 'local' | 'uri'> | undefined;
  let locationCount = 0;
  let locText: string | undefined;
  let parseError: Error | undefined;

  parser.on('error', (error) => {
    parseError ??= error;
  });
  parser.on('doctype', () => {
    parseError ??= new Error('DOCTYPE declarations are not allowed.');
  });
  parser.on('opentag', (tag) => {
    const element = { local: tag.local, uri: tag.uri };
    stack.push(element);
    if (!root) {
      root = element;
      if (root.local === 'sitemapindex') {
        parseError ??= new Error('sitemap indexes are not fetched; provide each child URL-set XML file explicitly.');
      } else if (root.local !== 'urlset') {
        parseError ??= new Error('the root element must be <urlset>.');
      }
      return;
    }

    if (
      stack.length === 3
      && stack[1]?.local === 'url'
      && stack[1]?.uri === root.uri
      && element.local === 'loc'
      && element.uri === root.uri
    ) {
      locText = '';
    }
  });
  const appendLocText = (text: string): void => {
    if (locText !== undefined && stack.length === 3) locText += text;
  };
  parser.on('text', appendLocText);
  parser.on('cdata', appendLocText);
  parser.on('closetag', () => {
    const closing = stack.pop();
    if (locText !== undefined && stack.length === 2 && closing?.local === 'loc' && closing.uri === root?.uri) {
      const value = locText.trim();
      if (value) {
        locationCount += 1;
        if (locationCount > maximumSitemapUrls) {
          parseError ??= new Error('the file exceeds the 50,000 URL sitemap limit.');
        } else {
          urls.push(value);
        }
      }
      locText = undefined;
    }
  });

  parser.write(xml).close();
  if (parseError) {
    const message = parseError.message.replace(/^\d+:\d+:\s*/, '');
    throw new Error(`Invalid XML sitemap "${label}": ${message}`);
  }
  return unique(urls);
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, '');
}

function normalizeAllowedHost(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    if (trimmed.includes('://') && (parsed.pathname !== '/' || parsed.search || parsed.hash)) throw new Error();
    const hostname = normalizeHostname(parsed.hostname);
    if (!hostname || hostname.includes('*')) throw new Error();
    return hostname;
  } catch {
    throw new Error(`Invalid allowed host "${trimmed}". Use a hostname such as example.com, without a path or wildcard.`);
  }
}

function looksLikeStagingHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return host === '127.0.0.1'
    || host === '[::1]'
    || stagingHostPattern.test(host);
}

export function urlRestrictionReason(
  value: string,
  options: { allowedHosts?: string[]; exactHosts?: string[]; stagingOnly?: boolean } = {}
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'Navigation resolved to an invalid URL.';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return `Navigation resolved to the unsupported ${parsed.protocol || 'unknown'} protocol.`;
  }
  if (parsed.username || parsed.password) {
    return 'Navigation resolved to a URL containing embedded credentials.';
  }
  const host = normalizeHostname(parsed.hostname);
  const allowedHosts = (options.allowedHosts ?? []).map(normalizeAllowedHost);
  const exactHosts = (options.exactHosts ?? []).map(normalizeAllowedHost);
  if (exactHosts.length > 0 && !exactHosts.includes(host)) {
    return `Host ${host} is not in the exact-host list.`;
  }
  if (allowedHosts.length > 0 && !allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    return `Host ${host} is not in the allowed-host list.`;
  }
  if (options.stagingOnly && !looksLikeStagingHost(host)) {
    return `Host ${host} does not look like a staging host.`;
  }
  return null;
}

export async function collectUrls(
  inputs: string[],
  options: { allowedHosts?: string[]; exactHosts?: string[]; maxPages?: number; stagingOnly?: boolean } = {}
): Promise<UrlCollection> {
  const found: string[] = [];
  const sources: string[] = [];

  for (const input of inputs) {
    const expandedInputs = splitUrlListValue(input);
    const isExplicitList = expandedInputs.length > 1 || expandedInputs[0] !== input.trim();
    if (isExplicitList) {
      const normalizedEntries = normalizeExplicitUrlEntries(expandedInputs);
      found.push(...normalizedEntries);
      sources.push('explicit URL list');
      continue;
    }
    const direct = normalizeUrl(input);
    if (direct) {
      found.push(direct);
      sources.push('command line');
      continue;
    }

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim())) {
      throw new Error('Unsupported or invalid target URL. Supply an HTTP(S) URL without embedded credentials.');
    }

    const filePath = resolve(input);
    const extension = extname(filePath).toLowerCase();
    sources.push(basename(filePath));
    if (extension === '.xlsx') {
      found.push(...(await urlsFromWorkbook(filePath)));
      continue;
    }
    if (extension === '.xml') {
      found.push(...(await urlsFromSitemap(filePath)));
      continue;
    }
    const text = await readFile(filePath, 'utf8');
    found.push(...(text.match(urlPattern) ?? []));
  }

  // Validate the allowlist even when the supplied page list contains no matching URL.
  (options.allowedHosts ?? []).map(normalizeAllowedHost);
  (options.exactHosts ?? []).map(normalizeAllowedHost);
  const skipped: Array<{ url: string; reason: string }> = [];
  const urls = unique(found).filter((url) => {
    const reason = urlRestrictionReason(url, options);
    if (reason) {
      skipped.push({ url, reason });
      return false;
    }
    return true;
  });

  if (found.length === 0) throw new Error('No HTTP(S) URLs were found in the supplied input.');
  if (urls.length === 0) throw new Error('All discovered URLs were excluded by the host restrictions.');
  if (options.maxPages !== undefined && urls.length > options.maxPages) {
    throw new Error(
      `Resolved ${urls.length} authorized unique pages, exceeding the configured maximum of ${options.maxPages}. Narrow the input or increase maxPages.`
    );
  }
  return { source: sources.join(', '), urls, skipped };
}
