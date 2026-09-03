# Workbook reporting

The reporter uses the bundled Accessibility Testing Boilerplate, removes placeholder rows, preserves the 32 Accessibility Report columns and WCAG lookup formulas, and populates operational fields for every finding.

The same reusable component implementation, rendered component name, and root cause produce one row across all affected pages. Generic unnamed controls must also share the same rendered location before they are consolidated, preventing identical bare markup from merging unrelated widgets. A page-specific implementation or root cause remains on its own row. The Links cell lists every affected page on its own line. JSON preserves URL, viewport, selector, screenshot, and raw evidence.

Summary uses the rendered component name rather than a CSS selector alone. Issue uses labelled lines for Component, Location, Affected viewport(s), Accessibility issue, User impact, and Technical locator. The workbook validator rejects rows that omit any of those fields.

Notes contains remediation only. The validator rejects empty Notes or ticket-system references in Notes.

Every populated report row starts with Status `Fail`. Development and QA findings default to `Implementation Queue`; Content, Design, and Mixed findings retain the corresponding specialist queue when that ownership is justified. Estimate starts at numeric `0`; workbook validation permits only non-negative quarter increments such as `0.25`, `0.50`, and `0.75`.

Accessibility Overview contains one landing-page QA URL, supplied explicitly or defaulted to the first resolved URL.

Image Inventory contains one row per unique confirmed-failure or blocker screenshot with page, viewport, rule, rendered component, component location, selector, evidence type, result, filename, and a relative hyperlink. Images are not embedded. Component evidence is cropped to an appropriate rendered component boundary and the affected element is outlined. Full-page evidence is permitted only for page-level failures or blockers without a component locator. The portable ZIP preserves the workbook and `screenshots` tree so links remain valid after transfer. When no screenshot evidence exists, the worksheet contains an explicit no-evidence row.

The generated workbook has no screen-reader worksheet. Assistive-technology testing remains in guided manual checks.

Graceful cancellation still writes and validates JSON and XLSX output. Page Inventory identifies completed viewport evidence, consent-banner handling, and pages not started. Interrupted viewport work is excluded from findings.
