import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import ExcelJS from 'exceljs';

export interface UrlCollection {
  source: string;
  urls: string[];
  skipped: Array<{ url: string; reason: string }>;
}

const urlPattern = /https?:\/\/[^\s<>'"\])}]+/gi;

function normalizeUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
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

  const allowedHosts = (options.allowedHosts ?? []).map((host) => host.toLowerCase());
  const skipped: Array<{ url: string; reason: string }> = [];
  const urls = unique(found).filter((url) => {
    const host = new URL(url).hostname.toLowerCase();
    if (allowedHosts.length > 0 && !allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      skipped.push({ url, reason: `Host ${host} is not in the allowed-host list.` });
      return false;
    }
    if (options.stagingOnly && !/(staging|stage|preview|qa|test|runmytests|localhost|127\.0\.0\.1)/i.test(host)) {
      skipped.push({ url, reason: `Host ${host} does not look like a staging host.` });
      return false;
    }
    return true;
  });

  if (found.length === 0) throw new Error('No HTTP(S) URLs were found in the supplied input.');
  if (urls.length === 0) throw new Error('All discovered URLs were excluded by the host restrictions.');
  return { source: sources.join(', '), urls, skipped };
}
