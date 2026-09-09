# GitHub Action usage

`CarlasHub/accessibility-audit-plugin` is a free JavaScript Action for collecting structured WCAG 2.2 accessibility evidence in CI. It runs the same site-independent audit engine as the editor plugins and produces a validated Excel workbook, JSON evidence, screenshots, and a portable ZIP.

It is an automated testing aid, not a WCAG certification. Complete the report's manual checks before making a conformance claim.

## Minimal workflow

```yaml
name: Accessibility audit

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - id: audit
        uses: CarlasHub/accessibility-audit-plugin@v1
        with:
          urls: https://preview.example.test/
          allowed-hosts: preview.example.test
      - name: Upload evidence
        if: always() && steps.audit.outputs.output-dir != ''
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: accessibility-audit
          path: ${{ steps.audit.outputs.output-dir }}
```

Use a full release commit SHA instead of `@v1` when your threat model requires immutable third-party Action references. The maintained `v1` tag follows the latest compatible `v1.x.x` release.

## Pull-request summaries

To create or update one audit comment, grant pull-request write access and pass the workflow token:

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: CarlasHub/accessibility-audit-plugin@v1
    with:
      urls: https://preview.example.test/
      github-token: ${{ secrets.GITHUB_TOKEN }}
      comment-on-pr: 'true'
```

The Action uses the GitHub REST API only to list, create, or update its marked pull-request comment. A missing or read-only token does not discard the audit; it emits a warning and continues. Workflows triggered from forks commonly receive a read-only token.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `urls` | Required | One explicit HTTP(S) URL per line, or a JSON string array. The Action does not crawl. |
| `auditor` | `GitHub Actions` | Auditor name written into the workbook. |
| `output-dir` | `accessibility-audit-results` | Output directory, relative to the workspace unless absolute. |
| `landing-page-url` | First URL | Report metadata and same-origin link context; it does not expand scope. |
| `allowed-hosts` | Empty | Comma- or newline-separated hostname allowlist. Strongly recommended. |
| `staging-only` | `false` | Reject hosts that do not look like staging, QA, preview, test, or local hosts. |
| `capture-screenshots` | `true` | Retain contextual screenshot evidence when reproducible. |
| `browser-channel` | Empty | Optional installed Playwright channel such as `chrome`. |
| `auto-install-browser` | `true` | Install Playwright Chromium when no compatible browser is available. |
| `concurrency` | `2` | Concurrent pages, from 1 to 8. |
| `timeout-ms` | `30000` | Per-operation timeout in milliseconds. |
| `report-name` | `Accessibility_Audit_Report.xlsx` | Excel report filename. |
| `fail-on` | `none` | `none`, `blockers`, `confirmed`, `critical`, `serious`, `moderate`, or `minor`. |
| `comment-on-pr` | `true` | Attempt the marked pull-request summary when a token is supplied. |
| `github-token` | Empty | Token used only for the pull-request summary. |

## Quality gates

`none` records evidence without failing the job. `blockers` fails when a page could not be audited. `confirmed` fails on any confirmed finding. A severity policy fails on confirmed findings at that severity or higher. Review and manual items never fail a severity gate because automation has not established that they are defects.

Start with `none` while establishing a baseline. Move to a severity policy after the audited URLs are stable and the team has reviewed the evidence model.

## Outputs

The Action exposes `output-dir`, `report-path`, `json-path`, `archive-path`, `confirmed-findings`, `review-findings`, `blockers`, and `gate-result`. An `if: always()` upload step preserves evidence even when the configured gate fails.

## Security and privacy

- Pin third-party Actions to complete commit SHAs and grant the workflow only the permissions it needs.
- Use `allowed-hosts`; use `staging-only: 'true'` where naming conventions make it reliable.
- Do not put credentials, session tokens, private URLs, or secrets in `urls` or workflow logs.
- Treat reports and screenshots as potentially sensitive. Set an appropriate artifact retention period and restrict repository access.
- Do not run untrusted pull-request changes with production credentials or network access to private targets.
- Keep manual review in the release process; no automated result proves complete WCAG conformance.

The bundled Action code and Playwright runtime are committed under `action/dist` so a consumer does not run `npm install`. Maintainers reproduce and verify that bundle with `npm run build:action` and `npm run test:action`.
