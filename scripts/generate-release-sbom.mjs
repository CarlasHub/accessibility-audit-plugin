import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReleaseSbom } from './lib/release-sbom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectoryArgument = process.argv.indexOf('--output-dir');
if (outputDirectoryArgument >= 0 && !process.argv[outputDirectoryArgument + 1]) {
  throw new Error('--output-dir requires a directory path.');
}
const artifactsDirectory = outputDirectoryArgument >= 0
  ? path.resolve(process.argv[outputDirectoryArgument + 1])
  : path.join(root, 'artifacts');

const sbom = await generateReleaseSbom({ root, artifactsDirectory });
console.log(`Generated release SBOM: ${path.relative(root, sbom.versioned)} and ${path.relative(root, sbom.stable)}`);
