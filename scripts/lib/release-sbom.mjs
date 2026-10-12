import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function uuidV5(namespace, name) {
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  if (namespaceBytes.length !== 16 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(namespace)) {
    throw new Error('UUIDv5 namespace must be an RFC 4122 UUID.');
  }
  const bytes = createHash('sha1')
    .update(namespaceBytes)
    .update(name, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicSerialNumber(packageJson, packageLockBytes) {
  const urlNamespace = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
  const name = `${packageJson.name}@${packageJson.version}\n${sha256(packageLockBytes)}`;
  return `urn:uuid:${uuidV5(urlNamespace, name)}`;
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
  if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(sbom.serialNumber)
    || sbom.metadata?.timestamp !== undefined) {
    throw new Error('Release SBOM must contain a deterministic UUID serial number and omit timestamps.');
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
  const packageLockBytes = await readFile(path.join(root, 'package-lock.json'));
  const packageLock = JSON.parse(packageLockBytes.toString('utf8'));
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
    sbom.serialNumber = deterministicSerialNumber(packageJson, packageLockBytes);
    assertSbom(sbom, packageJson);
    const serialized = `${JSON.stringify(sbom, null, 2)}\n`;
    await writeFile(versioned, serialized, 'utf8');
    await writeFile(stable, serialized, 'utf8');
    await writeChecksum(versioned, versionedName);
    await writeChecksum(stable, stableName);
  } finally {
    await rm(temporary, { force: true });
  }

  return { versioned, stable };
}
