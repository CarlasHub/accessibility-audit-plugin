# Accessibility Audit Plugin

An isolated Codex, Claude Code, and Cursor plugin for evidence-backed WCAG 2.2 A/AA page testing. It runs headless Chromium checks at desktop, mobile, and 320 CSS-pixel reflow sizes, records deterministic and review findings separately, captures element-level screenshot evidence, and generates a validated Excel workbook plus JSON evidence.

This plugin is an automated testing aid, not a WCAG certification. Screen-reader, physical-device, content-meaning, visual-judgment, and other guided checks remain manual.

## Features

- Headless Playwright Chromium execution with visible terminal or MCP progress.
- axe-core WCAG 2.2 A/AA and selected best-practice rules.
- DOM and semantic checks for page structure, image alternatives, controls, fields, landmarks, duplicate ids, tables, and media.
- Sequential keyboard traversal, focus visibility review, focus obscuration checks, and disclosure interaction tests.
- Tab-component state, roving tabindex, arrow navigation, activation, and tab/panel relationship checks.
- Conservative same-origin link validation for empty names, placeholders, missing fragments, confirmed 404/410 destinations, and server-error review signals.
- Desktop, 390px mobile, and 320px reflow viewports.
- Full-page screenshots plus issue-level element screenshots.
- Embedded screenshot previews in the workbook `Image Inventory` worksheet.
- Graceful cancellation that writes and validates partial JSON and XLSX output.
- URL, XLSX, CSV, TXT, and JSON page-list inputs.
- Per-page findings by default, with cross-page consolidation only when the component implementation and root cause match.
- Embedded instructions, command, skill, rules, MCP server, workbook template, validation, and CI checks.

## Requirements

- Node.js 22 or later.
- npm.
- A Playwright-supported Chromium installation. The setup command below can install the bundled Chromium runtime.
- Microsoft Excel or another OOXML-compatible reader for the generated workbook.

No screen-reader package or operating-system accessibility permission is required.

## Install the plugin dependencies

Clone the plugin into its own directory. Do not install its dependencies inside a repository being audited.

```sh
git clone https://github.com/carla-goncalves_radancy/accessibility-audit-plugin.git accessibility-audit
cd accessibility-audit
npm ci
npx playwright install chromium
npm run build
```

The `dist/` directory is produced by `npm run build` and is intentionally not committed.

## Cursor installation

For local testing, Cursor discovers plugins under its local plugin directory. Symlink the built repository and reload Cursor:

```sh
PLUGIN_DIR="$(pwd -P)"
mkdir -p ~/.cursor/plugins/local
ln -sfn "$PLUGIN_DIR" ~/.cursor/plugins/local/accessibility-audit
```

Then run `Developer: Reload Window`, open **Customize**, and confirm that `accessibility-audit` exposes its command, skill, rule, and MCP server.

On Windows PowerShell, clone directly into Cursor's local plugin directory:

```powershell
$Destination = Join-Path $env:USERPROFILE ".cursor\plugins\local\accessibility-audit"
New-Item -ItemType Directory -Force (Split-Path $Destination) | Out-Null
git clone https://github.com/carla-goncalves_radancy/accessibility-audit-plugin.git $Destination
Set-Location $Destination
npm ci
npx playwright install chromium
npm run build
```

After an installation is updated, run `npm ci`, `npm run build`, and reload Cursor.

Cursor can also load the root `mcp.json` when the repository is configured as a plugin. The manifest is [.cursor-plugin/plugin.json](.cursor-plugin/plugin.json).

