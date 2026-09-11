# Changelog

## 1.6.2 - 2026-09-11

- Made the default, 200% root text-resize, and WCAG text-spacing phases run against the rendered state even when a modal blocks underlying keyboard interactions.
- Added explicit responsive-phase completion evidence and prevented the coverage matrix from claiming those phases ran when evidence is absent.
- Stopped Chromium's generic transient resource-load console message from being misreported as an authored page error while preserving real JavaScript console and page errors.
- Added regression coverage for blocked-page responsive execution and truthful incomplete-phase reporting.

## 1.6.1 - 2026-09-11

- Made the GitHub Action's process-level cancellation state authoritative, preventing a late SIGTERM received during output or summary writing from incorrectly exiting as a successful audit.

## 1.6.0 - 2026-09-11

- Added configurable, isolated site task journeys for keyboard operation, forms, interaction states, focus management, URL changes, input values, and scoped live-region DOM updates.
- Added an independent 200% root-text responsive phase alongside 320-pixel reflow and WCAG text-spacing checks, retaining overflow and lost-functionality evidence.
- Added Action inputs, reusable-workflow support, HTML evidence, documentation, and a deterministic BuggyLand keyboard/form/tabs/modal/status-message journey pack.
- Extended unit, Chromium, and live BuggyLand regression contracts so configured journeys and their evidence cannot silently disappear or become inconclusive.

## 1.5.1 - 2026-09-11

- Corrected the WCAG criterion ledger so only retained confirmed failures can fail a criterion; review candidates and coverage blockers now remain explicitly inconclusive.
- Tightened workbook and BuggyLand regression validation around all 55 active A/AA procedures, all 86 active WCAG 2.2 criteria, evidence provenance, viewport coverage, and the separation of disabled AAA advisory criteria.
- Prevented failed or blocked page states, truncated link checks, and empty automated results from being presented as confirmed passes.
- Re-ran the complete two-run live BuggyLand benchmark at desktop, mobile, and 320-pixel reflow sizes with identical validated HTML, XLSX, JSON, and ZIP outputs.

## 1.5.0 - 2026-09-11

- Added a criterion-specific human verification procedure and evidence prompt for every one of the 55 active WCAG 2.2 Level A and AA success criteria.
- Exposed those evidence requirements in the accessible HTML report and validated Excel workbook, with every human verdict remaining `Not tested` until an auditor records a decision.
- Added a coverage contract that rejects missing, duplicate, or underspecified A/AA procedures and clarified throughout the documentation and public site that automated results alone cannot establish conformance.
- Refreshed the deterministic BuggyLand baseline for the intentional v1.4.1 false-positive reductions and made `npm run test:buggyland` execute the complete two-run live regression.

## 1.4.1 - 2026-09-11

- Prevented active consent and modal blockers from producing unreliable responsive findings against the obscured page underneath.
- Excluded intentionally visually hidden assistive text from clipping detection, deduplicated responsive evidence across base and text-spacing states, and classified heuristic responsive signals as moderate review items rather than confirmed serious failures.
- Reworked the Excel workbook as a professional triage document with severity and evidence-status colours, frozen navigation, readable evidence fields, banded tables, and clearer priority guidance.
- Added unit, browser, Action-bundle, and workbook-format regressions for the corrected filtering and reporting behaviour.

## 1.4.0 - 2026-09-10

- Added a token-free landing-page generator that turns one public URL into a ready-to-paste GitHub Actions workflow and explains the complete run-to-report path.
- Added a maintained reusable workflow so projects can run the audit with one URL, no checkout, no browser setup, and no repeated hostname input.
- Derived the network allowlist securely from explicit audit URLs when `allowed-hosts` is omitted, while continuing to reject credential-bearing URLs.
- Linked the uploaded HTML, Excel, JSON, screenshot, and ZIP evidence directly from the GitHub Actions run summary.
- Added automated coverage for workflow generation and one-URL Action inputs, and validated the landing page at desktop, mobile, and 320-pixel reflow sizes.

## 1.3.1 - 2026-09-10

- Corrected the release lineage after `v1.3.0` was accidentally published from the previous `v1.2.1` source commit; `v1.3.0` is retained as withdrawn and must not be used.

