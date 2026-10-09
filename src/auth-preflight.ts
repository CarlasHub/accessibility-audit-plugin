import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { getDomain } from 'tldts';
import type { AuditOptions } from './types.js';
import { auditArchivePath } from './reporting/archive.js';

const MAX_STORAGE_STATE_BYTES = 10 * 1024 * 1024;
const MAX_COOKIE_EXPIRES_SECONDS = 253402300799;
const COOKIE_KEYS = new Set(['name', 'value', 'domain', 'path', 'expires', 'httpOnly', 'secure', 'sameSite']);
const ORIGIN_KEYS = new Set(['origin', 'localStorage']);
const LOCAL_STORAGE_KEYS = new Set(['name', 'value']);
const ROOT_KEYS = new Set(['cookies', 'origins']);

type AuthenticationScopeOptions = Pick<
  AuditOptions,
  'storageState' | 'allowedHosts' | 'exactHosts' | 'outputDir'
>;

export interface VerifiedStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

export interface AuthenticationPreflightResult {
  configured: boolean;
  scopedHostCount: number;
  stateDigest?: string;
  /** In-memory only. Never serialize this value into an audit artifact or log. */
  storageState?: VerifiedStorageState;
}

export class AuthenticationConfirmationStaleError extends Error {
  constructor() {
    super('The saved browser state changed after confirmation. No audit was started; review the updated pre-audit summary and confirm it again.');
    this.name = 'AuthenticationConfirmationStaleError';
  }
}

export function isAuthenticationConfirmationStaleError(error: unknown): error is AuthenticationConfirmationStaleError {
  return error instanceof AuthenticationConfirmationStaleError;
}

function failure(reason: string): Error {
  return new Error(`Authentication preflight failed: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function containsCookieControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function normalizeHost(value: string): string | null {
  const candidate = value.trim().replace(/^\.+|\.+$/g, '');
  if (!candidate || candidate.includes('*') || /[\s/@]/.test(candidate)) return null;
  const unwrappedIp = candidate.replace(/^\[|\]$/g, '');
  if (isIP(unwrappedIp) !== 0) return unwrappedIp.toLowerCase();
  try {
    const parsed = new URL(`http://${candidate}`);
    return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '') || null;
  } catch {
    return null;
  }
}

function normalizeConfiguredHost(value: string): string | null {
  const candidate = value.trim();
  try {
    const parsed = new URL(candidate.includes('://') ? candidate : `http://${candidate}`);
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) return null;
    return normalizeHost(parsed.hostname);
  } catch {
    return null;
  }
}

interface ApprovedHostScopes {
  exact: Set<string>;
  descendants: Set<string>;
}

function approvedOriginHost(host: string, approved: ApprovedHostScopes): boolean {
  if (approved.exact.has(host)) return true;
  return [...approved.descendants].some((scope) => host === scope || host.endsWith(`.${scope}`));
}

function isRegistrableCookieDomain(domain: string): boolean {
  if (isIP(domain) !== 0 || domain === 'localhost') return true;
  return getDomain(domain, { allowPrivateDomains: true }) !== null;
}

function approvedCookieDomain(domain: string, approved: ApprovedHostScopes): boolean {
  if (!isRegistrableCookieDomain(domain)) return false;
  if (isIP(domain) !== 0 || domain === 'localhost') {
    return approved.exact.has(domain) || approved.descendants.has(domain);
  }
  if ([...approved.exact].some((host) => domain === host || host.endsWith(`.${domain}`))) return true;
  return [...approved.descendants].some((scope) => (
    domain === scope || domain.endsWith(`.${scope}`) || scope.endsWith(`.${domain}`)
  ));
}

