# Changelog

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
- Replaced the bundled workbook byte-for-byte with `Accessibility Testing Boilerplate v.4 (4)` and added checksum, worksheet-order, tab-colour, field, style, and validation regression coverage.
- Removed invented Page Inventroy and Image Inventory table schemas. Page Inventroy now lists only unique scanned URLs in column A; Image Inventory lists only unique linked relative evidence paths in column A.
- Extended the template's existing conditional formatting and data validation behavior to additional Accessibility Report finding rows without adding report columns or worksheets.

## 0.9.3 - 2026-09-03

- Prepared the source repository for public review with Radancy ownership metadata, hardened CI permissions, and production-dependency auditing.
- Added a sanitised, captioned workflow demonstration with a text transcript while keeping media out of executable runtime archives.
- Expanded issue and contribution guidance across Cursor, Claude, Codex, and GitHub Copilot clients.
- Aligned public-source and RAI Ops marketplace submission documentation.

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
- Added submission staging files and documentation for the Radancy RAI Ops plugin marketplace without modifying that marketplace repository.

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
- Write one landing-page QA URL to Accessibility Overview through CLI, configuration, and MCP inputs.
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
- Element-level screenshots with embedded Image Inventory previews.
- Comprehensive Cursor, Claude Code, and Codex installation and usage documentation.
- Security, support, contribution, and release documentation.

### Changed

- Browser testing remains headless by default.
- Home/End tab behavior is recorded as optional and no longer causes a failure.
- Empty-link naming includes descendant image alternatives and additional name sources.
- Workbook validation now verifies Image Inventory evidence and rejects obsolete screen-reader worksheets.

### Removed

- Guidepup, VoiceOver, NVDA, screen-reader CLI/MCP options, setup commands, dependencies, runtime results, tests, documentation, and the Screen Reader Failures worksheet.

## 0.5.0 - 2026-09-02

- Added progress notifications, graceful cancellation, partial report preservation, pre-run confirmation, and isolated browser execution.
