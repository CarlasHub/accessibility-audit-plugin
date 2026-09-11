import { buildWorkflow, normalizeGitHubRepository, normalizeTargetUrls } from '../../site/workflow.js';

interface KeyValueStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface ConnectorEnvironment {
  ALLOWED_ORIGINS: string;
  GITHUB_APP_SLUG: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSIONS: KeyValueStore;
  STATE_SECRET?: string;
}

interface GitHubRepository {
  archived: boolean;
  default_branch: string;
  full_name: string;
  name: string;
  owner: { login: string };
  permissions?: { admin?: boolean; push?: boolean };
  private: boolean;
}

interface GitHubInstallation {
  id: number;
}

interface StoredSession {
  expiresAt: number;
  token: string;
}

interface SignedState {
  expiresAt: number;
  nonce: string;
  returnTo: string;
}

const API_VERSION = '2022-11-28';
const SESSION_SECONDS = 60 * 60;
const WORKFLOW_PATH = '.github/workflows/accessibility-audit.yml';
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function allowedOrigins(environment: ConnectorEnvironment): Set<string> {
  return new Set(
    (environment.ALLOWED_ORIGINS || '').split(',')
      .map((origin) => origin.trim().replace(/\/$/u, ''))
      .filter(Boolean)
  );
}

function requireEnvironment(environment: ConnectorEnvironment): void {
  if (
    allowedOrigins(environment).size === 0
    || !environment.GITHUB_APP_SLUG?.trim()
    || environment.GITHUB_APP_SLUG.includes('REPLACE_WITH')
    || !environment.GITHUB_CLIENT_ID?.trim()
    || !environment.GITHUB_CLIENT_SECRET?.trim()
    || !environment.SESSIONS
  ) {
    throw new Error('The GitHub connector is not configured.');
  }
}

