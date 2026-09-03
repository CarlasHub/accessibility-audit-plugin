import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const outputRoot = join(root, 'marketplace', 'rai-ops-plugin-marketplace');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const harnesses = [
  { directory: 'claude', name: 'accessibility-audit', manifest: '.claude-plugin/plugin.json' },
  { directory: 'copilot-cli', name: 'accessibility-audit', manifest: 'plugin.json' },
  { directory: 'copilot-vscode', name: 'accessibility-audit-vscode', manifest: '.claude-plugin/plugin.json' }
];
const failures = [];
const runtimeDigests = [];
const runtimeTarballs = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function jsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    failures.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

for (const harness of harnesses) {
  const harnessRoot = join(outputRoot, 'accessibility-audit', harness.directory);
  const manifest = await jsonFile(join(harnessRoot, harness.manifest));
  const install = await jsonFile(join(harnessRoot, 'install-manifest.json'));
  const mcp = await jsonFile(join(harnessRoot, '.mcp.json'));
  check(manifest?.name === harness.name, `${harness.directory}: plugin name must be ${harness.name}.`);
  check(manifest?.version === packageJson.version, `${harness.directory}: plugin version must match package.json.`);
  check(manifest?.skills === './skills/', `${harness.directory}: skills path is missing or invalid.`);
  check(manifest?.mcpServers === './.mcp.json', `${harness.directory}: MCP path is missing or invalid.`);
  check(install?.version === packageJson.version, `${harness.directory}: install manifest version must match package.json.`);
  check(install?.packageName === packageJson.name, `${harness.directory}: package name must match package.json.`);
  if (install?.sha256) runtimeDigests.push(install.sha256);
  if (install?.tarball) runtimeTarballs.push(install.tarball);
  check(mcp?.mcpServers?.['accessibility-audit']?.command === 'node', `${harness.directory}: MCP server must use Node.`);
  check(mcp?.mcpServers?.['accessibility-audit']?.args?.some((argument) => String(argument).includes('launch-mcp.mjs')), `${harness.directory}: MCP server must use the isolated launcher.`);

  if (!install?.tarball) continue;
  const tarball = join(harnessRoot, '_install-source', install.tarball);
  try {
    check((await stat(tarball)).isFile(), `${harness.directory}: packaged runtime is not a file.`);
    check(await sha256(tarball) === install.sha256, `${harness.directory}: packaged runtime checksum does not match.`);
    const { stdout } = await execFileAsync('tar', ['-tzf', tarball], { maxBuffer: 4 * 1024 * 1024 });
    const entries = stdout.split('\n').filter(Boolean);
    check(entries.includes('package/dist/mcp.js'), `${harness.directory}: packaged runtime is missing dist/mcp.js.`);
    check(entries.includes('package/assets/accessibility-report-template.xlsx'), `${harness.directory}: packaged runtime is missing the Excel template.`);
    check(entries.some((entry) => entry.startsWith('package/node_modules/@modelcontextprotocol/sdk/')), `${harness.directory}: packaged runtime is missing bundled production dependencies.`);
    check(!entries.some((entry) => /guidepup/i.test(entry)), `${harness.directory}: packaged runtime contains removed Guidepup files.`);
  } catch (error) {
    failures.push(`${harness.directory}: cannot validate packaged runtime: ${error instanceof Error ? error.message : String(error)}`);
  }
}

check(new Set(runtimeDigests).size === 1, 'All harness payloads must use the same runtime checksum.');
check(new Set(runtimeTarballs).size === 1, 'All harness payloads must use the same runtime archive name.');

const claudeHooks = await jsonFile(join(outputRoot, 'accessibility-audit', 'claude', 'hooks', 'hooks.json'));
check(Array.isArray(claudeHooks?.hooks?.SessionStart), 'claude: SessionStart hook is missing.');
const copilotHooks = await jsonFile(join(outputRoot, 'accessibility-audit', 'copilot-cli', 'hooks', 'hooks.json'));
check(copilotHooks?.version === 1, 'copilot-cli: hooks version must be 1.');
check(Array.isArray(copilotHooks?.hooks?.sessionStart), 'copilot-cli: sessionStart hook is missing.');
const vscodeHooks = await jsonFile(join(outputRoot, 'accessibility-audit', 'copilot-vscode', 'hooks', 'hooks.json'));
check(Array.isArray(vscodeHooks?.hooks?.SessionStart), 'copilot-vscode: SessionStart hook is missing.');

const claudeCatalog = await jsonFile(join(outputRoot, 'catalog-fragments', 'claude.json'));
check(claudeCatalog?.name === 'accessibility-audit', 'Claude catalog fragment has the wrong name.');
check(claudeCatalog?.source?.path === 'accessibility-audit/claude', 'Claude catalog fragment has the wrong source path.');
const copilotCatalog = await jsonFile(join(outputRoot, 'catalog-fragments', 'copilot.json'));
check(Array.isArray(copilotCatalog) && copilotCatalog.length === 2, 'Copilot catalog fragment must contain CLI and VS Code entries.');
if (Array.isArray(copilotCatalog)) {
  check(copilotCatalog.every((entry) => entry.version === packageJson.version), 'Copilot catalog fragment versions must match package.json.');
  check(copilotCatalog.map((entry) => entry.name).join(',') === 'accessibility-audit,accessibility-audit-vscode', 'Copilot catalog entries must be in alphabetical order.');
}

async function inspectTextTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '_install-source') await inspectTextTree(filePath);
      continue;
    }
    if (!/\.(?:json|md|mjs|cjs)$/.test(entry.name)) continue;
    const contents = await readFile(filePath, 'utf8');
    check(!contents.includes('/Users/'), `${filePath}: generated payload contains a local machine path.`);
    check(!/guidepup/i.test(contents), `${filePath}: generated payload references removed Guidepup support.`);
  }
}

await inspectTextTree(outputRoot);

if (failures.length) {
  process.stderr.write(`Marketplace payload validation failed (${failures.length}):\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Marketplace payload ${packageJson.version} is valid for Claude, Copilot CLI, and Copilot in VS Code.\n`);
}
