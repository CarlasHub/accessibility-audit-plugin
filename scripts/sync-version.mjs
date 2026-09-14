import { readFile, writeFile } from 'node:fs/promises';

const CHECK_ONLY = process.argv.includes('--check');
const JSON_INDENT = 2;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, JSON_INDENT)}\n`);
}

const packageJson = await readJson('package.json');
const version = packageJson.version;

if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`package.json contains an invalid release version: ${String(version)}`);
}

const jsonTargets = [
  ['plugin.json', (manifest) => manifest.version],
  ['.codex-plugin/plugin.json', (manifest) => manifest.version],
  ['.cursor-plugin/plugin.json', (manifest) => manifest.version],
  ['.claude-plugin/plugin.json', (manifest) => manifest.version],
  ['.claude-plugin/marketplace.json', (manifest) => manifest.plugins?.[0]?.version],
  ['package-lock.json', (manifest) => manifest.version],
  ['package-lock.json#packages[""]', (manifest) => manifest.packages?.['']?.version]
];

const generatedTargets = [
  'marketplace/carlashub-plugin-marketplace/accessibility-audit/claude/.claude-plugin/plugin.json',
  'marketplace/carlashub-plugin-marketplace/accessibility-audit/claude/install-manifest.json',
  'marketplace/carlashub-plugin-marketplace/accessibility-audit/copilot-cli/plugin.json',
  'marketplace/carlashub-plugin-marketplace/accessibility-audit/copilot-cli/install-manifest.json',
  'marketplace/carlashub-plugin-marketplace/accessibility-audit/copilot-vscode/.claude-plugin/plugin.json',
  'marketplace/carlashub-plugin-marketplace/accessibility-audit/copilot-vscode/install-manifest.json'
];

if (CHECK_ONLY) {
  const mismatches = [];
  const cache = new Map();

  for (const [label, select] of jsonTargets) {
    const path = label.split('#')[0];
    const manifest = cache.get(path) ?? await readJson(path);
    cache.set(path, manifest);
    const actual = select(manifest);
    if (actual !== version) mismatches.push(`${label}: ${String(actual)}`);
  }

  const versionModule = await readFile('src/version.ts', 'utf8');
  if (versionModule !== `export const PLUGIN_VERSION = '${version}';\n`) {
    mismatches.push('src/version.ts: does not match package.json');
  }

  const citation = await readFile('CITATION.cff', 'utf8');
  const citationVersion = citation.match(/^version:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1];
  if (citationVersion !== version) {
    mismatches.push(`CITATION.cff: ${String(citationVersion)}`);
  }

  for (const path of generatedTargets) {
    const manifest = await readJson(path);
    if (manifest.version !== version) mismatches.push(`${path}: ${String(manifest.version)}`);
  }

  if (mismatches.length > 0) {
    throw new Error(`Version ${version} is not synchronised:\n- ${mismatches.join('\n- ')}`);
  }

  process.stdout.write(`All source and generated manifests use ${version}.\n`);
  process.exit(0);
}

for (const path of ['plugin.json', '.codex-plugin/plugin.json', '.cursor-plugin/plugin.json', '.claude-plugin/plugin.json']) {
  const manifest = await readJson(path);
  if (manifest.version === version) continue;
  manifest.version = version;
  await writeJson(path, manifest);
}

const marketplace = await readJson('.claude-plugin/marketplace.json');
if (!marketplace.plugins?.[0]) throw new Error('.claude-plugin/marketplace.json has no plugin entry.');
if (marketplace.plugins[0].version !== version) {
  marketplace.plugins[0].version = version;
  await writeJson('.claude-plugin/marketplace.json', marketplace);
}

const packageLock = await readJson('package-lock.json');
if (!packageLock.packages?.['']) throw new Error('package-lock.json has no root package entry.');
if (packageLock.version !== version || packageLock.packages[''].version !== version) {
  packageLock.version = version;
  packageLock.packages[''].version = version;
  await writeJson('package-lock.json', packageLock);
}

const expectedVersionModule = `export const PLUGIN_VERSION = '${version}';\n`;
if (await readFile('src/version.ts', 'utf8') !== expectedVersionModule) {
  await writeFile('src/version.ts', expectedVersionModule);
}

const citation = await readFile('CITATION.cff', 'utf8');
if (!/^version:\s*.+$/m.test(citation)) throw new Error('CITATION.cff has no version field.');
const nextCitation = citation.replace(/^version:\s*.+$/m, `version: ${version}`);
if (nextCitation !== citation) await writeFile('CITATION.cff', nextCitation);
process.stdout.write(`Synchronised source manifests to ${version}.\n`);
