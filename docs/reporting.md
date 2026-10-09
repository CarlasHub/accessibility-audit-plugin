# HTML, workbook, and automation reporting

Every audit writes two human-readable formats. Open the self-contained HTML report first for a decision-ready executive summary, searchable and filterable findings, page coverage, evidence links, manual checks, and print-friendly sharing. Its first screen leads with the current position, recommended next step, and direct links to the three highest-priority actions, findings, WCAG criteria, and page coverage before the detailed metrics and conformance notice. Coverage blockers come first, followed by confirmed barriers ordered by severity, review candidates, and manual work. Each top-action card links to the unchanged source finding and shows its next step, suggested owner, effort, and affected-page count. The summary never treats automated output as a conformance decision. The bundled CarlasHub WCAG 2.2 workbook repeats the same ranked top actions with its executive guidance, detailed triage, ownership, remediation, and follow-up. JSON preserves the complete evidence model, CSV provides a flat finding register for imports, and SARIF 2.1.0 supports compatible automation systems.

Each HTML finding expands into the same practical reading order: what to do with the result, why the barrier matters, how it was checked, how to fix it, the affected component, technical selectors, and screenshot evidence. The guidance changes with the evidence type so confirmed barriers, review candidates, blockers, and manual procedures are not mistaken for one another. The workbook repeats those evidence-type definitions above its remediation register.

Use **Copy ticket** inside an expanded HTML finding to copy a ready-to-paste work item containing its stable ID, evidence type, priority, standards, affected scope, ownership hints, issue, impact, test method, remediation, next step, and technical selectors. The status beside the button confirms success for keyboard and screen-reader users. The report falls back to a local copy method when the modern clipboard API is unavailable, including when the report is opened directly from disk.

## Read the workbook in this order

1. **Audit Summary:** confirm the executive position and next step, audit metadata, scope, result totals, severity totals, and limitations.
2. **Page Inventory:** review every requested URL, its audit state, completed viewports, consent handling, runtime errors, and notes.
3. **Findings:** triage confirmed findings, investigate review items, and resolve blockers.
4. **Evidence:** trace screenshots and other evidence back to a finding, page, viewport, rule, component, and technical locator.
5. **Manual Checks:** complete all 55 A/AA criterion-specific procedures and record the requested evidence, explicit verdict, and reviewer notes; use `Not applicable` only with a reason.
6. **WCAG 2.2 Reference:** use the criterion, level, title, and Understanding link as a reporting aid.
7. **WCAG Criteria:** review every WCAG 2.2 success criterion, its AA-target or AAA-advisory scope, evidence status, mapped finding ids, automated evidence, explanation, and Understanding link.

The criterion ledger uses `passed`, `failed`, `manual-review-required`, `not-applicable`, and `inconclusive`. A failed criterion has retained failure evidence. `Passed` applies only where the recorded evidence supports that exact assessment; absence of a finding never creates a pass. AAA criteria are `not-applicable` unless advisory mode is enabled. The overall conformance decision remains `not-determined` until the outstanding human procedures have been completed by a qualified reviewer.

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

Graceful cancellation still writes partial HTML, JSON, CSV, and SARIF plus a validated partial XLSX workbook. Interrupted or unperformed work is never presented as passed.

Optional baseline and history comparisons are valid only across equivalent browser-engine, URL, and viewport scope. A report created before browser selection was available has no `browserEngine` field and is interpreted as Chromium for backward compatibility. A present engine must be `chromium`, `firefox`, or `webkit`; unsupported or malformed values are rejected instead of being silently treated as Chromium. Cross-engine comparisons remain partial and never claim unmatched findings as new or resolved.

## Coverage and pass claims

Coverage states include `confirmed-passed`, `confirmed-failed`, `tested-inconclusive`, `manual-review-required`, `not-tested`, and `not-applicable`.

`confirmed-passed` applies only to the exact automated rule and state supported by retained evidence. An empty finding list, axe incomplete result, sampled keyboard path, truncated link check, blocked interaction, or unperformed manual procedure is not proof of accessibility or complete WCAG conformance.
