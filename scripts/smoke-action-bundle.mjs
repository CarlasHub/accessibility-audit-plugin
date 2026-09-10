import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { URL } from 'node:url';

const root = process.cwd();
const actionDist = resolve(root, 'action', 'dist');
const actionEntry = resolve(actionDist, 'index.js');
const outputNames = [
  'output-dir',
  'report-path',
  'html-path',
  'json-path',
  'archive-path',
  'confirmed-findings',
  'review-findings',
  'blockers',
  'requested-pages',
  'audited-pages',
  'completed-pages',
  'partial-pages',
  'not-started-pages',
  'skipped-pages',
  'gate-result'
];

for (const requiredPath of [
  actionEntry,
  resolve(actionDist, 'node_modules', 'axe-core', 'package.json'),
  resolve(actionDist, 'node_modules', 'playwright', 'package.json'),
  resolve(actionDist, 'node_modules', 'playwright-core', 'package.json'),
  resolve(root, 'assets', 'accessibility-report-template.xlsx')
]) await access(requiredPath);

const emitted = await readdir(actionDist, { recursive: true });
const forbidden = emitted.filter((entry) => /\.(?:zip|tgz|xlsx)$/i.test(entry));
if (forbidden.length > 0) throw new Error(`The Action bundle contains release or report artifacts: ${forbidden.join(', ')}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runAction(environment, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [actionEntry], {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let cancellationScheduled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!cancellationScheduled && options.cancelWhen?.(stdout, stderr)) {
        cancellationScheduled = true;
        setTimeout(() => child.kill('SIGTERM'), 250);
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('close', (status, signal) => resolveRun({ status, signal, stdout, stderr, output: `${stdout}${stderr}` }));
  });
}

function parseOutputs(value) {
  return new Map(value.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

async function createRunWorkspace(parent, name) {
  const workspace = join(parent, name);
  await mkdir(workspace, { recursive: true });
  return {
    workspace,
    outputFile: join(workspace, 'github-output.txt'),
    summaryFile: join(workspace, 'github-summary.md')
  };
}

function actionEnvironment(run, targetUrl, overrides = {}) {
  const target = new URL(targetUrl);
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_ACTION_PATH: root,
    GITHUB_WORKSPACE: run.workspace,
    GITHUB_OUTPUT: run.outputFile,
    GITHUB_STEP_SUMMARY: run.summaryFile,
    INPUT_URLS: JSON.stringify([targetUrl]),
    INPUT_AUDITOR: 'CarlasHub Action E2E',
    'INPUT_WCAG-LEVEL': 'AAA',
    'INPUT_AAA-ADVISORY': 'true',
    'INPUT_OUTPUT-DIR': 'results',
    'INPUT_LANDING-PAGE-URL': `${target.protocol}//${target.host}/review`,
    'INPUT_ALLOWED-HOSTS': target.hostname,
    'INPUT_STAGING-ONLY': 'true',
    'INPUT_CAPTURE-SCREENSHOTS': 'false',
    'INPUT_BROWSER-CHANNEL': 'chromium',
    'INPUT_AUTO-INSTALL-BROWSER': 'false',
    INPUT_CONCURRENCY: '1',
    'INPUT_TIMEOUT-MS': '10000',
    'INPUT_REPORT-NAME': 'Action_E2E_Report.xlsx',
    'INPUT_FAIL-ON': 'none',
    'INPUT_COMMENT-ON-PR': 'false',
    'INPUT_GITHUB-TOKEN': '',
    ...overrides
  };
}

async function assertArtifacts(run, expectedGate) {
  const outputText = await readFile(run.outputFile, 'utf8');
  const outputs = parseOutputs(outputText);
  assert(
    outputNames.every((name) => outputs.has(name)) && outputs.size === outputNames.length,
    `The Action did not publish every declared output exactly once.\n${outputText}`
  );
  assert(outputs.get('gate-result') === expectedGate, `Expected gate ${expectedGate}, received ${outputs.get('gate-result')}.`);
  assert(outputs.get('output-dir') === join(run.workspace, 'results'), 'The output-dir output is not the resolved workspace path.');
  assert(outputs.get('report-path') === join(run.workspace, 'results', 'Action_E2E_Report.xlsx'), 'The custom report-name input was not used.');
  for (const name of ['report-path', 'html-path', 'json-path', 'archive-path']) await access(outputs.get(name));
  const archive = await readFile(outputs.get('archive-path'));
  assert(archive.subarray(0, 2).toString() === 'PK', 'The bundled Action produced an invalid ZIP archive.');
  const summary = await readFile(run.summaryFile, 'utf8');
  assert(summary.includes('CarlasHub WCAG accessibility audit'), 'The Action did not publish its job summary.');
  return { outputs, summary, report: JSON.parse(await readFile(outputs.get('json-path'), 'utf8')) };
}

