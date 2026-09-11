const API_PATH = '/api/audits';
const MAX_AUDIT_TARGETS = 20;
const MAX_REQUEST_BYTES = 16_384;
const REPOSITORY = 'CarlasHub/accessibility-audit-plugin';
const WORKFLOW = 'accessibility-audit.yml';
const WORKFLOW_REF = 'main';
const WORKFLOW_PAGE = `https://github.com/${REPOSITORY}/actions/workflows/${WORKFLOW}`;
const GITHUB_API_VERSION = '2026-03-10';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

function isIpLiteral(hostname) {
  const unwrapped = hostname.replace(/^\[|\]$/g, '');
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(unwrapped) || unwrapped.includes(':');
}

function isPrivateHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return (
    normalized === 'localhost' ||
    normalized === 'metadata.google.internal' ||
    normalized === 'metadata.azure.internal' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.lan') ||
    isIpLiteral(normalized)
  );
}

export function normalizeAuditUrls(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Add at least one public HTTPS page.');
  }
  if (values.length > MAX_AUDIT_TARGETS) {
    throw new Error(`Add no more than ${MAX_AUDIT_TARGETS} pages per audit.`);
  }

  const seen = new Set();
  return values.map((value) => {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('Every page needs a complete HTTPS URL.');
    }

    let parsed;
    try {
      parsed = new URL(value.trim());
    } catch {
      throw new Error(`Enter a complete HTTPS URL: ${value.trim()}`);
    }

    if (parsed.protocol !== 'https:') {
      throw new Error(`One-click audits require HTTPS: ${parsed.href}`);
    }
    if (parsed.username || parsed.password) {
      throw new Error('URLs containing embedded credentials are not allowed.');
    }
    if (isPrivateHostname(parsed.hostname)) {
      throw new Error(`Use a public hostname instead of a private address: ${parsed.hostname}`);
    }

    parsed.hash = '';
    const normalized = parsed.href;
    if (seen.has(normalized)) throw new Error(`Remove the duplicate page: ${normalized}`);
    seen.add(normalized);
    return normalized;
  });
}

async function findWorkflowRun(githubFetch, token, requestId) {
  const listUrl = `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&branch=${WORKFLOW_REF}&per_page=20`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    const response = await githubFetch(listUrl, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': GITHUB_API_VERSION,
        'user-agent': 'CarlasHub-accessibility-audit-launcher'
      }
    });
    if (!response.ok) continue;
    const payload = await response.json();
    const run = payload.workflow_runs?.find((candidate) => candidate.display_title?.includes(requestId));
    if (run?.html_url) return run.html_url;
  }

  return null;
}

export async function handleAuditRequest(request, environment, githubFetch = globalThis.fetch) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== requestUrl.origin) {
    return jsonResponse({ error: 'This audit must be started from the CarlasHub launcher.' }, 403);
  }

  if (!request.headers.get('oai-authenticated-user-id')) {
    return jsonResponse({ error: 'Sign in to the CarlasHub launcher before starting an audit.' }, 401);
  }

  if (!environment.GITHUB_ACTIONS_TOKEN) {
    return jsonResponse({ error: 'The one-click launcher is not connected to GitHub yet. Use the workflow option below.' }, 503);
  }

  const declaredLength = Number(request.headers.get('content-length') || '0');
  if (declaredLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: 'The audit request is too large.' }, 413);
  }

  let body;
  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_REQUEST_BYTES) return jsonResponse({ error: 'The audit request is too large.' }, 413);
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Send the pages as valid JSON.' }, 400);
  }

  let urls;
  try {
    urls = normalizeAuditUrls(body?.urls);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Check the page URLs.' }, 400);
  }

  const requestId = globalThis.crypto.randomUUID();
  let dispatchResponse;
  try {
    dispatchResponse = await githubFetch(
      `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${environment.GITHUB_ACTIONS_TOKEN}`,
          'content-type': 'application/json',
          'x-github-api-version': GITHUB_API_VERSION,
          'user-agent': 'CarlasHub-accessibility-audit-launcher'
        },
        body: JSON.stringify({
          ref: WORKFLOW_REF,
          return_run_details: true,
          inputs: {
            'target-url': urls.join('\n'),
            'request-id': requestId
          }
        })
      }
    );
  } catch {
    return jsonResponse({ error: 'GitHub could not be reached. Try again or use the workflow option below.' }, 502);
  }

  if (!dispatchResponse.ok) {
    const message = [401, 403].includes(dispatchResponse.status)
      ? 'GitHub rejected the launcher credentials. The site owner needs to reconnect the Action.'
      : 'GitHub could not start the audit. Try again or use the workflow option below.';
    return jsonResponse({ error: message }, 502);
  }

  let runUrl = null;
  if (dispatchResponse.status !== 204) {
    try {
      const dispatchPayload = await dispatchResponse.json();
      const apiRunId = typeof dispatchPayload.run_url === 'string'
        ? dispatchPayload.run_url.match(/\/actions\/runs\/(\d+)$/)?.[1]
        : null;
      const runId = dispatchPayload.workflow_run_id || dispatchPayload.workflow_run?.id || apiRunId;
      runUrl = dispatchPayload.html_url || dispatchPayload.workflow_run?.html_url || null;
      if (!runUrl && runId) runUrl = `https://github.com/${REPOSITORY}/actions/runs/${runId}`;
    } catch {
      // Older GitHub responses have no body; the run lookup below handles them.
    }
  }
  if (!runUrl) {
    try {
      runUrl = await findWorkflowRun(githubFetch, environment.GITHUB_ACTIONS_TOKEN, requestId);
    } catch {
      runUrl = null;
    }
  }

  return jsonResponse({
    runUrl: runUrl || WORKFLOW_PAGE,
    exactRun: Boolean(runUrl),
    pages: urls.length
  }, 201);
}

export default {
  async fetch(request, environment) {
    const url = new URL(request.url);
    if (url.pathname === API_PATH) {
      if (request.method !== 'POST') {
        return new Response(null, { status: 405, headers: { allow: 'POST' } });
      }
      return handleAuditRequest(request, environment);
    }

    if (!environment.ASSETS || typeof environment.ASSETS.fetch !== 'function') {
      return new Response('Static assets are unavailable.', { status: 503 });
    }

    const response = await environment.ASSETS.fetch(request);
    if (response.status !== 404 || request.method !== 'GET') return response;
    if (url.pathname.includes('.')) return response;

    return environment.ASSETS.fetch(new Request(new URL('/', url), request));
  }
};
