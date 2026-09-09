import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const INSTALL_MANIFEST = 'install-manifest.json';
const READY_MARKER = '.accessibility-audit-ready.json';
const LOCK_TIMEOUT_MS = 120_000;
const LOCK_STALE_MS = 10 * 60_000;
const POLL_MS = 200;

function assertPlainSegment(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw new Error(`${label} must contain only letters, numbers, dots, underscores, and hyphens.`);
  }
  return value;
}

function packageSegments(packageName) {
  if (typeof packageName !== 'string') throw new Error('install manifest packageName must be a string.');
  const segments = packageName.split('/');
  if (segments.length === 1) return [assertPlainSegment(segments[0], 'packageName')];
  if (segments.length === 2 && segments[0]?.startsWith('@')) {
    return [`@${assertPlainSegment(segments[0].slice(1), 'package scope')}`, assertPlainSegment(segments[1], 'packageName')];
  }
  throw new Error('install manifest packageName is invalid.');
}

function normalizeEnvironmentPath(value) {
  if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(value)) {
    return `${value[1]?.toUpperCase()}:\\${value.slice(3).replaceAll('/', '\\')}`;
  }
  return resolve(value);
}

export function resolvePluginRoot(environment = process.env) {
  const value = environment.CLAUDE_PLUGIN_ROOT
    || environment.COPILOT_PLUGIN_ROOT
    || environment.PLUGIN_ROOT;
  if (!value) {
    throw new Error('Plugin root is unavailable. Set CLAUDE_PLUGIN_ROOT, COPILOT_PLUGIN_ROOT, or PLUGIN_ROOT.');
  }
  return normalizeEnvironmentPath(value);
}

export function resolvePluginDataRoot(environment = process.env, userHome = homedir()) {
  const configured = environment.CLAUDE_PLUGIN_DATA
    || environment.COPILOT_PLUGIN_DATA
    || environment.PLUGIN_DATA;
  return configured
    ? normalizeEnvironmentPath(configured)
    : join(userHome, '.carlashub', 'cache', 'accessibility-audit');
}

export async function readInstallManifest(pluginRoot) {
  const manifestPath = join(pluginRoot, INSTALL_MANIFEST);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const version = assertPlainSegment(parsed.version, 'install manifest version');
  const tarball = assertPlainSegment(parsed.tarball, 'install manifest tarball');
  if (!tarball.endsWith('.tgz') || basename(tarball) !== tarball) {
    throw new Error('install manifest tarball must be a local .tgz filename.');
  }
  if (typeof parsed.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.sha256)) {
    throw new Error('install manifest sha256 must be a lowercase SHA-256 digest.');
  }
  const entrypoint = parsed.entrypoint;
  if (typeof entrypoint !== 'string' || !/^dist\/[a-zA-Z0-9._/-]+\.js$/.test(entrypoint) || entrypoint.includes('..')) {
    throw new Error('install manifest entrypoint must be a JavaScript file below dist/.');
  }
  const template = parsed.template;
  if (typeof template !== 'string' || !/^assets\/[a-zA-Z0-9._/-]+\.xlsx$/.test(template) || template.includes('..')) {
    throw new Error('install manifest template must be an XLSX file below assets/.');
  }
  const packageName = parsed.packageName;
  packageSegments(packageName);
  const overrides = parsed.overrides && typeof parsed.overrides === 'object' && !Array.isArray(parsed.overrides)
    ? parsed.overrides
    : {};

  return { version, tarball, sha256: parsed.sha256, entrypoint, template, packageName, overrides };
}

