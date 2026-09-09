# User guide

This guide explains how to run and use the Accessibility Audit Plugin without assuming previous WCAG or accessibility-testing experience.

## What the plugin is for

Use the plugin to collect repeatable accessibility evidence from a known set of web pages. It helps developers, QA testers, designers, content authors, and accessibility specialists identify barriers, organize remediation, and retest consistently.

The plugin does three things:

1. Opens each supplied page in headless Chromium at three viewport sizes.
2. Runs automated and scripted interaction checks and records the evidence.
3. Produces a polished self-contained HTML report, a structured Excel workbook, detailed JSON, linked screenshots, and a portable ZIP.

It does not certify WCAG conformance. W3C explains that tools can assist evaluation but cannot determine accessibility without knowledgeable human evaluation.

## Before the first audit

Prepare:

- authorized HTTP or HTTPS pages that the test may open;
- a complete page list if the requested scope is larger than a few pages;
- any access needed for protected staging pages;
- the auditor name to record, or accept `Automated` when no person owns the audit;
- a writable output directory;
- time after the automated run for review and manual testing.

Do not put passwords, session tokens, or other secrets in URLs, configuration files, filenames, or prompts. Screenshots and page text can contain sensitive information, so store the output according to project policy.

## Step 1: choose the scope

The plugin is URL-list driven. It never assumes that one URL represents an entire site.

| Intended scope | Input to provide |
|---|---|
| One page | One complete HTTP(S) URL |
| A short user journey | Each page URL in the journey |
| Selected templates | At least one representative URL for each template, plus pages with meaningful component variations |
| A complete known site | A complete, deduplicated canonical URL list in XLSX, CSV, TXT, or JSON |

Include pages that expose distinct states or content, such as search results, no-results states, form pages, error pages, localized pages, and pages with unique navigation or widgets. A component that is absent from the supplied pages cannot be tested.

The landing-page QA URL is only the main reference link shown in `Audit Summary`. Changing it does not add pages to the audit.

### Page-list files

Supported formats:

- XLSX: columns named `QA page`, `Staging URL`, `URL`, or `Page URL` are preferred; otherwise HTTP(S) cells are scanned.
- CSV: include the page URLs as values in the file.
- TXT: normally use one URL per line.
- JSON: use an array or object containing URL strings.

Remove production URLs when the assignment is staging-only. Remove duplicate tracking variants unless they intentionally render different content. Keep every required locale or page variation as its own URL.

## Step 2: run the audit

### Cursor or Claude Code

Open a project, then use the installed command:

```text
/accessibility-audit https://preview.example.test/
```

For selected pages:

```text
/accessibility-audit https://preview.example.test/ https://preview.example.test/jobs
```

For a page-list file available to the editor:

```text
/accessibility-audit pages.xlsx
```

The plugin is isolated from the open project. It does not edit the project’s source, dependencies, configuration, governance, or CI. The project only provides working context and, optionally, a page-list file.

### Codex

In a supported Codex plugin surface, use a direct request:

```text
Use the Accessibility Audit plugin to audit every URL in pages.xlsx.
```

Codex should invoke the installed `run_accessibility_audit` tool and show the same confirmation fields. In Codex CLI, `/plugins` opens the plugin browser. Start a new session after installing or updating the plugin. The Codex IDE extension does not currently support plugins; use Codex CLI or another supported Codex/ChatGPT plugin surface.

### Terminal

From the built plugin directory:

```sh
node dist/cli.js audit pages.xlsx
```

The terminal prompts for:

1. Auditor name.
2. Landing-page QA URL.
3. Confirmation to start.

Press Enter to accept a displayed default. Use `--yes` only in trusted automation when the supplied and default values are already correct.

## Step 3: check the confirmation

Before accepting, verify:

- the URL or page-list input is the intended one;
- the auditor name is correct;
- the landing-page QA URL is the project’s main QA/staging reference;
- the output directory is appropriate;
- `stagingOnly` is enabled only when every target uses a recognizable staging, QA, preview, test, or local hostname;
- the host allowlist includes the intended hosts and nothing broader.

If a client cannot display the confirmation form, the agent should show the same values in chat and ask once before retrying the tool with confirmation enabled.

## Step 4: follow progress or stop safely

The run reports preparation, URL resolution, browser progress, report writing, validation, and completion. Browser checks are headless by default.

To stop:

- use the editor’s Stop control in Cursor, Claude Code, or Codex; or
- press `Ctrl+C` once in a terminal.

One stop request allows the plugin to close Chromium and write partial HTML and JSON plus validated XLSX and ZIP output. A second `Ctrl+C` exits immediately and may prevent partial reports from being finalized.

Cancelled output must be treated as partial. `Page Inventory` lists the URLs whose browser testing started; check the JSON summary to determine which pages and viewports completed, remained partial, or never started.

## Step 5: open the output correctly

The output contains:

- `Accessibility_Audit_Report.html` — the easiest report to open, search, filter, print, and share;
- `Accessibility_Audit_Report.xlsx` — the working accessibility report;
- `audit-results.json` — detailed evidence and run state;
- `screenshots/elements/` — focused evidence for confirmed component failures;
- `screenshots/` — full-page evidence only for page-level failures or blockers;
- a ZIP beside the output directory containing the portable package.

