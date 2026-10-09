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
    'ACCESS_TOKEN="SENTINEL QUOTED VALUE". clientSecret=SENTINEL-CAMEL-VALUE. Please retry.'
  );
  expect(output).not.toContain('SENTINEL');
  expect(output).not.toContain('QUOTED VALUE');
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
    force: true,
  })));
});

describe('agent release bundles', () => {
  it('creates self-contained Copilot ZIPs and a local-agent package with checksums', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'accessibility-audit-release-bundles-'));
    const secondOutputDirectory = await mkdtemp(join(tmpdir(), 'accessibility-audit-release-bundles-repeat-'));
    temporaryDirectories.push(outputDirectory);
    temporaryDirectories.push(secondOutputDirectory);
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/package-release-bundles.mjs',
      '--output-dir',
      outputDirectory,
    ]);
    await execFileAsync(process.execPath, [
      'scripts/package-release-bundles.mjs',
      '--output-dir',
      secondOutputDirectory,
    ]);

    for (const bundle of ['copilot-cli', 'copilot-vscode']) {
      const archiveName = `accessibility-audit-${bundle}-${PLUGIN_VERSION}.zip`;
      const stableName = `accessibility-audit-${bundle}.zip`;
      const archive = await readFile(join(outputDirectory, archiveName));
      const stableArchive = await readFile(join(outputDirectory, stableName));
      const repeatedArchive = await readFile(join(secondOutputDirectory, archiveName));
      const repeatedStableArchive = await readFile(join(secondOutputDirectory, stableName));
      const names = archiveEntryNames(archive);
      const checksum = createHash('sha256').update(archive).digest('hex');

      expect(archive.subarray(0, 2).toString()).toBe('PK');
      expect(names).toContain('.mcp.json');
      expect(names).toContain('README.md');
      expect(names).toContain('skills/run-accessibility-audit/SKILL.md');
      expect(names).toContain('_runtime/bin/launch-mcp.mjs');
      expect(names).toContain('_runtime/lib/safe-log.mjs');
      expect(stableArchive.equals(archive)).toBe(true);
      expect(repeatedArchive.equals(archive)).toBe(true);
      expect(repeatedStableArchive.equals(stableArchive)).toBe(true);
      const { stdout: readme } = await execFileAsync('unzip', ['-p', join(outputDirectory, archiveName), 'README.md']);
      expect(readme).toContain('pasted whitespace- or newline-separated URL list');
      expect(readme).toContain('a JSON string array');
      expect(readme).toContain('validated by position');
      expect(await readFile(join(outputDirectory, `${archiveName}.sha256`), 'utf8'))
        .toBe(`${checksum}  ${archiveName}\n`);
      expect(await readFile(join(outputDirectory, `${stableName}.sha256`), 'utf8'))
        .toBe(`${checksum}  ${stableName}\n`);
      await expectCredentialSafeRuntime(join(outputDirectory, archiveName));
      await expectCredentialSafeRuntime(join(outputDirectory, stableName));
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
    expect(packageEntries).toContain('package/dist/history.js');
    const [
      { stdout: runnerSource },
      { stdout: htmlSource },
      { stdout: excelSource },
      { stdout: scopeSource },
      { stdout: cliSource },
      { stdout: mcpSource }
    ] = await Promise.all([
      execFileAsync('tar', ['-xOzf', join(outputDirectory, packageName), 'package/dist/audit/runner.js']),
      execFileAsync('tar', ['-xOzf', join(outputDirectory, packageName), 'package/dist/reporting/html.js']),
      execFileAsync('tar', ['-xOzf', join(outputDirectory, packageName), 'package/dist/reporting/excel.js']),
      execFileAsync('tar', ['-xOzf', join(outputDirectory, packageName), 'package/dist/scope.js']),
      execFileAsync('tar', ['-xOzf', join(outputDirectory, packageName), 'package/dist/cli.js']),
      execFileAsync('tar', ['-xOzf', join(outputDirectory, packageName), 'package/dist/mcp.js'])
    ]);
    expect(runnerSource).toContain('scopeMode: AUDIT_SCOPE_MODE');
    expect(scopeSource).toContain("'supplied-pages-only'");
    expect(htmlSource).toContain('links are never added as audit targets');
    expect(excelSource).toContain('Scope mode: ${AUDIT_SCOPE_LABEL}');
    expect(cliSource).toContain("'--history <path>'");
    expect(mcpSource).toContain('historyPaths');
    expect(stablePackage.equals(packageArchive)).toBe(true);
    expect(await readFile(join(outputDirectory, `${packageName}.sha256`), 'utf8'))
      .toBe(`${packageChecksum}  ${packageName}\n`);
    expect(await readFile(join(outputDirectory, `${stablePackageName}.sha256`), 'utf8'))
      .toBe(`${packageChecksum}  ${stablePackageName}\n`);
    expect(stdout).toContain('Packaged copilot-cli');
    expect(stdout).toContain('Packaged copilot-vscode');
    expect(stdout).toContain('Packaged local agent bundle');
    expect(stdout).toContain('Generated release SBOM');

    const sbomName = `accessibility-audit-plugin-${PLUGIN_VERSION}.cdx.json`;
    const stableSbomName = 'accessibility-audit-plugin.cdx.json';
    const sbomBytes = await readFile(join(outputDirectory, sbomName));
    const stableSbomBytes = await readFile(join(outputDirectory, stableSbomName));
    const repeatedSbomBytes = await readFile(join(secondOutputDirectory, sbomName));
    const sbomChecksum = createHash('sha256').update(sbomBytes).digest('hex');
    const sbom = JSON.parse(sbomBytes.toString('utf8')) as {
      bomFormat: string;
      specVersion: string;
      serialNumber?: string;
      metadata: { timestamp?: string; component: { name: string; version: string } };
      components: Array<{ group?: string; name: string; version?: string }>;
    };
    const componentNames = new Set(sbom.components.map((component) => (
      component.group ? `${component.group}/${component.name}` : component.name
    )));

    expect(stableSbomBytes.equals(sbomBytes)).toBe(true);
    expect(repeatedSbomBytes.equals(sbomBytes)).toBe(true);
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.specVersion).toBe('1.6');
    expect(sbom.serialNumber).toBeUndefined();
    expect(sbom.metadata.timestamp).toBeUndefined();
    expect(sbom.metadata.component).toMatchObject({
      name: 'accessibility-audit-plugin',
      version: PLUGIN_VERSION,
    });
    expect(componentNames).toContain('@modelcontextprotocol/sdk');
    expect(componentNames).toContain('playwright');
    expect(componentNames).not.toContain('vitest');
    expect(componentNames).not.toContain('@cyclonedx/cyclonedx-npm');
    expect(await readFile(join(outputDirectory, `${sbomName}.sha256`), 'utf8'))
      .toBe(`${sbomChecksum}  ${sbomName}\n`);
    expect(await readFile(join(outputDirectory, `${stableSbomName}.sha256`), 'utf8'))
      .toBe(`${sbomChecksum}  ${stableSbomName}\n`);
  }, 180_000);
});
