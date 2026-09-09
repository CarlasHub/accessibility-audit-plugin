# BuggyLand GitHub Action tutorial transcript

This silent, captioned walkthrough was recorded on 9 September 2026. It documents the successful public GitHub Actions run at <https://github.com/CarlasHub/buggyland/actions/runs/34391886799>.

## 00:00 — Choose the free CarlasHub GitHub Action

Open the repository and copy the workflow example. The Action audits public URLs and produces HTML, XLSX, JSON, screenshots, and a portable ZIP bundle.

## 00:08 — Add the workflow to your project

Create `.github/workflows/accessibility-audit.yml`, set the public URL or URLs, choose WCAG 2.2 and Level AA or AAA, then commit the file. The demonstrated BuggyLand workflow audits both published pages at Level AAA.

## 00:20 — Run the audit from GitHub

Open **Actions → Buggyland WCAG audit → Run workflow**, choose the `main` branch, and press **Run workflow**. A push also starts the workflow when `push` is configured as a trigger.

## 00:29 — Watch the run and open its job

Public run `34391886799` completed against both published pages with zero execution errors. Select its `accessibility-audit` job to inspect the audited URLs and execution log.

## 00:40 — Download the results artifact

At the bottom of the completed run, find **Artifacts** and download `buggyland-accessibility-audit`. Unzip it on your computer. GitHub retains this workflow's artifact for 90 days.

## 00:49 — Find every result in the downloaded folder

Open `Accessibility_Audit_Report.html` first. The folder also contains `Accessibility_Audit_Report.xlsx`, `audit-results.json`, screenshots, and `accessibility-audit-results.zip`.

## 00:57 — Use the interactive HTML report

The report presents 70 consolidated results: 52 confirmed automated failures and 18 review items. Search, filter by severity or status, expand a finding, and follow its WCAG guidance and evidence links.

## 01:09 — Open the validated workbook for triage

Automation produced evidence for 37 of the 86 active WCAG 2.2 success criteria. The other 49 remain explicitly marked for human verification. An absent automated result never means that a criterion passed.

The enhanced workbook opens in Excel and LibreOffice and contains the executive summary, complete criteria matrix, 172-fixture inventory, automated findings, test coverage, manual plan, and run metadata. It is benchmark evidence, not a WCAG conformance claim.
