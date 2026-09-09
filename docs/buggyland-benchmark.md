# BuggyLand WCAG 2.2 benchmark evidence

This page records the public end-to-end test of the CarlasHub Accessibility Audit GitHub Action against [BuggyLand](https://carlashub.github.io/buggyland/), a deliberately inaccessible benchmark site.

## Verified public run

- **GitHub Actions run:** [BuggyLand WCAG audit #3](https://github.com/CarlasHub/buggyland/actions/runs/34384488369)
- **Action version tested:** commit [`e633f49`](https://github.com/CarlasHub/accessibility-audit-plugin/commit/e633f4910616fb9ce1ddf4698686240662d0aa93)
- **Scope:** both published BuggyLand pages
- **Requested standard:** WCAG 2.2 Levels A, AA, and AAA
- **Execution:** 2 pages audited, 0 page errors
- **Machine results:** 70 consolidated findings: 52 confirmed and 18 requiring review
- **Benchmark inventory:** 172 declared failure fixtures across all 86 active WCAG 2.2 success criteria
- **Criterion reach:** automated evidence mapped to 37 criteria; 49 criteria remain explicitly assigned to human verification

The workflow keeps its GitHub Actions artifact for 90 days. The v1.1.0 release keeps permanent copies:

- [Enhanced WCAG benchmark workbook](https://github.com/CarlasHub/accessibility-audit-plugin/releases/download/v1.1.0/BuggyLand_WCAG_2.2_Benchmark_Report.xlsx)
- [Original Action workbook](https://github.com/CarlasHub/accessibility-audit-plugin/releases/download/v1.1.0/BuggyLand_GitHub_Action_Original_Report.xlsx)
- [Raw Action JSON](https://github.com/CarlasHub/accessibility-audit-plugin/releases/download/v1.1.0/buggyland-audit-results.json)
- [Captioned tutorial video](https://github.com/CarlasHub/accessibility-audit-plugin/releases/download/v1.1.0/BuggyLand_GitHub_Action_Tutorial.mp4)

## Why 172 fixtures do not produce 172 findings

BuggyLand's number is a declared test-fixture inventory, not an expected automated finding count. Each fixture demonstrates an intentionally broken example associated with a success criterion. The Action independently tests the rendered pages and reports only evidence its rules actually establish.

The result count is lower because:

1. Related nodes, repeated selectors, and viewport occurrences are consolidated into a remediation-sized finding.
2. Several fixtures can expose the same underlying defect or automated rule.
3. Some rules surface evidence for review rather than proving a failure because WCAG exceptions or context still need judgment.
4. Many requirements—such as the meaning of alternatives, captions, audio description, reading order, focus logic, input purpose, error recovery, and accessible authentication—cannot be conclusively evaluated by an automated browser rule alone.

Therefore, an absent automated finding means **not detected**, not **passed**. W3C states that evaluation tools cannot determine accessibility on their own and recommends combining tools with knowledgeable human evaluation.

## What the enhanced workbook adds

The release workbook preserves the Action results and adds the benchmark context needed to answer “what was tested?”:

1. **Executive Summary** — totals, scope, outcome definitions, and limitations.
2. **Criteria Matrix** — every active WCAG 2.2 success criterion, its level, fixture count, automated evidence count, and W3C link.
3. **Fixture Inventory** — all 172 declared BuggyLand examples with page and criterion traceability.
4. **Automated Findings** — all 70 consolidated results from the Action.
5. **Test Coverage** — machine rules and checks executed, including viewports and states.
6. **Manual Plan** — the human decision still required for every criterion, with automation status kept separate.
7. **Run Metadata** — source URLs, workflow run, commit, timestamps, and evidence notes.

The workbook is an evidence and remediation aid, not a conformance certificate. Follow the [WCAG Evaluation Methodology](https://www.w3.org/WAI/test-evaluate/conformance/wcag-em/) and the [W3C reporting template](https://www.w3.org/WAI/test-evaluate/report-template/) when making a formal claim.

## Reproduce the audit

Copy [BuggyLand's workflow](https://github.com/CarlasHub/buggyland/blob/main/.github/workflows/accessibility-audit.yml), or trigger it manually from the repository's **Actions** tab. It audits these explicit URLs:

```text
https://carlashub.github.io/buggyland/
https://carlashub.github.io/buggyland/aaa.html
```

Use the [WCAG 2.2 standard](https://www.w3.org/TR/WCAG22/) and [How to Meet WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/) as the normative and implementation references while completing the manual plan.
