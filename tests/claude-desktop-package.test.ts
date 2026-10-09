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

async function expectCredentialSafeRuntime(archivePath: string): Promise<void> {
  const [{ stdout: loggerSource }, { stdout: launcherSource }] = await Promise.all([
    execFileAsync('unzip', ['-p', archivePath, '_runtime/lib/safe-log.mjs']),
    execFileAsync('unzip', ['-p', archivePath, '_runtime/bin/launch-mcp.mjs'])
  ]);
  expect(launcherSource).toContain("../lib/safe-log.mjs");
  const logger = await import(`data:text/javascript;base64,${Buffer.from(loggerSource).toString('base64')}`);
  const output = logger.redactLogMessage(
    'Authorization: Digest realm="SENTINEL.REALM", nonce="SENTINEL-NONCE". Please retry.'
  );
  expect(output).not.toContain('SENTINEL');
  expect(output).toContain('Please retry.');
}

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
    force: true
  })));
});

describe('Claude Desktop custom-plugin package', () => {
  it('creates a validated root-level plugin archive and checksum', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'claude-desktop-package-'));
    const secondOutputDirectory = await mkdtemp(join(tmpdir(), 'claude-desktop-package-repeat-'));
    temporaryDirectories.push(outputDirectory);
    temporaryDirectories.push(secondOutputDirectory);
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/package-claude-desktop.mjs',
      '--output-dir',
      outputDirectory
    ]);
    await execFileAsync(process.execPath, [
      'scripts/package-claude-desktop.mjs',
      '--output-dir',
      secondOutputDirectory
    ]);
    const archiveName = `accessibility-audit-claude-desktop-${PLUGIN_VERSION}.zip`;
    const archive = await readFile(join(outputDirectory, archiveName));
    const currentArchiveName = 'accessibility-audit-claude-desktop.zip';
    const currentArchive = await readFile(join(outputDirectory, currentArchiveName));
    const repeatedArchive = await readFile(join(secondOutputDirectory, archiveName));
    const repeatedCurrentArchive = await readFile(join(secondOutputDirectory, currentArchiveName));
    const checksum = await readFile(join(outputDirectory, `${archiveName}.sha256`), 'utf8');
    const currentChecksum = await readFile(join(outputDirectory, `${currentArchiveName}.sha256`), 'utf8');
    const names = archiveEntryNames(archive);

    expect(stdout).toContain('Claude Desktop plugin package created and validated.');
    expect(archive.subarray(0, 2).toString()).toBe('PK');
    expect(names).toContain('.claude-plugin/plugin.json');
    expect(names).toContain('.mcp.json');
    expect(names).toContain('README.md');
    expect(names).toContain('skills/run-accessibility-audit/SKILL.md');
    expect(names).toContain('_runtime/bin/launch-mcp.mjs');
    expect(names).toContain('_runtime/lib/safe-log.mjs');
    expect(names.some((name) => name.startsWith('claude/'))).toBe(false);
    expect(repeatedArchive.equals(archive)).toBe(true);
    expect(currentArchive.equals(archive)).toBe(true);
    expect(repeatedCurrentArchive.equals(currentArchive)).toBe(true);
    expect(checksum).toBe(`${createHash('sha256').update(archive).digest('hex')}  ${archiveName}\n`);
    expect(currentChecksum).toBe(`${createHash('sha256').update(archive).digest('hex')}  ${currentArchiveName}\n`);
    const { stdout: readme } = await execFileAsync('unzip', ['-p', join(outputDirectory, archiveName), 'README.md']);
    expect(readme).toContain('pasted whitespace- or newline-separated URL list');
    expect(readme).toContain('a JSON string array');
    expect(readme).toContain('validated by position');
    await expectCredentialSafeRuntime(join(outputDirectory, archiveName));
    await expectCredentialSafeRuntime(join(outputDirectory, currentArchiveName));
  }, 30_000);
});
