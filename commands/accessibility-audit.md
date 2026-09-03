---
name: accessibility-audit
description: Run the isolated headless desktop, mobile, reflow, link, keyboard, and screenshot audit and generate the validated Excel report.
---

Call the installed MCP tool `run_accessibility_audit` once with the URL(s) or page-list path supplied after this command. The tool owns testing, evidence capture, report generation, graceful cancellation, and workbook validation.

Before execution, confirm the exact pages/input, the single landing-page QA URL, and the auditor in one interaction. Use the tool form when supported. The editable auditor default is `Automated`; the landing page defaults to the first resolved URL. If no target was supplied, ask for explicit HTTP(S) URLs or one XLSX, CSV, TXT, or JSON page-list file. Do not request a report template because the plugin bundles it.

Use headless desktop, mobile, and 320px reflow checks. Dismiss visible consent banners before interaction checks and evidence capture. Keep contextual component screenshots enabled for confirmed failures and blockers; allow full-page screenshots only for page-level findings without a component locator. Surface progress. If the user stops the tool, allow partial JSON/XLSX/ZIP generation and validation to finish, then report the run as cancelled.

Keep the target repository read-only. Do not install dependencies in or modify the target project, its governance, rules, CI, hooks, manifests, lockfiles, or source. Write only to the configured audit output directory.

Use one row for the same reusable component implementation and root cause across all affected pages; keep page-specific implementations or root causes separate. List every affected page individually in Links. Preserve confirmed, review, blocker, and manual classifications. Report the exact workbook, JSON, and ZIP paths, page counts, finding counts, Image Inventory count, and validation result.

Explain the result in plain language. State that the plugin tests only supplied URLs, an empty automated result is not proof of WCAG conformance, review items need the Testing procedure, blockers were not tested, and guided manual checks remain outstanding. Tell the user to extract the ZIP and keep the workbook with its screenshot tree so evidence links work.
