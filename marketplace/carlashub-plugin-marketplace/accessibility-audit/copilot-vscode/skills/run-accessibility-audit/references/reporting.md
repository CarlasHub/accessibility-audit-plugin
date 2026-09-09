# Reporting reference

- Preserve the six bundled sheets in order: `Audit Summary`, `Findings`, `Page Inventory`, `Evidence`, `Manual Checks`, and `WCAG 2.2 Reference`.
- Populate the structured fields supplied by the template; do not add or rename columns or worksheets during a run.
- Keep findings per page unless a reusable component implementation and root cause both match. List each affected URL and keep different implementations, behaviours, criteria, colour treatments, impacts, or remedies separate.
- Use `confirmed`, `review`, `blocker`, and `manual` as distinct evidence types. Every generated item starts with workflow status `Open`; status is not evidence confidence.
- Fill WCAG level and title from `WCAG 2.2 Reference`. Do not treat the reference sheet as audit evidence.
- Summary, issue, user impact, location, technical locator, test method, actual result, expected result, and recommendation must be concrete and reproducible.
- Evidence contains one row per retained artifact with finding, page, viewport, rule, component, locator, type, and detail. Store relative screenshot hyperlinks and do not embed images.
- Page Inventory includes requested, skipped, partial, and completed scope with viewports, consent handling, runtime errors, and notes.
- Manual Checks records the guided procedures that automation cannot complete. Do not create a separate screen-reader results sheet.
- Cancelled runs identify completed, partial, and not-started work and never present interrupted pages as passed.
- JSON retains axe violations/incomplete/pass counts, related nodes, consent/blocker state, interaction sampling and truncation, and the page/viewport/test-area coverage matrix. Incomplete, sampled, truncated, blocked, manual, and unperformed checks are not passes.
