import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDocs = [
  'README.md',
  'SUPPORT.md',
  'CONTRIBUTING.md',
  'docs/installation.md',
  'docs/user-guide.md',
  'docs/wcag-basics.md',
  'docs/reporting.md',
  'docs/testing-matrix.md',
  'docs/manual-verification.md'
];

describe('user documentation', () => {
  it('provides a beginner-safe audit and report workflow', async () => {
    const [readme, userGuide, wcagBasics, reporting, manual] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('docs/user-guide.md', 'utf8'),
      readFile('docs/wcag-basics.md', 'utf8'),
      readFile('docs/reporting.md', 'utf8'),
      readFile('docs/manual-verification.md', 'utf8')
    ]);

    expect(readme).toContain('## Start here');
    expect(readme).toContain('does not discover or crawl');
    expect(readme).toContain('Status = Fail');
    expect(userGuide).toContain('## Step 1: choose the scope');
    expect(userGuide).toContain('Changing it does not add pages to the audit');
    expect(userGuide).toContain('## Step 7: decide what happens next');
    expect(wcagBasics).toContain('## Why automation is incomplete');
    expect(wcagBasics).toContain('no automated finding does not mean “pass”');
    expect(reporting).toContain('## Accessibility Report field guide');
    expect(reporting).toContain('workflow Status `Fail`');
    expect(manual).toContain('Do not report an unperformed check as passed');
    expect(manual).toContain('## Test supported screen-reader and browser combinations');
  });

  it('documents complete client installation without using a personal auditor example', async () => {
    const [readme, installation] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('docs/installation.md', 'utf8')
    ]);

    expect(readme).not.toContain('Carla Goncalves');
    expect(readme).toContain('--auditor "Auditor Name"');
    expect(installation).toContain('## 3A. Install in Cursor');
    expect(installation).toContain('## 3B. Install in Claude Code');
    expect(installation).toContain('## 3C. Install in Codex');
    expect(installation).toContain('Developer: Reload Window');
    expect(installation).toContain('claude --plugin-dir');
    expect(installation).toContain('codex plugin marketplace add');
    expect(installation).toContain('## 5. Update an installation');
    expect(installation).toContain('## 6. Uninstall');
    expect(installation).toContain('The Codex IDE extension does not currently load plugins');
  });

  it('keeps local Markdown links resolvable and public guidance free of retired automation', async () => {
    for (const path of publicDocs) {
      const markdown = await readFile(path, 'utf8');
      expect(markdown).not.toMatch(/guidepup/i);
      expect(markdown).not.toMatch(/\/Users\/[A-Za-z0-9._-]+/);
      const links = [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]!);
      for (const link of links) {
        if (/^(?:https?:|mailto:|#)/i.test(link)) continue;
        const target = link.split('#', 1)[0]!;
        if (!target) continue;
        await expect(access(resolve(dirname(path), decodeURIComponent(target)))).resolves.toBeUndefined();
      }
    }
  });
});