For sharing, send the ZIP. The recipient should extract the complete ZIP, open the HTML report first, and use the workbook for triage. Opening the workbook directly from inside the ZIP, moving only the workbook, or renaming/moving the screenshot tree can break relative evidence links.

## Step 6: review the workbook

Review in this order:

1. `Audit Summary`: confirm scope, auditor, methods, totals, limitations, and outstanding manual checks.
2. `Findings`: triage confirmed issues first, then perform the stated checks for review items.
3. `Page Inventory`: confirm each tested URL and its completion, viewport, consent, and runtime-error state.
4. `Evidence`: open each relative screenshot link and match it to its finding, page, viewport, rule, and locator.
5. `Manual Checks`: record the outcome of every applicable human verification procedure.
6. `WCAG 2.2 Reference`: use the criterion, level, title, and Understanding link as a navigation aid.

Do not conclude that the site passed because the workbook has few or no automated rows. An `Open` workflow status means the item still needs triage; `Evidence type` states how strongly automation supports it.

## Understanding one finding row

Read these fields together:

| Field | How to use it |
|---|---|
| Affected URL(s) | Every page where the same component implementation and root cause were found. |
| Evidence type | Whether the item is confirmed, requires review, records a blocker, or needs a manual decision. |
| Status | Workflow state, initially `Open`. |
| WCAG criterion, Level, WCAG title | The mapped WCAG 2.2 reference. |
| Summary | A short title stating the affected desktop/mobile scope and rendered component. |
| Viewport(s) | Affected desktop/mobile/reflow viewport. |
| Component and Location | The rendered component and page area. |
| Issue | Component name, page location, affected viewport, barrier, user impact, and technical locator. |
| User impact | The practical barrier for disabled users. |
| Technical locator | A selector or other reproducible location hint. |
| Test method, Actual result, Expected result | How the result was produced and what should be reproduced or verified. |
| Recommendation | Concrete remediation guidance. |
| Owner and Effort | Triage fields for the delivery team. |
| Screenshot | Link to the first evidence image when one exists. |
| Rule ID and Labels | Traceability to the automated or manual rule and grouping metadata. |

One reusable component/root-cause combination is consolidated into one row across multiple pages, including repeated instances within the component. Each affected URL still appears separately in Links. Page-specific implementations, different measured colour treatments, behaviours, criteria, or remediation requirements remain separate rows. A repeated same-name landmark set or one family of filter controls should not become one row per DOM node when its implementation and root cause match. Missing `aria-controls` alone produces no finding for an ordinary disclosure/accordion, and Escape is not a generic accordion/disclosure requirement.

Target-size reviews are deliberately conservative. A control is not added to the workbook solely because one measured dimension is below 24 CSS pixels. The plugin first requires visible on-screen hit-tested geometry, excludes inline text links, and checks spacing against neighbouring targets. A row is created only for a spacing collision or an axe target-size signal, and it remains a review until a person assesses the remaining WCAG exceptions. Exact measurements and neighbouring-target evidence remain in JSON.

The JSON `coverage` matrix is the execution record for every started page and viewport. Read it before claiming an area passed. `tested-inconclusive`, `manual-review-required`, `not-tested`, and `not-applicable` are not passes. In particular, sampled keyboard traversal, a non-empty title, an axe incomplete result, a configured link-limit truncation, or the absence of a finding does not prove conformance.

## Step 7: decide what happens next

Use this triage sequence:

1. Resolve blockers and rerun those pages.
2. Reproduce confirmed issues and prioritize them by user impact and product risk.
3. Complete the Test method for every review item; reclassify it only after evidence supports the decision.
4. Assign and estimate accepted failures.
5. Complete the guided manual checks with suitable browsers, devices, and assistive technologies.
6. Implement fixes.
7. Rerun the same URL list and manually retest affected journeys and states.
8. Keep before/after evidence according to the project’s retention policy.

## Common misunderstandings

### “I supplied the home page, so the full site was tested.”

No. Only supplied URLs are tested. Provide a complete page list for a complete known-site scope.

### “The automated audit found nothing, so the page passes WCAG.”

No. Many requirements need human judgment, assistive technology, a physical device, or states the automation cannot safely create.

### “A review row is definitely a WCAG failure.”

No. It is a signal that needs the described manual decision. WCAG exceptions and page context can change the result.

### “Status says Open, so confidence must be confirmed.”

No. `Status` is initialized for the implementation workflow. Evidence confidence is recorded separately in `Evidence type`.

### “The screenshots prove the whole issue.”

Not always. A screenshot provides visual context. Use it with the Test method, technical locator, structured JSON evidence, and manual reproduction.

## When to involve a specialist

Involve an accessibility specialist when:

- the issue depends on WCAG exceptions or interpretation;
- a custom widget, complex form, authentication flow, or dynamic application behavior is involved;
- screen-reader or voice-control output must be evaluated;
- legal or contractual conformance claims are being considered;
- automated and manual evidence disagree;
- remediation changes the interaction design rather than only markup or styling.
