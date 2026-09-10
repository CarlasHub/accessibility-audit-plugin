# Use CarlasHub WCAG Accessibility Audit in GitHub Actions

> Approval draft for the replacement video tutorial. The video must not be recorded until this guide and the companion narration are approved.

This guide teaches a first-time user how to add the public Action to a repository, run it against a deployed website, find and understand every report, choose run triggers and quality gates, and complete the human testing that automation cannot replace.

## What this tutorial does—and does not—claim

The Action collects repeatable accessibility evidence. It does **not** certify a website, prove complete WCAG conformance, or replace testing by people with disabilities.

The GitHub Action accepts explicit `http://` or `https://` URLs. It does not crawl a whole site and it does not accept a CSV file as the `urls` input. The separate local CLI/editor integrations can use `.xlsx`, `.csv`, `.txt`, or `.json` URL inventories; that is a different operating mode from this GitHub Actions tutorial.

By the end, the learner can:

- add the workflow without installing software locally;
- run it manually, after a deployment, on a pull request with a real preview URL, or on a schedule;
- understand which automated tests ran and which WCAG checks still need a person;
- download the HTML, Excel, JSON, screenshots, and ZIP evidence;
- investigate possible false positives instead of treating every signal as a confirmed defect;
- choose a blocking policy for continuous integration; and
- fix, deploy, rerun, and compare evidence.

## Before you start

You need:

1. A GitHub repository where you can commit a workflow file.
2. A deployed website that GitHub-hosted runners can reach. A local-only address such as `localhost` will not work unless the job starts that site first.
3. The exact pages you want to audit.
4. The hostnames those pages are allowed to use.

The worked example uses:

- repository: `CarlasHub/a11y-test-cases`;
- page: `https://carlashub.github.io/a11y-test-cases/`; and
- allowed host: `carlashub.github.io`.

Only audit websites you own or have permission to test. Start with a small, representative page list; each URL is tested at several viewports and can take time.

## 1. Create the workflow from the GitHub website

1. Open the repository's **Code** tab.
2. Select **Add file**, then **Create new file**.
3. Enter `.github/workflows/accessibility-audit.yml` as the filename. GitHub creates the folders automatically.
4. Paste this baseline workflow:

```yaml
name: WCAG accessibility audit

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Audit the published site
        id: audit
        uses: CarlasHub/accessibility-audit-plugin@v1
        with:
          urls: https://carlashub.github.io/a11y-test-cases/
          allowed-hosts: carlashub.github.io
          auditor: Carla / CarlasHub
          wcag-level: AA
          aaa-advisory: 'true'
          fail-on: none
          comment-on-pr: 'false'

      - name: Upload audit evidence
        if: always() && steps.audit.outputs.output-dir != ''
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: accessibility-audit
          path: ${{ steps.audit.outputs.output-dir }}
          retention-days: 14
```

5. Select **Commit changes**, add a clear message, and commit to the default branch or submit a pull request for review.

### Why every important line is present

- `workflow_dispatch` adds the **Run workflow** button.
- `contents: read` grants only the baseline repository permission this job needs.
- `timeout-minutes` stops a stuck job from running indefinitely.
- `id: audit` lets later steps read the Action's outputs.
- `@v1` follows compatible version 1 releases. For maximum supply-chain reproducibility, replace it with a reviewed full commit SHA and update it deliberately.
- `urls` is the exact audit scope. Add one complete URL per line for multiple pages.
- `allowed-hosts` prevents an accidental redirect or input mistake from moving the audit outside the approved host.
- `wcag-level: AA` runs the supported A and AA automation.
- `aaa-advisory: 'true'` adds the supported AAA automation as advisory evidence. It does not turn the result into an AAA conformance assessment.
- `fail-on: none` is the safest first run because it produces evidence without blocking the workflow.
- `comment-on-pr: 'false'` avoids pull-request comments in a manual-only starter workflow.
- `if: always()` preserves evidence even when a later quality gate marks the audit unsuccessful.
- `upload-artifact` makes the result downloadable from the workflow run. Fourteen days is a requested retention period; the repository or organization maximum can shorten it.