const validation = await runAction({ GITHUB_ACTIONS: 'true', INPUT_URLS: '' });
assert(
  validation.status === 1 && validation.output.includes('The urls input must include at least one URL'),
  `The Action bundle did not produce the expected controlled validation error.\n${validation.output}`
);
assert(
  !/ReferenceError|Cannot find module|ERR_MODULE_NOT_FOUND/.test(validation.output),
  `The Action bundle failed to load a runtime dependency.\n${validation.output}`
);

const temporaryRoot = await mkdtemp(join(tmpdir(), 'carlashub-action-e2e-'));
const pullRequestComments = [];
const apiCalls = { post: 0, patch: 0, denied: 0 };
let serverPort = 0;
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${serverPort}`);
  const sendJson = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  };
  const readBody = () => new Promise((resolveBody) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => resolveBody(body ? JSON.parse(body) : {}));
  });

  if (url.pathname === '/review') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Review-only target</title></head><body><main><h1>Review target</h1><h3>Advisory heading-order example</h3><button type="button" aria-label="Small control" style="width:12px;height:12px"></button></main></body></html>');
    return;
  }
  if (url.pathname === '/defect') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Confirmed defect target</title></head><body><main><h1>Defect target</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main></body></html>');
    return;
  }
  if (url.pathname === '/redirect') {
    response.writeHead(302, { location: `http://localhost:${serverPort}/review` });
    response.end();
    return;
  }
  if (url.pathname === '/hang') return;

  if (/\/repos\/CarlasHub\/fixture\/issues\/17\/comments$/.test(url.pathname) && request.method === 'GET') {
    if (request.headers.authorization === 'Bearer denied-token') {
      apiCalls.denied += 1;
      sendJson(403, { message: 'Resource not accessible by integration' });
    } else sendJson(200, pullRequestComments);
    return;
  }
  if (/\/repos\/CarlasHub\/fixture\/issues\/17\/comments$/.test(url.pathname) && request.method === 'POST') {
    void readBody().then((body) => {
      apiCalls.post += 1;
      pullRequestComments.push({ id: 91, body: body.body, user: { type: 'Bot' } });
      sendJson(201, pullRequestComments[0]);
    });
    return;
  }
  if (url.pathname === '/repos/CarlasHub/fixture/issues/comments/91' && request.method === 'PATCH') {
    void readBody().then((body) => {
      apiCalls.patch += 1;
      pullRequestComments[0].body = body.body;
      sendJson(200, pullRequestComments[0]);
    });
    return;
  }
  sendJson(404, { message: 'Not found' });
});

