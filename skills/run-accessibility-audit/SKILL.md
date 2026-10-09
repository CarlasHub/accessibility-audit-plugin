---
name: run-accessibility-audit
description: Run a site-independent evidence-backed accessibility pre-audit for explicit WCAG 2.2 A/AA page scope, preserve complete or partial evidence, and export review-ready HTML, Excel, JSON, CSV, SARIF, screenshots, and a portable archive.
---

# Run Accessibility Audit

Call `run_accessibility_audit` once with the supplied targets. Read [test-matrix.md](references/test-matrix.md) before describing coverage and [reporting.md](references/reporting.md) before describing the workbook.

## Procedure

1. Accept explicit HTTP(S) URLs, pasted whitespace-, newline-, bulleted-, numbered-, or JSON-array URL lists, or a supported page-list file. Confirm the exact resolved pages/input, single landing-page QA URL, and auditor in one concise interaction. Use the MCP form when available. Use `Automated` as the editable auditor default and the first resolved URL as the landing-page default. Do not ask for page details already present in a supplied list.
2. Audit only explicit authorized URLs. Use narrow `allowedHosts` for an approved host plus its subdomains, or `exactHosts` for literal-only host boundaries. Use optional `maxPages` when the operator needs a hard ceiling on the authorized deduplicated page count; an exceeded ceiling must stop before browser startup and must never truncate silently. Set `stagingOnly` only for an explicitly staging-only scope whose hosts match staging, QA, preview, test, or local patterns.
3. Run desktop, mobile, and 320px reflow headlessly with Chromium by default or the operator's opt-in Firefox/WebKit engine. If the selected browser is unavailable, allow the plugin to install its matching Playwright browser once in plugin-owned storage after confirmation. Browser channels are Chromium-only. Dismiss visible consent banners first, preferring reject or necessary-only actions, and record the result. If a modal remains, report an interaction-coverage blocker and do not treat underlying interaction checks as executed. Keep contextual component screenshots enabled and retain at most one representative image per final confirmed, blocker, or review reporting unit when capture succeeds. Surface MCP progress.
4. For protected pages, accept only the path to an operator-approved local Playwright storage-state file. Never request or repeat credentials, tokens, one-time codes, the state-file contents, or its path in summaries and final responses. Treat the file and authenticated output as confidential, keep the file outside source control and report directories, use least privilege, and recommend revocation or deletion after use.
5. If the user stops the run, let the tool close the selected browser and write and validate partial JSON/XLSX/ZIP output. Report it as cancelled, not complete.
6. Keep deterministic failures confirmed; keep heuristics, placeholder links, 5xx responses, content judgments, and WCAG exceptions as review/manual work. A 404/410 is confirmed only when the two implemented same-origin checks agree.
7. Use one row for the same reusable component implementation and root cause across affected pages. Group repeated instances within that component instead of creating one row per DOM node. Keep page-specific implementations, colour treatments, behaviours, criteria, or remediation requirements separate, and list each affected URL separately in Links. Do not report missing `aria-controls` alone as a WCAG failure or standalone review for ordinary disclosures/accordions. Confirm a stale `aria-expanded` value only after the intended live control receives focus, the interaction is performed, JavaScript/animations settle, the control and panel are re-queried, and one final DOM snapshot proves a mismatch with controlled-content visibility. Retain hidden/inactive clones, ambiguous identities, detached controls, incomplete or unsettled interactions in JSON and inconclusive coverage without creating a finding. Do not require generic disclosures/accordions to close with Escape.
8. Preserve axe violations, incomplete results, related nodes, keyboard-cycle/truncation and focus samples, incomplete interactions, link candidate/check counts, consent outcomes, interaction blockers, and the per-page/per-viewport coverage matrix in JSON. Never convert an incomplete, truncated, sampled, absent, or unperformed check into a finding or pass.
9. Validate the workbook. Report run status, exact HTML/workbook/JSON/CSV/SARIF/ZIP paths, completed/partial/not-started page counts, finding and evidence counts, and validation result. Present the returned HTML resource link when the client supports it.
10. Give a plain-language handoff suitable for a user unfamiliar with WCAG: explain that only supplied URLs were tested, define each result category present, distinguish workflow Status from evidence confidence, identify outstanding manual work, and explain that the extracted workbook must remain beside its screenshot tree.

## Boundaries

- Treat the target repository as read-only and write only to the audit output directory.
- Do not install plugin dependencies in or modify the target project, governance, rules, CI, hooks, manifests, lockfiles, or source.
- The plugin does not crawl. A complete-site audit requires a complete URL list.
- The plugin does not run a screen reader. Retain screen-reader, physical-device, content, visual, and judgment-based procedures as manual checks.
- Do not call the result a certification or complete WCAG conformance verdict.
- Do not present an axe pass or absence of an automated signal as proof of accessibility.
- Notes contain specific remediation only and no workflow or ticket commentary.
- Preserve the seven-sheet CarlasHub WCAG workbook structure, worksheet order, fields, formulas, validations, and styles. The seventh sheet is the generated WCAG Criteria ledger; do not add or rename workbook fields, columns, or worksheets during a run.
- Page Inventory includes every requested URL and its audit state. Evidence contains portable relative screenshot hyperlinks with finding and test context. Component evidence is cropped around the component and target; full-page evidence is reserved for page-level failures or blockers without a component locator. Audit images are not embedded; native screen-reader transcripts are published separately because they are supporting evidence, not automated conformance proof.
- Audit Summary contains the landing-page QA URL. Findings start as `Open`; evidence confidence remains separately recorded as `confirmed`, `review`, `blocker`, or `manual`.
