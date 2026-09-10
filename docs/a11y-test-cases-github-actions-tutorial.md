# Run the accessibility audit from another repository

This tutorial shows the complete GitHub Actions process using the separate [`CarlasHub/a11y-test-cases`](https://github.com/CarlasHub/a11y-test-cases) repository and its public site at <https://carlashub.github.io/a11y-test-cases/>.

[Watch the 111-second captioned video](https://github.com/CarlasHub/accessibility-audit-plugin/releases/download/v1.2.1/A11y_Test_Cases_GitHub_Actions_Tutorial.mp4) or inspect the [successful public demonstration run](https://github.com/CarlasHub/a11y-test-cases/actions/runs/34448319858).

## Before you start

You need a GitHub repository where you can commit a workflow. The website may be hosted from that repository or somewhere else. For a public website, this example needs no password, API key, paid plan, or marketplace installation.

The Action audits only the URLs you provide. It does not automatically crawl an entire website.

## 1. Create the workflow

Open the repository that will run the audit. Add a file named:

```text
.github/workflows/accessibility-audit.yml
```

Paste this workflow into the file:

```yaml
name: WCAG accessibility audit

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Audit the live test-case site
        id: audit
        uses: CarlasHub/accessibility-audit-plugin@v1
        with:
          urls: https://carlashub.github.io/a11y-test-cases/
          allowed-hosts: carlashub.github.io
          wcag-level: AAA
          fail-on: none
          comment-on-pr: 'false'

      - name: Upload audit evidence
        if: always() && steps.audit.outputs.output-dir != ''
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: accessibility-audit
          path: ${{ steps.audit.outputs.output-dir }}
          retention-days: 14
```

Commit the file to the repository's default branch. In the demonstration, that branch is `main`.

What the important settings mean:

- `uses: CarlasHub/accessibility-audit-plugin@v1` uses the stable major-version release.
- `urls` is the exact live page to audit. Add more URLs on separate indented lines if needed.
- `allowed-hosts` is a safety boundary. It must contain every hostname the audit may visit.
- `wcag-level: AAA` includes automated evidence mapped to WCAG 2.2 Levels A, AA, and AAA.
- `fail-on: none` keeps this demonstration informational even when confirmed barriers are found.
- `if: always()` preserves the evidence artifact even if a future severity gate fails the audit step.

## 2. Start the audit in GitHub Actions

1. Open the repository's **Actions** tab.
2. Select **WCAG accessibility audit** in the workflow list.
3. Select **Run workflow**.
4. Choose the `main` branch.
5. Select the green **Run workflow** button.
6. Open the newest workflow run when it appears.

GitHub provisions a runner, audits the live URL, builds the reports, and uploads the result package. Open the **audit** job to see each step and its logs.

## 3. Download the results

After the run shows a green **Success** status:

1. Return to the run summary page.
2. Find **Artifacts** near the bottom of the page.
3. Select **accessibility-audit** to download the ZIP.
4. Extract the downloaded ZIP before opening its contents.

The artifact contains:

- `Accessibility_Audit_Report.html` — the fastest way to review and filter findings.
- `Accessibility_Audit_Report.xlsx` — structured triage, evidence, page inventory, manual checks, and WCAG reference sheets.
- `audit-results.json` — machine-readable evidence for integrations.
- `screenshots/` — captured element evidence linked from the reports.

Keep the workbook beside the `screenshots` folder so its evidence links continue to work.

## 4. Review the evidence

Open `Accessibility_Audit_Report.html` in a browser. Use its search and filters, then expand a finding for its impact, verification steps, remediation guidance, WCAG mapping, and available screenshot evidence.

Open `Accessibility_Audit_Report.xlsx` in Excel or LibreOffice for assignment and remediation tracking. Review the **Audit Summary**, **Findings**, **Page Inventory**, **Evidence**, **Manual Checks**, and **WCAG 2.2 Reference** sheets.

The public demonstration run completed one page with:

- 52 total findings
- 51 confirmed findings
- 1 finding requiring human review
- 7 guided manual checks
- 0 execution blockers

## 5. Complete the human checks

Automated testing cannot prove full WCAG conformance. Complete the guided checks in the HTML report or the workbook's **Manual Checks** sheet, including keyboard-only use, supported screen-reader and browser combinations, zoom and reflow, component-state contrast, content meaning, cognitive consistency, and physical mobile-device testing.

The final accessibility decision should combine the generated evidence with qualified human evaluation.

## Adapt it for your own website

Change `urls` and `allowed-hosts`, then commit the workflow in your own repository. For multiple pages, use YAML's multi-line form:

```yaml
with:
  urls: |
    https://example.com/
    https://example.com/contact
    https://example.com/checkout
  allowed-hosts: example.com
```

For authenticated or restricted sites, review the [GitHub Action security and input guidance](github-action.md) before adding credentials or private network access.
