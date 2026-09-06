# Reporting reference

- Preserve exactly `Accessibility Overview`, `Accessibility Report`, `Page Inventroy`, `Image Inventory`, and hidden `Lookup WCAG 2.2`, in that order, with the supplied worksheet tab colours and colour scheme.
- Remove placeholder report values and populate only the existing 32-column report schema. Do not add fields, columns, headers, tables, or worksheets.
- Keep findings per page unless a reusable component implementation and root cause both match. Group repeated instances inside that component and list each affected URL on its own line in Links. Keep different colour treatments, implementations, behaviours, criteria, impacts, and remediation requirements separate. Do not call a finding site-wide unless every claimed page has traceable evidence. Do not split one same-name landmark implementation or invalid description list into one row per DOM node.
- Missing `aria-controls` alone produces no finding for an ordinary disclosure or accordion. Establish a collapsed baseline, exercise Enter and Space, and confirm stale state only when the performed interaction yields an observed mismatch with controlled-content visibility. Keep setup failures and ambiguous results in JSON and inconclusive coverage without creating a workbook row. Do not require generic disclosures or accordions to close with Escape.
- Notes contains concrete fixes only.
- Summary names the rendered component. Issue states Component, Location, Affected viewport(s), Accessibility issue, User impact, and Technical locator.
- Image Inventory is a headerless column-A list of unique relative screenshot paths; each cell links to the displayed path. Images are not embedded. Retain at most one representative contextual screenshot per final confirmed, blocker, or review reporting unit when capture succeeds; full-page screenshots are used only for page-level findings or unresolved blockers. Finding and component metadata remains in Accessibility Report and JSON.
- Accessibility Overview uses one landing-page QA URL. Every report row starts as Fail, the default Assignment is Implementation Queue, and Estimate starts at numeric 0 with quarter increments permitted.
- Page Inventroy is a headerless column-A list of unique URLs whose browser testing started. Completion, status, redirects, consent handling, and runtime errors remain in JSON.
- Do not create a screen-reader worksheet.
- Cancelled runs identify completed, partial, and not-started work and never present interrupted pages as passed.
- JSON retains axe violations/incomplete/pass counts and related nodes, consent/blocker state, keyboard and link truncation, and a page/viewport/test-area coverage matrix. Incomplete, sampled, truncated, blocked, manual, and unperformed checks are not passes.