The public demonstration previously used the legacy `wcag-level: AAA` form. New workflows should use `wcag-level: AA` plus `aaa-advisory: 'true'` so the baseline and advisory evidence are explicit.

### Multiple pages

Use a YAML block and repeat only approved URLs:

```yaml
with:
  urls: |
    https://example.com/
    https://example.com/help/
    https://example.com/contact/
  allowed-hosts: example.com
```

For more than one host, use one host per line. Do not add third-party hosts merely to silence a scope error.

## 2. Run the workflow

1. Open the repository's **Actions** tab.
2. Select **WCAG accessibility audit** in the workflow list.
3. Select **Run workflow**.
4. Choose the branch containing the workflow.
5. Select the green **Run workflow** button.
6. Open the new run, then open the `audit` job to watch its real steps and logs.

If the button is missing, confirm that the workflow contains `workflow_dispatch`, exists on the default branch, Actions are enabled, and you have write access. GitHub requires manually dispatched workflows to exist on the default branch.

## 3. Understand what the Action tests

For every accepted URL, the Action exercises Desktop, Mobile, and a 320 CSS-pixel reflow viewport. Its current automated and bounded checks include:

- axe rules mapped to WCAG 2.2 A/AA, selected best practices, and optional AAA advisory rules;
- page language, title, landmarks, heading structure, duplicate IDs, image alternatives, accessible names, form labels, and metadata;
- deterministic keyboard and focus journeys, including bypass links, visible focus evidence, focus order signals, and bounded trap detection;
- disclosure and tabs semantics, state relationships, Enter/Space activation, and next-focus evidence;
- reflow, text spacing, horizontal overflow, overlap, and clipping signals;
- bounded same-origin link checks;
- target-size, table, and autoplay signals;
- consent dialog or modal blockers; and
- screenshots when capture is enabled.

The result model matters:

- **confirmed finding** means the configured automated assertion found reproducible failing evidence;
- **review finding** means a signal needs a person to decide whether it is a real accessibility defect;
- **blocker** means the requested test could not obtain trustworthy page evidence, for example because a modal prevented access;
- **manual check** is an important requirement the Action cannot responsibly decide; and
- **confirmed passed** applies only to the assertion that actually ran, not to the whole WCAG success criterion.

Coverage is reported as `confirmed-passed`, `confirmed-failed`, `tested-inconclusive`, `manual-review-required`, `not-tested`, or `not-applicable`. Incomplete, ambiguous, or blocked evidence must not be reported as a pass.

### Screen-reader evidence

The consumer Action does not currently expose a Guidepup or native screen-reader input. This repository separately runs bounded native screen-reader journeys in `.github/workflows/native-screen-readers.yml` using VoiceOver with WebKit on macOS and NVDA with Firefox on Windows.

That workflow is supplementary project evidence; adding `uses: CarlasHub/accessibility-audit-plugin@v1` to another repository does not automatically copy or run it. Even native automation cannot replace a skilled screen-reader user completing representative tasks and judging meaning, announcements, and usability.

## 4. Download and open every report

1. Return to the workflow run summary after the job finishes.
2. Scroll to **Artifacts**.
3. Download `accessibility-audit`.
4. Extract the downloaded ZIP before opening its contents.

The evidence folder can contain:

- `Accessibility_Audit_Report.html` — the primary visual report, with summary, filters, findings, page inventory, coverage, manual checks, and method;
- `Accessibility_Audit_Report.xlsx` — the structured workbook for triage, ownership, filtering, and audit records;
- `audit-results.json` — the machine-readable source for integrations and detailed evidence;
- `screenshots/` — captured page evidence when enabled; and
- any additional packaged evidence produced by the Action version and workflow configuration used for that run.

Fresh demonstration run `34463583709` produced the HTML, XLSX, and JSON files. It did not produce a screenshots folder because screenshot capture was not enabled. Always describe the files actually present in the run being demonstrated.

