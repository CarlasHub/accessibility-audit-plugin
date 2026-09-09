import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const stagedRoot = join(root, 'marketplace', 'carlashub-plugin-marketplace');
const expectedRepository = 'https://github.com/CarlasHub/accessibility-audit-plugin';

const claudeFragment = JSON.parse(await readFile(join(stagedRoot, 'catalog-fragments', 'claude.json'), 'utf8'));
const copilotFragments = JSON.parse(await readFile(join(stagedRoot, 'catalog-fragments', 'copilot.json'), 'utf8'));

if (claudeFragment?.source?.url !== `${expectedRepository}.git`) {
  throw new Error('Claude catalog fragment does not point to the CarlasHub repository.');
}
if (claudeFragment?.source?.path !== 'marketplace/carlashub-plugin-marketplace/accessibility-audit/claude') {
  throw new Error('Claude catalog fragment has an unexpected repository subdirectory.');
}
if (!Array.isArray(copilotFragments) || copilotFragments.length !== 2) {
  throw new Error('Copilot catalog fragments are missing.');
}

for (const client of ['claude', 'copilot-cli', 'copilot-vscode']) {
  const clientRoot = join(stagedRoot, 'accessibility-audit', client);
  await access(join(clientRoot, 'install-manifest.json'));
  await access(join(clientRoot, '.mcp.json'));
  await access(join(clientRoot, 'README.md'));
}

process.stdout.write('Generated CarlasHub payload has compatible Claude and Copilot catalog metadata.\n');
