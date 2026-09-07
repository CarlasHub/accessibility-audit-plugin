import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('site-neutrality verification', () => {
  it('accepts the runtime and user-facing plugin content', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['scripts/verify-site-neutrality.mjs']);
    expect(stdout).toContain('Site-neutrality verification passed.');
  });

  it.each([
    String.fromCharCode(117, 110, 105, 108, 101, 118, 101, 114),
    String.fromCharCode(98, 97, 116)
  ])('rejects validation-customer name %s in user-facing content', async (prohibitedName) => {
    const directory = await mkdtemp(join(tmpdir(), 'site-neutrality-'));
    await writeFile(join(directory, 'README.md'), `Audit only ${prohibitedName} pages.`);

    await expect(execFileAsync(process.execPath, [
      'scripts/verify-site-neutrality.mjs',
      '--root',
      directory
    ])).rejects.toMatchObject({
      stderr: expect.stringContaining('README.md')
    });
  });
});
