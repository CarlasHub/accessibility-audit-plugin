import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const generatedRoot = path.join(root, 'marketplace', 'carlashub-plugin-marketplace', 'accessibility-audit');
const outputDirectoryArgument = process.argv.indexOf('--output-dir');
const artifactsDirectory = outputDirectoryArgument >= 0
  ? path.resolve(process.argv[outputDirectoryArgument + 1] ?? '')
  : path.join(root, 'artifacts');
if (outputDirectoryArgument >= 0 && !process.argv[outputDirectoryArgument + 1]) {
  throw new Error('--output-dir requires a directory path.');
}
const archiveDate = new Date('1980-01-01T00:00:00.000Z');

const bundles = [
  {
    sourceName: 'copilot-cli',
    archiveName: 'accessibility-audit-copilot-cli',
    manifest: 'plugin.json',
    expectedName: 'accessibility-audit',
    required: [
      'plugin.json',
      '.mcp.json',
      '_runtime/bin/launch-mcp.mjs',
      '_runtime/lib/install.mjs',
      'commands/accessibility-audit.md',
      'hooks/hooks.json',
      'install-manifest.json',
      'skills/run-accessibility-audit/SKILL.md',
    ],
  },
  {
    sourceName: 'copilot-vscode',
    archiveName: 'accessibility-audit-copilot-vscode',
    manifest: '.claude-plugin/plugin.json',
    expectedName: 'accessibility-audit-vscode',
    required: [
      '.claude-plugin/plugin.json',
      '.mcp.json',
      '_runtime/bin/launch-mcp.mjs',
      '_runtime/lib/install.mjs',
      'commands/accessibility-audit.md',
      'hooks/hooks.json',
      'install-manifest.json',
      'skills/run-accessibility-audit/SKILL.md',
    ],
  },
];

async function collectFiles(directory, prefix = '') {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolute, relative));
    if (entry.isFile()) files.push({ absolute, relative });
  }
  return files;
}

async function sha256(file) {
  const bytes = await readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

async function assertPayload(bundle, source) {
  for (const relative of bundle.required) await access(path.join(source, relative));
  const manifest = JSON.parse(await readFile(path.join(source, bundle.manifest), 'utf8'));
  if (manifest.name !== bundle.expectedName || manifest.version !== version) {
    throw new Error(`${bundle.sourceName} manifest does not match ${bundle.expectedName}@${version}`);
  }
}

async function createArchive(source, destination) {
  const files = await collectFiles(source);
  await new Promise((resolve, reject) => {
    const output = createWriteStream(destination);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const file of files) {
      archive.file(file.absolute, { name: file.relative, date: archiveDate, mode: 0o644 });
    }
    void archive.finalize();
  });
}

async function publishFile(source, versionedName, stableName) {
  const versioned = path.join(artifactsDirectory, versionedName);
  const stable = path.join(artifactsDirectory, stableName);
  await copyFile(source, versioned);
  await copyFile(source, stable);
  const checksum = await sha256(source);
  await writeFile(`${versioned}.sha256`, `${checksum}  ${versionedName}\n`, 'utf8');
  await writeFile(`${stable}.sha256`, `${checksum}  ${stableName}\n`, 'utf8');
  return { versioned, stable };
}

await mkdir(artifactsDirectory, { recursive: true });

for (const bundle of bundles) {
  const source = path.join(generatedRoot, bundle.sourceName);
  await assertPayload(bundle, source);
  const temporaryArchive = path.join(artifactsDirectory, `.${bundle.archiveName}-${version}.zip`);
  await rm(temporaryArchive, { force: true });
  await createArchive(source, temporaryArchive);
  const names = await publishFile(
    temporaryArchive,
    `${bundle.archiveName}-${version}.zip`,
    `${bundle.archiveName}.zip`,
  );
  await rm(temporaryArchive, { force: true });
  console.log(`Packaged ${bundle.sourceName}: ${path.relative(root, names.versioned)} and ${path.relative(root, names.stable)}`);
}

const installArchive = path.join(
  generatedRoot,
  'claude',
  '_install-source',
  `accessibility-audit-plugin-${version}.tgz`,
);
await access(installArchive);
const agentBundle = await publishFile(
  installArchive,
  `accessibility-audit-agent-plugin-${version}.tgz`,
  'accessibility-audit-agent-plugin.tgz',
);
console.log(`Packaged local agent bundle: ${path.relative(root, agentBundle.versioned)} and ${path.relative(root, agentBundle.stable)}`);
