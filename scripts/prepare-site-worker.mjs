import { copyFile, cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repositoryRoot, 'site');
const serverDirectory = path.join(siteRoot, 'dist', 'server');
const hostingServerDirectory = path.join(repositoryRoot, 'dist', 'server');
const hostingClientDirectory = path.join(repositoryRoot, 'dist', 'client');
const hostingMetadataDirectory = path.join(repositoryRoot, 'dist', '.openai');

await mkdir(serverDirectory, { recursive: true });
await copyFile(path.join(siteRoot, 'server.js'), path.join(serverDirectory, 'index.js'));
await mkdir(hostingServerDirectory, { recursive: true });
await copyFile(path.join(siteRoot, 'server.js'), path.join(hostingServerDirectory, 'index.js'));
await cp(path.join(siteRoot, 'dist', 'client'), hostingClientDirectory, {
  recursive: true,
  force: true
});
await mkdir(hostingMetadataDirectory, { recursive: true });
await copyFile(
  path.join(siteRoot, '.openai', 'hosting.json'),
  path.join(hostingMetadataDirectory, 'hosting.json')
);
