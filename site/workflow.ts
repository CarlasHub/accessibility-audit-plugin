const ACTION_VERSION = 'v1';
const UPLOAD_ARTIFACT_SHA = '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';

export interface AuditTarget {
  hostname: string;
  url: string;
}

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

export function buildWorkflow(target: AuditTarget): string {
  const targetUrl = yamlSingleQuoted(target.url);
  const allowedHost = yamlSingleQuoted(target.hostname);

  return `name: Accessibility audit

on:
  workflow_dispatch:
    inputs:
      url:
        description: Public page to audit
        required: true
        type: string
        default: ${targetUrl}

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
          urls: \${{ inputs.url }}
          allowed-hosts: ${allowedHost}
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
