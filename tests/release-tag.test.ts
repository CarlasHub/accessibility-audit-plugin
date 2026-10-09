import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('release tag verification', () => {
  it('accepts only the exact package version tag', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
    const expectedTag = `v${packageJson.version}`;
    const script = 'scripts/verify-release-tag.mjs';
    const matching = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, RELEASE_TAG: expectedTag },
    });
    const mismatching = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, RELEASE_TAG: `${expectedTag}-wrong` },
    });

    expect(matching.status).toBe(0);
    expect(matching.stdout).toContain(`Release tag ${expectedTag} matches`);
    expect(mismatching.status).not.toBe(0);
    expect(mismatching.stderr).toContain(`expected ${expectedTag}`);
    expect(mismatching.stderr).toContain(`received ${expectedTag}-wrong`);
  });
});