export async function fileSha256(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

function runtimePaths(dataRoot, manifest) {
  const runtimeRoot = join(dataRoot, 'runtime');
  const versionRoot = join(runtimeRoot, manifest.version);
  const packageRoot = join(versionRoot, 'node_modules', ...packageSegments(manifest.packageName));
  return {
    runtimeRoot,
    versionRoot,
    packageRoot,
    entrypoint: join(packageRoot, manifest.entrypoint),
    template: join(packageRoot, manifest.template),
    marker: join(versionRoot, READY_MARKER),
    lock: join(runtimeRoot, `${manifest.version}.install.lock`)
  };
}

async function defaultVerifyRuntime(paths, manifest) {
  const packageJsonPath = join(paths.packageRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  if (packageJson.name !== manifest.packageName || packageJson.version !== manifest.version) {
    throw new Error(`Installed package identity is ${packageJson.name}@${packageJson.version}; expected ${manifest.packageName}@${manifest.version}.`);
  }
  await access(paths.entrypoint);
  await access(paths.template);
  await execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    'await import(process.argv[1])',
    pathToFileURL(paths.entrypoint).href
  ], {
    env: { ...process.env, ACCESSIBILITY_AUDIT_IMPORT_CHECK: '1' },
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
}

async function runtimeIsReady(paths, manifest, verifyRuntime) {
  try {
    const marker = JSON.parse(await readFile(paths.marker, 'utf8'));
    if (marker.version !== manifest.version || marker.sha256 !== manifest.sha256) return false;
    await verifyRuntime(paths, manifest);
    return true;
  } catch {
    return false;
  }
}

async function defaultRunNpm({ tarballPath, prefix, signal }) {
  await execFileAsync('npm', [
    'install',
    tarballPath,
    '--prefix',
    prefix,
    '--omit=dev',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    '--package-lock=false'
  ], {
    env: { ...process.env, npm_config_update_notifier: 'false' },
    signal,
    timeout: 10 * 60_000,
    maxBuffer: 4 * 1024 * 1024
  });
}

async function acquireLock(lockPath, signal) {
  const startedAt = Date.now();
  while (true) {
    if (signal?.aborted) throw new Error('Plugin runtime installation was cancelled.');
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      await handle.close();
      return;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
          await unlink(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for plugin runtime installation lock: ${lockPath}`);
      }
      await new Promise((resolvePoll, rejectPoll) => {
        const abort = () => {
          clearTimeout(timer);
          rejectPoll(new Error('Plugin runtime installation was cancelled.'));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', abort);
          resolvePoll();
        }, POLL_MS);
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
  }
}

export async function ensureInstalled(pluginRoot, options = {}) {
  const log = options.log ?? (() => undefined);
  const manifest = await readInstallManifest(pluginRoot);
  const tarballPath = join(pluginRoot, '_install-source', manifest.tarball);
  const actualSha256 = await fileSha256(tarballPath).catch((error) => {
    throw new Error(`Cannot read the packaged plugin runtime ${tarballPath}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (actualSha256 !== manifest.sha256) {
    throw new Error(`Packaged plugin runtime checksum mismatch: expected ${manifest.sha256}, received ${actualSha256}.`);
  }

  const dataRoot = options.dataRoot ?? resolvePluginDataRoot(options.environment);
  const paths = runtimePaths(dataRoot, manifest);
  const verifyRuntime = options.verifyRuntime ?? defaultVerifyRuntime;
  const runNpm = options.runNpm ?? defaultRunNpm;
  await mkdir(paths.runtimeRoot, { recursive: true });
  if (await runtimeIsReady(paths, manifest, verifyRuntime)) {
    return { ...paths, dataRoot, manifest, installed: false };
  }

  await acquireLock(paths.lock, options.signal);
  let stagingRoot;
  try {
    if (await runtimeIsReady(paths, manifest, verifyRuntime)) {
      return { ...paths, dataRoot, manifest, installed: false };
    }

    stagingRoot = await mkdtemp(join(paths.runtimeRoot, `.${manifest.version}.staging-`));
    const stagingPackage = {
      name: 'accessibility-audit-marketplace-runtime',
      version: manifest.version,
      private: true,
      overrides: manifest.overrides
    };
    await writeFile(join(stagingRoot, 'package.json'), `${JSON.stringify(stagingPackage, null, 2)}\n`, 'utf8');
    log(`Installing Accessibility Audit ${manifest.version} into isolated plugin storage...`);
    await runNpm({ tarballPath, prefix: stagingRoot, manifest, signal: options.signal });

    const stagingPackageRoot = join(stagingRoot, 'node_modules', ...packageSegments(manifest.packageName));
    const stagingPaths = {
      ...paths,
      versionRoot: stagingRoot,
      packageRoot: stagingPackageRoot,
      entrypoint: join(stagingPackageRoot, manifest.entrypoint),
      template: join(stagingPackageRoot, manifest.template),
      marker: join(stagingRoot, READY_MARKER)
    };
    await verifyRuntime(stagingPaths, manifest);
    await writeFile(stagingPaths.marker, `${JSON.stringify({
      version: manifest.version,
      sha256: manifest.sha256,
      installedAt: new Date().toISOString()
    }, null, 2)}\n`, 'utf8');

    await rm(paths.versionRoot, { recursive: true, force: true });
    await rename(stagingRoot, paths.versionRoot);
    stagingRoot = undefined;
    log(`Accessibility Audit ${manifest.version} is ready.`);
    return { ...paths, dataRoot, manifest, installed: true };
  } finally {
    if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true });
    await unlink(paths.lock).catch(() => undefined);
  }
}

export async function removeInstalledVersion(dataRoot, version) {
  const safeVersion = assertPlainSegment(version, 'version');
  const versionRoot = join(dataRoot, 'runtime', safeVersion);
  await rm(versionRoot, { recursive: true, force: true });
  return versionRoot;
}
