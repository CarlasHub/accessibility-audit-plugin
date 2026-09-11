import { describe, expect, it, vi } from 'vitest';
import {
  buildGitHubWorkflowEditorUrl,
  buildWorkflow,
  normalizeGitHubRepository,
  normalizeTargetUrl,
  normalizeTargetUrls
} from '../site/workflow.js';
import { resolvePublicRepositoryDefaultBranch } from '../site/github-connector.js';

describe('landing page workflow generator', () => {
  it('normalizes a public URL and derives its security boundary', () => {
    expect(normalizeTargetUrl(' https://Example.COM/path ')).toEqual({
      hostname: 'example.com',
      url: 'https://example.com/path'
    });
  });

  it('rejects non-web URLs and embedded credentials', () => {
    expect(() => normalizeTargetUrl('file:///tmp/report.html')).toThrow(/Only public/);
    expect(() => normalizeTargetUrl('https://user:secret@example.com/')).toThrow(/credentials/);
    expect(() => normalizeTargetUrl('example.com')).toThrow(/complete URL/);
  });

  it('creates a standalone workflow with a pinned report uploader', () => {
    const workflow = buildWorkflow(normalizeTargetUrl("https://example.com/it's-here"));
    expect(workflow).toContain('CarlasHub/accessibility-audit-plugin@v1');
    expect(workflow).toContain("allowed-hosts: 'example.com'");
    expect(workflow).toContain("default: |-\n          https://example.com/it's-here");
    expect(workflow).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
    expect(workflow).toContain('${{ inputs.urls }}');
    expect(workflow).not.toContain('token:');
  });

  it('creates one combined audit for multiple URLs and deduplicates host boundaries', () => {
    const targets = normalizeTargetUrls([
      'https://example.com/',
      'https://example.com/contact',
      'https://docs.example.org/help'
    ]);
    const workflow = buildWorkflow(targets);

    expect(workflow).toContain('Public pages to audit, one per line');
    expect(workflow).toContain('          https://example.com/\n          https://example.com/contact');
    expect(workflow).toContain("allowed-hosts: 'example.com,docs.example.org'");
  });

  it('rejects duplicate and empty URL lists', () => {
    expect(() => normalizeTargetUrls([])).toThrow(/at least one/);
    expect(() => normalizeTargetUrls(['https://example.com', 'https://example.com/'])).toThrow(/duplicate/);
  });

  it('accepts an existing GitHub repository URL or owner/name without requesting account access', () => {
    expect(normalizeGitHubRepository(' CarlasHub/example-project ')).toEqual({
      owner: 'CarlasHub',
      name: 'example-project',
      slug: 'CarlasHub/example-project'
    });
    expect(normalizeGitHubRepository('https://github.com/CarlasHub/example-project.git')).toEqual({
      owner: 'CarlasHub',
      name: 'example-project',
      slug: 'CarlasHub/example-project'
    });
  });

  it('rejects non-GitHub hosts and file paths masquerading as repositories', () => {
    expect(() => normalizeGitHubRepository('https://example.com/owner/project')).toThrow(/github.com/);
    expect(() => normalizeGitHubRepository('owner/project/settings')).toThrow(/extra file path/);
  });

  it('opens GitHub’s workflow editor with the generated file prepared', () => {
    const repository = normalizeGitHubRepository('CarlasHub/example-project');
    const editorUrl = new URL(buildGitHubWorkflowEditorUrl(repository, 'name: Accessibility audit\n', 'trunk'));

    expect(editorUrl.origin).toBe('https://github.com');
    expect(editorUrl.pathname).toBe('/CarlasHub/example-project/new/trunk');
    expect(editorUrl.searchParams.get('filename')).toBe('.github/workflows/accessibility-audit.yml');
    expect(editorUrl.searchParams.get('value')).toBe('name: Accessibility audit\n');
  });

  it('uses the repository default branch returned by GitHub', async () => {
    const repository = normalizeGitHubRepository('CarlasHub/ai-agent-sdlc-boilerplate');
    const request = vi.fn(async () => new Response(JSON.stringify({ default_branch: 'main' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    }));

    await expect(resolvePublicRepositoryDefaultBranch(repository, request as typeof fetch))
      .resolves.toBe('main');
    expect(request).toHaveBeenCalledWith(
      'https://api.github.com/repos/CarlasHub/ai-agent-sdlc-boilerplate',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
