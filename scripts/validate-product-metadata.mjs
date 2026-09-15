import { readFile } from 'node:fs/promises';

const PRODUCT_NAME = 'CarlasHub Accessibility Audit';
const PRODUCT_POSITION = 'evidence-backed accessibility pre-audit';
const HOMEPAGE = 'https://carlashub.github.io/accessibility-audit-plugin/';
const REPOSITORY = 'https://github.com/CarlasHub/accessibility-audit-plugin';
const MARKETPLACE = 'https://github.com/marketplace/actions/carlashub-accessibility-audit';

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

async function read(path) {
  return readFile(path, 'utf8');
}

async function readJson(path) {
  return JSON.parse(await read(path));
}

function includesPosition(value) {
  return typeof value === 'string' && value.toLowerCase().includes(PRODUCT_POSITION);
}

const packageJson = await readJson('package.json');
const action = await read('action.yml');
const readme = await read('README.md');
const citation = await read('CITATION.cff');
const publicTextPaths = [
  'README.md',
  'action.yml',
  'plugin.json',
  '.codex-plugin/plugin.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.cursor-plugin/plugin.json',
  'commands/accessibility-audit.md',
  'skills/run-accessibility-audit/SKILL.md',
  'skills/run-accessibility-audit/references/reporting.md',
  'docs/github-action.md',
  'docs/github-developer-program.md',
  'scripts/build-marketplace-payload.mjs',
  'src/mcp.ts'
];
const publicText = await Promise.all(publicTextPaths.map(async (path) => [path, await read(path)]));

assert(packageJson.name === 'accessibility-audit-plugin', 'package.json: unexpected package name');
assert(includesPosition(packageJson.description), 'package.json: description must use the approved product position');
assert(packageJson.homepage === HOMEPAGE, 'package.json: homepage must point to the public product page');
assert(packageJson.repository?.url === `git+${REPOSITORY}.git`, 'package.json: repository URL is incorrect');

const requiredKeywords = [
  'accessibility',
  'accessibility-audit',
  'accessibility-testing',
  'a11y',
  'axe-core',
  'claude-code-plugin',
  'codex-plugin',
  'cursor-plugin',
  'github-actions',
  'github-copilot-plugin',
  'model-context-protocol',
  'playwright',
  'web-accessibility',
  'wcag',
  'wcag-22'
];
for (const keyword of requiredKeywords) {
  assert(packageJson.keywords?.includes(keyword), `package.json: missing discoverability keyword ${keyword}`);
}

assert(action.includes(`name: ${PRODUCT_NAME}\n`), 'action.yml: product name is inconsistent');
assert(includesPosition(action), 'action.yml: description must use the approved product position');
assert(readme.startsWith(`# ${PRODUCT_NAME}\n`), 'README.md: first heading must be the product name');
assert(includesPosition(readme), 'README.md: introduction must use the approved product position');
assert(readme.includes(HOMEPAGE), 'README.md: public product page is missing');
assert(readme.includes(MARKETPLACE), 'README.md: GitHub Marketplace listing is missing');

const manifestDescriptions = [
  ['plugin.json', (await readJson('plugin.json')).description],
  ['.codex-plugin/plugin.json', (await readJson('.codex-plugin/plugin.json')).description],
  ['.claude-plugin/plugin.json', (await readJson('.claude-plugin/plugin.json')).description],
  ['.cursor-plugin/plugin.json', (await readJson('.cursor-plugin/plugin.json')).description],
  ['.claude-plugin/marketplace.json', (await readJson('.claude-plugin/marketplace.json')).plugins?.[0]?.description]
];
for (const [path, description] of manifestDescriptions) {
  assert(includesPosition(description), `${path}: description must use the approved product position`);
}

assert(citation.includes(`title: "${PRODUCT_NAME}"`), 'CITATION.cff: title is inconsistent');
assert(citation.includes(`version: ${packageJson.version}`), 'CITATION.cff: version does not match package.json');
assert(citation.includes(`repository-code: "${REPOSITORY}"`), 'CITATION.cff: repository URL is incorrect');
assert(citation.includes(`url: "${HOMEPAGE}"`), 'CITATION.cff: homepage is incorrect');
assert(includesPosition(citation), 'CITATION.cff: abstract must use the approved product position');

const staleClaims = [
  /Professional one-shot/i,
  /full headless/i,
  /five-sheet/i,
  /six bundled sheets/i,
  /32-column/i,
  /full accessibility audit/i
];
for (const [path, contents] of publicText) {
  for (const claim of staleClaims) {
    assert(!claim.test(contents), `${path}: contains stale or misleading wording ${claim}`);
  }
}

for (const [path, contents] of publicText) {
  if (['action.yml', 'skills/run-accessibility-audit/references/reporting.md'].includes(path)) continue;
  if (path.endsWith('.json')) continue;
  assert(includesPosition(contents), `${path}: approved product position is missing`);
}

assert(
  (await read('skills/run-accessibility-audit/references/reporting.md')).includes('seven bundled sheets'),
  'reporting reference: workbook sheet count must be seven'
);
assert(
  (await read('scripts/build-marketplace-payload.mjs')).includes('seven purpose-built sheets'),
  'marketplace generator: workbook sheet count must be seven'
);

if (errors.length > 0) {
  throw new Error(`Product metadata validation failed:\n- ${errors.join('\n- ')}`);
}

process.stdout.write(`Product metadata is consistent for ${PRODUCT_NAME} ${packageJson.version}.\n`);
