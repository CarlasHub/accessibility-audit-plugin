# Workbook reporting

The reporter uses an exact bundled copy of `Accessibility Testing Boilerplate v.4 (4)`, removes placeholder finding values, preserves the worksheet order, tab colours, 32 Accessibility Report columns, WCAG lookup formulas, validations, and existing colour scheme, and populates only the template's existing report fields. It does not add worksheets or inventory columns.

## Read the workbook in this order

1. **Accessibility Overview:** confirm the landing-page QA URL, audit date, auditor, scope, methods, totals, limitations, and outstanding guided checks.
2. **Page Inventroy:** confirm the headerless column-A list contains the unique URLs whose browser testing started. Use JSON for completed, partial, not-started, redirect, consent, status, and runtime-error detail.
3. **Accessibility Report:** triage confirmed findings, then perform the Testing procedure for review findings.
4. **Image Inventory:** open the linked relative screenshot references in column A and match them to the Screengrab links and evidence records in the report and JSON.

`Lookup WCAG 2.2` is hidden reference data for formulas. It is not an audit-results worksheet.

## Understand evidence confidence

The workbook uses `confirmed`, `review`, `blocker`, and `manual` labels:

- `confirmed` means deterministic evidence was reproduced.
- `review` means a credible signal still requires the decision described in Testing.
- `blocker` means a requested page could not be tested.
- `manual` means automation cannot determine the result.

Every populated row starts with workflow Status `Fail`. This template default ensures the item enters remediation, but it does not change its evidence category. In particular, a `review` row is not a confirmed WCAG failure until a qualified reviewer completes the stated procedure.

Impact severity is also separate. It estimates the likely effect on users; it is not the WCAG A/AA level, evidence confidence, implementation effort, or delivery priority.

## Accessibility Report field guide

| Field | Purpose |
|---|---|
| ID | Stable row identifier generated for the workbook. |
| SC1–SC3 and adjacent lookup fields | Up to three mapped criteria with level, synopsis, and W3C Understanding reference. |
| Links | Every affected page. Consolidated component findings list one URL per line. |
| Summary | Short finding title beginning with the affected Desktop/Mobile scope and rendered component name. |
| Environment | Browser and affected Desktop, Mobile, or Mobile reflow viewport. |
| Issue | Labelled component name, page location, affected viewports, accessibility barrier, user impact, and technical locator. |
| Testing | Reproduction evidence and any decision still required from a person. |
| Screengrab | Relative link to the first available evidence image. |
| ProductNote and Labels | Evidence category, rule identifier, and WCAG mapping. |
| Impact | Initial user-impact severity. |
| Status | Starts as `Fail` for implementation tracking. |
| Assignment | Suggested implementation, content, design, or accessibility ownership queue. |
| Effort | Initial broad remediation-size indication. |
| Specialist and Implementation | Initial review/workflow values from the report template. |
| Notes | Concrete remediation only. It must not contain ticket-system or audit-process commentary. |
| Estimate | Starts at numeric `0` and accepts non-negative quarter increments. |

The same reusable component implementation, rendered component name, and root cause produce one row across all affected pages. Generic unnamed controls must also share the same rendered location before they are consolidated, preventing identical bare markup from merging unrelated widgets. A page-specific implementation or root cause remains on its own row. The Links cell lists every affected page on its own line. JSON preserves URL, viewport, selector, screenshot, and raw evidence.

Summary states the affected Desktop/Mobile scope and uses the rendered component name rather than a CSS selector alone. Issue uses labelled lines for Component, Location, Affected viewport(s), Accessibility issue, User impact, and Technical locator. Every generated finding provides reproducible steps with explicit Actual and Expected results. The workbook validator rejects rows that omit the viewport-first Summary, required Issue context, or structured Testing evidence.

Target-size evidence is gated before it becomes a row. A raw dimension below 24 CSS pixels is retained in JSON but does not by itself create a finding. Inline text links and isolated undersized targets that satisfy the spacing geometry are omitted. A workbook review requires a detected clearance collision or an axe target-size violation/incomplete signal, related targets are grouped by rendered component, and no confirmed WCAG 2.5.8 failure is claimed until the applicable exceptions have been assessed.

Notes contains remediation only. The validator rejects empty Notes or ticket-system references in Notes.

Every populated report row starts with Status `Fail`. Development and QA findings default to `Implementation Queue`; Content, Design, and Mixed findings retain the corresponding specialist queue when that ownership is justified. Estimate starts at numeric `0`; workbook validation permits only non-negative quarter increments such as `0.25`, `0.50`, and `0.75`.

Accessibility Overview contains one landing-page QA URL, supplied explicitly or defaulted to the first resolved URL.

`Page Inventroy` and `Image Inventory` follow the supplied blank-sheet layout exactly: neither has a header or metadata columns. Page Inventroy column A contains one hyperlink per unique URL whose browser testing started. Image Inventory column A contains one hyperlink per unique screenshot, displaying the same relative path used by the link. If no browser page started or no screenshot evidence exists, the corresponding sheet remains blank.

Images are not embedded. Component evidence is cropped to an appropriate rendered component boundary and the affected element is outlined. Full-page evidence is permitted only for page-level failures or blockers without a component locator. The portable ZIP preserves the workbook and `screenshots` tree so links remain valid after transfer. Page, viewport, rule, component, location, selector, classification, and result detail remain in Accessibility Report and JSON rather than being duplicated into invented inventory columns.

The generated workbook has no screen-reader worksheet. Assistive-technology testing remains in guided manual checks.

Graceful cancellation still writes and validates JSON and XLSX output. Page Inventroy lists only URLs whose browser testing started; JSON identifies completed, partial, not-started, and skipped work plus consent handling. Interrupted viewport work is excluded from findings.

## Evidence links

The workbook stores relative links, not embedded images. Extract and keep the workbook with its `screenshots` directory. If only the workbook is moved or emailed, the evidence links will stop working. The generated ZIP is the correct portable artifact to share.

An evidence image supports reproduction; it does not replace the Testing text or JSON. A component screenshot should show the named component in context with the target outlined. Full-page screenshots are reserved for page-level failures and blockers.
