import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import ExcelJS from 'exceljs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const textExtensions = new Set([
  '.cjs', '.d.ts', '.js', '.json', '.md', '.mdc', '.mjs', '.ts', '.txt', '.xlsx', '.yaml', '.yml'
]);
const sourceEntries = [
  '.claude-plugin',
  '.claude-mcp.json',
  '.codex-plugin',
  '.cursor-plugin',
  '.mcp.json',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'SECURITY.md',
  'SUPPORT.md',
  'assets',
  'commands',
  'docs',
  'mcp.json',
  'package.json',
  'rules',
  'skills',
  'src',
  'README.md',
  'audit.config.example.json'
];

// Development-only regression terms. Character codes keep validation-customer
// names out of the plugin's searchable source and generated package content.
const prohibitedNames = [
  String.fromCharCode(117, 110, 105, 108, 101, 118, 101, 114),
  String.fromCharCode(98, 97, 116)
];

function isProhibited(text) {
  return prohibitedNames.some((name) => new RegExp(`\\b${name}\\b`, 'iu').test(text));
}

async function searchableContent(path) {
  if (extname(path).toLowerCase() !== '.xlsx') return readFile(path, 'utf8');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const values = [];
  for (const worksheet of workbook.worksheets) {
    values.push(worksheet.name);
    worksheet.eachRow((row) => row.eachCell((cell) => {
      const value = cell.value;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        values.push(String(value));
      } else if (value && typeof value === 'object') {
        for (const key of ['text', 'hyperlink', 'formula', 'result']) {
          const candidate = value[key];
          if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean') {
            values.push(String(candidate));
          }
        }
        if (Array.isArray(value.richText)) {
          values.push(value.richText
            .map((entry) => typeof entry?.text === 'string' ? entry.text : '')
            .join(''));
        }
      }
      if (cell.note) {
        try {
          values.push(JSON.stringify(cell.note));
        } catch {
          // Ignore non-serializable note metadata after recording all cell text fields above.
        }
      }
    }));
  }
  return values.join('\n');
}

async function collectTextFiles(path) {
  const metadata = await stat(path).catch(() => null);
  if (!metadata) return [];
  if (metadata.isFile()) return textExtensions.has(extname(path).toLowerCase()) ? [path] : [];
  if (!metadata.isDirectory()) return [];

  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter((entry) => !entry.isSymbolicLink())
    .map((entry) => collectTextFiles(join(path, entry.name))));
  return files.flat();
}

export async function findSiteSpecificReferences(root, options = {}) {
  const entries = [...sourceEntries];
  if (options.includeDist) entries.push('dist');
  if (options.includeMarketplace) {
    entries.push('marketplace/rai-ops-plugin-marketplace/accessibility-audit');
    entries.push('marketplace/rai-ops-plugin-marketplace/catalog-fragments');
  }
  const files = (await Promise.all(entries.map((entry) => collectTextFiles(join(root, entry))))).flat();
  const failures = [];

  for (const path of files) {
    const content = await searchableContent(path);
    if (isProhibited(content)) failures.push(relative(root, path));
  }
  return failures.sort();
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 && args[rootIndex + 1]
    ? resolve(args[rootIndex + 1])
    : repositoryRoot;
  const requireDist = args.includes('--require-dist');
  const includeMarketplace = args.includes('--include-marketplace');
  if (requireDist && !(await stat(join(root, 'dist')).catch(() => null))?.isDirectory()) {
    throw new Error('Site-neutrality verification requires a compiled dist directory.');
  }

  const failures = await findSiteSpecificReferences(root, {
    includeDist: requireDist || (await stat(join(root, 'dist')).catch(() => null))?.isDirectory() === true,
    includeMarketplace
  });
  if (failures.length > 0) {
    process.stderr.write(`Site-neutrality verification failed:\n${failures.map((path) => `- ${path}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Site-neutrality verification passed.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
