import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertKnownNpmOverrideWarning(stderr, root, packageJson, packageLock) {
  const warning = stderr.trim();
  if (!warning) return;

  const overriddenUuid = packageJson.overrides?.uuid;
  const lockedUuid = packageLock.packages?.['node_modules/uuid']?.version;
  if (overriddenUuid !== '11.1.1' || lockedUuid !== overriddenUuid) {
    throw new Error('SBOM generation reported npm dependency errors without the documented UUID override.');
  }

  const expectedUuidPath = path.join(root, 'node_modules', 'uuid');
  const allowedLines = [
    /^Command failed: .*npm-cli\.js ls --json --long --all --package-lock-only --omit=dev$/,
    /^npm (?:error|ERR!) code ELSPROBLEMS$/,
    new RegExp(`^npm (?:error|ERR!) invalid: uuid@11\\.1\\.1 ${expectedUuidPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    /^npm (?:error|ERR!) A complete log of this run can be found in: .+$/,
  ];
  const unexpected = warning
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !allowedLines.some((pattern) => pattern.test(line)));
  if (unexpected.length > 0 || !warning.includes('ELSPROBLEMS') || !warning.includes('invalid: uuid@11.1.1')) {
    throw new Error('SBOM generation reported an unexpected npm dependency error.');
  }
}

function assertSbom(sbom, packageJson) {
  if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.6') {
    throw new Error('Release SBOM must be CycloneDX 1.6 JSON.');
  }
  if (sbom.serialNumber !== undefined || sbom.metadata?.timestamp !== undefined) {
    throw new Error('Release SBOM must omit non-reproducible identifiers and timestamps.');
  }
  if (sbom.metadata?.component?.name !== packageJson.name
    || sbom.metadata?.component?.version !== packageJson.version) {
    throw new Error('Release SBOM root component does not match package metadata.');
  }
  if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
    throw new Error('Release SBOM must contain the production dependency graph.');
  }
}

async function writeChecksum(file, name) {
  const bytes = await readFile(file);
  await writeFile(`${file}.sha256`, `${sha256(bytes)}  ${name}\n`, 'utf8');
}

export async function generateReleaseSbom({ root, artifactsDirectory }) {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const versionedName = `accessibility-audit-plugin-${packageJson.version}.cdx.json`;
  const stableName = 'accessibility-audit-plugin.cdx.json';
  const versioned = path.join(artifactsDirectory, versionedName);
  const stable = path.join(artifactsDirectory, stableName);
  const temporary = path.join(artifactsDirectory, `.${versionedName}.tmp`);
  const cli = path.join(root, 'node_modules', '@cyclonedx', 'cyclonedx-npm', 'bin', 'cyclonedx-npm-cli.js');

  await mkdir(artifactsDirectory, { recursive: true });
  await rm(temporary, { force: true });
  try {
    const { stderr } = await execFileAsync(process.execPath, [
      cli,
      '--package-lock-only',
      '--omit', 'dev',
      '--output-reproducible',
      '--validate',
      '--spec-version', '1.6',
      '--output-format', 'JSON',
      '--output-file', temporary,
      '--ignore-npm-errors',
    ], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
    assertKnownNpmOverrideWarning(stderr, root, packageJson, packageLock);

    const sbom = JSON.parse(await readFile(temporary, 'utf8'));
    assertSbom(sbom, packageJson);
    await copyFile(temporary, versioned);
    await copyFile(temporary, stable);
    await writeChecksum(versioned, versionedName);
    await writeChecksum(stable, stableName);
  } finally {
    await rm(temporary, { force: true });
  }

  return { versioned, stable };
}
