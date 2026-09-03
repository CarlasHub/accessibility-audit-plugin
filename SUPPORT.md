# Support

Start with [Installation](docs/installation.md), then use the [plain-language user guide](docs/user-guide.md). They cover client setup, scope, running an audit, stopping safely, opening the portable output, reading findings, and completing manual checks.

## Before requesting help

Collect the following without including secrets or private page content:

- Plugin version from `node dist/cli.js --version`.
- Node and npm versions.
- Operating system and editor/client version.
- The failing command or MCP tool name.
- Sanitized stderr or MCP startup error.
- Whether `npm run check` and `npm run test:integration` pass.
- Whether `dist/mcp.js` exists.

## Common resolutions

- Rebuild after updates with `npm ci && npm run build`.
- Reload Cursor or restart the Claude, Codex, or Copilot session after rebuilding.
- Allow the one-time automatic Chromium installation, or install it explicitly with `npx playwright install chromium` when organisational policy blocks automatic downloads.
- Check `allowedHosts`, `stagingOnly`, redirects, and authentication when pages are skipped.
- Keep screenshot capture enabled and use a writable output directory when Image Inventory is empty.

## The plugin is installed but the command or MCP server is missing

1. Confirm Node.js 22 or later with `node --version`.
2. For a source checkout, run `npm ci` and `npm run build` in the plugin directory. For a marketplace payload, run `npm run build:marketplace`, `npm run validate:marketplace`, and `npm run test:marketplace` in its source checkout.
3. Confirm `dist/mcp.js` exists.
4. Reload Cursor or start a new Claude, Codex, or Copilot session.
5. Confirm `accessibility-audit` is enabled in the client’s plugin settings.
6. Inspect the client’s MCP log for the first startup error.

For platform-specific diagnostics, follow the verification and troubleshooting steps in [Installation](docs/installation.md). For Codex, use a supported plugin surface. The Codex IDE extension does not currently load plugins; Codex CLI exposes installed marketplaces through `/plugins`.

## A marketplace plugin fails on first activation

The generated Claude and Copilot payloads verify a bundled runtime checksum and install production dependencies into client-owned plugin data. They do not use the open project’s package manifest or lockfile. Confirm Node.js 22 or later and npm are visible to the client, that plugin data storage is writable, and that endpoint protection has not quarantined the bundled `.tgz`. Run `npm run test:marketplace` in the source repository to reproduce the same install and MCP handshake without auditing a site.

## The workbook will not open

1. Download or copy the generated ZIP completely.
2. Extract the ZIP to a normal writable folder.
3. Open `Accessibility_Audit_Report.xlsx` from the extracted folder with Microsoft Excel or another OOXML-compatible reader.
4. Do not rename the file to another extension.
5. If it still fails, run `node dist/cli.js validate <workbook-path>` and include the sanitized validation result in the support request.

The plugin validates workbook structure before delivery, but file transfer, partial downloads, security quarantine, or opening directly from an archive can still prevent a spreadsheet application from loading it.

## Screenshot links do not work

The report uses relative links to keep the workbook small. Extract the complete ZIP and keep the workbook beside the original `screenshots` directory. Moving only the workbook breaks those links.

## Fewer pages were tested than expected

The plugin never crawls a site. It tests only explicit URLs resolved from the supplied arguments or page-list file. Check `Page Inventroy`, `requestedUrls`, `auditedUrls`, and `skippedUrls`. The landing-page QA URL is report metadata and does not expand the scope.

## A finding looks incorrect

Check its evidence category before treating it as a defect:

- `confirmed` has deterministic reproduced evidence;
- `review` requires the procedure in Testing;
- `blocker` means the page was not tested;
- `manual` means automation cannot decide.

Include the sanitized finding ID, rule ID, page, viewport, Testing text, and relevant JSON evidence in a bug report. Do not attach private customer screenshots or content to a public issue.

## Issues

Use the repository issue tracker for reproducible bugs and feature requests. Remove credentials, cookies, internal URLs, screenshots, and proprietary page content before posting.

Use the private process in [SECURITY.md](SECURITY.md) for vulnerabilities.
