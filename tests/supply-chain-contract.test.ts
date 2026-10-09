import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ATTEST_ACTION = 'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2';
const UPLOAD_ACTION = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7';

describe('release supply-chain contract', () => {
  it('generates a reproducible production SBOM with an exact maintained tool', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const generator = await readFile('scripts/lib/release-sbom.mjs', 'utf8');

    expect(packageJson.devDependencies['@cyclonedx/cyclonedx-npm']).toBe('6.0.1');
    expect(packageJson.scripts['generate:sbom']).toBe('node scripts/generate-release-sbom.mjs');
    expect(packageJson.scripts['package:release-bundles']).toContain('package-release-bundles.mjs');
    expect(generator).toContain("'--omit', 'dev'");
    expect(generator).toContain("'--output-reproducible'");
    expect(generator).toContain("'--validate'");
    expect(generator).toContain("'--spec-version', '1.6'");
    expect(generator).toContain('assertKnownNpmOverrideWarning');
  });

  it('attests only tag-built versioned archives with job-scoped write permissions', async () => {
    const workflow = await readFile('.github/workflows/release-smoke.yml', 'utf8');
    const topLevel = workflow.slice(0, workflow.indexOf('\njobs:'));
    const releaseJob = workflow.slice(workflow.indexOf('\n  release-artifacts:'));

    expect(topLevel).toContain('contents: read');
    expect(topLevel).not.toContain('id-token: write');
    expect(topLevel).not.toContain('attestations: write');
    expect(releaseJob).toContain('needs: release-smoke');
    expect(releaseJob).toContain('id-token: write');
    expect(releaseJob).toContain('attestations: write');
    expect(releaseJob.match(new RegExp(ATTEST_ACTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(2);
    expect(releaseJob).toContain('sbom-path: artifacts/accessibility-audit-plugin-${{ steps.metadata.outputs.version }}.cdx.json');
    expect(releaseJob).toContain(UPLOAD_ACTION);
    expect(releaseJob).toContain('if-no-files-found: error');
    expect(releaseJob).not.toContain('contents: write');
    expect(workflow).toContain('RELEASE_TAG: ${{ github.ref_name }}');
    expect(workflow).toContain('run: npm run verify:release-tag');
    expect(workflow.indexOf('run: npm run verify:release-tag'))
      .toBeLessThan(workflow.indexOf('run: npm run package:release-bundles'));
  });

  it('documents the owner-reviewed publication and verification boundary', async () => {
    const [readme, security, marketplace] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('SECURITY.md', 'utf8'),
      readFile('docs/marketplace-submission.md', 'utf8'),
    ]);

    for (const document of [readme, security, marketplace]) {
      expect(document).toContain('CycloneDX 1.6');
      expect(document).toContain('gh attestation verify');
    }
    expect(readme).toContain('does not publish a GitHub release');
    expect(security).toContain('never publishes a GitHub release automatically');
    expect(marketplace).toContain('workflow does not publish a release automatically');
  });
});
