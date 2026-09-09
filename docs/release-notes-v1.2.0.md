# v1.2.0 — Professional reports and complete tutorial

This release replaces the earlier BuggyLand deliverables with a clearer, professional report set and a complete beginning-to-end walkthrough.

## What changed

- Added a polished, self-contained HTML report with an executive summary, searchable and filterable findings, detailed remediation guidance, page inventory, coverage evidence, manual checks, and print styling.
- Rebuilt the enhanced WCAG workbook for Excel and LibreOffice compatibility, with an executive summary, all 86 active WCAG 2.2 criteria, all 172 declared BuggyLand fixtures, 70 consolidated findings, test coverage, a manual plan, and run metadata.
- Added a 79-second captioned tutorial that starts with the repository and workflow, shows how to run the audit, opens the completed public run, identifies the downloadable artifact, and demonstrates both report formats.
- Added the HTML report to the Action outputs and portable ZIP bundle.

## Verified demonstration

The final public [BuggyLand GitHub Actions run](https://github.com/CarlasHub/buggyland/actions/runs/34391886799) audited both published pages at WCAG 2.2 Level AAA with zero execution errors. It produced 70 consolidated findings: 52 confirmed failures and 18 items requiring review.

BuggyLand declares 172 intentional fixtures across the 86 active WCAG 2.2 success criteria. The Action result is deliberately not presented as 172 passes or failures: repeated evidence is consolidated, and requirements that need human judgment remain in the manual plan.

See the [benchmark evidence guide](https://github.com/CarlasHub/accessibility-audit-plugin/blob/v1.2.0/docs/buggyland-benchmark.md) and [tutorial transcript](https://github.com/CarlasHub/accessibility-audit-plugin/blob/v1.2.0/docs/buggyland-github-action-tutorial-transcript.md) for context.
