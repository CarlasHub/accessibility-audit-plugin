# Audit Quality Contract

**Contract version:** 1.0.0  
**Conformance target:** WCAG 2.2 Level A and AA  
**Authority:** This document is the normative quality and release contract for CarlasHub Accessibility Audit. If product copy, implementation, tests, examples, or release notes conflict with this contract, this contract takes precedence.

## 1. Product promise

The product provides a repeatable, evidence-backed accessibility pre-audit. Every one of the 55 active WCAG 2.2 Level A and AA success criteria must appear in the criterion ledger and must receive an honest outcome based on the evidence actually collected.

The product must never claim that automation alone proves WCAG conformance. A complete WCAG 2.2 AA conformance decision requires applicable Level A and AA success criteria to be evaluated across complete pages and complete processes by a qualified human. Until that work is complete, the overall decision is **Not determined**.

This contract therefore guarantees **complete criterion accountability**, not automatic certification.

## 2. Normative audit plumbing

Every production audit follows this traceable pipeline:

```text
URLs, allowed hosts, viewports and configured task journeys
  -> safe page acquisition in Playwright
  -> axe-core rules plus deterministic DOM and interaction checks
  -> keyboard, focus, reflow, resize, text-spacing and target-size evidence
  -> optional bounded native screen-reader evidence
  -> applicability, visibility, completeness and reproducibility checks
  -> confirmed-finding confidence gate
  -> stable identity, root-cause consolidation and deduplication
  -> all-55-success-criterion WCAG ledger
  -> one canonical versioned JSON result
  -> accessible HTML, professional XLSX and portable evidence package
  -> automated contract, regression and release gates
  -> qualified human review and final conformance decision
```

No renderer may invent, suppress, reclassify, or materially reinterpret audit data. JSON is the canonical result; HTML and XLSX are views of that same result.

## 3. Technology and responsibility map

| Layer | Technology | Contracted responsibility |
| --- | --- | --- |
| Browser execution | Playwright and Chromium | Load each requested public page, exercise declared states and journeys, collect viewport-specific evidence, and report incomplete execution honestly. |
| Standards-based rules | axe-core | Run applicable deterministic rules using WCAG tags. An axe pass is a rule-level result, never an automatic success-criterion pass. Axe `incomplete` outcomes remain unresolved. |
| Product checks | Typed Playwright/DOM evaluators | Test observable keyboard, focus, landmark, link, responsive, resize, spacing, target-size, disclosure, tabs, media and interaction conditions with explicit assertions. |
| Assistive technology | Guidepup with native VoiceOver/WebKit and NVDA/Firefox workflows | Retain bounded spoken-output transcripts and environment metadata as supporting evidence. These journeys do not represent every screen reader, state, task, device or human understanding. |
| Data contract | TypeScript types and runtime validation | Preserve stable identifiers, classification, WCAG mapping, URLs, viewports, selectors, observed evidence, expected result, remediation and limitations. |
| Reports | Canonical JSON, accessible HTML and ExcelJS XLSX | Present the same decisions in machine-readable, accessible and professional formats. Colour always has a text equivalent. |
| Verification | Vitest, Playwright, fixture regressions and GitHub Actions | Prevent contract regressions, validate report parity, and exercise packaged consumer behaviour before release. |

## 4. Result semantics

### 4.1 Finding classifications

- **Confirmed failure**: a reproducible failure that satisfies every confidence-gate condition in section 5.
- **Needs review**: a plausible issue or risk that needs contextual, visual, content, exception, physical-device or human judgment. It is not counted as a confirmed failure.
- **Blocker**: the requested evidence could not be collected or the run was materially incomplete. It is not a page failure and is never treated as a pass.
- **Manual assessment**: a criterion-specific procedure a qualified tester must complete. It is not an automated finding.

### 4.2 Criterion-ledger outcomes

- **Failed**: at least one retained confirmed failure maps to the criterion.
- **Inconclusive**: automation or execution produced unresolved evidence, review candidates, blockers or incomplete results.
- **Manual review required**: the criterion needs qualified assessment not completed by the audit.
- **Not applicable**: applicability has been established with adequate evidence for the audited scope.
- **Passed**: reserved for a criterion only when all applicable requirements, pages, states and complete processes have sufficient retained evidence. Rule-level automation alone cannot assign this outcome.

Unexecuted, incomplete, unavailable and uncertain work must never become a pass.

## 5. Confirmed-finding confidence gate

A result may be labelled **Confirmed failure** only when all of these conditions are satisfied:

