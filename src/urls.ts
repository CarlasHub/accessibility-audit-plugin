import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import ExcelJS from 'exceljs';

export interface UrlCollection {
  source: string;
  urls: string[];
  skipped: Array<{ url: string; reason: string }>;
}

const urlPattern = /https?:\/\/[^\s<>'"\])}]+/gi;
const stagingHostPattern = /(?:^|[.-])(?:dev|development|local|localhost|preview|qa|stage|staging|test|testing|uat)(?:[.\d-]|$)/i;

function normalizeUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) {
      throw new Error('URLs containing embedded usernames or passwords are not supported.');
    }
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    if (error instanceof Error && error.message.includes('embedded usernames or passwords')) throw error;
    return null;
  }
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
  options: { allowedHosts?: string[]; stagingOnly?: boolean } = {}
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
  options: { allowedHosts?: string[]; stagingOnly?: boolean } = {}
): Promise<UrlCollection> {
  const found: string[] = [];
  const sources: string[] = [];

  for (const input of inputs) {
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
    sources.push(filePath);
    if (extension === '.xlsx') {
      found.push(...(await urlsFromWorkbook(filePath)));
      continue;
    }
    const text = await readFile(filePath, 'utf8');
    found.push(...(text.match(urlPattern) ?? []));
  }

  // Validate the allowlist even when the supplied page list contains no matching URL.
  (options.allowedHosts ?? []).map(normalizeAllowedHost);
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
  return { source: sources.join(', '), urls, skipped };
}
