import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { PLUGIN_VERSION } from '../src/version.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

function archiveEntryNames(buffer: Buffer): string[] {
  let footerOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      footerOffset = offset;
      break;
    }
  }
  if (footerOffset === -1) throw new Error('ZIP footer not found.');

  const entryCount = buffer.readUInt16LE(footerOffset + 10);
  let offset = buffer.readUInt32LE(footerOffset + 16);
  const names: string[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP entry.');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('agent release bundles', () => {
  it('creates self-contained Copilot ZIPs and a local-agent package with checksums', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'accessibility-audit-release-bundles-'));
    temporaryDirectories.push(outputDirectory);
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/package-release-bundles.mjs',
      '--output-dir',
      outputDirectory,
    ]);

    for (const bundle of ['copilot-cli', 'copilot-vscode']) {
      const archiveName = `accessibility-audit-${bundle}-${PLUGIN_VERSION}.zip`;
      const stableName = `accessibility-audit-${bundle}.zip`;
      const archive = await readFile(join(outputDirectory, archiveName));
      const stableArchive = await readFile(join(outputDirectory, stableName));
      const names = archiveEntryNames(archive);
      const checksum = createHash('sha256').update(archive).digest('hex');

      expect(archive.subarray(0, 2).toString()).toBe('PK');
      expect(names).toContain('.mcp.json');
      expect(names).toContain('skills/run-accessibility-audit/SKILL.md');
      expect(names).toContain('_runtime/bin/launch-mcp.mjs');
      expect(stableArchive.equals(archive)).toBe(true);
      expect(await readFile(join(outputDirectory, `${archiveName}.sha256`), 'utf8'))
        .toBe(`${checksum}  ${archiveName}\n`);
      expect(await readFile(join(outputDirectory, `${stableName}.sha256`), 'utf8'))
        .toBe(`${checksum}  ${stableName}\n`);
    }

    const packageName = `accessibility-audit-agent-plugin-${PLUGIN_VERSION}.tgz`;
    const stablePackageName = 'accessibility-audit-agent-plugin.tgz';
    const packageArchive = await readFile(join(outputDirectory, packageName));
    const stablePackage = await readFile(join(outputDirectory, stablePackageName));
    const packageChecksum = createHash('sha256').update(packageArchive).digest('hex');
    const { stdout: packageEntries } = await execFileAsync('tar', [
      '-tzf',
      join(outputDirectory, packageName),
    ]);
    expect(packageArchive.subarray(0, 2).toString('hex')).toBe('1f8b');
    expect(packageEntries).toContain('package/.cursor-plugin/plugin.json');
    expect(packageEntries).toContain('package/.codex-plugin/plugin.json');
    expect(packageEntries).toContain('package/.claude-plugin/plugin.json');
    expect(packageEntries).toContain('package/.mcp.json');
    expect(packageEntries).toContain('package/dist/mcp.js');
    expect(stablePackage.equals(packageArchive)).toBe(true);
    expect(await readFile(join(outputDirectory, `${packageName}.sha256`), 'utf8'))
      .toBe(`${packageChecksum}  ${packageName}\n`);
    expect(await readFile(join(outputDirectory, `${stablePackageName}.sha256`), 'utf8'))
      .toBe(`${packageChecksum}  ${stablePackageName}\n`);
    expect(stdout).toContain('Packaged copilot-cli');
    expect(stdout).toContain('Packaged copilot-vscode');
    expect(stdout).toContain('Packaged local agent bundle');
  }, 180_000);
});
