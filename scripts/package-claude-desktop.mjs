import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import archiver from 'archiver';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const source = join(
  root,
  'marketplace',
  'rai-ops-plugin-marketplace',
  'accessibility-audit',
  'claude'
);
const fixedArchiveDate = new Date('1980-01-01T00:00:00.000Z');
const requiredEntries = [
  '.claude-plugin/plugin.json',
  '.mcp.json',
  '_runtime/bin/launch-mcp.mjs',
  '_runtime/lib/install.mjs',
  'commands/accessibility-audit.md',
  'hooks/hooks.json',
  'install-manifest.json',
  'skills/run-accessibility-audit/SKILL.md'
];

function outputDirectory() {
  const flagIndex = process.argv.indexOf('--output-dir');
  if (flagIndex === -1) return join(root, 'artifacts');
  const value = process.argv[flagIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--output-dir requires a directory path.');
  }
  return resolve(value);
}

async function collectFiles(directory) {
  const paths = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Claude Desktop package cannot contain symbolic links: ${absolutePath}`);
    }
    if (entry.isDirectory()) {
      paths.push(...await collectFiles(absolutePath));
      continue;
    }
    if (entry.isFile()) paths.push(absolutePath);
  }

  return paths;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('Generated file is not a valid ZIP archive: central directory footer is missing.');
}

function zipEntryNames(buffer) {
  const footerOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(footerOffset + 10);
  let offset = buffer.readUInt32LE(footerOffset + 16);
  const names = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Generated ZIP central directory is malformed.');
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return names;
}

async function assertPayload() {
  for (const entry of requiredEntries) await access(join(source, entry));
  const manifest = JSON.parse(await readFile(join(source, '.claude-plugin', 'plugin.json'), 'utf8'));
  if (manifest.name !== 'accessibility-audit') {
    throw new Error('Claude plugin manifest name must be accessibility-audit.');
  }
  if (manifest.version !== packageJson.version) {
    throw new Error(`Claude plugin version ${manifest.version} does not match package ${packageJson.version}.`);
  }
}

async function createArchive(destination) {
  const files = await collectFiles(source);
  const entries = [];
  for (const file of files) {
    entries.push({
      archivePath: relative(source, file).split(sep).join('/'),
      contents: await readFile(file)
    });
  }
  const output = createWriteStream(destination, { flags: 'w' });
  const archive = archiver('zip', { zlib: { level: 9 } });

  await new Promise((resolvePromise, rejectPromise) => {
    output.once('close', resolvePromise);
    output.once('error', rejectPromise);
    archive.once('error', rejectPromise);
    archive.pipe(output);

    for (const entry of entries) {
      archive.append(entry.contents, {
        name: entry.archivePath,
        date: fixedArchiveDate,
        mode: 0o644
      });
    }

    archive.finalize().catch(rejectPromise);
  });
}

await assertPayload();
const destinationDirectory = outputDirectory();
const archiveName = `accessibility-audit-claude-desktop-${packageJson.version}.zip`;
const archivePath = join(destinationDirectory, archiveName);
const checksumPath = `${archivePath}.sha256`;
await mkdir(destinationDirectory, { recursive: true });
await rm(archivePath, { force: true });
await rm(checksumPath, { force: true });
await createArchive(archivePath);

const archiveBuffer = await readFile(archivePath);
const entries = new Set(zipEntryNames(archiveBuffer));
for (const requiredEntry of requiredEntries) {
  if (!entries.has(requiredEntry)) {
    throw new Error(`Claude Desktop package is missing ${requiredEntry}.`);
  }
}
if ([...entries].some((entry) => entry.startsWith('claude/'))) {
  throw new Error('Claude Desktop package has an invalid wrapper directory.');
}

const digest = sha256(archiveBuffer);
await writeFile(checksumPath, `${digest}  ${basename(archivePath)}\n`, 'utf8');
process.stdout.write(`Claude Desktop plugin package created and validated.\n${archivePath}\n${checksumPath}\nSHA-256: ${digest}\n`);
