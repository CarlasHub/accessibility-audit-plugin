# BuggyLand GitHub Action tutorial transcript

This silent, captioned walkthrough was recorded on 9 September 2026. It documents the successful public GitHub Actions run at <https://github.com/CarlasHub/buggyland/actions/runs/34384488369>.

## 00:00 — Start with the free CarlasHub GitHub Action

The repository contains the reusable action, usage example, documentation, and source code.

## 00:08 — Configure the public audit

The BuggyLand workflow audits both published pages at WCAG 2.2 Level AAA and retains downloadable evidence for 90 days.

## 00:18 — Open the successful GitHub Actions run

The public run completed against the published site with zero execution errors. Its artifact contains the original Action workbook and `audit-results.json`.

## 00:31 — Inspect the intentional failures

BuggyLand is a benchmark. Every card declares a WCAG success criterion and two intentional failure examples. The Action evaluates the rendered pages, rather than treating those declarations as test results.

## 00:47 — Read the enhanced benchmark report

The Action returned 70 consolidated results: 52 confirmed automated failures and 18 review items. This differs from the 172 benchmark fixtures because repeated selectors and viewports are consolidated, and many WCAG requirements require human judgment.

## 00:55 — Finish the manual WCAG evaluation

Automation produced evidence for 37 of the 86 active WCAG 2.2 success criteria. The other 49 remain explicitly marked for human verification. An absent automated result never means that a criterion passed.

The enhanced workbook contains the executive summary, complete criteria matrix, 172-fixture inventory, automated findings, test coverage, manual plan, and run metadata. It is benchmark evidence, not a WCAG conformance claim.
