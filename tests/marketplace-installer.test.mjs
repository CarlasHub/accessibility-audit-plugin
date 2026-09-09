import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureInstalled,
  readInstallManifest,
  resolvePluginDataRoot,
  resolvePluginRoot
} from '../marketplace/runtime/lib/install.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), 'accessibility-installer-test-'));
  temporaryDirectories.push(temporary);
  const pluginRoot = join(temporary, 'plugin with spaces');
  const dataRoot = join(temporary, 'data with spaces');
  const sourceRoot = join(pluginRoot, '_install-source');
  await mkdir(sourceRoot, { recursive: true });
  const tarball = 'accessibility-audit-plugin-9.9.9.tgz';
  const payload = Buffer.from('fixture payload');
  const sha256 = createHash('sha256').update(payload).digest('hex');
  await writeFile(join(sourceRoot, tarball), payload);
  await writeFile(join(pluginRoot, 'install-manifest.json'), `${JSON.stringify({
    version: '9.9.9',
    packageName: 'accessibility-audit-plugin',
    tarball,
    sha256,
    entrypoint: 'dist/mcp.js',
    template: 'assets/accessibility-report-template.xlsx',
    overrides: { uuid: '11.1.1' }
  }, null, 2)}\n`);
  return { pluginRoot, dataRoot, sha256 };
}

async function createFakeRuntime({ prefix, manifest }) {
  const packageRoot = join(prefix, 'node_modules', manifest.packageName);
  await mkdir(join(packageRoot, 'dist'), { recursive: true });
  await mkdir(join(packageRoot, 'assets'), { recursive: true });
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: manifest.packageName, version: manifest.version }));
  await writeFile(join(packageRoot, manifest.entrypoint), 'export {};\n');
  await writeFile(join(packageRoot, manifest.template), 'workbook');
}

async function verifyFakeRuntime(paths, manifest) {
  const packageJson = JSON.parse(await readFile(join(paths.packageRoot, 'package.json'), 'utf8'));
  expect(packageJson).toEqual({ name: manifest.packageName, version: manifest.version });
  await access(paths.entrypoint);
  await access(paths.template);
}

describe('marketplace runtime installer', () => {
  it('uses client-owned data directories with a private fallback', () => {
    expect(resolvePluginRoot({ COPILOT_PLUGIN_ROOT: '/plugins/audit' })).toContain('/plugins/audit');
    expect(resolvePluginDataRoot({ CLAUDE_PLUGIN_DATA: '/client/data' }, '/home/test')).toContain('/client/data');
    expect(resolvePluginDataRoot({}, '/home/test')).toBe('/home/test/.carlashub/cache/accessibility-audit');
  });

  it('installs once, verifies the runtime, and reuses the ready version', async () => {
    const { pluginRoot, dataRoot } = await fixture();
    const runNpm = vi.fn(createFakeRuntime);
    const first = await ensureInstalled(pluginRoot, { dataRoot, runNpm, verifyRuntime: verifyFakeRuntime });
    const second = await ensureInstalled(pluginRoot, { dataRoot, runNpm, verifyRuntime: verifyFakeRuntime });

    expect(first.installed).toBe(true);
    expect(second.installed).toBe(false);
    expect(first.entrypoint).toBe(second.entrypoint);
    expect(runNpm).toHaveBeenCalledTimes(1);
  });

  it('rejects a corrupt bundled runtime before installation', async () => {
    const { pluginRoot, dataRoot } = await fixture();
    await writeFile(join(pluginRoot, '_install-source', 'accessibility-audit-plugin-9.9.9.tgz'), 'corrupt');
    const runNpm = vi.fn(createFakeRuntime);

    await expect(ensureInstalled(pluginRoot, { dataRoot, runNpm, verifyRuntime: verifyFakeRuntime }))
      .rejects.toThrow('checksum mismatch');
    expect(runNpm).not.toHaveBeenCalled();
  });

  it('cleans its lock and incomplete version after an installation failure', async () => {
    const { pluginRoot, dataRoot } = await fixture();
    const failure = new Error('npm failed');
    await expect(ensureInstalled(pluginRoot, {
      dataRoot,
      runNpm: async () => { throw failure; },
      verifyRuntime: verifyFakeRuntime
    })).rejects.toThrow('npm failed');

    await expect(access(join(dataRoot, 'runtime', '9.9.9.install.lock'))).rejects.toThrow();
    await expect(access(join(dataRoot, 'runtime', '9.9.9'))).rejects.toThrow();
  });

  it('rejects unsafe manifest paths', async () => {
    const { pluginRoot } = await fixture();
    const manifest = JSON.parse(await readFile(join(pluginRoot, 'install-manifest.json'), 'utf8'));
    manifest.tarball = '../outside.tgz';
    await writeFile(join(pluginRoot, 'install-manifest.json'), JSON.stringify(manifest));
    await expect(readInstallManifest(pluginRoot)).rejects.toThrow('tarball');
  });
});