1. The assertion is objective and maps to at least one known WCAG 2.2 success criterion.
2. The target was applicable, rendered, visible or programmatically exposed as required by the rule, and relevant in the tested state.
3. The failure was observed after the required interaction or page state was reached.
4. The check completed without timeout, truncation, navigation failure, blocked resource or unsupported environment affecting the decision.
5. Reproduction evidence includes page URL, viewport or environment, observed result, expected result and a useful locator or rule identifier.
6. The result is reproducible within the bounded run and is not contradicted by retained evidence.
7. Known WCAG exceptions and contextual judgments have either been evaluated objectively or cause the result to be classified as Needs review.
8. Stable identity and root-cause consolidation have removed duplicate representations without hiding distinct affected pages, viewports or states.

The implementation must reject or downgrade any purported confirmed failure that violates this gate. Release tests must deliberately submit malformed confirmed findings and prove that they cannot pass the gate.

## 6. False-positive and data-treatment controls

### Contrast

- Confirmed text-contrast failures require a numeric observed ratio, the applicable threshold and evidence that axe completed the applicable calculation.
- Hidden, disabled, transparent, background-image-dependent, indeterminate or otherwise incomplete contrast candidates stay unresolved or Needs review.
- Large-text and component-context exceptions must not be guessed.

### Responsive overlap and reflow

- Geometry is clipped to the viewport before overlap is calculated.
- Trivial intersections are discarded.
- A candidate requires a material overlap area and proportion plus multi-point hit testing that identifies a clear obscuring element.
- Because meaning, intentional overlays and operability require context, overlap candidates remain Needs review unless a separate deterministic interaction assertion proves the failure.
- Horizontal document overflow, fixed/sticky obstruction, loss of content and loss of operation are recorded separately.

### Keyboard and focus

- Keyboard failures require a reproduced state transition, focus sequence, focus visibility/obscuration result, trap, unreachable control or failed expected destination.
- Cycle limits, timeouts, page unloads and unexplored states are incomplete evidence, not passes or failures.
- Scripted journeys declare their intended task, assertions and completed steps; generic traversal cannot stand in for every user journey.

### Links, network and dynamic content

- Link results distinguish destination defects from redirects, authentication, rate limiting, unsupported protocols, temporary network errors and blocked requests.
- Live-region and DOM changes prove only the observed programmatic change. They do not prove announcement quality or comprehension.
- Dynamic controls must be tested in each explicitly configured state; unexercised states remain outstanding.

### Consolidation

- Stable IDs are based on root cause and stable target identity, not changing row order.
- Consolidation retains all affected URLs, viewports, selectors, evidence and screenshots.
- Review candidates are not allowed to inflate confirmed severity totals.

## 7. Required accessibility coverage

The audit must account for all 55 active WCAG 2.2 Level A and AA success criteria and provide exactly one criterion-specific guided human procedure with an evidence prompt for each criterion.

The automated and configured evidence portfolio must include, where applicable:

- axe-core deterministic rules and incomplete-result preservation;
- semantic structure, names, roles, states and relationships;
- keyboard traversal, visible focus, focus order, traps and obscuration;
- configured task journeys for menus, disclosures, tabs, dialogs, forms, errors, status messages and other site-specific interactions;
- responsive checks at 320 CSS pixels or equivalent, 200% root-text resizing, WCAG text spacing, fixed/sticky obstruction and horizontal overflow;
- target-size review and interaction evidence;
- links, skip links, autoplay media and programmatic live-region behaviour;
- optional native VoiceOver/WebKit and NVDA/Firefox transcripts with exact environment and bounded-step metadata;
- human procedures for content meaning, media alternatives, colour use, visual judgment, physical-device behaviour, complete processes, screen-reader usability and every other requirement automation cannot decide.

The criterion ledger must identify the evidence source and explain why the current outcome was assigned.

## 8. Reporting contract

### Canonical JSON

- Is the source of truth for every renderer.
- Includes contract version, standard, target, run scope, requested and audited URLs, completeness, findings, criterion ledger, guided checks, evidence references, configured journeys and limitations.
- Uses portable relative paths inside the evidence package and stable finding IDs across identical runs.

### HTML

- Is keyboard operable, responsive at 320 CSS pixels, screen-reader understandable and usable at zoom.
- Includes skip navigation, semantic headings and tables, visible focus, labelled filters and status updates that do not steal focus.
- Separates confirmed failures, review candidates, blockers and manual work in both wording and totals.
- Never uses colour alone and never describes unresolved criteria as covered or passed.

### XLSX

- Opens without repair prompts or formula errors in supported spreadsheet applications.
- Uses a compact executive summary and separate usable sheets for findings, criterion accountability, manual procedures and run data.
- Freezes useful headers/identity columns, applies filters, sensible widths, wrapping, print settings and portable evidence links.
- Uses severity/classification text as well as accessible colour coding. Only confirmed failures receive failure-severity colouring.
- Keeps the primary findings view reviewable without forcing users through dozens of low-value technical columns; secondary evidence may be hidden but remains available.

