import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repositoryRoot, 'site');
const serverDirectory = path.join(siteRoot, 'dist', 'server');

await mkdir(serverDirectory, { recursive: true });
await copyFile(path.join(siteRoot, 'server.js'), path.join(serverDirectory, 'index.js'));
