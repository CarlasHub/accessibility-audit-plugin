import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isDirectInvocation } from '../src/invocation.js';

describe('direct invocation detection', () => {
  it('recognizes the same executable through a symbolic parent path', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'accessibility-invocation-'));
    try {
      const realDirectory = join(temporary, 'real');
      const linkedDirectory = join(temporary, 'linked');
      await mkdir(realDirectory);
      const script = join(realDirectory, 'mcp.js');
      await writeFile(script, '', 'utf8');
      await symlink(realDirectory, linkedDirectory, 'dir');
      const canonicalScript = await realpath(script);

      expect(isDirectInvocation(pathToFileURL(canonicalScript).href, join(linkedDirectory, 'mcp.js'))).toBe(true);
      expect(isDirectInvocation(pathToFileURL(canonicalScript).href, join(linkedDirectory, 'other.js'))).toBe(false);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
