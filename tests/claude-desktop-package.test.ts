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
    const repeatedArchive = await readFile(join(secondOutputDirectory, archiveName));
    const checksum = await readFile(join(outputDirectory, `${archiveName}.sha256`), 'utf8');
    const names = archiveEntryNames(archive);

    expect(stdout).toContain('Claude Desktop plugin package created and validated.');
    expect(archive.subarray(0, 2).toString()).toBe('PK');
    expect(names).toContain('.claude-plugin/plugin.json');
    expect(names).toContain('.mcp.json');
    expect(names).toContain('skills/run-accessibility-audit/SKILL.md');
    expect(names).toContain('_runtime/bin/launch-mcp.mjs');
    expect(names.some((name) => name.startsWith('claude/'))).toBe(false);
    expect(repeatedArchive.equals(archive)).toBe(true);
    expect(checksum).toBe(`${createHash('sha256').update(archive).digest('hex')}  ${archiveName}\n`);
  }, 30_000);
});
