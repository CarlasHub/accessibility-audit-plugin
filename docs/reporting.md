# HTML and workbook reporting

Every audit writes two human-readable formats. Open the self-contained HTML report first for a clean summary, searchable and filterable findings, page coverage, evidence links, manual checks, and print-friendly sharing. Use the bundled CarlasHub WCAG 2.2 workbook for detailed triage, ownership, remediation, and follow-up.

## Read the workbook in this order

1. **Audit Summary:** confirm the audit metadata, scope, result totals, severity totals, and limitations.
2. **Page Inventory:** review every requested URL, its audit state, completed viewports, consent handling, runtime errors, and notes.
3. **Findings:** triage confirmed findings, investigate review items, and resolve blockers.
4. **Evidence:** trace screenshots and other evidence back to a finding, page, viewport, rule, component, and technical locator.
5. **Manual Checks:** assign and record the guided checks that automation cannot complete.
6. **WCAG 2.2 Reference:** use the criterion, level, title, and Understanding link as a reporting aid.

## Understand evidence confidence

The workbook uses `confirmed`, `review`, `blocker`, and `manual` evidence types:

- `confirmed` means deterministic evidence was reproduced.
- `review` means a credible signal still requires the stated human decision.
- `blocker` means requested scope could not be tested.
- `manual` means automation cannot determine the result.

Every generated finding starts with workflow status `Open`. Status tracks remediation; it does not change evidence confidence. A `review` item is not a confirmed WCAG failure until a qualified reviewer completes its test method.

Severity estimates the likely effect on users. It is separate from the WCAG conformance level, confidence, effort, and delivery priority.

## Findings field guide

| Field | Purpose |
|---|---|
| Finding ID | Stable workbook identifier. |
| Evidence type | `confirmed`, `review`, `blocker`, or `manual`. |
| Status | Remediation state, initially `Open`. |
| Severity | Critical, Serious, Moderate, Minor, or Review. |
| WCAG criterion, Level, WCAG title | Success criterion mapping enriched from the reference sheet. |
| Affected URL(s), Viewport(s) | Exact affected scope. |
| Component, Location | Human-readable UI context. |
| Summary, Issue, User impact | Concise barrier and impact description. |
| Technical locator | Selector or other reproducible locator. |
| Test method, Actual result, Expected result | Reproduction and decision evidence. |
| Recommendation | Concrete remediation advice. |
| Owner, Effort | Suggested responsibility and sizing. |
| Screenshot | Relative link to representative evidence, or `Not captured`. |
| Rule ID, Labels | Tool rule and searchable metadata. |
| Translation review | Whether translated content needs separate review. |

The same reusable component implementation and root cause produce one finding across affected pages. Different implementations, behaviours, criteria, colour treatments, or remedies stay separate. JSON retains detailed URL, viewport, selector, related-node, and raw tool evidence.

Missing `aria-controls` alone is not a WCAG failure for an ordinary disclosure or accordion. Interaction evidence must identify the live control, settle updates, re-query state, and demonstrate a visible mismatch. Ambiguous or incomplete interactions remain inconclusive JSON coverage.

Target-size findings require rendered, hit-testable evidence and consideration of WCAG exceptions; a raw measurement below 24 CSS pixels alone is insufficient.

## Evidence and portability

Images are not embedded. The Evidence sheet stores portable relative links and enough context to identify the related finding and test state. Extract the ZIP and keep `Accessibility_Audit_Report.xlsx` beside the `screenshots` directory so links continue to work.

The Page Inventory represents requested scope, including skipped and not-started pages, so missing coverage is visible in the workbook. The JSON coverage matrix remains the authoritative record for each page, viewport, and test area.

Graceful cancellation still writes partial HTML and JSON plus a validated partial XLSX workbook. Interrupted or unperformed work is never presented as passed.

## Coverage and pass claims

Coverage states include `confirmed-passed`, `confirmed-failed`, `tested-inconclusive`, `manual-review-required`, `not-tested`, and `not-applicable`.

`confirmed-passed` applies only to the exact automated rule and state supported by retained evidence. An empty finding list, axe incomplete result, sampled keyboard path, truncated link check, blocked interaction, or unperformed manual procedure is not proof of accessibility or complete WCAG conformance.
