import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PLUGIN_VERSION } from '../src/version.js';

const VERSION = PLUGIN_VERSION;

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

describe('plugin packaging', () => {
  it('keeps package and client manifests version-aligned', async () => {
    const manifests = await Promise.all([
      json('package.json'),
      json('plugin.json'),
      json('.codex-plugin/plugin.json'),
      json('.cursor-plugin/plugin.json'),
      json('.claude-plugin/plugin.json')
    ]);
    expect(manifests.map((manifest) => manifest.version)).toEqual(Array(5).fill(VERSION));
    expect(manifests.map((manifest) => (manifest.author as { name?: string } | undefined)?.name)).toEqual(Array(5).fill('CarlasHub'));
    const marketplace = await json('.claude-plugin/marketplace.json') as {
      plugins?: Array<{ version?: string }>;
    };
    expect(marketplace.plugins?.[0]?.version).toBe(VERSION);
  });

  it('contains no retired screen-reader execution option in public manifests or MCP definitions', async () => {
    const paths = [
      'package.json',
      'plugin.json',
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

  it('provides portable plugin and marketplace metadata', async () => {
    const [plugin, mcp, marketplace] = await Promise.all([
      json('plugin.json'),
      json('mcp.json'),
      json('.agents/plugins/marketplace.json')
    ]);
    expect(plugin.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    expect(mcp.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
    expect((mcp.mcpServers as Record<string, { type?: string }> | undefined)?.['accessibility-audit']?.type).toBe('stdio');
    expect(marketplace.name).toBe('carlashub-plugins');
  });

  it('bundles every production dependency for offline marketplace activation', async () => {
    const packageJson = await json('package.json') as {
      dependencies?: Record<string, string>;
      bundleDependencies?: string[];
    };
    expect(packageJson.bundleDependencies?.sort()).toEqual(Object.keys(packageJson.dependencies ?? {}).sort());
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
