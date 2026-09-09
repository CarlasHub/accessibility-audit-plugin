import { join } from 'node:path';
import { ensureInstalled, resolvePluginDataRoot, resolvePluginRoot } from '../lib/install.mjs';

function log(message) {
  process.stderr.write(`[accessibility-audit] ${message}\n`);
}

try {
  const pluginRoot = resolvePluginRoot();
  const dataRoot = resolvePluginDataRoot();
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dataRoot, 'browsers');
  await ensureInstalled(pluginRoot, { dataRoot, log });
} catch (error) {
  log(`Runtime preparation did not complete: ${error instanceof Error ? error.message : String(error)}`);
  log('The MCP launcher will retry when an audit tool is first used.');
}