Open the extracted HTML file in a browser. Open the `.xlsx` file in Excel, Numbers, LibreOffice, or a compatible spreadsheet application. Do not try to open the downloaded artifact ZIP as a workbook.

The workbook includes Audit Summary, Findings, Page Inventory, Evidence, Manual Checks, and WCAG reference/criteria sheets. If it still will not open, download the artifact again, extract it fully, confirm the filename ends in `.xlsx`, and compare the HTML and JSON reports while preserving the failed file for diagnosis.

## 5. Read the verdict without overclaiming

Start with the report summary, then work in this order:

1. **Blockers:** resolve blocked pages first because missing evidence can hide defects.
2. **Confirmed findings:** reproduce the exact element, page, viewport, rule, and evidence.
3. **Review findings:** inspect the page manually before opening a defect.
4. **Coverage:** look for inconclusive, manual-required, or untested criteria.
5. **Manual checks:** assign an owner and record the test method and outcome.

### Investigate a possible contrast false positive

For each contrast signal:

1. Open the reported URL at the reported viewport and state.
2. Locate the selector and compare it with the screenshot/evidence.
3. Confirm the foreground and effective background after opacity, gradients, overlays, images, focus/hover state, and inherited CSS are applied.
4. Measure the rendered colours with an independent contrast tool.
5. Confirm text size and weight because the threshold can differ for large text.
6. Mark it confirmed only when the rendered state reproduces the failure; otherwise document why it is not reproducible or needs further review.

Do not bulk-dismiss contrast results and do not treat automation alone as the final decision.

## 6. Complete the human assessment

At minimum, test and record:

- complete representative tasks using only a keyboard, including reverse navigation, focus visibility/order, menus, dialogs, errors, and escape routes;
- representative tasks with the supported screen reader and browser combinations, checking names, roles, states, reading order, announcements, errors, and dynamic updates;
- 200% browser zoom and 320 CSS-pixel reflow without loss of content or two-dimensional scrolling except where WCAG permits it;
- content meaning, instructions, headings, link purpose, error recovery, and cognitive clarity;
- component states and contrast for default, hover, focus, selected, disabled, and error states;
- captions, transcripts, audio description, flashing, motion, and time limits where media or timed content exists; and
- touch operation and orientation on representative physical mobile devices.

Record tester, date, environment, assistive technology version, scenario, expected result, actual result, evidence, and verdict. The report's Manual Checks sheet is a starting point, not proof that those checks were completed.

## 7. Choose how the audit starts

### Manual run

Keep `workflow_dispatch` for an on-demand audit and for learning the tool.

### After a deployment

Run on a branch push only when that push also deploys—or waits for—the version being tested:

```yaml
on:
  workflow_dispatch:
  push:
    branches: [main]
```

If deployment happens in another workflow, call the audit only after the deployment succeeds. Otherwise the Action may audit the previous public build.

### Pull request

Add `pull_request` only when each pull request has a reachable preview URL and the workflow passes that URL to `urls`. Pointing every pull request at the production URL tests production, not the proposed change.

To publish a pull-request summary, set:

```yaml
permissions:
  contents: read
  pull-requests: write

# in the Action inputs
comment-on-pr: 'true'
github-token: ${{ github.token }}
```

GitHub commonly gives workflows from forks a read-only token and withholds secrets, so comments can be unavailable for forked pull requests. Keep the report artifact as the reliable fallback. Do not switch to `pull_request_target` merely to gain write access; running untrusted pull-request code with elevated permissions can create a serious security risk.