Cursor Marketplace submission requires a public Git repository. A private repository can instead be used for local development or an organisation’s private team marketplace. See the [Cursor plugin reference](https://cursor.com/docs/reference/plugins).

## Claude Code installation

Test directly from a built checkout:

```sh
claude --plugin-dir "$(pwd -P)"
```

The Claude plugin manifest is [.claude-plugin/plugin.json](.claude-plugin/plugin.json), and its MCP definition is [.claude-mcp.json](.claude-mcp.json).

For private team distribution, add the private GitHub repository as a Claude marketplace and install the plugin:

```text
/plugin marketplace add carla-goncalves_radancy/accessibility-audit-plugin
/plugin install accessibility-audit@accessibility-audit-marketplace
```

The user must already have Git credentials that can read the private repository. See the [Claude Code plugin marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces).

## Codex installation

The Codex manifest is [.codex-plugin/plugin.json](.codex-plugin/plugin.json), and the MCP server is declared in [.mcp.json](.mcp.json). Add the built plugin directory through Codex plugin management, then start a new session after rebuilding or updating the plugin.

## Run an audit in Cursor or Claude

Use the bundled command:

```text
/accessibility-audit https://preview.example.test/
```

Multiple selected pages:

```text
/accessibility-audit https://preview.example.test/ https://preview.example.test/jobs https://preview.example.test/contact
```

A complete page-list file:

```text
/accessibility-audit /absolute/path/to/pages.xlsx
```

The confirmation form shows the supplied pages or input file and asks for the auditor. `Automated` is the editable default. If the client does not support MCP forms, the tool returns `confirmation-required`; the agent confirms the same values in chat and retries once.

The plugin tests only the URLs provided. It does not crawl a site or infer missing pages. To audit a complete site, provide a complete canonical URL list in XLSX, CSV, TXT, or JSON form.

## Run from a terminal

Direct invocation:

```sh
node dist/cli.js https://preview.example.test/
```

Explicit audit command with selected options:

```sh
node dist/cli.js audit \
  https://preview.example.test/ \
  https://preview.example.test/jobs \
  --auditor "Carla Goncalves" \
  --output "accessibility-audit-results" \
  --allow-host preview.example.test \
  --staging-only \
  --max-links 200
```

Page-list input:

```sh
node dist/cli.js audit pages.xlsx \
  --auditor "Carla Goncalves" \
  --output "accessibility-audit-results" \
  --staging-only
```

Interactive execution prints the targets, asks for the auditor, and asks for start confirmation. `--yes` accepts the supplied/default auditor and starts without prompts.

Progress is written to stderr. The final structured result is written to stdout.

### Stop an audit safely

- In Cursor, Claude, or Codex, press the client’s **Stop** control.
- In a terminal, press `Ctrl+C` once.

The plugin closes active Chromium work, retains completed evidence, writes `audit-results.json` and `Accessibility_Audit_Report.xlsx`, validates the partial workbook, and returns `status: "cancelled"`. Pressing `Ctrl+C` a second time exits immediately and can prevent report completion.

## Inputs

Supported inputs are:

- One or more explicit HTTP(S) URLs.
- XLSX workbooks. Columns named `QA page`, `Staging URL`, `URL`, or `Page URL` are preferred; otherwise HTTP(S) cells are scanned.
- CSV files containing URLs.
- TXT files containing URLs, normally one per line.
- JSON arrays or objects containing URL strings.

Use `allowedHosts` or repeated `--allow-host` flags to constrain navigation. Enable `stagingOnly` only when every supplied target is a staging, QA, preview, test, or local host.

## Output

The default output directory is `Accessibility Audit Results` under the user’s home directory. A custom `outputDir` can be supplied.

Generated files:

- `Accessibility_Audit_Report.xlsx` — validated 32-column accessibility workbook.
- `audit-results.json` — complete evidence, classifications, requested/completed/skipped pages, and guided checks.
- `screenshots/*.png` — full-page viewport screenshots.
- `screenshots/elements/*.png` — issue-level element screenshots.

Workbook worksheets:

- `Accessibility Overview` — scope, auditor, methods, totals, limitations, and outstanding guided checks.
- `Accessibility Report` — one evidence-backed finding per row unless a reusable component and root cause are proven identical.
- `Page Inventroy` — requested/final URL, HTTP status, page title, viewport, and runtime errors.
- `Image Inventory` — finding, page, viewport, selector, evidence type, screenshot filename, and embedded screenshot preview.
- `Lookup WCAG 2.2` — hidden lookup data used by report formulas.

The report contains no screen-reader worksheet or screen-reader execution result.

## Finding confidence and false-positive controls

The report keeps these categories separate:

- `confirmed` — deterministic reproduced evidence, such as an axe violation, missing label, broken ARIA relationship, missing fragment, or two-source 404/410 response.
- `review` — a signal requiring human judgment, such as target-size exceptions, text-spacing overflow, placeholder links, a 5xx response, linked-image wording, or ambiguous component behavior.
- `blocker` — the requested page could not be tested.
- `manual` — procedures automation cannot prove.

Link validation deliberately avoids broad crawling and destructive requests:

- Only rendered same-origin links are network-checked.
- External links, downloads, non-HTTP protocols, and logout/delete/remove/unsubscribe paths are not requested.
- HTTP 404/410 is confirmed only when both the authenticated Playwright request context and an in-page browser fetch return the same status.
- HTTP 5xx and placeholder destinations remain review items.
- Empty link names include text, ARIA labels, valid labelled-by text, descendant image alternatives, input values, and titles before being reported.
- Equivalent custom and axe link-name evidence is de-duplicated.

Tab checks do not report optional Home/End support as a failure. They separately test orientation-aware arrow navigation, Enter/Space or automatic activation, `aria-selected`, tabindex behavior, `aria-controls`, `tabpanel`, and `aria-labelledby` relationships. Broken references and keyboard-unreachable tabs are confirmed; non-standard but potentially operable authoring patterns remain review items.

## Configuration

Pass `--config audit.config.json`. Command-line values override the file.

```json
{
  "auditor": "Automated",
  "outputDir": "artifacts/client-audit",
  "allowedHosts": ["preview.example.test"],
  "stagingOnly": true,
  "headless": true,
  "channel": "chrome",
  "concurrency": 2,
  "timeoutMs": 30000,
  "maxTabStops": 120,
  "maxLinksPerPage": 200,
  "captureScreenshots": true
}
```

Use `--headed` only when debugging. Normal and CI execution should remain headless.

## MCP tools

- `run_accessibility_audit` — recommended one-shot entry point with confirmation, progress, cancellation, report generation, and validation.
- `audit_pages` — lower-level explicit URL entry point.
- `audit_from_file` — lower-level page-list entry point.
- `get_audit_instructions` — returns the embedded generic workflow.
- `validate_accessibility_report` — validates workbook structure, remediation, image evidence, and obsolete-sheet removal.
- `list_guided_manual_checks` — returns procedures automation does not prove.

The server also publishes the `run-accessibility-audit` MCP prompt.

## What the automation does not prove

Automation cannot establish complete WCAG conformance. Manual work remains necessary for:

- Supported screen-reader/browser combinations and dynamic announcements.
- Physical mobile devices, touch gestures, orientation, and drag alternatives.
- Alternative-text meaning, captions, audio descriptions, language changes, and heading/label quality.
- Complete contrast over gradients, images, and every component state.
- Timing, flashing, cognitive consistency, error quality, accessible authentication, and exception analysis.
- Complete keyboard journeys and application-specific workflows not safely submitted by automation.

Use `list_guided_manual_checks`, the workbook Overview, and [docs/manual-verification.md](docs/manual-verification.md) to complete those procedures.

## Security and isolation

- The target repository is read-only. The plugin does not edit source, governance files, agent rules, CI, hooks, manifests, or lockfiles.
- Dependencies are installed in the plugin directory, not the audited project.
- Output is written only to the configured audit directory.
- Only explicitly supplied URLs are audited.
- Host allowlists and optional staging-only enforcement are available.
- Browser checks are headless by default.
- No credentials are collected or transmitted by the plugin. Authenticated pages use the browser context available to the launched audit session.
- Screenshots and page content can contain sensitive information; protect and delete report artifacts according to project policy.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and data-handling notes.

## Validate and develop

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:integration
npm pack --dry-run
```

Validate a generated workbook:

```sh
node dist/cli.js validate accessibility-audit-results/Accessibility_Audit_Report.xlsx
```

The integration suite runs real Chromium, verifies confirmed/review classifications, checks element screenshot capture and embedding, and tests graceful cancellation. Unit tests do not replace real browser or manual assistive-technology verification.

## Troubleshooting

### Plugin or MCP server is not visible

1. Run `npm ci` and `npm run build` in the plugin directory.
2. Confirm `dist/mcp.js` exists.
3. Reload the editor or start a new Claude/Codex session.
4. Confirm the plugin is enabled at the intended user/workspace scope.
5. Review the client’s MCP logs for `accessibility-audit` startup errors.

### Chromium executable is missing

```sh
npx playwright install chromium
```

Alternatively configure a supported installed channel such as `chrome`.

### A page was skipped

Check `allowedHosts`, `stagingOnly`, redirects, authentication, and the `skippedUrls` or Page Inventory reason. A skipped or interrupted page is never presented as passed.

### A broken link looks incorrect

Inspect the JSON evidence, response status, final URL, authentication state, and page-specific routing. Only matching 404/410 checks are confirmed; other uncertain states remain review findings.

### Images are missing from Image Inventory

Keep `captureScreenshots` enabled, confirm the output directory is writable, and inspect the JSON evidence path. The workbook validator fails when an evidence row lacks its embedded image.

## Support and contribution

- Usage and troubleshooting: [SUPPORT.md](SUPPORT.md)
- Security reports: [SECURITY.md](SECURITY.md)
- Contribution and verification requirements: [CONTRIBUTING.md](CONTRIBUTING.md)
- Release history: [CHANGELOG.md](CHANGELOG.md)
- Detailed test matrix: [docs/testing-matrix.md](docs/testing-matrix.md)
- Workbook behavior: [docs/reporting.md](docs/reporting.md)

## License

MIT. See [LICENSE](LICENSE).
