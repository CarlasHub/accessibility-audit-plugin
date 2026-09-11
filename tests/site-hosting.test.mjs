import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function exists(relativePath) {
  try {
    await access(path.join(repositoryRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

describe('public landing-page hosting', () => {
  it('uses the public GitHub Pages URL as its canonical address', async () => {
    const html = await readFile(path.join(repositoryRoot, 'site', 'index.html'), 'utf8');

    expect(html).toContain(
      '<link rel="canonical" href="https://carlashub.github.io/accessibility-audit-plugin/" />'
    );
    expect(html).not.toContain('chatgpt.site');
  });

  it('builds the static site into the directory deployed by GitHub Pages', async () => {
    const viteConfig = await readFile(path.join(repositoryRoot, 'site', 'vite.config.ts'), 'utf8');
    const workflow = await readFile(
      path.join(repositoryRoot, '.github', 'workflows', 'pages.yml'),
      'utf8'
    );

    expect(viteConfig).toContain("outDir: '../dist/client'");
    expect(viteConfig).toContain("entryFileNames: 'assets/[name]-[hash].js'");
    expect(viteConfig).not.toContain("entryFileNames: 'assets/app.js'");
    expect(workflow).toContain('uses: actions/deploy-pages@v4');
    expect(workflow).toContain('path: dist/client');
  });

  it('does not package ChatGPT Sites hosting metadata or a hosting worker', async () => {
    expect(await exists('site/.openai/hosting.json')).toBe(false);
    expect(await exists('site/server.js')).toBe(false);
    expect(await exists('scripts/prepare-site-worker.mjs')).toBe(false);
  });

  it('offers user-owned setup for both new and existing repositories', async () => {
    const html = await readFile(path.join(repositoryRoot, 'site', 'index.html'), 'utf8');
    const workflowBuilder = await readFile(path.join(repositoryRoot, 'site', 'workflow.ts'), 'utf8');

    expect(html).toContain('value="new" checked');
    expect(html).toContain('value="existing"');
    expect(html).toContain('id="repository-name"');
    expect(html).toContain('id="choose-repository"');
    expect(html).toContain('id="repository-dialog"');
    expect(html).toContain('It never runs audits or stores reports.');
    expect(html).toContain('<script src="./config.js"></script>');
    expect(workflowBuilder).not.toContain('/new/HEAD');
  });
});
