# Changelog

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
