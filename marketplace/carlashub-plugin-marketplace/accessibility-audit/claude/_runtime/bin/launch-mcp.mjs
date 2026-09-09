import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ensureInstalled, resolvePluginDataRoot, resolvePluginRoot } from '../lib/install.mjs';

function log(message) {
  process.stderr.write(`[accessibility-audit] ${message}\n`);
}

const pluginRoot = resolvePluginRoot();
const dataRoot = resolvePluginDataRoot();
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dataRoot, 'browsers');

let runtime;
try {
  runtime = await ensureInstalled(pluginRoot, { dataRoot, log });
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  process.exit();
}

const child = spawn(process.execPath, [runtime.entrypoint], {
  cwd: runtime.packageRoot,
  env: process.env,
  stdio: ['inherit', 'inherit', 'inherit']
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}

child.once('error', (error) => {
  log(`Could not start the MCP server: ${error.message}`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
