import { describe, expect, it } from 'vitest';
import { buildWorkflow, normalizeTargetUrl, normalizeTargetUrls } from '../site/workflow.js';

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
});
