# A11y Test Cases GitHub Actions tutorial transcript

This is the text transcript for the silent, captioned 111-second walkthrough. It documents the successful public GitHub Actions run at <https://github.com/CarlasHub/a11y-test-cases/actions/runs/34448319858>, recorded on 10 September 2026.

## 00:00 — Introduction

Run a WCAG audit with GitHub Actions. Start to results on a different repository. Target: `carlashub.github.io/a11y-test-cases/`.

## 00:05 — Open the target repository

Open the repository that will run the audit. The example repository is `CarlasHub/a11y-test-cases`.

## 00:11 — Confirm the live URL

Confirm the live website URL you want to test. This demonstration audits <https://carlashub.github.io/a11y-test-cases/>.

## 00:17 — Create the workflow

Create `.github/workflows/accessibility-audit.yml`. Use `CarlasHub/accessibility-audit-plugin@v1`, list the URL and allowed host, and choose a WCAG level.

## 00:29 — Open GitHub Actions

Commit the workflow, then open the **Actions** tab. Select the workflow named **WCAG accessibility audit**.

## 00:35 — Run the workflow

Select **Run workflow**, choose `main`, then start the run. The workflow uses `workflow_dispatch`, so you can launch it whenever you need fresh evidence.

## 00:44 — Watch the run

Open the new run and watch the audit execute. GitHub provisions the runner, scans the live page, and builds the report package.

## 00:50 — Inspect the steps

Open the **audit** job to inspect every completed step. The evidence upload step runs even when an audit finds accessibility failures.

## 00:57 — Confirm completion

Confirm the green **Success** status and read the summary. This run completed one page: 51 confirmed findings, 1 review finding, and 7 guided manual checks.

## 01:05 — Download the artifact

Select **Artifacts**, then download **accessibility-audit**. The ZIP contains the HTML report, XLSX workbook, JSON evidence, and screenshots.

## 01:13 — Open the HTML report

Extract the ZIP and open `Accessibility_Audit_Report.html`. The overview separates confirmed findings, review items, and manual checks.

## 01:21 — Review detailed findings

Search and filter the detailed findings. Expand a finding for impact, verification steps, remediation guidance, and linked screenshots.

## 01:28 — Open the workbook

Open `Accessibility_Audit_Report.xlsx` for triage. The workbook provides an executive summary and structured evidence for teams.

## 01:36 — Complete the manual checks

Complete the guided checks that automation cannot prove. Use the **Manual Checks** sheet for keyboard, screen-reader, zoom, content, cognition, and device testing.

## 01:44 — Finish

One workflow can audit any allowed public website. Combine automated evidence with guided human review. Automated results are not a WCAG certificate.