try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The Action E2E server did not expose a TCP port.');
  serverPort = address.port;
  const origin = `http://127.0.0.1:${serverPort}`;
  const eventPath = join(temporaryRoot, 'pull-request-event.json');
  await writeFile(eventPath, JSON.stringify({ pull_request: { number: 17 } }), 'utf8');
  const prEnvironment = {
    GITHUB_API_URL: origin,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: 'CarlasHub/fixture',
    GITHUB_RUN_ID: '1234',
    GITHUB_SERVER_URL: 'https://github.com',
    'INPUT_COMMENT-ON-PR': 'true',
    'INPUT_GITHUB-TOKEN': 'test-token',
    'INPUT_FAIL-ON': 'serious'
  };

  const firstCommentRun = await createRunWorkspace(temporaryRoot, 'comment-create');
  const firstCommentExecution = await runAction(actionEnvironment(firstCommentRun, `${origin}/review`, prEnvironment));
  assert(firstCommentExecution.status === 0, `Review-only evidence incorrectly failed the confirmed-severity gate.\n${firstCommentExecution.output}`);
  const firstCommentArtifacts = await assertArtifacts(firstCommentRun, 'passed');
  assert(Number(firstCommentArtifacts.outputs.get('confirmed-findings')) === 0, 'The review-only fixture unexpectedly produced a confirmed finding.');
  assert(Number(firstCommentArtifacts.outputs.get('review-findings')) > 0, 'The review-only fixture did not exercise review classification.');

  const secondCommentRun = await createRunWorkspace(temporaryRoot, 'comment-update');
  const secondCommentExecution = await runAction(actionEnvironment(secondCommentRun, `${origin}/review`, prEnvironment));
  assert(secondCommentExecution.status === 0, `The PR comment update run failed.\n${secondCommentExecution.output}`);
  await assertArtifacts(secondCommentRun, 'passed');
  assert(apiCalls.post === 1 && apiCalls.patch === 1 && pullRequestComments.length === 1, 'The Action duplicated its pull-request comment instead of updating it.');

  const deniedRun = await createRunWorkspace(temporaryRoot, 'comment-denied');
  const deniedExecution = await runAction(actionEnvironment(deniedRun, `${origin}/review`, {
    ...prEnvironment,
    'INPUT_GITHUB-TOKEN': 'denied-token',
    'INPUT_FAIL-ON': 'none'
  }));
  assert(deniedExecution.status === 0, `Missing fork/comment permissions failed the audit.\n${deniedExecution.output}`);
  assert(deniedExecution.output.includes('Pull request comment skipped') && apiCalls.denied === 1, 'Denied comment permission was not reported as a graceful warning.');
  await assertArtifacts(deniedRun, 'not-evaluated');

  const failedGateRun = await createRunWorkspace(temporaryRoot, 'failed-gate');
  const failedGateExecution = await runAction(actionEnvironment(failedGateRun, `${origin}/defect`, { 'INPUT_FAIL-ON': 'serious' }));
  assert(failedGateExecution.status === 1, `A confirmed serious defect did not fail the configured gate.\n${failedGateExecution.output}`);
  const failedGateArtifacts = await assertArtifacts(failedGateRun, 'failed');
  assert(Number(failedGateArtifacts.outputs.get('confirmed-findings')) > 0, 'The gate failed without a confirmed finding.');

  const redirectRun = await createRunWorkspace(temporaryRoot, 'redirect-blocked');
  const redirectExecution = await runAction(actionEnvironment(redirectRun, `${origin}/redirect`, {
    'INPUT_BROWSER-CHANNEL': '',
    'INPUT_FAIL-ON': 'none'
  }));
  assert(redirectExecution.status === 0, `A blocked cross-host redirect prevented partial artifact generation.\n${redirectExecution.output}`);
  const redirectArtifacts = await assertArtifacts(redirectRun, 'not-evaluated');
  assert(Number(redirectArtifacts.outputs.get('partial-pages')) === 1, 'The disallowed redirect was not marked partial.');
  assert(
    JSON.stringify(redirectArtifacts.report).includes('localhost') && JSON.stringify(redirectArtifacts.report).toLowerCase().includes('allow'),
    'The redirect allowlist failure is missing from JSON evidence.'
  );

  const cancellationRun = await createRunWorkspace(temporaryRoot, 'cancelled');
  const cancellationExecution = await runAction(
    actionEnvironment(cancellationRun, `${origin}/hang`, {
      'INPUT_BROWSER-CHANNEL': '',
      'INPUT_TIMEOUT-MS': '60000'
    }),
    { cancelWhen: (stdout) => stdout.includes('Testing page 1/1') }
  );
  assert(cancellationExecution.status === 130, `The graceful cancellation path exited with ${cancellationExecution.status}.\n${cancellationExecution.output}`);
  assert(cancellationExecution.stderr.includes('writing partial audit artifacts'), 'The cancellation path did not announce graceful partial reporting.');
  const cancellationArtifacts = await assertArtifacts(cancellationRun, 'not-evaluated');
  assert(cancellationArtifacts.report.status === 'cancelled', 'Cancelled Action JSON is not marked cancelled.');
  assert(Number(cancellationArtifacts.outputs.get('not-started-pages')) + Number(cancellationArtifacts.outputs.get('partial-pages')) === 1, 'Cancelled page coverage is not accounted for.');
} finally {
  server.closeAllConnections?.();
  server.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write('GitHub Action built-bundle E2E passed: inputs, outputs, gates, artifacts, PR comments, redirects, and cancellation.\n');
