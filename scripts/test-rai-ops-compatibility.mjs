import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const stagedRoot = join(root, 'marketplace', 'rai-ops-plugin-marketplace');
const temporary = await mkdtemp(join(tmpdir(), 'rai-ops-marketplace-compatibility-'));
const checkout = join(temporary, 'marketplace');

function sortedWith(catalog, additions) {
  const names = new Set(additions.map((entry) => entry.name));
  return {
    ...catalog,
    plugins: [
      ...(Array.isArray(catalog.plugins) ? catalog.plugins.filter((entry) => !names.has(entry.name)) : []),
      ...additions
    ].sort((left, right) => left.name.localeCompare(right.name))
  };
}

try {
  await execFileAsync('git', [
    'clone',
    '--depth', '1',
    '--branch', 'main',
    'https://github.com/radancy-pe/rai-ops-plugin-marketplace.git',
    checkout
  ], { maxBuffer: 4 * 1024 * 1024 });
  await cp(join(stagedRoot, 'accessibility-audit'), join(checkout, 'accessibility-audit'), { recursive: true });

  const claudeCatalogPath = join(checkout, '.claude-plugin', 'marketplace.json');
  const claudeCatalog = JSON.parse(await readFile(claudeCatalogPath, 'utf8'));
  const claudeAddition = JSON.parse(await readFile(join(stagedRoot, 'catalog-fragments', 'claude.json'), 'utf8'));
  await writeFile(claudeCatalogPath, `${JSON.stringify(sortedWith(claudeCatalog, [claudeAddition]), null, 2)}\n`, 'utf8');

  const copilotCatalogPath = join(checkout, '.github', 'plugin', 'marketplace.json');
  const copilotCatalog = JSON.parse(await readFile(copilotCatalogPath, 'utf8'));
  const copilotAdditions = JSON.parse(await readFile(join(stagedRoot, 'catalog-fragments', 'copilot.json'), 'utf8'));
  await writeFile(copilotCatalogPath, `${JSON.stringify(sortedWith(copilotCatalog, copilotAdditions), null, 2)}\n`, 'utf8');

  const validation = await execFileAsync(process.execPath, ['tests/validate-marketplace.mjs'], {
    cwd: checkout,
    maxBuffer: 4 * 1024 * 1024
  });
  const tests = await execFileAsync(process.execPath, ['--test', 'tests/validate-marketplace.test.mjs'], {
    cwd: checkout,
    maxBuffer: 4 * 1024 * 1024
  });
  process.stdout.write(validation.stdout);
  process.stderr.write(validation.stderr);
  process.stdout.write(tests.stdout);
  process.stderr.write(tests.stderr);
  process.stdout.write('Staged payload is compatible with the current RAI Ops marketplace catalogs and validator.\n');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