function approvedHostsFor(pages: string[], options: AuthenticationScopeOptions): ApprovedHostScopes {
  const exact = new Set<string>();
  const descendants = new Set<string>();
  for (const page of pages) {
    const host = normalizeHost(new URL(page).hostname);
    if (host) exact.add(host);
  }
  for (const configured of options.exactHosts) {
    const host = normalizeConfiguredHost(configured);
    if (host) exact.add(host);
  }
  for (const configured of options.allowedHosts) {
    const host = normalizeConfiguredHost(configured);
    if (host) descendants.add(host);
  }
  return { exact, descendants };
}

async function canonicalPotentialPath(path: string): Promise<string> {
  let cursor = resolve(path);
  const missing: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(cursor), ...missing.reverse());
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(basename(cursor));
      cursor = parent;
    }
  }
}

function isWithin(path: string, directory: string): boolean {
  const offset = relative(directory, path);
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset));
}

async function assertOutsideArtifacts(statePath: string, outputDir: string): Promise<void> {
  const canonicalState = await realpath(statePath);
  const canonicalOutput = await canonicalPotentialPath(outputDir);
  const canonicalArchive = await canonicalPotentialPath(auditArchivePath(outputDir));
  if (isWithin(canonicalState, canonicalOutput) || canonicalState === canonicalArchive) {
    throw failure('the saved browser state overlaps generated audit artifacts. Move it outside the output directory and portable archive path, then retry.');
  }
}

function deepFreezeStorageState(state: VerifiedStorageState): VerifiedStorageState {
  for (const cookie of state.cookies) Object.freeze(cookie);
  for (const origin of state.origins) {
    for (const entry of origin.localStorage) Object.freeze(entry);
    Object.freeze(origin.localStorage);
    Object.freeze(origin);
  }
  Object.freeze(state.cookies);
  Object.freeze(state.origins);
  return Object.freeze(state);
}

/**
 * Validates an opt-in Playwright storage-state file without exposing its path
 * or secret values. This runs before browser launch and report creation.
 */