export function validateReturnUrl(rawUrl: string, environment: ConnectorEnvironment): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('The return address is invalid.');
  }

  if (!allowedOrigins(environment).has(url.origin) || url.username || url.password) {
    throw new Error('The return address is not allowed.');
  }
  url.hash = '';
  return url;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function bytesToBase64(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function utf8ToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToUtf8(value: string): string {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign']
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function createSignedState(state: SignedState, environment: ConnectorEnvironment): Promise<string> {
  const payload = utf8ToBase64Url(JSON.stringify(state));
  const signature = await sign(payload, environment.STATE_SECRET || environment.GITHUB_CLIENT_SECRET);
  return `${payload}.${signature}`;
}

export async function verifySignedState(value: string, environment: ConnectorEnvironment): Promise<SignedState> {
  const [payload, suppliedSignature, ...extra] = value.split('.');
  if (!payload || !suppliedSignature || extra.length > 0) throw new Error('The GitHub sign-in request is invalid.');
  const expectedSignature = await sign(payload, environment.STATE_SECRET || environment.GITHUB_CLIENT_SECRET);
  if (!timingSafeEqual(suppliedSignature, expectedSignature)) throw new Error('The GitHub sign-in request is invalid.');

  let state: SignedState;
  try {
    state = JSON.parse(base64UrlToUtf8(payload)) as SignedState;
  } catch {
    throw new Error('The GitHub sign-in request is invalid.');
  }
  if (
    typeof state.expiresAt !== 'number'
    || state.expiresAt < Date.now()
    || typeof state.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{20,}$/u.test(state.nonce)
    || typeof state.returnTo !== 'string'
  ) {
    throw new Error('The GitHub sign-in request has expired.');
  }
  validateReturnUrl(state.returnTo, environment);
  return state;
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function securityHeaders(): HeadersInit {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  };
}

function jsonResponse(payload: unknown, status = 200, origin?: string): Response {
  const headers = new Headers({ ...JSON_HEADERS, ...securityHeaders() });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(payload), { headers, status });
}

function redirectResponse(location: string): Response {
  return new Response(null, { headers: { ...securityHeaders(), Location: location }, status: 302 });
}

function requestOrigin(request: Request, environment: ConnectorEnvironment): string | null {
  const origin = request.headers.get('Origin')?.replace(/\/$/u, '') ?? '';
  return allowedOrigins(environment).has(origin) ? origin : null;
}

async function githubRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('User-Agent', 'CarlasHub-accessibility-audit-connector');
  headers.set('X-GitHub-Api-Version', API_VERSION);
  if (init.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(`https://api.github.com${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const githubMessage = typeof payload === 'object' && payload !== null && 'message' in payload
      && typeof payload.message === 'string'
      ? payload.message
      : 'GitHub rejected the request.';
    const error = new Error(githubMessage) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

async function readSession(request: Request, environment: ConnectorEnvironment): Promise<StoredSession> {
  const authorization = request.headers.get('Authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/u.exec(authorization);
  if (!match?.[1]) throw Object.assign(new Error('Connect your GitHub account again.'), { status: 401 });

  const stored = await environment.SESSIONS.get(`session:${match[1]}`);
  if (!stored) throw Object.assign(new Error('Your GitHub connection has expired. Connect again.'), { status: 401 });

  let session: StoredSession;
  try {
    session = JSON.parse(stored) as StoredSession;
  } catch {
    throw Object.assign(new Error('Your GitHub connection has expired. Connect again.'), { status: 401 });
  }
  if (!session.token || session.expiresAt < Date.now()) {
    throw Object.assign(new Error('Your GitHub connection has expired. Connect again.'), { status: 401 });
  }
  return session;
}

async function listRepositories(token: string): Promise<GitHubRepository[]> {
  const installations = await githubRequest<{ installations: GitHubInstallation[] }>(
    token,
    '/user/installations?per_page=100'
  );
  const repositories = new Map<string, GitHubRepository>();
  let repositoryRequests = 0;

  for (const installation of installations.installations) {
    for (let page = 1; page <= 10; page += 1) {
      if (repositoryRequests >= 40) {
        throw Object.assign(
          new Error('Too many repositories were returned. Limit this GitHub App to the repositories you want to audit.'),
          { status: 422 }
        );
      }
      repositoryRequests += 1;
      const result = await githubRequest<{ repositories: GitHubRepository[] }>(
        token,
        `/user/installations/${installation.id}/repositories?per_page=100&page=${page}`
      );
      for (const repository of result.repositories) {
        if (!repository.archived && (repository.permissions?.push || repository.permissions?.admin)) {
          repositories.set(repository.full_name.toLowerCase(), repository);
        }
      }
      if (result.repositories.length < 100) break;
    }
  }

  return [...repositories.values()].sort((left, right) => left.full_name.localeCompare(right.full_name));
}

function encodeRepositoryPath(owner: string, repository: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
}

function decodeGitHubContent(content: string): string {
  const binary = atob(content.replaceAll('\n', ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export function encodeGitHubContent(content: string): string {
  return bytesToBase64(new TextEncoder().encode(content));
}

async function createWorkflowIfSafe(
  token: string,
  repository: GitHubRepository,
  workflow: string
): Promise<boolean> {
  const repositoryPath = encodeRepositoryPath(repository.owner.login, repository.name);
  const contentPath = `${repositoryPath}/contents/${WORKFLOW_PATH.split('/').map(encodeURIComponent).join('/')}`;
  let existing: { content?: string; type?: string } | null = null;

  try {
    existing = await githubRequest(token, contentPath);
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
  }

  if (existing) {
    if (existing.type !== 'file' || !existing.content || decodeGitHubContent(existing.content) !== workflow) {
      throw Object.assign(
        new Error('This repository already has a different accessibility-audit workflow. Review it manually; nothing was overwritten.'),
        { status: 409 }
      );
    }
    return false;
  }

  await githubRequest(token, contentPath, {
    body: JSON.stringify({
      branch: repository.default_branch,
      content: encodeGitHubContent(workflow),
      message: 'Add CarlasHub accessibility audit workflow'
    }),
    method: 'PUT'
  });
  return true;
}

async function dispatchWorkflow(
  token: string,
  repository: GitHubRepository,
  urls: string[],
  wasCreated: boolean
): Promise<void> {
  const path = `${encodeRepositoryPath(repository.owner.login, repository.name)}/actions/workflows/accessibility-audit.yml/dispatches`;
  const attempts = wasCreated ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await githubRequest(token, path, {
        body: JSON.stringify({ inputs: { urls: urls.join('\n') }, ref: repository.default_branch }),
        method: 'POST'
      });
      return;
    } catch (error) {
      if ((error as { status?: number }).status !== 404 || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
}

async function startAuthorization(request: Request, environment: ConnectorEnvironment): Promise<Response> {
  const requestUrl = new URL(request.url);
  const returnTo = validateReturnUrl(requestUrl.searchParams.get('return_to') ?? '', environment);
  const callback = new URL('/auth/github/callback', requestUrl.origin);
  const state = await createSignedState({
    expiresAt: Date.now() + 10 * 60 * 1000,
    nonce: randomToken(20),
    returnTo: returnTo.href
  }, environment);
  const githubUrl = new URL('https://github.com/login/oauth/authorize');
  githubUrl.searchParams.set('client_id', environment.GITHUB_CLIENT_ID);
  githubUrl.searchParams.set('redirect_uri', callback.href);
  githubUrl.searchParams.set('state', state);
  return redirectResponse(githubUrl.href);
}

async function finishAuthorization(request: Request, environment: ConnectorEnvironment): Promise<Response> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code') ?? '';
  const state = await verifySignedState(requestUrl.searchParams.get('state') ?? '', environment);
  if (!/^[A-Za-z0-9_-]{10,}$/u.test(code)) throw new Error('GitHub did not return a valid authorization code.');

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    body: JSON.stringify({
      client_id: environment.GITHUB_CLIENT_ID,
      client_secret: environment.GITHUB_CLIENT_SECRET,
      code
    }),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    method: 'POST'
  });
  const tokenPayload = await tokenResponse.json() as { access_token?: string; error_description?: string };
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error(tokenPayload.error_description || 'GitHub sign-in could not be completed.');
  }

  const sessionId = randomToken();
  await environment.SESSIONS.put(
    `session:${sessionId}`,
    JSON.stringify({ expiresAt: Date.now() + SESSION_SECONDS * 1000, token: tokenPayload.access_token }),
    { expirationTtl: SESSION_SECONDS }
  );
  const returnTo = validateReturnUrl(state.returnTo, environment);
  returnTo.hash = `github_session=${sessionId}`;
  return redirectResponse(returnTo.href);
}

async function listRepositoryOptions(request: Request, environment: ConnectorEnvironment, origin: string): Promise<Response> {
  const session = await readSession(request, environment);
  const repositories = await listRepositories(session.token);
  return jsonResponse({
    repositories: repositories.map((repository) => ({
      archived: repository.archived,
      defaultBranch: repository.default_branch,
      fullName: repository.full_name,
      private: repository.private
    }))
  }, 200, origin);
}

async function setUpAudit(request: Request, environment: ConnectorEnvironment, origin: string): Promise<Response> {
  if (Number(request.headers.get('Content-Length') || 0) > 20_000) {
    return jsonResponse({ message: 'The request is too large.' }, 413, origin);
  }
  const session = await readSession(request, environment);
  let payload: { repository?: unknown; urls?: unknown };
  try {
    payload = await request.json() as { repository?: unknown; urls?: unknown };
  } catch {
    return jsonResponse({ message: 'Send the repository and page URLs as valid JSON.' }, 400, origin);
  }
  if (typeof payload.repository !== 'string' || !Array.isArray(payload.urls)
    || !payload.urls.every((value) => typeof value === 'string')) {
    return jsonResponse({ message: 'Choose a repository and provide valid page URLs.' }, 400, origin);
  }

  let requestedRepository: ReturnType<typeof normalizeGitHubRepository>;
  let targets: ReturnType<typeof normalizeTargetUrls>;
  try {
    requestedRepository = normalizeGitHubRepository(payload.repository);
    targets = normalizeTargetUrls(payload.urls);
  } catch (error) {
    return jsonResponse({
      message: error instanceof Error ? error.message : 'Check the repository and page URLs.'
    }, 400, origin);
  }
  const repositories = await listRepositories(session.token);
  const repository = repositories.find((candidate) => candidate.full_name.toLowerCase() === requestedRepository.slug.toLowerCase());
  if (!repository) {
    return jsonResponse({ message: 'That repository is not writable or has not been shared with this GitHub App.' }, 403, origin);
  }

  const workflow = buildWorkflow(targets);
  const workflowCreated = await createWorkflowIfSafe(session.token, repository, workflow);
  await dispatchWorkflow(session.token, repository, targets.map((target) => target.url), workflowCreated);
  return jsonResponse({
    actionsUrl: `https://github.com/${repository.full_name}/actions/workflows/accessibility-audit.yml`,
    repository: repository.full_name,
    workflowCreated
  }, 200, origin);
}

