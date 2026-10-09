import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findCredentialFindings,
  repositoryManifestPaths,
  scanCredentialFiles
} from '../scripts/lib/credential-safety.mjs';
import { createSafeLogger, redactLogMessage } from '../marketplace/runtime/lib/safe-log.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('credential safety', () => {
  it.each([
    ['plugin.json', '{"access_token":"manifest-secret"}', 'literal-sensitive-field'],
    ['plugin.json', '{"accessToken":"SENTINEL-CAMEL-VALUE"}', 'literal-sensitive-field'],
    ['plugin.json', '{"clientSecret":"SENTINEL-CLIENT-VALUE"}', 'literal-sensitive-field'],
    ['.mcp.json', '{"endpoint":"https://user:password@example.test/mcp"}', 'url-userinfo'],
    ['.mcp.json', '{"endpoint":"https://SENTINEL-USER@example.test/mcp"}', 'url-userinfo'],
    ['action.yml', 'authorization: Bearer abcdefghijklmnop', 'authorization-value'],
    ['action.yml', 'password: "SENTINEL QUOTED VALUE"', 'literal-sensitive-field'],
    ['plugin.json', '{"endpoint":"https://example.test/?access%255Ftoken=query-secret"}', 'sensitive-url-parameter'],
    ['plugin.json', '{"key":"-----BEGIN PRIVATE KEY-----"}', 'private-key'],
    ['plugin.json', '{"key":"github_pat_1234567890abcdefghijklmnop"}', 'github-token']
  ])('detects %s credentials without returning their value', (path, contents, expectedRule) => {
    const findings = findCredentialFindings(path, contents);
    expect(findings.some((finding) => finding.rule.includes(expectedRule))).toBe(true);
    expect(JSON.stringify(findings)).not.toMatch(/manifest-secret|password@example|abcdefghijklmnop/);
  });

  it('permits environment references and explicit redaction placeholders', () => {
    const contents = JSON.stringify({
      token: '${AUDIT_TOKEN}',
      password: '${{ secrets.AUDIT_PASSWORD }}',
      api_key: '[redacted]',
      secret: '<redacted>'
    });
    expect(findCredentialFindings('plugin.json', contents)).toEqual([]);
  });

  it('permits non-string control values under sensitive-looking keys', () => {
    expect(findCredentialFindings(
      'plugin.json',
      '{"session":false,"cookie":true,"token":0,"secret":null}'
    )).toEqual([]);
  });

  it('permits only valid id-token permission controls in GitHub workflow YAML', () => {
    expect(findCredentialFindings(
      '.github/workflows/publish.yml',
      'permissions:\n  id-token: write\n'
    )).toEqual([]);
    expect(findCredentialFindings(
      '.github/workflows/publish.yml',
      'permissions:\n  id-token: "literal-secret"\n'
    )).toEqual([
      { path: '.github/workflows/publish.yml', line: 2, rule: 'literal-sensitive-field:id-token' }
    ]);
    expect(findCredentialFindings('plugin.yml', 'id-token: write\n')).toEqual([
      { path: 'plugin.yml', line: 1, rule: 'literal-sensitive-field:id-token' }
    ]);
  });

  it('scans all repository manifests without credential literals', async () => {
    const root = resolve(import.meta.dirname, '..');
    const paths = await repositoryManifestPaths(root);
    expect(paths.some((path) => path.endsWith('action.yml'))).toBe(true);
    expect(paths.some((path) => path.endsWith('install-manifest.json'))).toBe(true);
    expect(await scanCredentialFiles(root, paths)).toEqual([]);
  });

  it('reports only a safe file, line, and rule for a failed scan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'credential-safety-'));
    temporaryDirectories.push(root);
    const path = join(root, 'plugin.json');
    await writeFile(path, '{\n  "password": "do-not-print-this"\n}\n');
    const findings = await scanCredentialFiles(root, [path]);
    expect(findings).toEqual([{ path: 'plugin.json', line: 2, rule: 'literal-sensitive-field:password' }]);
    expect(JSON.stringify(findings)).not.toContain('do-not-print-this');
  });

  it('applies adversarial checks through repository-level manifest discovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'credential-safety-repository-'));
    temporaryDirectories.push(root);
    await writeFile(join(root, 'plugin.json'), '{"clientSecret":"SENTINEL-CLIENT-VALUE"}\n');
    await writeFile(join(root, 'action.yml'), 'password: "SENTINEL QUOTED VALUE"\n');
    const findings = await scanCredentialFiles(root);
    expect(findings.map((finding) => finding.path)).toEqual(['action.yml', 'plugin.json']);
    expect(JSON.stringify(findings)).not.toContain('SENTINEL');
  });

  it('redacts credentials from marketplace runtime log messages', () => {
    const raw = 'Install failed at https://user:pass@example.test/?access%255Ftoken=url-secret Authorization: Bearer header-secret';
    const messages = [];
    createSafeLogger((message) => messages.push(message))(raw);
    const output = messages.join('');
    expect(output).toContain('https://[redacted]@example.test/');
    expect(output).toContain('access%255Ftoken=[redacted]');
    expect(output).not.toMatch(/user:pass|url-secret|header-secret/);
    expect(redactLogMessage('github_pat_1234567890abcdefghijklmnop')).toBe('[redacted]');
  });

  it.each([
    ['Install failed. ACCESS_TOKEN="SENTINEL QUOTED VALUE". Please retry.', ['SENTINEL', 'QUOTED VALUE']],
    ['Install failed. clientSecret=SENTINEL-CAMEL-VALUE. Please retry.', ['SENTINEL-CAMEL-VALUE']],
    ['Request https://example.test/?client_secret=SENTINEL-QUERY-VALUE failed.', ['SENTINEL-QUERY-VALUE']],
    ['Authorization: Digest realm="SENTINEL.REALM", nonce="SENTINEL-NONCE". Please retry.', ['SENTINEL.REALM', 'SENTINEL-NONCE']]
  ])('redacts adversarial marketplace log input %#', (raw, secrets) => {
    const output = redactLogMessage(raw);
    for (const secret of secrets) expect(output).not.toContain(secret);
    expect(output).toContain('[redacted]');
    if (raw.includes('Please retry.')) expect(output).toContain('Please retry.');
    if (raw.includes('https://example.test/')) expect(output).toContain('https://example.test/');
  });

  it('keeps generated runtime loggers behaviorally identical and credential-safe', async () => {
    const root = resolve(import.meta.dirname, '..');
    const sourceCases = [
      'ACCESS_TOKEN="SENTINEL QUOTED VALUE". Please retry.',
      'clientSecret=SENTINEL-CAMEL-VALUE. Please retry.',
      'Request https://example.test/?client_secret=SENTINEL-QUERY-VALUE failed.',
      'Authorization: Digest realm="SENTINEL.REALM", nonce="SENTINEL-NONCE". Please retry.'
    ];
    for (const target of ['claude', 'copilot-cli', 'copilot-vscode']) {
      const generated = await import(pathToFileURL(join(
        root,
        'marketplace',
        'carlashub-plugin-marketplace',
        'accessibility-audit',
        target,
        '_runtime',
        'lib',
        'safe-log.mjs'
      )).href);
      for (const raw of sourceCases) {
        expect(generated.redactLogMessage(raw)).toBe(redactLogMessage(raw));
        expect(generated.redactLogMessage(raw)).not.toContain('SENTINEL');
      }
    }
  });
});