- Kept WCAG 2.2 Level AA as the public conformance target and separated optional AAA checks into clearly labelled advisory evidence.
- Added a complete criterion-by-criterion WCAG 2.2 ledger to HTML, XLSX, and JSON reports with explicit failed, manual-review-required, not-applicable, and inconclusive outcomes and a mandatory-human conformance decision.
- Replaced the generic keyboard sample with deterministic forward/reverse focus-order and bypass-block journeys, plus off-viewport focus evidence.
- Expanded reflow and text-spacing evidence to retain clipping, overlap, lost interactive functionality, and focus visibility signals.
- Added pinned Guidepup workflows for VoiceOver/WebKit on macOS and NVDA/Firefox on Windows with JSON, Markdown, HTML, and Playwright transcript artifacts.
- Added deliberately passing and failing regression pages covering AA/AAA contrast separation, semantic failures, keyboard journeys, and reflow behaviour.

## 1.3.0 - 2026-09-10

- Withdrawn: this tag was accidentally created from the `v1.2.1` source commit before the intended v1.3 changes were pushed. Use `v1.2.1` until `v1.3.1` is available.

## 1.2.1 - 2026-09-09

- Made axe-core execution reliable on pages with strict Content Security Policy headers.
- Hardened target handling by rejecting embedded credentials, validating allowlists, and stopping audits after redirects outside the authorized host or staging scope.
- Corrected completed-page accounting so HTTP failures and incomplete axe runs are reported as partial instead of successful audits.
- Added requested, audited, completed, partial, not-started, and skipped page counts to GitHub Action outputs and job summaries.
- Sanitized report filenames, bounded noisy runtime errors, expanded regression coverage, and updated public workflow examples to current pinned action releases.

## 1.2.0 - 2026-09-09

- Added a polished, self-contained, responsive HTML report with accessible navigation, summary metrics, searchable and filterable findings, complete manual checks, coverage details, and print styling.
- Added the HTML report to GitHub Action outputs, job summaries, portable ZIP archives, CLI/MCP completion messages, and public documentation.
- Rebuilt the BuggyLand benchmark workbook for broader Excel and LibreOffice compatibility by removing threaded comments and cached formulas while retaining the full criteria, fixture, coverage, manual-plan, and run metadata sheets.
- Replaced the short result-only demonstration with an end-to-end tutorial covering workflow setup, manual execution, run status, artifact download, HTML review, workbook review, and the limits of automated testing.

## 1.1.0 - 2026-09-09

- Added the `wcag-level` GitHub Action and CLI option so audits can include supported WCAG 2.2 AAA automation in addition to the default A/AA rules.
- Made browser-side axe execution reliable in the distributed Action bundle by preserving callback source and packaging `axe-core` explicitly.
- Preserved completed axe and heuristic evidence when a later interaction check is inconclusive or fails unexpectedly.
- Fixed bundled report-path resolution and label AAA reports accurately in the workbook summary.
- Expanded Action-bundle smoke coverage for packaged axe availability and AAA configuration.

## 1.0.0 - 2026-09-09

- Rebranded the public package, manifests, generated marketplaces, documentation, policies, and support paths for CarlasHub ownership.
- Replaced the inherited workbook with an original six-sheet WCAG 2.2 reporting template covering audit summary, findings, page inventory, evidence, manual checks, and the A/AA success-criterion reference.
- Added a portable Agent Plugin manifest and marketplace catalog alongside the existing Codex, Claude, Cursor, and GitHub Copilot packages.
- Added submission guidance, privacy terms, release validation, and local marketplace compatibility checks for public distribution.

## 0.9.7 - 2026-09-07

- Removed customer and validation-site names from runtime instructions, URL tests, finding fixtures, report fixtures, and staging-host detection.
- Documented that audit targets are supplied at run time and that no customer-specific hostname, selector, rule, default, or prior-run evidence belongs in the plugin package.
- Added a build-time site-neutrality verification that rejects known validation-customer names in runtime and user-facing package content.
- Pinned Vitest's compatible Vite major so clean installs remain reproducible with both npm 10 and npm 11.

## 0.9.6 - 2026-09-06

