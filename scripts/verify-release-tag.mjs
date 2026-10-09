import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageJson.version;

if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`package.json contains an invalid release version: ${String(version)}`);
}

const expectedTag = `v${version}`;
const actualTag = process.env.RELEASE_TAG;

if (actualTag !== expectedTag) {
  process.stderr.write(
    `Release tag mismatch: expected ${expectedTag}, received ${actualTag ?? '(missing)'}.\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Release tag ${actualTag} matches package version ${version}.\n`);
}
