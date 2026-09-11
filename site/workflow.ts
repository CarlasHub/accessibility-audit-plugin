const ACTION_VERSION = 'v1';
const UPLOAD_ARTIFACT_SHA = '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';

export interface AuditTarget {
  hostname: string;
  url: string;
}

export interface GitHubRepository {
  name: string;
  owner: string;
  slug: string;
}

export const MAX_AUDIT_TARGETS = 20;

export function normalizeTargetUrl(rawValue: string): AuditTarget {
  const trimmed = rawValue.trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a complete URL beginning with https:// or http://.');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Only public http:// or https:// pages can be audited.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Remove usernames, passwords, or other credentials from the URL.');
  }
  if (!parsed.hostname) {
    throw new Error('Enter a URL with a valid hostname.');
  }

  return {
    hostname: parsed.hostname.toLowerCase().replace(/\.+$/, ''),
    url: parsed.toString()
  };
}

function yamlSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function normalizeTargetUrls(rawValues: string[]): AuditTarget[] {
  const populatedValues = rawValues.map((value) => value.trim()).filter(Boolean);

  if (populatedValues.length === 0) {
    throw new Error('Add at least one complete URL beginning with https:// or http://.');
  }
  if (populatedValues.length > MAX_AUDIT_TARGETS) {
    throw new Error(`Add no more than ${MAX_AUDIT_TARGETS} URLs to one audit.`);
  }

  const targets = populatedValues.map(normalizeTargetUrl);
  const seenUrls = new Set<string>();

  for (const target of targets) {
    if (seenUrls.has(target.url)) {
      throw new Error(`Remove the duplicate URL: ${target.url}`);
    }
    seenUrls.add(target.url);
  }

  return targets;
}

export function normalizeGitHubRepository(rawValue: string): GitHubRepository {
  const trimmed = rawValue.trim();
  if (!trimmed) throw new Error('Enter a GitHub repository URL or owner/name.');

  let slug = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error('Enter a valid GitHub repository URL or owner/name.');
    }

    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
      throw new Error('Use a repository on github.com, such as owner/project.');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('Remove credentials, query parameters, or fragments from the repository URL.');
    }

    slug = parsed.pathname.replace(/^\/+|\/+$/g, '');
  }

  slug = slug.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = slug.split('/');
  if (parts.length !== 2) {
    throw new Error('Use only the repository URL or owner/name, without an extra file path.');
  }

  const owner = parts[0];
  const name = parts[1];
  if (!owner || !name) {
    throw new Error('Enter a valid GitHub owner and repository name.');
  }
  const validOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner);
  const validName = name.length <= 100 && /^[A-Za-z0-9._-]+$/.test(name);
  if (!validOwner || !validName) {
    throw new Error('Enter a valid GitHub owner and repository name.');
  }

  return { owner, name, slug: `${owner}/${name}` };
}

export function buildGitHubWorkflowEditorUrl(
  repository: GitHubRepository,
  workflow: string,
  defaultBranch = 'main'
): string {
  const branch = defaultBranch.trim();
  if (!branch || branch.length > 255) {
    throw new Error('GitHub returned an invalid default branch for this repository.');
  }

  const editorUrl = new URL(
    `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/new/${encodeURIComponent(branch)}`
  );
  editorUrl.searchParams.set('filename', '.github/workflows/accessibility-audit.yml');
  editorUrl.searchParams.set('value', workflow);
  return editorUrl.href;
}

export function buildWorkflow(targets: AuditTarget | AuditTarget[]): string {
  const auditTargets = Array.isArray(targets) ? targets : [targets];
  if (auditTargets.length === 0) throw new Error('Add at least one URL to build a workflow.');

  const targetLines = auditTargets.map((target) => `          ${target.url}`).join('\n');
  const allowedHosts = [...new Set(auditTargets.map((target) => target.hostname))].join(',');
  const targetLabel = auditTargets.length === 1 ? 'Public page to audit' : 'Public pages to audit, one per line';

  return `name: Accessibility audit

on:
  workflow_dispatch:
    inputs:
      urls:
        description: ${targetLabel}
        required: true
        type: string
        default: |-
${targetLines}

permissions:
  contents: read

jobs:
  audit:
    name: Audit website
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - id: audit
        name: Run WCAG 2.2 audit
        uses: CarlasHub/accessibility-audit-plugin@${ACTION_VERSION}
        with:
          urls: \${{ inputs.urls }}
          allowed-hosts: ${yamlSingleQuoted(allowedHosts)}
          fail-on: none
          comment-on-pr: 'false'

      - id: report
        name: Upload the complete report
        if: always() && steps.audit.outputs.output-dir != ''
        uses: actions/upload-artifact@${UPLOAD_ARTIFACT_SHA} # v7
        with:
          name: accessibility-audit
          path: \${{ steps.audit.outputs.output-dir }}
          if-no-files-found: error
          retention-days: 14

      - name: Add the report link to the run summary
        if: always() && steps.report.outputs.artifact-url != ''
        env:
          ARTIFACT_URL: \${{ steps.report.outputs.artifact-url }}
        run: |
          {
            echo '## Accessibility report ready'
            echo
            echo "[Download the complete report]($ARTIFACT_URL)"
          } >> "$GITHUB_STEP_SUMMARY"
`;
}
