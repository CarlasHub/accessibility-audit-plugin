import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const baselinePath = resolve(repositoryRoot, 'tests', 'fixtures', 'buggyland-regression.json');
const outputRoot = resolve(process.env.BUGGYLAND_OUTPUT_DIR ?? resolve(repositoryRoot, 'buggyland-regression-results'));
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function run(command, arguments_, label) {
  const child = spawn(command, arguments_, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit'
  });
  const [status, signal] = await once(child, 'exit');
  if (status !== 0) {
    throw new Error(`${label} failed${signal ? ` after ${signal}` : ` with exit code ${status}`}.`);
  }
}

await mkdir(outputRoot, { recursive: true });
const reportPaths = [];
for (const runNumber of [1, 2]) {
  const outputDirectory = resolve(outputRoot, `run-${runNumber}`);
  await rm(outputDirectory, { recursive: true, force: true });
  await run(executable, [
    'run',
    'audit',
    '--',
    ...baseline.urls,
    '--yes',
    '--auditor',
    'CarlasHub BuggyLand regression',
    '--landing-page',
    baseline.urls[0],
    '--output',
    outputDirectory,
    '--allow-host',
    'carlashub.github.io',
    '--no-screenshots',
    '--no-auto-install-browser',
    '--concurrency',
    '2',
    '--timeout',
    '30000'
  ], `BuggyLand audit run ${runNumber}`);
  reportPaths.push(resolve(outputDirectory, 'audit-results.json'));
}

await run(
  process.execPath,
  [resolve(scriptDirectory, 'verify-buggyland-regression.mjs'), ...reportPaths],
  'BuggyLand exact regression gate'
);

process.stdout.write(`BuggyLand evidence is available in ${outputRoot}.\n`);
