# Reporting reference

- Preserve `Accessibility Overview`, `Accessibility Report`, `Page Inventroy`, `Image Inventory`, and hidden `Lookup WCAG 2.2`.
- Remove placeholder report rows and populate the 32-column report schema.
- Keep findings per page unless a reusable component fingerprint and root cause both match. List each affected URL on its own line in Links.
- Notes contains concrete fixes only.
- Image Inventory records the page, viewport, rule, selector, evidence type, result, screenshot filename, and relative link. Images are not embedded.
- Accessibility Overview uses one landing-page QA URL. Every report row starts as Fail, the default Assignment is Implementation Queue, and Estimate starts at numeric 0 with quarter increments permitted.
- Page Inventory records requested/final URL, status, title, viewport, and runtime errors.
- Do not create a screen-reader worksheet.
- Cancelled runs identify completed, partial, and not-started work and never present interrupted pages as passed.
