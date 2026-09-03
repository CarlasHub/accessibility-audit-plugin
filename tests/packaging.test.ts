import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const VERSION = '0.7.0';

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

describe('plugin packaging', () => {
  it('keeps package and client manifests version-aligned', async () => {
    const manifests = await Promise.all([
      json('package.json'),
      json('.codex-plugin/plugin.json'),
      json('.cursor-plugin/plugin.json'),
      json('.claude-plugin/plugin.json')
    ]);
    expect(manifests.map((manifest) => manifest.version)).toEqual(Array(4).fill(VERSION));
    const marketplace = await json('.claude-plugin/marketplace.json') as {
      plugins?: Array<{ version?: string }>;
    };
    expect(marketplace.plugins?.[0]?.version).toBe(VERSION);
  });

  it('contains no retired screen-reader execution option in public manifests or MCP definitions', async () => {
    const paths = [
      'package.json',
      '.codex-plugin/plugin.json',
      '.cursor-plugin/plugin.json',
      '.claude-plugin/plugin.json',
      '.mcp.json',
      'mcp.json',
      '.claude-mcp.json'
    ];
    const publicConfiguration = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n');
    expect(publicConfiguration).not.toMatch(/guidepup|screenReader/i);
  });

  it('keeps Cursor command and rule mirrors identical to the plugin roots', async () => {
    const [command, cursorCommand, rule, cursorRule] = await Promise.all([
      readFile('commands/accessibility-audit.md', 'utf8'),
      readFile('.cursor/commands/accessibility-audit.md', 'utf8'),
      readFile('rules/accessibility-audit.mdc', 'utf8'),
      readFile('.cursor/rules/accessibility-audit.mdc', 'utf8')
    ]);
    expect(cursorCommand).toBe(command);
    expect(cursorRule).toBe(rule);
  });
});