### Evidence package

- Contains JSON, HTML, XLSX, screenshots and available journey/transcript evidence referenced by relative paths.
- Must be self-contained, openable after download and free of credentials, tokens and private browsing data.

## 9. Release acceptance gates

Every release must satisfy all gates below. A skipped mandatory gate is a failed release unless the skip is an explicit platform limitation documented in the release evidence.

| Gate | Acceptance condition | Enforced by |
| --- | --- | --- |
| AQ-01 | Exactly 55 active WCAG 2.2 A/AA criteria and 55 criterion-specific guided procedures are present, with no duplicate criterion IDs. | Criterion/coverage contract tests |
| AQ-02 | Overall conformance remains Not determined and human assessment required unless a future, separately governed human sign-off system supplies complete evidence. | Runtime quality assertion and report tests |
| AQ-03 | Malformed, unmapped or evidence-free confirmed findings are rejected or downgraded; review-only rules never inflate confirmed totals. | Confidence-gate unit and integration tests |
| AQ-04 | Contrast decisions distinguish numeric confirmed evidence from incomplete or indeterminate candidates. | Adversarial contrast fixtures |
| AQ-05 | Responsive overlap uses viewport clipping, materiality thresholds and occlusion sampling, remains review-only without a deterministic interaction failure, and is deduplicated by obscured root cause. | Browser and consolidation regression tests |
| AQ-06 | Generic keyboard and configured interaction journeys record expected state, observed state, completion and incomplete execution without converting uncertainty into a pass. | Browser and journey tests |
| AQ-07 | Reflow, 200% resize, text spacing, fixed/sticky obstruction and horizontal overflow are independently exercised with false-positive fixtures. | Playwright browser fixtures |
| AQ-08 | Native VoiceOver/WebKit and NVDA/Firefox workflows validate inputs and preserve transcript plus environment metadata; unsupported or unrun combinations remain manual. | Native workflow/schema tests and retained workflow artifacts |
| AQ-09 | JSON, HTML and XLSX contain classification- and criterion-equivalent decisions and counts. | Report parity tests |
| AQ-10 | HTML passes structural accessibility checks and keyboard/reflow tests; status changes are announced without focus theft. | HTML report tests and Playwright accessibility checks |
| AQ-11 | XLSX opens successfully, has no formula errors, uses professional layout/print settings and communicates severity without colour alone. | ExcelJS validation and template-fidelity tests |
| AQ-12 | Two equivalent runs produce stable IDs and stable consolidated counts while retaining all affected scope and evidence. | Determinism and consolidation tests |
| AQ-13 | The packaged GitHub Action runs from a fresh consumer fixture using only documented inputs and uploads the complete report. | Packaged Action smoke test |
| AQ-14 | Live Buggyland runs twice and satisfies maintained exact baseline, classification, blocker-isolation, deduplication and stability checks. | Buggyland regression workflow |
| AQ-15 | Type checking, linting, unit, browser, integration, documentation, packaging and build checks pass from a clean install. | CI and release workflow |

## 10. Buggyland and adversarial fixtures

Buggyland is a maintained regression fixture, not proof that every real-world defect is detectable. Its expected pages, states, findings and classifications must be versioned. The release gate must run the public target twice, compare stable identities and counts, reject unexpected blockers, and retain the reports used for the decision.

Small adversarial fixtures must isolate contrast uncertainty, clipped/off-screen geometry, intentional overlays, hidden elements, sticky controls, text-spacing changes, keyboard traps, focus obscuration, failed journeys, redirects, rate limiting, missing resources and duplicate root causes. Each fixture must state the expected Confirmed, Needs review or Blocker outcome.

## 11. Human review and final sign-off

A qualified reviewer must complete applicable guided checks across the agreed sample, component states and complete processes; verify supported desktop and mobile assistive-technology combinations; inspect every retained confirmed failure and review candidate; and record the evidence supporting pass, fail or not-applicable decisions.

Only that governed review can change the overall decision from Not determined. Marketing, README and Marketplace text must use the phrase **evidence-backed accessibility pre-audit** and must not promise full automatic WCAG coverage, certification, zero false positives or guaranteed legal compliance.

## 12. Change control

Any change that weakens a gate, changes classification semantics, changes the canonical schema, removes a criterion/procedure, or broadens a conformance claim requires:

1. a new contract version;
2. implementation and migration notes;
3. updated adversarial and regression tests;
4. report parity verification;
5. Buggyland and packaged Action evidence; and
6. explicit release notes describing the effect on users.

Release evidence must identify the contract version used. Known gaps are documented as limitations or open work; they are never silently represented as passes.

## 13. Standards basis

