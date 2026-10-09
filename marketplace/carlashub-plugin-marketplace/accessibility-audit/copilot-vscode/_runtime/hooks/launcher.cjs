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
    import(pathToFileURL(path.join(pluginRoot, '_runtime', 'lib', 'safe-log.mjs')).href)
      .then(({ createSafeLogger }) => createSafeLogger()(error instanceof Error ? error.message : String(error)))
      .catch(() => process.stderr.write('[accessibility-audit] The requested hook could not be started.\n'));
    process.exitCode = 1;
  });
}
