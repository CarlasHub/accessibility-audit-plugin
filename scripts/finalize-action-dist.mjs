import { cp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const actionDist = resolve(process.cwd(), 'action', 'dist');
const relocatedWorkspace = resolve(actionDist, 'Accessibility-audit-plugin');

// Remove any workspace asset ncc may have traced. Runtime-generated reports
// and local release artifacts are not Action dependencies and must not ship.
await rm(relocatedWorkspace, { recursive: true, force: true });

// Playwright loads its package metadata and browser registry dynamically, and
// axe-core's browser source must remain byte-for-byte executable. Ship these
// runtime packages beside the bundle so the committed Action is self-contained.
const actionNodeModules = resolve(actionDist, 'node_modules');
await rm(actionNodeModules, { recursive: true, force: true });
for (const packageName of ['axe-core', 'playwright', 'playwright-core']) {
  await cp(
    resolve(process.cwd(), 'node_modules', packageName),
    resolve(actionNodeModules, packageName),
    { recursive: true }
  );
}

const indexPath = resolve(actionDist, 'index.js');
if (!(await stat(indexPath)).isFile()) throw new Error('The GitHub Action bundle is missing index.js.');

// ncc follows the ESM entry point, while Playwright contains a few bundled
// CommonJS modules that still expect these Node globals.
const nodeGlobals = [
  'import { fileURLToPath as __actionFileURLToPath } from "node:url";',
  'import { dirname as __actionDirname } from "node:path";',
  'const __filename = __actionFileURLToPath(import.meta.url);',
  'const __dirname = __actionDirname(__filename);',
  ''
].join('\n');
const bundledSource = await readFile(indexPath, 'utf8');
await writeFile(indexPath, `${nodeGlobals}${bundledSource}`, 'utf8');
await writeFile(resolve(actionDist, 'package.json'), '{"type":"module"}\n', 'utf8');

const emitted = await readdir(actionDist, { recursive: true });
const forbidden = emitted.filter((entry) => /\.(?:zip|tgz|xlsx)$/i.test(entry));
if (forbidden.length > 0) {
  throw new Error(`The GitHub Action bundle contains forbidden release or report artifacts: ${forbidden.join(', ')}`);
}
