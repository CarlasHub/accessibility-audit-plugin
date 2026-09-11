import type { GitHubRepository } from './workflow.js';

export interface ConnectorConfig {
  apiBaseUrl: string;
  githubAppSlug: string;
}

export interface GitHubRepositoryOption {
  archived: boolean;
  defaultBranch: string;
  fullName: string;
  private: boolean;
}

export interface RepositorySetupResult {
  actionsUrl: string;
  repository: string;
  workflowCreated: boolean;
}

declare global {
  interface Window {
    __A11Y_AUDIT_CONNECTOR__?: Partial<ConnectorConfig>;
  }
}

const SESSION_KEY = 'carlashub-a11y-github-session';
const DRAFT_KEY = 'carlashub-a11y-audit-draft';
const GITHUB_REQUEST_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMessage: string,
  fetchImplementation: typeof fetch = fetch
): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS);

  try {
    return await fetchImplementation(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function readConnectorConfig(): ConnectorConfig | null {
  const configured = window.__A11Y_AUDIT_CONNECTOR__;
  const apiBaseUrl = configured?.apiBaseUrl?.trim().replace(/\/$/u, '') ?? '';
  const githubAppSlug = configured?.githubAppSlug?.trim() ?? '';
  if (!apiBaseUrl || !githubAppSlug) return null;

  try {
    const apiUrl = new URL(apiBaseUrl);
    if (apiUrl.protocol !== 'https:' && apiUrl.hostname !== '127.0.0.1' && apiUrl.hostname !== 'localhost') {
      return null;
    }
  } catch {
    return null;
  }

  return { apiBaseUrl, githubAppSlug };
}

export function captureOAuthSession(location: Location = window.location): boolean {
  const hash = new URLSearchParams(location.hash.replace(/^#/u, ''));
  const session = hash.get('github_session');
  if (!session || !/^[A-Za-z0-9_-]{32,256}$/u.test(session)) return false;

  sessionStorage.setItem(SESSION_KEY, session);
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return true;
}

export function hasConnectorSession(): boolean {
  return Boolean(sessionStorage.getItem(SESSION_KEY));
}

export function clearConnectorSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function saveAuditDraft(urls: string[]): void {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(urls));
}

export function takeAuditDraft(): string[] | null {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  sessionStorage.removeItem(DRAFT_KEY);
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null;
    return value;
  } catch {
    return null;
  }
}

export function buildAuthorizationUrl(config: ConnectorConfig, returnTo = window.location.href): string {
  const url = new URL('/auth/github/start', `${config.apiBaseUrl}/`);
  const safeReturnUrl = new URL(returnTo);
  safeReturnUrl.hash = '';
  url.searchParams.set('return_to', safeReturnUrl.href);
  return url.href;
}

export function buildInstallationUrl(config: ConnectorConfig): string {
  return `https://github.com/apps/${encodeURIComponent(config.githubAppSlug)}/installations/new`;
}

async function connectorRequest<T>(
  config: ConnectorConfig,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const session = sessionStorage.getItem(SESSION_KEY);
  if (!session) throw new Error('Connect your GitHub account first.');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session}`);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');

  const response = await fetchWithTimeout(
    new URL(path, `${config.apiBaseUrl}/`),
    { ...init, headers },
    'GitHub took too long to respond. Nothing was changed; try again.'
  );
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearConnectorSession();
    const message = typeof payload === 'object' && payload !== null && 'message' in payload
      && typeof payload.message === 'string'
      ? payload.message
      : 'GitHub could not complete this request.';
    const error = new Error(message) as Error & { status?: number; details?: unknown };
    error.status = response.status;
    error.details = payload;
    throw error;
  }

  return payload as T;
}

export async function resolvePublicRepositoryDefaultBranch(
  repository: GitHubRepository,
  fetchImplementation: typeof fetch = fetch
): Promise<string> {
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,
    { headers: { Accept: 'application/vnd.github+json' } },
    'GitHub took too long to check this repository. Nothing was changed; try again.',
    fetchImplementation
  );

  if (response.status === 404) {
    throw new Error('GitHub could not find that public repository. Check owner/name. Private repositories require the connected repository chooser.');
  }
  if (!response.ok) {
    throw new Error('GitHub could not confirm this repository’s default branch. Nothing was changed; try again.');
  }

  const payload: unknown = await response.json();
  const branch = typeof payload === 'object' && payload !== null && 'default_branch' in payload
    && typeof payload.default_branch === 'string'
    ? payload.default_branch.trim()
    : '';
  if (!branch || branch.length > 255) {
    throw new Error('GitHub returned an invalid default branch for this repository.');
  }
  return branch;
}

export async function listAccessibleRepositories(config: ConnectorConfig): Promise<GitHubRepositoryOption[]> {
  const result = await connectorRequest<{ repositories: GitHubRepositoryOption[] }>(
    config,
    '/api/repositories'
  );
  return result.repositories;
}

export async function setUpAndRunAudit(
  config: ConnectorConfig,
  repository: string,
  urls: string[]
): Promise<RepositorySetupResult> {
  return connectorRequest<RepositorySetupResult>(config, '/api/setup', {
    method: 'POST',
    body: JSON.stringify({ repository, urls })
  });
}
