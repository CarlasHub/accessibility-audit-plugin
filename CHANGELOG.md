# Changelog

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