- [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/)
- [WCAG 2.2 conformance requirements](https://www.w3.org/TR/WCAG22/#conformance-reqs)
- [Website Accessibility Conformance Evaluation Methodology (WCAG-EM) 1.0](https://www.w3.org/TR/WCAG-EM/)
- [Accessibility Conformance Testing Rules Format 1.1](https://www.w3.org/TR/act-rules-format/)

## 14. Contract delivery plan and traceability

This plan is part of the contract. A phase is complete only when its output exists and its acceptance evidence passes; implementation activity alone is not completion.

| Phase | Required implementation | Acceptance evidence |
| --- | --- | --- |
| 1. Criterion accountability | Maintain exactly 55 active WCAG 2.2 Level A/AA records, criterion-specific automated mappings, guided human procedures, applicability, provenance and outcome states. | `npm run test:quality-contract`; coverage and manual-check contract tests; canonical JSON ledger inspection. |
| 2. Evidence confidence | Route every candidate through the central evidence gate; require reproducible scope, locator, steps, viewport and complete rule-specific measurements before Confirmed; downgrade uncertainty to Needs review or Blocker. | Malformed-evidence, contrast, classification, blocker-isolation and fail-on contract tests. |
| 3. False-positive controls | Enforce DOM/style/actionability checks, stable observation, viewport clipping, materiality thresholds, multi-point hit testing, intended-state isolation and root-cause deduplication without deleting supporting occurrences. | Adversarial fixture tests and deterministic two-run comparisons. |
| 4. Interaction portfolio | Exercise generic tab journeys plus configured disclosures, tabs, menus, dialogs, forms, errors, live changes and complete user journeys; record expected and observed states and incomplete execution. | Local Playwright integration tests and journey evidence in JSON/report outputs. |
| 5. Responsive and visual behaviour | Test 320 CSS-pixel reflow, 200% resize, WCAG text spacing, sticky/fixed obstruction, target size, focus visibility and focus obscuration as distinct checks. | Browser fixture matrix with positive, negative, intentionally hidden and blocking-surface cases. |
| 6. Assistive technology | Keep native VoiceOver/WebKit and NVDA/Firefox evidence workflows bounded, validated and artifact-producing; expose unrun combinations and semantic/usability judgments as human work. | Workflow/schema tests plus retained transcript/environment artifacts when the native workflows run. |
| 7. Canonical reporting | Generate JSON once as the decision source; derive accessible HTML and professional XLSX without reclassifying data; package portable relative evidence. | Report parity, HTML accessibility/reflow, workbook structure/render/formula and archive tests. |
| 8. Product delivery | Build CLI, MCP/plugin packages and a self-contained GitHub Action; validate documented inputs from a fresh consumer fixture; keep the target repository read-only except for the user's committed workflow and generated Actions artifacts. | Built-product, marketplace compatibility, package dry-run and consumer-action tests. |
| 9. Public regression | Run the public Buggyland fixture twice, compare exact maintained classifications and stable IDs, reject unexpected blockers and retain both reports. | `npm run test:buggyland:live` locally and the Buggyland/release workflow artifacts. |
| 10. Release decision | Run all AQ-01 through AQ-15 gates from a clean install, record platform limitations, publish no stronger claim than the evidence supports and require qualified human sign-off for conformance. | Green Verify, native evidence where supported, release-smoke and release evidence artifacts. |

### Implementation ownership map

| Contract concern | Authoritative implementation |
| --- | --- |
| Criterion inventory and guided procedures | `src/audit/wcag-criteria.ts`, `src/audit/manual-checks.ts` |
| Browser observations and interaction evidence | `src/audit/browser-checks.ts`, `src/audit/runner.ts` |
| Classification, grouping and root-cause deduplication | `src/audit/findings.ts` |
| Central confirmed-finding gate and runtime assertions | `src/audit/quality-contract.ts` |
| Canonical decision model | `src/types.ts`, generated `audit-results.json` |
| Human-readable and spreadsheet reports | `src/reporting/html.ts`, `src/reporting/excel.ts`, `src/reporting/validate.ts` |
| Regression and release enforcement | `tests/`, `fixtures/`, `scripts/run-buggyland-regression.mjs`, `.github/workflows/` |

### Required release command set

```sh
npm ci
npm run audit:dependencies
npm run lint
npm run typecheck
npm run test:quality-contract
npm run test:unit
npm run test:browser
npm run test:built-cli
npm run build:action
npm run test:action
git diff --exit-code -- action/dist
npm run build:marketplace
npm run validate:marketplace
npm run test:marketplace
npm run test:marketplace-compatibility
npm run test:buggyland:live
npm pack --dry-run
```

The native screen-reader workflows are required release evidence for the combinations they support but cannot be represented by a Linux-only local command. If a platform workflow is unavailable, the release record must identify that limitation and the related criteria remain unresolved for human assessment.
