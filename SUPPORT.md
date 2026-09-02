# Support

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
- Reload Cursor or restart the Claude/Codex session after rebuilding.
- Install Chromium with `npx playwright install chromium`.
- Check `allowedHosts`, `stagingOnly`, redirects, and authentication when pages are skipped.
- Keep screenshot capture enabled and use a writable output directory when Image Inventory is empty.

## Issues

Use the repository issue tracker for reproducible bugs and feature requests. Remove credentials, cookies, internal URLs, screenshots, and proprietary page content before posting.

Use the private process in [SECURITY.md](SECURITY.md) for vulnerabilities.
