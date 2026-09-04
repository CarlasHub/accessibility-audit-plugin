# Reporting reference

- Preserve exactly `Accessibility Overview`, `Accessibility Report`, `Page Inventroy`, `Image Inventory`, and hidden `Lookup WCAG 2.2`, in that order, with the supplied worksheet tab colours and colour scheme.
- Remove placeholder report values and populate only the existing 32-column report schema. Do not add fields, columns, headers, tables, or worksheets.
- Keep findings per page unless a reusable component fingerprint and root cause both match. Group repeated instances inside the same component and list each affected URL on its own line in Links. Report text-contrast failures as one site-wide colour-system row per host while retaining every measured pair and affected component. Do not split a same-name landmark set, disclosure family, or one invalid description list into one row per DOM node.
- Missing `aria-controls` alone is a Best Practice review for an ordinary disclosure or accordion, not a WCAG failure. Combine it with an unchanged `aria-expanded` signal on the same component. Confirm the stale state only when controlled content is also observed to open; otherwise keep the state-versus-keyboard-activation result in review. Do not require generic disclosures or accordions to close with Escape.
- Notes contains concrete fixes only.
- Summary names the rendered component. Issue states Component, Location, Affected viewport(s), Accessibility issue, User impact, and Technical locator.
- Image Inventory is a headerless column-A list of unique relative screenshot paths; each cell links to the displayed path. Images are not embedded. Component screenshots include surrounding component context; full-page screenshots are used only for page-level findings without a component locator. Finding and component metadata remains in Accessibility Report and JSON.
- Accessibility Overview uses one landing-page QA URL. Every report row starts as Fail, the default Assignment is Implementation Queue, and Estimate starts at numeric 0 with quarter increments permitted.
- Page Inventroy is a headerless column-A list of unique URLs whose browser testing started. Completion, status, redirects, consent handling, and runtime errors remain in JSON.
- Do not create a screen-reader worksheet.
- Cancelled runs identify completed, partial, and not-started work and never present interrupted pages as passed.