async function handleRequest(request: Request, environment: ConnectorEnvironment): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/auth/github/start') {
    return startAuthorization(request, environment);
  }
  if (request.method === 'GET' && url.pathname === '/auth/github/callback') {
    return finishAuthorization(request, environment);
  }

  const origin = requestOrigin(request, environment);
  if (!origin) return jsonResponse({ message: 'This website is not allowed to use the connector.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { headers: jsonResponse({}, 200, origin).headers, status: 204 });
  if (request.method === 'GET' && url.pathname === '/api/repositories') {
    return listRepositoryOptions(request, environment, origin);
  }
  if (request.method === 'POST' && url.pathname === '/api/setup') {
    return setUpAudit(request, environment, origin);
  }
  return jsonResponse({ message: 'Not found.' }, 404, origin);
}

export default {
  async fetch(request: Request, environment: ConnectorEnvironment): Promise<Response> {
    try {
      requireEnvironment(environment);
      return await handleRequest(request, environment);
    } catch (error) {
      const status = (error as { status?: number }).status;
      const safeStatus = status && [400, 401, 403, 404, 409, 422].includes(status) ? status : 500;
      const message = safeStatus === 500
        ? 'The GitHub connector could not complete this request. Try again.'
        : error instanceof Error ? error.message : 'The request could not be completed.';
      const origin = requestOrigin(request, environment) ?? undefined;
      return jsonResponse({ message }, safeStatus, origin);
    }
  }
};
