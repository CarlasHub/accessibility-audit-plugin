const path = require('node:path');
const { pathToFileURL } = require('node:url');

const requested = process.argv[2];
if (!requested || !/^[a-zA-Z0-9._-]+\.mjs$/.test(requested)) {
  process.stderr.write('[accessibility-audit] Hook launcher requires a local .mjs filename.\n');
  process.exitCode = 1;
} else {
  const rawRoot = process.env.CLAUDE_PLUGIN_ROOT
    || process.env.COPILOT_PLUGIN_ROOT
    || process.env.PLUGIN_ROOT
    || process.cwd();
  const pluginRoot = process.platform === 'win32' && /^\/[a-zA-Z]\//.test(rawRoot)
    ? `${rawRoot[1].toUpperCase()}:${rawRoot.slice(2)}`
    : rawRoot;
  import(pathToFileURL(path.join(pluginRoot, '_runtime', 'hooks', requested)).href).catch((error) => {
    process.stderr.write(`[accessibility-audit] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
