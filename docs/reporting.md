# Workbook reporting

The reporter uses the bundled Accessibility Testing Boilerplate, removes placeholder rows, preserves the 32 Accessibility Report columns and WCAG lookup formulas, and populates operational fields for every finding.

Findings remain page-specific unless both the reusable-component fingerprint and root cause match. The Links cell lists every affected page on its own line. JSON preserves URL, viewport, selector, screenshot, and raw evidence.

Notes contains remediation only. The validator rejects empty Notes or ticket-system references in Notes.

Image Inventory contains one row per unique finding screenshot with page, viewport, rule, selector, evidence type, result, filename, and embedded preview. The validator checks the schema and requires an embedded image for every evidence row. When no screenshot evidence exists, the worksheet contains an explicit no-evidence row.

The generated workbook has no screen-reader worksheet. Assistive-technology testing remains in guided manual checks.

Graceful cancellation still writes and validates JSON and XLSX output. Page Inventory identifies completed viewport evidence and pages not started. Interrupted viewport work is excluded from findings.
