# GitHub Action usage

`CarlasHub/accessibility-audit-plugin` is a free JavaScript Action for collecting structured WCAG 2.2 accessibility evidence in CI. It runs the same site-independent audit engine as the editor plugins and produces a polished self-contained HTML report, a validated Excel workbook, JSON evidence, screenshots, and a portable ZIP.

It is an automated testing aid, not a WCAG certification. WCAG 2.2 Level AA is the conformance target; optional AAA checks are advisory. Complete the report's human assessment before making a conformance claim.

## Minimal workflow

The shortest setup delegates the audit and report upload to the maintained reusable workflow. Add this as `.github/workflows/accessibility-audit.yml` in your project:

```yaml
name: Accessibility audit

on:
  workflow_dispatch:
    inputs:
      url:
        description: Public page to audit
        required: true
        type: string
        default: https://example.com/

permissions:
  contents: read

jobs:
  audit:
    uses: CarlasHub/accessibility-audit-plugin/.github/workflows/reusable-accessibility-audit.yml@v1
    with:
      url: ${{ inputs.url }}
```

Open **Actions → Accessibility audit → Run workflow**, enter a page, and start the run. Its summary links directly to the complete downloadable report. No checkout, browser installation, artifact step, token, or hostname field is required.

The reusable workflow follows the latest compatible `v1` release. For release-controlled environments, use the [standalone workflow](../site/workflow.ts) as a model and pin both Actions to immutable commit SHAs.

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
| `wcag-level` | `AA` | WCAG 2.2 Level AA conformance target. Legacy `AAA` values enable advisory AAA automation but do not change the target. |
| `aaa-advisory` | `false` | Run supported AAA rules as clearly separated advisory evidence. |
| `output-dir` | `accessibility-audit-results` | Output directory, relative to the workspace unless absolute. |
| `landing-page-url` | First URL | Report metadata and same-origin link context; it does not expand scope. |
| `allowed-hosts` | Hosts in `urls` | Optional comma- or newline-separated hostname allowlist. The Action securely derives one from the explicit URLs when omitted. |
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

The Action exposes `output-dir`, `html-path`, `report-path`, `json-path`, `archive-path`, `confirmed-findings`, `review-findings`, `blockers`, `requested-pages`, `audited-pages`, `completed-pages`, `partial-pages`, `not-started-pages`, `skipped-pages`, and `gate-result`. An `if: always()` upload step preserves evidence even when the configured gate fails. Download the workflow artifact, extract it, and open `Accessibility_Audit_Report.html` first; the workbook and raw JSON remain beside it for deeper analysis.

## Native screen-reader evidence

The separate **Native screen-reader evidence** workflow can be started from the repository's Actions tab with an explicit target URL and a bounded navigation-step count. It runs Guidepup on the native combinations it supports in CI:

- VoiceOver with WebKit on macOS;
- NVDA with Firefox on Windows.

Each job uploads JSON, Markdown, HTML, and Playwright artifacts containing the spoken phrase log, browser and operating-system metadata, commands performed, page structure inventory, and limitations. These scripted journeys are supplementary evidence: a qualified tester must still evaluate meaningful announcements, dynamic states, real tasks, supported product combinations, and mobile assistive technology.

## Security and privacy

- Pin third-party Actions to complete commit SHAs and grant the workflow only the permissions it needs.
- The Action derives `allowed-hosts` from `urls`; set it explicitly when a stricter or deliberately different boundary is required. Use `staging-only: 'true'` where naming conventions make it reliable.
- Main-page redirects are checked against the same host and staging restrictions; out-of-scope destinations are rejected and are not accepted as audit results.
- Do not put credentials, session tokens, private URLs, or secrets in `urls` or workflow logs.
- Treat reports and screenshots as potentially sensitive. Set an appropriate artifact retention period and restrict repository access.
- Do not run untrusted pull-request changes with production credentials or network access to private targets.
- Keep manual review in the release process; no automated result proves complete WCAG conformance.

The bundled Action code and Playwright runtime are committed under `action/dist` so a consumer does not run `npm install`. Maintainers reproduce and verify that bundle with `npm run build:action` and `npm run test:action`.

The Action is designed for publicly reachable HTTP(S) pages. Sites that require authentication, CAPTCHA completion, private-network access, or anti-bot exceptions need an explicitly authorized, site-specific workflow and manual review.