- Replaced index-based disclosure activation and fixed post-key delays with stable live-control identity checks, focus-target verification, and bounded state settling.
- Re-query disclosure controls and every referenced panel after Enter and Space so delayed JavaScript updates and DOM replacement are measured from the final rendered DOM rather than a pre-interaction instance.
- Record ARIA state and controlled-panel visibility together in each snapshot, wait for relevant animations to finish, and retain settle timing and before/after snapshots in JSON.
- Keep visual panel visibility separate from accessibility-tree exposure so `aria-hidden` cannot be mistaken for CSS-hidden content or generate a false `aria-expanded` mismatch.
- Exclude hidden and inactive carousel clones and reject ambiguous, obscured, detached, or unsettled disclosure evidence instead of promoting it to a workbook finding.
- Require verified activation and settled post-interaction evidence before finding generation can confirm an `aria-expanded` mismatch; missing `aria-controls` remains non-failing by itself.
- Added real-Chromium regressions for delayed re-rendering, late hydration, hidden clones, initially open non-collapsible controls, missing relationships, and a genuine delayed state mismatch.

## 0.9.5 - 2026-09-04

- Added a retained per-page/per-viewport coverage matrix that distinguishes confirmed pass/fail evidence from inconclusive, manual-review-required, not-tested, and not-applicable areas.
- Detect unresolved modal and consent surfaces as interaction-coverage blockers, skip invalid underlying interaction checks, and consolidate the same blocker while retaining every affected page and viewport.
- Added iAlert consent handling and a real-Chromium regression that proves the modal is dismissed before the page keyboard sequence begins.
- Retained axe incomplete results, pass counts, rule metadata, and related landmark nodes in JSON; incomplete axe results can no longer appear as automated passes or workbook findings.
- Split contrast reporting by exact measured colour treatment and landmark reporting by role, name, and implementation instead of host-wide or role-only over-grouping.
- Removed missing `aria-controls` as a standalone finding and require performed, observed state/visibility evidence before confirming an `aria-expanded` failure.
- Exercise disclosures from a known collapsed baseline with Enter and Space; incomplete setup remains raw inconclusive coverage rather than a finding, failure, or silent pass.
- Hardened target-size collection against hidden, off-screen, and covered responsive layers by requiring viewport hit-test evidence unless axe independently signals the target.
- Retained link candidate/check counts and configured-limit truncation in JSON so partial link validation is never represented as complete.
- Capture at most one representative contextual screenshot per final reporting unit and full-page evidence for unresolved blocking surfaces without allowing unrelated full-page fallbacks.
- Fixed workbook lookup formula values so Best Practice rows no longer produce `[object Object]` cached results, and added adversarial consolidation, coverage, target, workbook, consent, and input-order regression tests.

## 0.9.4 - 2026-09-04

- Consolidated shared text-colour treatments, repeated same-name landmarks, disclosure families, and description-list structure signals into component/root-cause rows instead of one row per DOM node or page instance.
- Reclassified missing `aria-controls` alone as a Best Practice review for ordinary disclosures and accordions, combined it with unchanged `aria-expanded` evidence on the same component, and required observed open content before confirming a stale-state failure.
- Removed the generic Escape-to-close disclosure check and documented Escape as a pattern-specific manual expectation rather than an accordion/disclosure requirement.
- Replaced the bundled workbook with a checksum-locked reporting template and added worksheet-order, tab-colour, field, style, and validation regression coverage.
- Simplified the earlier page and evidence inventories to retain unique scanned URLs and linked relative evidence paths.
- Extended conditional formatting and data validation behavior to additional finding rows without adding report columns or worksheets.

## 0.9.3 - 2026-09-03

- Prepared the source repository for public review with organization ownership metadata, hardened CI permissions, and production-dependency auditing.
- Added a sanitised, captioned workflow demonstration with a text transcript while keeping media out of executable runtime archives.
- Expanded issue and contribution guidance across Cursor, Claude, Codex, and GitHub Copilot clients.
- Aligned public-source and organization marketplace submission documentation.

## 0.9.2 - 2026-09-03

- Stopped turning every rendered control below 24×24 CSS pixels into a target-size workbook row.
- Added rendered 24 CSS pixel clearance checks, inline-target exclusion, component grouping, and review-only handling for axe target-size violation/incomplete signals.
- Prevented ordinary text links containing decorative images and hash-only actions from being misclassified as image-only home links.
- Corrected unnamed non-link controls so they no longer inherit the link-purpose success criterion.
- Added viewport-first report titles and reproducible Actual/Expected procedures for every generated finding.
- Added regression coverage for isolated small targets, the inline exception, grouped spacing conflicts, and axe target-size classification.

## 0.9.1 - 2026-09-03

- Added a reproducible, checksum-verified Claude Desktop custom-plugin ZIP for local Chat conversations.
- Added Claude Desktop Chat installation, activation, update, removal, and troubleshooting guidance.