export async function preflightAuthentication(
  options: AuthenticationScopeOptions,
  resolvedPages: string[]
): Promise<AuthenticationPreflightResult> {
  if (!options.storageState) return { configured: false, scopedHostCount: 0 };

  let contents: Buffer;
  try {
    await assertOutsideArtifacts(options.storageState, options.outputDir);
    const metadata = await stat(options.storageState);
    if (!metadata.isFile()) {
      throw failure('the saved browser state must be a regular file. Choose a valid Playwright storage-state file, then retry.');
    }
    if (metadata.size > MAX_STORAGE_STATE_BYTES) {
      throw failure('the saved browser state exceeds the 10 MiB safety limit. Create a minimal, least-privilege state file, then retry.');
    }
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw failure('the saved browser state is accessible to other local users. Restrict it to its owner (for example, chmod 600), then retry.');
    }
    contents = await readFile(options.storageState);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Authentication preflight failed:')) throw error;
    throw failure('the saved browser state could not be read. Check that it exists and is readable only by the audit operator, then retry.');
  }

  if (contents.byteLength > MAX_STORAGE_STATE_BYTES) {
    throw failure('the saved browser state exceeds the 10 MiB safety limit. Create a minimal, least-privilege state file, then retry.');
  }

  let state: unknown;
  try {
    state = JSON.parse(contents.toString('utf8')) as unknown;
  } catch {
    throw failure('the saved browser state is not valid JSON. Create a fresh Playwright storage-state file, then retry.');
  }
  if (!isRecord(state) || !hasOnlyKeys(state, ROOT_KEYS) || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw failure('the saved browser state does not have the supported Playwright cookies and origins shape. Create a fresh state file, then retry.');
  }

  const approvedHosts = approvedHostsFor(resolvedPages, options);
  const scopedHosts = new Set<string>();
  const cookies: VerifiedStorageState['cookies'] = [];
  for (const cookie of state.cookies) {
    if (
      !isRecord(cookie)
      || !hasOnlyKeys(cookie, COOKIE_KEYS)
      || typeof cookie.name !== 'string'
      || cookie.name.length === 0
      || typeof cookie.value !== 'string'
      || typeof cookie.domain !== 'string'
      || typeof cookie.path !== 'string'
      || !cookie.path.startsWith('/')
      || containsCookieControlCharacter(cookie.name)
      || containsCookieControlCharacter(cookie.value)
      || containsCookieControlCharacter(cookie.path)
      || typeof cookie.expires !== 'number'
      || !Number.isFinite(cookie.expires)
      || (cookie.expires !== -1 && (cookie.expires < 0 || cookie.expires > MAX_COOKIE_EXPIRES_SECONDS))
      || typeof cookie.httpOnly !== 'boolean'
      || typeof cookie.secure !== 'boolean'
      || !['Strict', 'Lax', 'None'].includes(String(cookie.sameSite))
    ) {
      throw failure('the saved browser state contains an invalid cookie entry. Create a fresh state file, then retry.');
    }
    const domain = normalizeHost(cookie.domain);
    if (!domain) {
      throw failure('the saved browser state contains an invalid cookie scope. Create a fresh state file, then retry.');
    }
    if (!approvedCookieDomain(domain, approvedHosts)) {
      throw failure('the saved browser state contains a cookie outside the approved audit hosts or on a public suffix. Use a host-scoped, least-privilege state file, then retry.');
    }
    cookies.push({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite as 'Strict' | 'Lax' | 'None'
    });
    scopedHosts.add(domain);
  }

  const origins: VerifiedStorageState['origins'] = [];
  for (const originEntry of state.origins) {
    if (!isRecord(originEntry) || !hasOnlyKeys(originEntry, ORIGIN_KEYS) || typeof originEntry.origin !== 'string' || !Array.isArray(originEntry.localStorage)) {
      throw failure('the saved browser state contains an invalid origin entry. Create a fresh state file, then retry.');
    }
    let origin: URL;
    try {
      origin = new URL(originEntry.origin);
    } catch {
      throw failure('the saved browser state contains an invalid origin scope. Create a fresh state file, then retry.');
    }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.origin !== originEntry.origin) {
      throw failure('the saved browser state contains an unsupported origin scope. Use a canonical HTTP(S) origin without embedded credentials, then retry.');
    }
    const localStorage: Array<{ name: string; value: string }> = [];
    for (const entry of originEntry.localStorage) {
      if (!isRecord(entry) || !hasOnlyKeys(entry, LOCAL_STORAGE_KEYS) || typeof entry.name !== 'string' || typeof entry.value !== 'string') {
        throw failure('the saved browser state contains an invalid local-storage entry. Create a fresh state file, then retry.');
      }
      localStorage.push({ name: entry.name, value: entry.value });
    }
    const host = normalizeHost(origin.hostname);
    if (!host || !approvedOriginHost(host, approvedHosts)) {
      throw failure('the saved browser state contains an origin outside the approved audit hosts. Use a host-scoped, least-privilege state file, then retry.');
    }
    origins.push({ origin: origin.origin, localStorage });
    scopedHosts.add(host);
  }

  if (scopedHosts.size === 0) {
    throw failure('the saved browser state contains no host-scoped session data. Create a fresh authenticated state file, then retry.');
  }

  return {
    configured: true,
    scopedHostCount: scopedHosts.size,
    stateDigest: createHash('sha256').update(contents).digest('hex'),
    storageState: deepFreezeStorageState({ cookies, origins })
  };
}

export async function resolveAuthenticationForExecution(
  options: AuthenticationScopeOptions,
  resolvedPages: string[],
  approved?: AuthenticationPreflightResult
): Promise<AuthenticationPreflightResult> {
  const current = await preflightAuthentication(options, resolvedPages);
  if (!approved) return current;
  if (approved.configured !== current.configured || approved.stateDigest !== current.stateDigest) {
    throw new AuthenticationConfirmationStaleError();
  }
  return approved;
}
