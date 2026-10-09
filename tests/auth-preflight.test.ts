import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  preflightAuthentication,
  resolveAuthenticationForExecution
} from '../src/auth-preflight.js';
import { resolveOptions } from '../src/config.js';
import { toActionableAuditError } from '../src/errors.js';
import { executeAudit } from '../src/service.js';

const temporaryDirectories: string[] = [];

function cookie(domain: string, value = 'secret-cookie') {
  return {
    name: 'session',
    value,
    domain,
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax'
  };
}

async function writeState(state: unknown, mode = 0o600): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'auth-preflight-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'session.json');
  await writeFile(path, typeof state === 'string' ? state : JSON.stringify(state));
  await chmod(path, mode);
  return { directory, path };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe('authentication preflight', () => {
  it('accepts private Playwright state scoped to the confirmed target hosts', async () => {
    const { path } = await writeState({
      cookies: [cookie('.example.test')],
      origins: [{ origin: 'https://preview.example.test', localStorage: [] }]
    });

    const result = await preflightAuthentication(
      resolveOptions({ storageState: path }),
      ['https://preview.example.test/account']
    );

    expect(result).toEqual(expect.objectContaining({
      configured: true,
      scopedHostCount: 2,
      stateDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
    }));
    expect(result.storageState).toEqual({
      cookies: [cookie('.example.test')],
      origins: [{ origin: 'https://preview.example.test', localStorage: [] }]
    });
    expect(Object.isFrozen(result.storageState)).toBe(true);
    expect(Object.isFrozen(result.storageState?.cookies[0])).toBe(true);
  });

  it('reports an unconfigured state without accessing the filesystem', async () => {
    await expect(preflightAuthentication(resolveOptions(), ['https://preview.example.test/']))
      .resolves.toEqual({ configured: false, scopedHostCount: 0 });
  });

  it.each([
    {
      name: 'malformed JSON',
      state: '{not-json',
      message: 'not valid JSON'
    },
    {
      name: 'an invalid Playwright shape',
      state: { cookies: [] },
      message: 'supported Playwright cookies and origins shape'
    },
    {
      name: 'an empty session',
      state: { cookies: [], origins: [] },
      message: 'no host-scoped session data'
    },
    {
      name: 'an out-of-scope cookie',
      state: { cookies: [cookie('outside.test', 'do-not-log')], origins: [] },
      message: 'cookie outside the approved audit hosts'
    },
    {
      name: 'an out-of-scope origin',
      state: { cookies: [], origins: [{ origin: 'https://outside.test', localStorage: [] }] },
      message: 'origin outside the approved audit hosts'
    },
    {
      name: 'an origin containing credentials',
      state: { cookies: [], origins: [{ origin: 'https://user:password@preview.example.test', localStorage: [] }] },
      message: 'unsupported origin scope'
    }
  ])('rejects $name without disclosing secrets or the local path', async ({ state, message }) => {
    const { path } = await writeState(state);

    await expect(preflightAuthentication(
      resolveOptions({ storageState: path }),
      ['https://preview.example.test/']
    )).rejects.toThrow(message);
    try {
      await preflightAuthentication(resolveOptions({ storageState: path }), ['https://preview.example.test/']);
    } catch (error) {
      const rendered = String(error);
      expect(rendered).not.toContain(path);
      expect(rendered).not.toContain('do-not-log');
      expect(rendered).not.toContain('password');
    }
  });

  it.runIf(process.platform !== 'win32')('rejects state readable by other local users', async () => {
    const { path } = await writeState({
      cookies: [cookie('preview.example.test', 'secret')],
      origins: []
    }, 0o644);

    await expect(preflightAuthentication(
      resolveOptions({ storageState: path }),
      ['https://preview.example.test/']
    )).rejects.toThrow('accessible to other local users');
  });

  it.each([
    { label: 'missing cookie fields', state: { cookies: [{ name: 'session', value: 'secret', domain: 'preview.example.test' }], origins: [] }, message: 'invalid cookie entry' },
    { label: 'invalid sameSite', state: { cookies: [{ ...cookie('preview.example.test'), sameSite: 'Maybe' }], origins: [] }, message: 'invalid cookie entry' },
    { label: 'negative persistent expiry', state: { cookies: [{ ...cookie('preview.example.test'), expires: -2 }], origins: [] }, message: 'invalid cookie entry' },
    { label: 'fractional negative expiry', state: { cookies: [{ ...cookie('preview.example.test'), expires: -1.5 }], origins: [] }, message: 'invalid cookie entry' },
    { label: 'expiry beyond Playwright maximum', state: { cookies: [{ ...cookie('preview.example.test'), expires: 253402300800 }], origins: [] }, message: 'invalid cookie entry' },
    { label: 'control character in cookie name', state: { cookies: [{ ...cookie('preview.example.test'), name: 'session\nname' }], origins: [] }, message: 'invalid cookie entry' },
    { label: 'control character in cookie value', state: { cookies: [{ ...cookie('preview.example.test'), value: 'secret\rvalue' }], origins: [] }, message: 'invalid cookie entry' },
    { label: 'control character in cookie path', state: { cookies: [{ ...cookie('preview.example.test'), path: '/account\tprivate' }], origins: [] }, message: 'invalid cookie entry' },
    { label: 'non-string localStorage value', state: { cookies: [], origins: [{ origin: 'https://preview.example.test', localStorage: [{ name: 'token', value: 123 }] }] }, message: 'invalid local-storage entry' },
    { label: 'unsupported extra state', state: { cookies: [cookie('preview.example.test')], origins: [], secretMetadata: 'private' }, message: 'supported Playwright cookies and origins shape' }
  ])('rejects $label before browser launch', async ({ state, message }) => {
    const { path } = await writeState(state);
    await expect(preflightAuthentication(
      resolveOptions({ storageState: path }),
      ['https://preview.example.test/']
    )).rejects.toThrow(message);
  });

  it.each([-1, 0, 0.5, 1, 253402300799])('accepts Playwright-compatible cookie expiry %s', async (expires) => {
    const { path } = await writeState({
      cookies: [{ ...cookie('preview.example.test'), expires }],
      origins: []
    });
    await expect(preflightAuthentication(
      resolveOptions({ storageState: path }),
      ['https://preview.example.test/']
    )).resolves.toEqual(expect.objectContaining({ configured: true }));
  });

  it('keeps exact targets exact while allowed hosts can authorize descendants', async () => {
    const { path } = await writeState({
      cookies: [],
      origins: [{ origin: 'https://child.preview.example.test', localStorage: [{ name: 'token', value: 'private' }] }]
    });

    await expect(preflightAuthentication(
      resolveOptions({ storageState: path }),
      ['https://preview.example.test/']
    )).rejects.toThrow('origin outside the approved audit hosts');
    await expect(preflightAuthentication(
      resolveOptions({ storageState: path, exactHosts: ['preview.example.test'] }),
      ['https://other.example.test/']
    )).rejects.toThrow('origin outside the approved audit hosts');
    await expect(preflightAuthentication(
      resolveOptions({ storageState: path, allowedHosts: ['preview.example.test'] }),
      ['https://other.example.test/']
    )).resolves.toEqual(expect.objectContaining({ configured: true }));
    await expect(preflightAuthentication(
      resolveOptions({ storageState: path, allowedHosts: ['https://preview.example.test/'] }),
      ['https://other.example.test/']
    )).resolves.toEqual(expect.objectContaining({ configured: true }));
  });

  it('rejects public-suffix cookies while allowing a registrable parent domain', async () => {
    const publicSuffix = await writeState({ cookies: [cookie('.co.uk')], origins: [] });
    await expect(preflightAuthentication(
      resolveOptions({ storageState: publicSuffix.path }),
      ['https://shop.example.co.uk/']
    )).rejects.toThrow('public suffix');

    const parent = await writeState({ cookies: [cookie('.example.co.uk')], origins: [] });
    await expect(preflightAuthentication(
      resolveOptions({ storageState: parent.path }),
      ['https://shop.example.co.uk/']
    )).resolves.toEqual(expect.objectContaining({ configured: true }));
  });

  it.each([
    ['localhost', 'http://localhost/'],
    ['127.0.0.1', 'http://127.0.0.1/'],
    ['::1', 'http://[::1]/']
  ])('allows an exact local cookie scope for %s', async (domain, page) => {
    const { path } = await writeState({ cookies: [cookie(domain)], origins: [] });
    await expect(preflightAuthentication(resolveOptions({ storageState: path }), [page]))
      .resolves.toEqual(expect.objectContaining({ configured: true }));
  });

  it('rejects state located inside output artifacts, including symlink aliases and the portable ZIP path', async () => {
    const direct = await writeState({ cookies: [cookie('preview.example.test')], origins: [] });
    const originalState = await readFile(direct.path);
    await expect(preflightAuthentication(
      resolveOptions({ storageState: direct.path, outputDir: direct.directory }),
      ['https://preview.example.test/']
    )).rejects.toThrow('overlaps generated audit artifacts');
    expect(await readFile(direct.path)).toEqual(originalState);
    await expect(stat(`${direct.directory}.zip`)).rejects.toMatchObject({ code: 'ENOENT' });

    const aliasParent = await mkdtemp(join(tmpdir(), 'auth-output-alias-'));
    temporaryDirectories.push(aliasParent);
    const alias = join(aliasParent, 'output-link');
    await symlink(direct.directory, alias, 'dir');
    await expect(preflightAuthentication(
      resolveOptions({ storageState: direct.path, outputDir: alias }),
      ['https://preview.example.test/']
    )).rejects.toThrow('overlaps generated audit artifacts');

    const archiveDirectory = await mkdtemp(join(tmpdir(), 'auth-archive-'));
    temporaryDirectories.push(archiveDirectory);
    const outputDir = join(archiveDirectory, 'audit-output');
    const archivePath = `${outputDir}.zip`;
    await writeFile(archivePath, JSON.stringify({ cookies: [cookie('preview.example.test')], origins: [] }));
    await chmod(archivePath, 0o600);
    await expect(preflightAuthentication(
      resolveOptions({ storageState: archivePath, outputDir }),
      ['https://preview.example.test/']
    )).rejects.toThrow('overlaps generated audit artifacts');
  });

  it('invalidates a confirmation when the state bytes change and creates no output', async () => {
    const { directory, path } = await writeState({ cookies: [cookie('preview.example.test', 'first')], origins: [] });
    const options = resolveOptions({ storageState: path, outputDir: join(directory, 'must-not-exist') });
    const approved = await preflightAuthentication(options, ['https://preview.example.test/']);
    await writeFile(path, JSON.stringify({ cookies: [cookie('preview.example.test', 'second')], origins: [] }));

    await expect(resolveAuthenticationForExecution(options, ['https://preview.example.test/'], approved))
      .rejects.toThrow('changed after confirmation');
    await expect(executeAudit({
      inputs: ['https://preview.example.test/'],
      options,
      authentication: approved
    })).rejects.toThrow('changed after confirmation');
    await expect(stat(options.outputDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails before creating report output when authentication state is unsafe', async () => {
    const { directory, path } = await writeState('{not-json');
    const outputDir = join(directory, 'must-not-exist');

    await expect(executeAudit({
      inputs: ['https://preview.example.test/'],
      options: { storageState: path, outputDir }
    })).rejects.toThrow('Authentication preflight failed');
    await expect(stat(outputDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('classifies failures with safe, actionable recovery guidance', () => {
    const classification = toActionableAuditError(new Error(
      'Authentication preflight failed: the saved browser state is not valid JSON.'
    ));

    expect(classification).toEqual(expect.objectContaining({
      code: 'authentication-preflight-failed',
      retryable: true
    }));
    expect(classification.nextSteps.join(' ')).not.toContain('session.json');
  });
});
