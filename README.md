# Accessibility Audit Plugin

[![Verify plugin](https://github.com/CarlasHub/accessibility-audit-plugin/actions/workflows/verify.yml/badge.svg)](https://github.com/CarlasHub/accessibility-audit-plugin/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933.svg)](package.json)

A free GitHub Action and isolated Codex, Claude Code, Cursor, GitHub Copilot CLI, and GitHub Copilot in VS Code plugin that helps teams find and document web accessibility barriers. Give it one or more page URLs—or a file containing URLs—and it runs repeatable checks in a headless browser, then produces a polished self-contained HTML report, an Excel workbook, detailed JSON evidence, and a portable ZIP.

Maintained by CarlasHub and released under the MIT License.

The audit engine is site-independent. It contains no customer-specific hostnames, page assumptions, selectors, rules, or defaults. Every target URL is supplied at run time, and evidence from one audit is never reused in another. Customer sites used during development are external validation targets only and are not part of the plugin package.

You do not need to know WCAG terminology to run the plugin. Start with the workflow below, use the [installation guide](docs/installation.md) for your client, then use the [plain-language user guide](docs/user-guide.md) and [WCAG basics](docs/wcag-basics.md) to understand the results.

> **Important:** this plugin is an automated testing aid, not a WCAG certification. A report with no automated findings does not prove that a page is accessible. Screen-reader, physical-device, content-meaning, visual-judgment, and other guided checks remain manual. W3C likewise states that no evaluation tool alone can determine whether a site meets accessibility standards.

## GitHub Actions: start-to-results tutorial

[![Start-to-results tutorial for auditing a different repository with GitHub Actions](https://raw.githubusercontent.com/CarlasHub/accessibility-audit-plugin/main/.github/media/a11y-test-cases-github-actions-tutorial-poster.png)](https://github.com/CarlasHub/accessibility-audit-plugin/releases/download/v1.2.1/A11y_Test_Cases_GitHub_Actions_Tutorial.mp4)

[Watch or download the complete captioned walkthrough](https://github.com/CarlasHub/accessibility-audit-plugin/releases/download/v1.2.1/A11y_Test_Cases_GitHub_Actions_Tutorial.mp4). It starts in a separate repository, creates the workflow, runs it from the Actions tab, follows the job, downloads the artifact, and opens both report formats. You can also follow the [click-by-click written tutorial](docs/a11y-test-cases-github-actions-tutorial.md), read the [video transcript](docs/a11y-test-cases-github-actions-tutorial-transcript.md), or inspect the [successful public run](https://github.com/CarlasHub/a11y-test-cases/actions/runs/34448319858).

The demonstrated audit of [A11y Test Cases](https://carlashub.github.io/a11y-test-cases/) completed one page and produced 52 findings: 51 confirmed and 1 requiring review, plus 7 guided manual checks. No secret or paid marketplace installation is required for a public URL.

## Deeper BuggyLand benchmark

[![Captioned walkthrough of the CarlasHub Action auditing BuggyLand](https://raw.githubusercontent.com/CarlasHub/accessibility-audit-plugin/main/.github/media/buggyland-github-action-tutorial-poster.png)](https://github.com/CarlasHub/accessibility-audit-plugin/releases/download/v1.2.0/BuggyLand_GitHub_Action_Tutorial.mp4)

[Watch or download the complete captioned walkthrough](https://github.com/CarlasHub/accessibility-audit-plugin/releases/download/v1.2.0/BuggyLand_GitHub_Action_Tutorial.mp4), inspect the [successful public run](https://github.com/CarlasHub/buggyland/actions/runs/34391886799), or read the [video transcript](docs/buggyland-github-action-tutorial-transcript.md). It starts with adding and running the workflow, then shows exactly where to download and open the HTML and Excel results.

The two [BuggyLand](https://carlashub.github.io/buggyland/) pages declare 172 intentional failure fixtures across all 86 active WCAG 2.2 success criteria. The Action produced 70 consolidated machine results: 52 confirmed failures and 18 items for review, with zero execution errors. Those numbers should not match: automated rules inspect rendered behaviour, consolidate repeated evidence, and cannot decide every WCAG requirement. The [benchmark evidence guide](docs/buggyland-benchmark.md) provides the complete criteria matrix, fixture inventory, downloadable enhanced workbook, raw JSON, and manual verification plan.

For a client-neutral example, [watch the sanitised plugin demonstration](https://github.com/CarlasHub/accessibility-audit-plugin/blob/main/.github/media/accessibility-audit-demo.mp4) or read its [transcript](https://github.com/CarlasHub/accessibility-audit-plugin/blob/main/docs/accessibility-audit-demo-transcript.md).

## Use the free GitHub Action

Add WCAG 2.2 evidence to a workflow without installing this repository as an editor plugin:

```yaml
name: Accessibility audit

on:
  workflow_dispatch:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  accessibility:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - id: audit
        uses: CarlasHub/accessibility-audit-plugin@v1
        with:
          urls: |
            https://preview.example.test/
            https://preview.example.test/contact
          allowed-hosts: preview.example.test
          fail-on: serious
          github-token: ${{ secrets.GITHUB_TOKEN }}
      - name: Upload audit evidence
        if: always() && steps.audit.outputs.output-dir != ''
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: accessibility-audit
          path: ${{ steps.audit.outputs.output-dir }}
```

The Action tests only the URLs you list. It posts or updates one pull-request summary when permitted and retains HTML, Excel, JSON, screenshots, and a portable ZIP for upload. `fail-on: none` is the informational default; severity gates count confirmed findings only, never items awaiting human review. See [GitHub Action usage](docs/github-action.md) for every input, output, permission, and security recommendation.

## Start here

If the plugin is already installed:

1. Decide which pages are in scope. The plugin tests only the URLs you supply; it does not discover or crawl a whole site.
2. In Cursor or Claude Code, run `/accessibility-audit` with one URL, several URLs, or a page-list file. In Codex or Copilot, ask it to use the Accessibility Audit plugin with the same input.
3. Check the confirmation form. It shows the input, the auditor name, and the landing-page QA URL before testing starts.
4. Let the headless audit finish, or stop it safely if needed. Progress appears in the editor or terminal.
5. Extract the generated ZIP and open `Accessibility_Audit_Report.html` for the quickest review. Use `Accessibility_Audit_Report.xlsx` for detailed triage, keeping it beside the `screenshots` folder so its evidence links continue to work.

One page:

```text
/accessibility-audit https://preview.example.test/
```

Selected pages:

```text
/accessibility-audit https://preview.example.test/ https://preview.example.test/jobs https://preview.example.test/contact
```

Every page in a prepared list:

```text
/accessibility-audit pages.xlsx
```

Equivalent request in Codex or Copilot:

```text
Use the Accessibility Audit plugin to audit every URL in pages.xlsx.
```

For a complete-site audit, the page-list file must contain the complete canonical URL inventory. Supplying the home page does **not** make the plugin crawl the rest of the site.

### What the confirmation fields mean

| Field | Plain-language meaning | Default |
|---|---|---|
| Pages/input | The exact URLs or page-list file that will be tested. | Required |
| Auditor | The name recorded in the workbook. Use a person’s name when a person owns the audit. | `Automated` |
| Landing-page QA URL | The project’s main QA or staging URL shown in the Overview sheet. It is report metadata and does not add pages to the scope. | First resolved URL |
| Output directory | The isolated folder that receives the HTML report, workbook, JSON, screenshots, and ZIP. | `Accessibility Audit Results` in the user’s home directory |

### What happens during the audit

Every supplied page is checked at desktop (1440×1000), mobile (390×844), and 320-pixel reflow sizes. In plain terms, the plugin looks for problems such as:

- images, links, buttons, and form fields that do not have usable names;
- incorrect page structure or broken relationships between controls and content;
- keyboard focus that is unreachable, out of order, invisible, or fully covered;
- menus, disclosures, and tabs whose state or keyboard operation is broken;
- content that overflows at narrow widths or after WCAG text-spacing overrides;
- same-site links that are empty, placeholders, missing fragments, or consistently return 404/410;
- target-size spacing conflicts, plus selected table, media, and responsive-layout signals that require review.

The browser runs headlessly by default, so it should not take over the desktop. Visible consent banners are dismissed before the main checks and evidence capture. If one remains blocking, the plugin records the coverage blocker and does not claim that underlying interactions were tested. Each final confirmed, blocker, or review reporting unit can retain one representative contextual screenshot when the relevant state and element can be reproduced reliably; all occurrences remain traceable in JSON without creating a large duplicate image set.

### How to interpret the result

The report separates four evidence categories:

| Category | Meaning | What to do |
|---|---|---|
| `confirmed` | The plugin reproduced deterministic evidence of a failure. | Fix it, then retest. A person should still confirm high-impact or context-sensitive cases. |
| `review` | The plugin found a credible signal, but context or a WCAG exception requires human judgment. | Perform the documented Test method before deciding whether it fails. |
| `blocker` | The page could not be tested, for example because it returned an unavailable response. | Restore access or correct the URL, then rerun it. Never count it as a pass. |
| `manual` | Automation cannot determine the result. | Complete the stated guided check with an appropriate tester. |

Every populated finding starts with `Status = Open` so teams can triage it without implying a final compliance verdict. Use `Evidence type` to distinguish confirmed, review, blocker, and manual records, then follow `Test method` before assigning work.

Severity (`Critical`, `Serious`, `Moderate`, or `Minor`) describes expected user impact. It is different from WCAG level, evidence confidence, remediation effort, and delivery priority.

See [Understanding the report](docs/reporting.md) for a worksheet and column guide, and [Manual verification](docs/manual-verification.md) for checks that remain outstanding.

## Features

- Headless Playwright Chromium execution with visible terminal or MCP progress.
- Automatic one-time installation of headless Playwright Chromium when no supported browser is available; runtime and browser files stay in plugin-owned storage.
- axe-core WCAG 2.2 A/AA rules plus selected best-practice signals, which remain review items when no WCAG success criterion is mapped.
- DOM and semantic checks for page structure, image alternatives, controls, fields, landmarks, duplicate ids, tables, and media.
- Sequential keyboard traversal, focus visibility review, focus obscuration checks, and disclosure state/relationship interaction tests.
- Tab-component state, roving tabindex, arrow navigation, activation, and tab/panel relationship checks.
- Conservative same-origin link validation for empty names, placeholders, missing fragments, confirmed 404/410 destinations, and server-error review signals.
- Desktop, 390px mobile, and 320px reflow viewports.
- Consent-banner detection and dismissal before interaction testing and evidence capture; reject or necessary-only actions are preferred.
- At most one representative contextual component screenshot per final confirmed, blocker, or review reporting unit, with the affected element outlined inside its navigation, form, tablist, card, section, or other component boundary.
- Full-page screenshots only for page-level failures or unresolved blocking surfaces; a failed component capture never falls back to unrelated full-page evidence.
- Lightweight relative screenshot links in `Findings` and `Evidence`; images are not embedded in the workbook.
- Graceful cancellation that writes partial HTML and JSON plus a validated partial XLSX workbook.
- URL, XLSX, CSV, TXT, and JSON page-list inputs.
- One row for the same reusable component implementation, rendered name, and root cause across affected pages; generic unnamed controls also require the same rendered location, and page-specific findings remain separate.
- Embedded instructions, command, skill, rules, MCP server, workbook template, validation, CI checks, and generated marketplace payloads for Claude and GitHub Copilot.
- A self-contained Node.js GitHub Action with job-summary, pull-request-comment, artifact, and conservative quality-gate support.
- A per-page, per-viewport JSON coverage matrix that distinguishes confirmed pass/fail evidence from inconclusive, manual, not-tested, and not-applicable areas.

## Requirements

- Node.js 22 or later.
- npm.
- A Playwright-supported Chromium installation. If none is present, the plugin installs headless Playwright Chromium once after audit confirmation unless automatic installation is disabled.
- Microsoft Excel or another OOXML-compatible reader for the generated workbook.

No screen-reader package or operating-system accessibility permission is required.

## Install the plugin dependencies

Clone the plugin into its own directory. Do not install its dependencies inside a repository being audited.

```sh
git clone https://github.com/CarlasHub/accessibility-audit-plugin.git accessibility-audit
cd accessibility-audit
npm ci
npm run build
```

Installing Chromium during development is optional but avoids the first-run download:

```sh
npx playwright install chromium
```

The `dist/` directory is produced by `npm run build` and is intentionally not committed.

For complete platform-specific setup, activation, verification, updating, uninstalling, and troubleshooting steps, use [Installation](docs/installation.md). The sections below are the short local-development paths.

## Cursor installation

For local testing on macOS or Linux, Cursor discovers plugins under its local plugin directory. Symlink the built repository and reload Cursor:

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
git clone https://github.com/CarlasHub/accessibility-audit-plugin.git $Destination
Set-Location $Destination
npm ci
npx playwright install chromium
npm run build
```

After an installation is updated, run `npm ci`, `npm run build`, and reload Cursor.

Cursor can also load the root `mcp.json` when the repository is configured as a plugin. The manifest is [.cursor-plugin/plugin.json](.cursor-plugin/plugin.json).

Cursor Marketplace submission requires a public Git repository. A private repository can instead be used for local development or an organisation’s private team marketplace. See [Installation](docs/installation.md#3a-install-in-cursor) and the [Cursor plugin reference](https://cursor.com/docs/reference/plugins).

## Claude Code installation

Start Claude Code in the unrelated project while loading the separate built checkout:

```sh
cd /path/to/project-being-audited
claude --plugin-dir /path/to/accessibility-audit
```

The Claude plugin manifest is [.claude-plugin/plugin.json](.claude-plugin/plugin.json), and its MCP definition is [.claude-mcp.json](.claude-mcp.json).

For a persistent local installation, add the built checkout as a Claude marketplace and install the plugin:

```text
/plugin marketplace add /path/to/accessibility-audit
/plugin install accessibility-audit@accessibility-audit-marketplace
/reload-plugins
```

Team-marketplace publication is a separate release workflow: users need access to the destination marketplace, and the published snapshot must include runnable build output. See [Installation](docs/installation.md#3b-install-in-claude-code) and the [Claude Code plugin marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces).

## Claude Desktop Chat installation

Build the self-contained custom-plugin file:

```sh
npm ci
npm run package:claude-desktop
```

The command validates the archive structure and writes `artifacts/accessibility-audit-claude-desktop-<version>.zip` plus its SHA-256 file. In Claude Desktop, open **Customize**, select **Plugins**, use the custom-plugin upload option, and choose that ZIP. The ZIP contains the skill and its local MCP runtime; do not unzip it before uploading.

Open a new conversation in the **Chat** tab, type `/`, select **Run Accessibility Audit**, and provide one or more explicit URLs or a supported page-list file. The local MCP server requires Node.js 22 or later on the same computer. Organisation policy may prohibit custom plugins or local MCP servers. See [Installation](docs/installation.md#3c-install-in-claude-desktop-chat) for verification, updating, and removal.

## GitHub Copilot installation

The repository generates separate, marketplace-ready payloads for GitHub Copilot CLI and GitHub Copilot in VS Code. These payloads include compiled code, bundled production dependencies, skills, MCP configuration, and an isolated runtime launcher:

```sh
npm ci
npm run build:marketplace
npm run package:claude-desktop
npm run validate:marketplace
npm run test:marketplace
```

For local Copilot CLI verification, install the generated CLI payload directly:

```sh
copilot plugin install ./marketplace/carlashub-plugin-marketplace/accessibility-audit/copilot-cli
copilot plugin list
```

For team distribution, use the staged payload and catalog fragments documented in [Marketplace submission](docs/marketplace-submission.md). No marketplace repository is modified by the build command.

## Codex installation

The Codex manifest is [.codex-plugin/plugin.json](.codex-plugin/plugin.json), and the MCP server is declared in [.mcp.json](.mcp.json). Register the separate built checkout as a local marketplace, install it, and start a new session:

```sh
codex plugin marketplace add /path/to/accessibility-audit
codex plugin add accessibility-audit@accessibility-audit-marketplace
codex plugin list
```

In Codex CLI, enter `/plugins` to open the plugin browser. See [Installation](docs/installation.md#3c-install-in-codex) for activation, updating, and troubleshooting.

The Codex IDE extension does not currently support plugins. Use Codex CLI or another supported Codex/ChatGPT plugin surface. See the [official OpenAI plugin documentation](https://developers.openai.com/codex/plugins).

## Run an audit in Cursor, Claude, or Copilot

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

The confirmation form shows the supplied pages or input file and asks for the landing-page QA URL and auditor. `Automated` is the editable auditor default. The landing page defaults to the first resolved URL. If the client does not support MCP forms, the tool returns `confirmation-required`; the agent confirms the same values in chat and retries once.

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
  --auditor "Auditor Name" \
  --landing-page https://preview.example.test/ \
  --output "accessibility-audit-results" \
  --allow-host preview.example.test \
  --staging-only \
  --max-links 200
```

Page-list input:

```sh
node dist/cli.js audit pages.xlsx \
  --auditor "Auditor Name" \
  --output "accessibility-audit-results" \
  --staging-only
```

Interactive execution prints the targets, asks for the auditor and landing-page QA URL, and asks for start confirmation. `--yes` accepts supplied/default values and starts without prompts.

Progress is written to stderr. The final structured result is written to stdout.

### Stop an audit safely

- In Cursor, Claude, Codex, or Copilot, press the client’s **Stop** control.
- In a terminal, press `Ctrl+C` once.

The plugin closes active Chromium work, retains completed evidence, writes `Accessibility_Audit_Report.html`, `audit-results.json`, and `Accessibility_Audit_Report.xlsx`, validates the partial workbook, packages its files, and returns `status: "cancelled"`. Pressing `Ctrl+C` a second time exits immediately and can prevent report completion.

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

- `Accessibility_Audit_Report.html` — polished, self-contained, accessible report for fast browser review, filtering, printing, and sharing.
- `Accessibility_Audit_Report.xlsx` — validated CarlasHub WCAG 2.2 audit workbook.
- `audit-results.json` — complete evidence, classifications, requested/completed/skipped pages, axe incomplete/pass metadata, keyboard and link truncation, interaction blockers, the coverage matrix, and guided checks.
- `screenshots/*.png` — full-page screenshots only for page-level failures or unresolved blocking surfaces.
- `screenshots/elements/*.png` — one retained representative contextual image per final confirmed, blocker, or review reporting unit when the element and tested state are visible and stable; the affected element is outlined within surrounding component context.
- `<output-directory>.zip` — portable copy of the HTML report, workbook, JSON, and linked screenshot tree, written beside the output directory.

Workbook worksheets:

- `Audit Summary` — landing-page QA URL, scope, auditor, methods, totals, severity distribution, limitations, and outstanding guided checks.
- `Findings` — a 25-field remediation register covering evidence confidence, workflow status, severity, WCAG mapping, affected scope, user impact, reproducible results, recommendation, ownership, effort, and screenshot evidence.
- `Page Inventory` — every requested URL with audit state, planned and completed viewports, consent handling, runtime errors, and notes.
- `Evidence` — portable evidence paths linked to their finding, page, viewport, rule, component, locator, evidence type, and detail.
- `Manual Checks` — guided procedures, applicability, status, and reviewer notes for checks automation cannot complete.
- `WCAG 2.2 Reference` — visible criterion, level, title, and W3C Understanding links used to enrich findings.

The report contains no screen-reader worksheet or screen-reader execution result.

The bundled workbook is an original CarlasHub template designed around WCAG 2.2 audit and remediation workflows. Its six sheets separate executive summary, findings, page coverage, evidence, guided manual checks, and standards reference while retaining portable links and validation controls.

## Finding confidence and false-positive controls

The report keeps these categories separate:

- `confirmed` — deterministic reproduced evidence, such as a WCAG-tagged axe violation, missing label, broken ARIA relationship, missing fragment, or two-source 404/410 response.
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
- axe `region` best-practice nodes are summarized as one page-structure review row per page instead of one failed row per DOM node.
- Identical text-contrast treatments can be shared across pages only when the measured foreground, background, ratio, implementation evidence, and root cause match. Distinct colour treatments remain distinct rows, and a host is never labelled site-wide without traceable evidence for every affected page.
- Repeated landmark-name signals are grouped only when the role, accessible name, and implementation signature match; related axe nodes are retained.
- Repeated disclosure triggers are grouped only within the same rendered component family and root cause. Missing `aria-controls` alone produces no finding for an ordinary disclosure or accordion.
- Disclosure checks wait for the rendered control inventory to stabilize, establish a collapsed baseline, verify the exact live control receiving focus, and test both Enter and Space. After each activation they re-query the control and every referenced panel, wait for JavaScript and animations to settle, and capture `aria-expanded`, visual panel visibility, and accessibility-tree exposure in the same DOM snapshot. Visual visibility is measured independently from `aria-hidden`/`inert` exposure so those conditions cannot be confused. A mismatch is confirmed only from settled visual-state evidence; hidden/inactive clones, ambiguous identities, detached controls, incomplete interactions, and missing `aria-controls` alone remain raw JSON and inconclusive coverage evidence, not workbook findings.
- Generic disclosure checks do not require Escape. Escape is evaluated manually only for interaction patterns that require it, such as dialogs and applicable menus or popovers.
- Invalid `dl` parent/child and orphaned `dt`/`dd` signals from the same description-list component are reported as one structural root cause.
- A target is not reported merely because one rendered dimension is below 24 CSS pixels. Inline text links are excluded, isolated undersized targets that satisfy the spacing geometry do not create workbook rows, and raw measurements remain available in JSON.
- Target-size rows require a rendered spacing collision or an axe target-size violation/incomplete signal, remain `review` items while the Equivalent, Inline, User Agent Control, and Essential exceptions are unresolved, and group related controls in the same rendered component into one finding.
- Focus-obscuration checks sample the visible centre and four inset corners. A control is reported as confirmed only when unrelated content covers every sampled point; off-screen geometry and one covered point do not create a failure.

Tab checks do not report optional Home/End support as a failure. They separately test orientation-aware arrow navigation, Enter/Space or automatic activation, `aria-selected`, tabindex behavior, `aria-controls`, `tabpanel`, and `aria-labelledby` relationships. Broken references and keyboard-unreachable tabs are confirmed; non-standard but potentially operable authoring patterns remain review items.

## Configuration

Pass `--config audit.config.json`. Command-line values override the file.

```json
{
  "auditor": "Automated",
  "landingPageUrl": "https://preview.example.test/",
  "outputDir": "artifacts/client-audit",
  "allowedHosts": ["preview.example.test"],
  "stagingOnly": true,
  "headless": true,
  "autoInstallBrowser": true,
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
- Source-checkout dependencies stay in the plugin directory. Marketplace runtime dependencies and downloaded browsers stay in client-owned plugin data, never in the audited project.
- Output is written only to the configured audit directory.
- Only explicitly supplied URLs are audited.
- Visible consent banners are dismissed before component checks and screenshot capture. JSON states whether a banner was found, which action was used, and whether it was dismissed.
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
npm run build:marketplace
npm run validate:marketplace
npm run test:marketplace
npm pack --dry-run
```

Validate a generated workbook:

```sh
node dist/cli.js validate accessibility-audit-results/Accessibility_Audit_Report.xlsx
```

The integration suite runs real Chromium, verifies confirmed/review classifications, checks focused screenshot capture and relative evidence links, validates the portable archive, and tests graceful cancellation. Unit tests do not replace real browser or manual assistive-technology verification.

## Troubleshooting

### Plugin or MCP server is not visible

1. Run `npm ci` and `npm run build` in the plugin directory.
2. Confirm `dist/mcp.js` exists.
3. Reload the editor or start a new Claude, Codex, or Copilot session.
4. Confirm the plugin is enabled at the intended user/workspace scope.
5. Review the client’s MCP logs for `accessibility-audit` startup errors.

### Chromium executable is missing

The plugin installs Playwright Chromium automatically when no bundled Chromium, Chrome, or Edge executable is available. If automatic downloads are blocked, run `npx playwright install chromium` in the plugin checkout or configure a supported browser. Pass `--no-auto-install-browser` only when that fallback must be disabled.

### A page was skipped

Check `allowedHosts`, `stagingOnly`, redirects, authentication, and `skippedUrls` in `audit-results.json`. `Page Inventory` shows each requested URL and its audit state. A skipped or interrupted page is never presented as passed.

### A broken link looks incorrect

Inspect the JSON evidence, response status, final URL, authentication state, and page-specific routing. Only matching 404/410 checks are confirmed; placeholder destinations and 5xx responses remain review findings.

### Images are missing from Evidence

Keep `captureScreenshots` enabled, confirm the output directory is writable, and inspect the JSON evidence path. The final report retains at most one representative screenshot for each confirmed, blocker, or review reporting unit when the state and element can be reproduced. A component whose selector cannot be resolved is left without a screenshot instead of receiving unrelated full-page evidence. Keep the workbook beside its `screenshots` directory or use the generated ZIP so the relative links continue to work.

## Support and contribution

- Installation for Cursor, Claude Code, Codex, and GitHub Copilot: [docs/installation.md](docs/installation.md)
- Marketplace packaging and submission: [docs/marketplace-submission.md](docs/marketplace-submission.md)
- GitHub Action usage: [docs/github-action.md](docs/github-action.md)
- GitHub Developer Program application: [docs/github-developer-program.md](docs/github-developer-program.md)
- Start-to-finish instructions: [docs/user-guide.md](docs/user-guide.md)
- WCAG terminology for non-specialists: [docs/wcag-basics.md](docs/wcag-basics.md)
- Usage and troubleshooting: [SUPPORT.md](SUPPORT.md)
- Security reports: [SECURITY.md](SECURITY.md)
- Contribution and verification requirements: [CONTRIBUTING.md](CONTRIBUTING.md)
- Release history: [CHANGELOG.md](CHANGELOG.md)
- Detailed test matrix: [docs/testing-matrix.md](docs/testing-matrix.md)
- Workbook behavior: [docs/reporting.md](docs/reporting.md)
- Guided checks after automation: [docs/manual-verification.md](docs/manual-verification.md)
- Privacy notice: [PRIVACY.md](PRIVACY.md)
- Terms of use: [TERMS.md](TERMS.md)

## License

MIT. See [LICENSE](LICENSE).