## 0.9.0 - 2026-09-03

- Added generated, self-contained marketplace payloads for Claude Code, GitHub Copilot CLI, and GitHub Copilot in VS Code.
- Added a checksum-verified, versioned runtime installer that writes only to plugin-owned data storage and never changes the audited project.
- Added an isolated MCP launcher and marketplace package validation and smoke tests.
- Added automatic headless Playwright Chromium installation when no supported local browser exists, with an explicit opt-out.
- Added marketplace submission staging files and documentation without modifying the destination repository.

## 0.8.2 - 2026-09-03

- Added complete, isolated installation, activation, update, uninstall, and troubleshooting instructions for Cursor, Claude Code, and Codex.
- Replaced the personal auditor name in README command examples with the neutral `Auditor Name` placeholder.
- Clarified that remote marketplace publication requires a runnable packaged release and that an unbuilt source snapshot is not sufficient.

## 0.8.1 - 2026-09-03

- Added a plain-language start-to-finish user guide for people without WCAG experience.
- Added WCAG, evidence-confidence, severity, scope, output, and report-field explanations.
- Expanded guided manual-verification procedures and beginner-safe triage guidance.
- Updated embedded agent instructions to provide a plain-language audit handoff.
- Aligned CLI, MCP server, package, marketplace, and client-manifest version metadata.

## 0.8.0 - 2026-09-03

- Name the rendered component and page location in every finding and state affected Desktop/Mobile viewports directly in the Issue field.
- Structure Issue text around the accessibility problem, user impact, and technical locator instead of exposing raw scanner wording alone.
- Dismiss visible consent banners before interaction checks and screenshots, preferring reject or necessary-only actions, and record the result in JSON and Page Inventory.
- Capture confirmed component evidence at a surrounding component boundary with the affected element outlined.
- Restrict full-page screenshots to page-level failures and blockers without a component locator.
- Reduce focus-obscuration false positives by requiring all five sampled points in the visible focus bounds to be covered.
- Report target-size, focus-indicator, and focus-obscuration signals per component before cross-page consolidation, and require unnamed controls to share a rendered location before they can merge across pages.
- Extend workbook validation to reject incomplete Issue context and component findings linked to full-page screenshots.

## 0.7.0 - 2026-09-03

- Consolidate the same reusable component and root cause into one finding row across pages while preserving page-specific findings.
- Collapse repeated axe `region` nodes and responsive target-size signals into one page-specific review row to reduce false-positive-looking duplication.
- Default every populated report row to `Fail`, route Development and QA findings to `Implementation Queue`, and initialize Estimate to `0` with quarter-step validation.
- Write one landing-page QA URL to the workbook summary through CLI, configuration, and MCP inputs.
- Capture screenshot evidence only for confirmed failures and page blockers, keep images outside the workbook, and link them with portable relative hyperlinks.
- Package each audit as a ZIP containing the workbook, JSON evidence, and screenshot tree.

## 0.6.1 - 2026-09-03

- Count native associated `label` elements when checking form-control accessible names, preventing labelled controls from being reported as unnamed.
- Classify axe best-practice-only results as review findings unless the rule also maps to a WCAG success criterion.
- De-duplicate unnamed links and controls when axe and the DOM heuristic report the same rendered element with different CSS selector forms.
- Make the workbook overview state whether screenshot capture was enabled for the specific audit run.

All notable changes are documented here. Versions follow Semantic Versioning.

## 0.6.0 - 2026-09-02

### Added

- Conservative same-origin broken-link and placeholder-link testing.
- Detailed tab state, relationship, navigation, and activation checks.
- Element-level screenshots with evidence inventory previews.
- Comprehensive Cursor, Claude Code, and Codex installation and usage documentation.
- Security, support, contribution, and release documentation.

### Changed

- Browser testing remains headless by default.
- Home/End tab behavior is recorded as optional and no longer causes a failure.
- Empty-link naming includes descendant image alternatives and additional name sources.
- Workbook validation now verifies evidence inventory paths and rejects obsolete screen-reader worksheets.

### Removed

- Guidepup, VoiceOver, NVDA, screen-reader CLI/MCP options, setup commands, dependencies, runtime results, tests, documentation, and the Screen Reader Failures worksheet.

## 0.5.0 - 2026-09-02

- Added progress notifications, graceful cancellation, partial report preservation, pre-run confirmation, and isolated browser execution.
