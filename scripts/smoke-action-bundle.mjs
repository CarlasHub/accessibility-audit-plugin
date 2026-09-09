import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const actionDist = resolve(root, 'action', 'dist');
const actionEntry = resolve(actionDist, 'index.js');

for (const requiredPath of [
  actionEntry,
  resolve(actionDist, 'node_modules', 'axe-core', 'package.json'),
  resolve(actionDist, 'node_modules', 'playwright', 'package.json'),
  resolve(actionDist, 'node_modules', 'playwright-core', 'package.json'),
  resolve(root, 'assets', 'accessibility-report-template.xlsx')
]) {
  await access(requiredPath);
}

const emitted = await readdir(actionDist, { recursive: true });
const forbidden = emitted.filter((entry) => /\.(?:zip|tgz|xlsx)$/i.test(entry));
if (forbidden.length > 0) {
  throw new Error(`The Action bundle contains release or report artifacts: ${forbidden.join(', ')}`);
}

function runAction(environment) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [actionEntry], {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('close', (status) => resolveRun({ status, output: `${stdout}${stderr}` }));
  });
}

const validation = await runAction({
  GITHUB_ACTIONS: 'true',
  INPUT_URLS: ''
});
if (validation.status !== 1 || !validation.output.includes('The urls input must include at least one URL')) {
  throw new Error(`The Action bundle did not produce the expected controlled validation error.\n${validation.output}`);
}
if (/ReferenceError|Cannot find module|ERR_MODULE_NOT_FOUND/.test(validation.output)) {
  throw new Error(`The Action bundle failed to load a runtime dependency.\n${validation.output}`);
}

const temporaryWorkspace = await mkdtemp(join(tmpdir(), 'carlashub-action-smoke-'));
const outputFile = join(temporaryWorkspace, 'github-output.txt');
const summaryFile = join(temporaryWorkspace, 'github-summary.md');
const server = createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html lang="en"><head><title>Action smoke test</title></head><body><main><h1>Audit target</h1><img src="/sample.png"></main></body></html>');
    return;
  }
  response.writeHead(404).end();
});

try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The smoke-test server did not expose a TCP port.');

  const execution = await runAction({
    GITHUB_ACTIONS: 'true',
    GITHUB_ACTION_PATH: root,
    GITHUB_WORKSPACE: temporaryWorkspace,
    GITHUB_OUTPUT: outputFile,
    GITHUB_STEP_SUMMARY: summaryFile,
    INPUT_URLS: `http://127.0.0.1:${address.port}/`,
    'INPUT_ALLOWED-HOSTS': '127.0.0.1',
    'INPUT_OUTPUT-DIR': 'results',
    'INPUT_WCAG-LEVEL': 'AAA',
    'INPUT_CAPTURE-SCREENSHOTS': 'false',
    'INPUT_AUTO-INSTALL-BROWSER': 'false',
    'INPUT_COMMENT-ON-PR': 'false',
    'INPUT_TIMEOUT-MS': '10000',
    'INPUT_FAIL-ON': 'none'
  });
  if (execution.status !== 0) {
    throw new Error(`The bundled Action could not complete a local audit.\n${execution.output}`);
  }

  const reportPath = join(temporaryWorkspace, 'results', 'Accessibility_Audit_Report.xlsx');
  const jsonPath = join(temporaryWorkspace, 'results', 'audit-results.json');
  const archivePath = join(temporaryWorkspace, 'results.zip');
  await Promise.all([access(reportPath), access(jsonPath), access(archivePath)]);
  const [archive, outputs, summary] = await Promise.all([
    readFile(archivePath),
    readFile(outputFile, 'utf8'),
    readFile(summaryFile, 'utf8')
  ]);
  if (archive.subarray(0, 2).toString() !== 'PK') throw new Error('The bundled Action produced an invalid ZIP archive.');
  const expectedOutputs = [
    `archive-path=${archivePath}`,
    'requested-pages=1',
    'audited-pages=1',
    'completed-pages=1',
    'partial-pages=0',
    'not-started-pages=0',
    'skipped-pages=0',
    'gate-result=not-evaluated'
  ];
  if (!expectedOutputs.every((output) => outputs.includes(output))) {
    throw new Error(`The bundled Action did not publish its expected outputs.\n${outputs}`);
  }
  if (!summary.includes('CarlasHub WCAG accessibility audit')) {
    throw new Error('The bundled Action did not publish the expected job summary.');
  }
} finally {
  server.close();
  await rm(temporaryWorkspace, { recursive: true, force: true });
}

process.stdout.write('GitHub Action bundle smoke test passed.\n');
