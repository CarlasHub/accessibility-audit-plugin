---
name: run-accessibility-audit
description: Run a headless evidence-backed WCAG 2.2 A/AA audit of explicit URLs or an XLSX/CSV/TXT/JSON page list and generate a validated Excel report with element screenshot evidence. Do not use to claim complete conformance from automation alone.
---

# Run Accessibility Audit

Call `run_accessibility_audit` once with the supplied targets. Read [test-matrix.md](references/test-matrix.md) before describing coverage and [reporting.md](references/reporting.md) before describing the workbook.

## Procedure

1. Confirm the exact pages/input, single landing-page QA URL, and auditor in one concise interaction. Use the MCP form when available. Use `Automated` as the editable auditor default and the first resolved URL as the landing-page default. Do not ask for page details already present in a supplied list.
2. Audit only explicit authorized URLs. Use narrow `allowedHosts` when requested. Set `stagingOnly` only for an explicitly staging-only scope whose hosts match staging, QA, preview, test, or local patterns.
3. Run desktop, mobile, and 320px reflow headlessly. If no supported browser is available, allow the plugin to install Playwright Chromium once in plugin-owned storage after confirmation. Dismiss visible consent banners first, preferring reject or necessary-only actions, and record the result. Keep contextual component screenshots enabled for confirmed failures and page blockers. Surface MCP progress.
4. If the user stops the run, let the tool close Chromium and write and validate partial JSON/XLSX/ZIP output. Report it as cancelled, not complete.
5. Keep deterministic failures confirmed; keep heuristics, placeholder links, 5xx responses, content judgments, and WCAG exceptions as review/manual work. A 404/410 is confirmed only when the two implemented same-origin checks agree.
6. Use one row for the same reusable component implementation and root cause across affected pages. Keep page-specific implementations or root causes separate, and list each affected URL separately in Links.
7. Validate the workbook. Report run status, exact workbook/JSON/ZIP paths, completed/partial/not-started page counts, finding counts, Image Inventory count, and validation result.
8. Give a plain-language handoff suitable for a user unfamiliar with WCAG: explain that only supplied URLs were tested, define each result category present, distinguish workflow Status from evidence confidence, identify outstanding manual work, and explain that the extracted workbook must remain beside its screenshot tree.

## Boundaries

- Treat the target repository as read-only and write only to the audit output directory.
- Do not install plugin dependencies in or modify the target project, governance, rules, CI, hooks, manifests, lockfiles, or source.
- The plugin does not crawl. A complete-site audit requires a complete URL list.
- The plugin does not run a screen reader. Retain screen-reader, physical-device, content, visual, and judgment-based procedures as manual checks.
- Do not call the result a certification or complete WCAG conformance verdict.
- Do not present an axe pass or absence of an automated signal as proof of accessibility.
- Notes contain specific remediation only and no workflow or ticket commentary.
- Preserve the 32-column report schema and remove placeholder findings.
- Image Inventory names the rendered component and location and contains relative links to unique confirmed-failure and blocker screenshots. Component evidence is cropped around the component and target; full-page evidence is reserved for page-level failures or blockers without a component locator. Audit images are not embedded and no screen-reader worksheet is created.
- Accessibility Overview contains one landing-page QA URL. All report rows start as Fail, Assignment defaults to Implementation Queue unless specialist ownership is justified, and Estimate starts at numeric 0 with 0.25 increments allowed.