### Scheduled audit

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: '0 7 * * 1'
```

GitHub schedules use UTC and can be delayed during busy periods. A weekly run detects drift, but it is useful only if someone reviews and owns the results.

## 8. Choose the quality gate

Begin with `fail-on: none`, validate the scope, and triage the first baseline. Then select the policy your team can enforce:

- `blockers` — fail only when reliable auditing was blocked;
- `confirmed` — fail on any confirmed finding;
- `critical`, `serious`, `moderate`, or `minor` — fail at that axe impact threshold or above; or
- `none` — always report without failing the Action.

A passing job means the configured gate was not triggered. It never means the website fully conforms to WCAG.

## 9. Configure all Action inputs

| Input | Default | Purpose |
|---|---:|---|
| `urls` | required | Explicit URL per line or JSON array; GitHub Actions does not accept a CSV here. |
| `auditor` | GitHub Actions | Name recorded in the report. |
| `wcag-level` | AA | Baseline A/AA automation; legacy `AAA` is accepted but the explicit advisory input is clearer. |
| `aaa-advisory` | false | Adds supported AAA checks as advisory evidence. |
| `output-dir` | accessibility-audit-results | Folder written by the Action. |
| `landing-page-url` | empty | Optional report link/landing-page metadata. |
| `allowed-hosts` | empty | Approved hostname allowlist. Strongly recommended. |
| `staging-only` | false | Requires the configured target to satisfy the Action's staging safeguards. |
| `capture-screenshots` | true | Saves visual evidence. |
| `browser-channel` | empty | Selects a supported installed browser channel when needed. |
| `auto-install-browser` | true | Allows the Action to install its required browser. |
| `concurrency` | 2 | Parallel page workers; accepted range is 1–8. |
| `timeout-ms` | 30000 | Per-operation timeout in milliseconds. |
| `report-name` | Accessibility_Audit_Report.xlsx | Workbook filename. |
| `fail-on` | none | Quality-gate policy described above. |
| `comment-on-pr` | true | Attempts a pull-request summary when the event and token permit it. |
| `github-token` | current token | Token used for the pull-request comment. |

Use the Action outputs to connect later workflow steps: `output-dir`, `report-path`, `html-path`, `json-path`, `archive-path`, `confirmed-findings`, `review-findings`, `blockers`, `requested-pages`, `audited-pages`, `completed-pages`, `partial-pages`, `not-started-pages`, `skipped-pages`, and `gate-result`.

## 10. Fix, deploy, rerun, and compare

1. Reproduce and triage the evidence.
2. Fix confirmed defects in source code.
3. Deploy the fixed version to the exact audited URL.
4. Rerun the workflow.
5. Confirm blockers are resolved and findings changed for the expected reason.
6. Preserve both artifacts when an audit trail is required.
7. Complete the human checks again where the change can affect interaction, reading order, reflow, or assistive technology output.

## Troubleshooting

- **No Run workflow button:** put the `workflow_dispatch` workflow on the default branch and confirm Actions/write access.
- **URL rejected:** use a complete HTTP(S) URL and make `allowed-hosts` match its hostname exactly.
- **Wrong version tested:** wait for deployment and confirm the browser-visible build before starting the audit.
- **Blocked or partial page:** inspect authentication, consent, bot protection, network failures, timeouts, and screenshots. Do not count it as a pass.
- **No PR comment:** inspect the event type and token permissions; the artifact remains available even when commenting is not.
- **Workbook will not open:** extract the artifact first and open the `.xlsx`, not either ZIP file.
- **Too many contrast findings:** reproduce rendered states independently and classify evidence; do not lower the threshold merely to make the report quiet.

## Recording acceptance checklist

The replacement video must:

- start at the target repository and visibly create the workflow file;
- use the approved baseline YAML and explain each important option;
- start a real GitHub Actions run against `https://carlashub.github.io/a11y-test-cases/`;
- show the real job, logs, artifact download, extraction, HTML report, workbook, JSON, screenshots, coverage, and manual checks;
- explain automated test coverage and limitations without claiming full WCAG conformance;
- distinguish consumer Action evidence from the separate native Guidepup workflow;
- teach manual, deployment, pull-request, and scheduled operation plus quality gates;
- use spoken narration and synchronized captions;
- contain no profile promotion, release-page tour, fabricated report, silent filler, or run-dependent count recorded before the run is visible; and
- be reviewed against this guide before publication.

## GitHub references

- [Manually running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Store and share data with workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data)
