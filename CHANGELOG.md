# Changelog

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
