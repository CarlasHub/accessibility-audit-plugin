---
name: accessibility-audit
description: Run the isolated headless desktop, mobile, reflow, link, keyboard, and screenshot audit and generate the validated Excel report.
---

Call the installed MCP tool `run_accessibility_audit` once with the URL(s) or page-list path supplied after this command. The tool owns testing, evidence capture, report generation, graceful cancellation, and workbook validation.

Before execution, confirm the exact pages/input and the auditor in one interaction. Use the tool form when supported. The editable auditor default is `Automated`. If no target was supplied, ask for explicit HTTP(S) URLs or one XLSX, CSV, TXT, or JSON page-list file. Do not request a report template because the plugin bundles it.

Use headless desktop, mobile, and 320px reflow checks with screenshots enabled. Surface progress. If the user stops the tool, allow partial JSON/XLSX generation and validation to finish, then report the run as cancelled.

Keep the target repository read-only. Do not install dependencies in or modify the target project, its governance, rules, CI, hooks, manifests, lockfiles, or source. Write only to the configured audit output directory.

Keep findings separate per page unless evidence proves the same reusable component implementation and root cause. List every affected page individually in Links. Preserve confirmed, review, blocker, and manual classifications. Report the exact output paths, page counts, finding counts, Image Inventory count, and validation result.
