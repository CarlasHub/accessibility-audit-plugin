# Replacement video: approval script and storyboard

> Status: **recorded locally; publication remains pending final review.**

This is the complete proposed narrative for the replacement GitHub Actions tutorial. Every scene states what the viewer sees, the exact narration, and why the scene is necessary. Text in square brackets is a production direction or a value that must be read from the real run; it is not spoken literally.

## Production specification

- Target length: 12–14 minutes.
- Output: 1920×1080 MP4, readable at normal playback speed.
- Audio: clear spoken narration, no music over speech.
- Accessibility: synchronized open captions plus a matching text transcript.
- Evidence: only the real GitHub interface, real workflow run, and the reports downloaded from that run.
- Pointer and zoom: slow enough to follow; zoom into code, controls, and report details when necessary.
- Privacy: hide notifications, tokens, email addresses, and unrelated private repository details.
- Prohibited content: profile promotion, Marketplace/release-page tours, repeated title cards, silent filler, fabricated report pages, and claims of complete WCAG certification.

## Scene 1 — Set the learning goal (00:00–00:35)

**Show:** Open the **Code** tab of `CarlasHub/a11y-test-cases`. Briefly show the published page in a second browser tab, then return to the repository.

**Read exactly:**

> In this tutorial, I will add CarlasHub WCAG Accessibility Audit to a repository from the beginning, run a real audit against the deployed A11y Test Cases site, download every result, and explain what the evidence means. I will also show the available run triggers and quality gates, and the keyboard, screen-reader, reflow, and other human checks that automation cannot replace. This Action gathers evidence; it does not certify complete WCAG conformance.

**Why this matters:** The learner immediately knows the outcome and the tool's safety boundary.

**Caption:** `Goal: add → run → download → interpret → verify manually`

## Scene 2 — Confirm the project and scope (00:35–01:10)

**Show:** In the published site tab, select the address bar and clearly reveal `https://carlashub.github.io/a11y-test-cases/`. Return to the repository and show its name.

**Read exactly:**

> The workflow belongs in the repository whose release or website I want to test. The target must be a deployed HTTP or HTTPS page that a GitHub-hosted runner can reach. For this example, the repository is CarlaHub slash a11y-test-cases, the page is this GitHub Pages URL, and the allowed hostname will be carlashub.github.io. The Action tests the URLs I list; it does not crawl an entire site. In GitHub Actions, the URL input does not accept a CSV file.

**Why this matters:** It prevents the two most common setup errors: adding the workflow to the wrong project and assuming a local or unlisted page will be audited.

**Caption:** `Explicit deployed URL • explicit allowed host • no automatic crawl`

## Scene 3 — Create the workflow from nothing (01:10–02:05)

**Show:** From **Code**, select **Add file → Create new file**. Type `.github/workflows/accessibility-audit.yml`. Paste the approved baseline workflow slowly enough to see the whole file.

**Read exactly:**

> From the Code tab, I choose Add file, then Create new file. The filename must be dot github, slash workflows, slash accessibility-audit dot y m l. GitHub recognizes YAML files in this folder as workflows. I am starting with a manual trigger so a first-time user controls exactly when the audit runs.

**Why this matters:** The previous video skipped the actual installation step. This scene shows where the integration lives and how it is created without a local development environment.

**Caption:** `.github/workflows/accessibility-audit.yml`

## Scene 4 — Explain the baseline workflow line by line (02:05–03:25)

**Show:** Keep the editor open. Highlight each relevant block as it is explained: trigger, permissions, runner and timeout, Action step and inputs, then artifact upload.

**Read exactly:**

> The workflow-dispatch trigger creates the Run workflow button. Contents read is the baseline repository permission. The job uses GitHub's Ubuntu runner and has a twenty-minute safety timeout. The audit step has the ID audit so later steps can use its outputs. The uses line calls version one of the public CarlasHub Action.
>
> The URLs input contains the exact deployed page. For several pages, I would use a vertical bar and put one complete URL on each following line. Allowed-hosts prevents an input error or redirect from silently moving the audit to another hostname.
>
> WCAG level AA enables the supported A and AA automation. AAA advisory true adds supported AAA checks as advisory evidence; it is not an AAA conformance verdict. Fail-on none is appropriate for the first baseline because findings are reported without blocking the workflow. Comment-on-PR is false because this starter run is manual.
>
> The final step uploads the Action's output directory even when a later gate fails. That is how the reports become downloadable from GitHub. Fourteen days is the requested retention period, although a repository or organization can impose a shorter maximum.

**Why this matters:** The viewer learns the meaning and consequence of the configuration rather than blindly copying unexplained YAML.

**Caption:** `First baseline: AA + AAA advisory • fail-on: none`

## Scene 5 — Commit safely (03:25–03:55)

**Show:** Select **Commit changes**, enter `Add WCAG accessibility audit workflow`, and show the branch choice. Commit through the repository's normal review process. Do not expose unrelated changes.

**Read exactly:**

> I use a clear commit message and follow the repository's normal review policy. A manual workflow must exist on the default branch before GitHub shows its Run workflow control. In a team repository, I would open a pull request and merge it after review rather than bypassing branch protection.

**Why this matters:** A valid file on an unmerged branch can still leave a learner wondering why no manual-run button appears.

**Caption:** `Manual dispatch must exist on the default branch`

## Scene 6 — Start and observe the real run (03:55–04:40)

**Show:** Open **Actions**, select **WCAG accessibility audit**, choose **Run workflow**, select the default branch, and run it. Open the new run and the `audit` job. Show the real step list and enough log output to verify the target URL without displaying secrets.

**Read exactly:**

> In Actions, I select the WCAG accessibility audit workflow, choose Run workflow, confirm the branch, and start it. I open the new run, then the audit job. This is a live execution, not a prepared results page. The job validates the scope, starts its browser, audits the requested viewports, builds the reports, and exposes their locations and counts as Action outputs.

**Why this matters:** The learner sees the complete operating path and how to distinguish a queued, running, successful, or failed job.

**Caption:** `Actions → workflow → Run workflow → audit job`

## Scene 7 — Explain the tests that actually run (04:40–05:45)

**Show:** While the job runs, show the relevant log stages and then a concise on-screen checklist matching the groups below. Do not show a generic claim such as “all WCAG tests passed.”

**Read exactly:**

> Each accepted page is exercised at desktop, mobile, and three-hundred-and-twenty CSS-pixel reflow widths. The Action runs axe rules mapped to WCAG two point two A and AA, selected best practices, and optional AAA advisory checks. It also inspects language, titles, landmarks, headings, IDs, images, accessible names, form labels, and metadata.
>
> Bounded interaction checks look for keyboard and focus problems, bypass links, visible focus evidence, focus-order signals, and traps. Disclosure and tab checks inspect semantics, states, relationships, Enter and Space activation, and next-focus evidence. The Action also gathers reflow, text-spacing, overflow, overlap, clipping, same-origin link, target-size, table, autoplay, consent-dialog, modal, and screenshot evidence.
>
> These are defined assertions, not every possible WCAG test. An incomplete or ambiguous test is reported as inconclusive or manual review, never silently converted into a pass.

**Why this matters:** The learner can judge the scope and quality of the audit instead of equating one scanner with full accessibility coverage.

**Caption:** `Automated evidence ≠ complete WCAG conformance`

## Scene 8 — Explain the native screen-reader boundary (05:45–06:25)

**Show:** In the Action repository, open `.github/workflows/native-screen-readers.yml` and highlight the VoiceOver/WebKit and NVDA/Firefox jobs. Then return to the consumer workflow and show that it has no screen-reader input.

**Read exactly:**

> The public consumer Action does not currently expose a Guidepup or native screen-reader option. The Action's own repository has a separate bounded workflow using VoiceOver with WebKit on macOS and NVDA with Firefox on Windows. That is supplementary project evidence. Adding the uses line to another repository does not copy or run this native workflow. Native automation also does not replace a skilled screen-reader user completing real tasks and judging names, states, reading order, announcements, and usability.

**Why this matters:** It accurately distinguishes delivered functionality from repository-level validation and prevents a misleading coverage claim.

**Caption:** `Separate native workflow • not included by uses: @v1`

## Scene 9 — Find and download the real artifact (06:25–07:05)

**Show:** After completion, return to the run summary, scroll to **Artifacts**, download `accessibility-audit`, and extract the downloaded artifact ZIP. Show the three files from fresh run `34463583709` in a clean results view.

**Read exactly:**

> When the job finishes, I return to its summary and scroll to Artifacts. I download accessibility-audit and extract the downloaded ZIP before opening anything. This run contains the HTML report, the Excel workbook, and the machine-readable JSON. A screenshots folder also appears when screenshot capture is enabled. I open the dot x l s x file in a spreadsheet application, not the downloaded artifact ZIP.

**Why this matters:** It shows exactly where the reports are and addresses the workbook-opening problem caused by opening the wrong container.

**Caption:** `Run summary → Artifacts → download → extract`

## Scene 10 — Read the HTML verdict correctly (07:05–08:05)

**Show:** Open the extracted `Accessibility_Audit_Report.html`. Show the summary, page inventory, filters, a confirmed finding, a review finding if present, coverage, manual checks, and method. Read counts only from this real report.

**Read exactly:**

> The HTML file is the primary human-readable report. This real run shows [read the visible requested, completed, partial, and blocked page values], [read the visible confirmed and review-finding values], and [read the visible manual-check value]. These numbers describe this run only.
>
> I resolve blockers first because a blocked page can hide defects. Next, I reproduce confirmed findings using the page, viewport, selector, rule, and evidence. Review findings are signals that need a person. In Coverage, confirmed passed means only that the named assertion ran and passed. Tested inconclusive, manual-review-required, not-tested, and not-applicable keep the limits visible. A successful workflow means its configured gate was not triggered; it does not mean the site fully conforms to WCAG.

**Why this matters:** A polished report is useful only when the learner understands its evidence states and does not overclaim the verdict.

**Caption:** `Blockers → confirmed → review → coverage → manual checks`

## Scene 11 — Triage a contrast signal (08:05–08:50)

**Show:** Filter the real report to a contrast finding or review item. Open its target page and reported viewport/state. Compare the report evidence with the rendered element; show an independent contrast measurement if available.

**Read exactly:**

> A contrast signal is not dismissed or accepted in bulk. I reproduce the reported viewport and state, locate the selector, and compare the screenshot and evidence with the rendered element. I account for inherited styles, opacity, gradients, overlays, images, focus or hover state, and the effective background. Then I independently measure the rendered colours and confirm the text size and weight. I record a defect only when the failing state reproduces; otherwise I document why it is not reproducible or still needs review.

**Why this matters:** It teaches a defensible response to suspected false positives without weakening the audit.

**Caption:** `Reproduce • inspect rendered colours • measure • document`

## Scene 12 — Use the workbook, JSON, and screenshots (08:50–09:35)

**Show:** Open `Accessibility_Audit_Report.xlsx` in a spreadsheet application and move through Audit Summary, Findings, Page Inventory, Evidence, Manual Checks, and WCAG reference/criteria sheets. Open a small, relevant part of `audit-results.json`. Explain that no screenshots folder is present because screenshot capture was not enabled for this fresh run.

**Read exactly:**

> The workbook is for structured triage, filtering, ownership, and audit records. Its sheets separate the summary, findings, page inventory, detailed evidence, manual checks, and WCAG references. The JSON is the machine-readable source for integrations and exact evidence fields. This run has no screenshots folder because capture was not enabled. When screenshots are enabled, they support reproduction but never replace inspecting the page. If the workbook will not open, I confirm I extracted the artifact and selected the dot x l s x file, then preserve the failed file and use the HTML and JSON while it is investigated.

**Why this matters:** The viewer learns the distinct purpose of every deliverable and how to open the workbook reliably.

**Caption:** `HTML: read • XLSX: triage • JSON: integrate • screenshots: optional`

## Scene 13 — Perform the missing human checks (09:35–10:40)

**Show:** Use the Manual Checks sheet as a checklist while demonstrating brief real examples: keyboard Tab and Shift+Tab, a screen reader navigating a representative task, 200% zoom, and 320 CSS-pixel reflow. Show fields for tester, environment, scenario, evidence, and verdict.

**Read exactly:**

> Now I complete the checks the Action cannot decide responsibly. With keyboard only, I complete representative tasks in both directions and inspect focus visibility, order, menus, dialogs, errors, and escape routes. With supported screen-reader and browser combinations, I check names, roles, states, reading order, announcements, errors, dynamic updates, and whether the task is understandable.
>
> I also test two-hundred-percent zoom and three-hundred-and-twenty CSS-pixel reflow; content meaning and instructions; link purpose and error recovery; every component state; media alternatives, flashing, motion, and time limits; and representative touch and orientation behaviour on physical devices. For every manual result, I record the tester, date, environment, assistive technology version, scenario, expected and actual results, evidence, and verdict. A generated checklist is not evidence that a human completed it.

**Why this matters:** Keyboard, native assistive technology, responsive layout, meaning, and real task usability are essential parts of an accessibility assessment.

**Caption:** `Generated manual checklist ≠ completed human test`

## Scene 14 — Show every useful run mode (10:40–11:45)

**Show:** Return to the workflow file. In separate, clearly labelled snippets, show `workflow_dispatch`, `push` after deployment, `pull_request` with a real preview URL, and weekly `schedule`. Show the permission block for PR comments.

**Read exactly:**

> Workflow dispatch is the manual option I used. A push trigger is useful only when the matching version is already deployed, or when the audit job explicitly waits for deployment. A pull-request trigger needs a reachable preview URL for that pull request; pointing every pull request at production audits the old production build, not the proposed change.
>
> Pull-request comments require pull-requests write permission, comment-on-PR true, and the GitHub token. Forked pull requests commonly receive a read-only token and no secrets, so the artifact is the reliable fallback. I do not use pull-request-target merely to obtain write access because untrusted pull-request code with elevated permissions can be dangerous. A scheduled workflow uses UTC and is useful only when someone owns the recurring results.

**Why this matters:** The learner can select an operating model without testing the wrong deployment or creating a token-permission vulnerability.

**Caption:** `Manual • after deployment • PR preview • schedule (UTC)`

## Scene 15 — Configure inputs, outputs, and the quality gate (11:45–12:45)

**Show:** Display the guide's complete input table, then highlight the Action outputs. In the workflow editor, change only `fail-on` to demonstrate the policy choices; undo the demonstration change unless it is intentionally adopted.

**Read exactly:**

> The required input is URLs. The remaining controls identify the auditor; select the WCAG baseline and AAA advisory evidence; name the output folder and workbook; constrain hosts or staging; enable screenshots; select or install the browser; set concurrency from one to eight; set the operation timeout; choose the quality gate; and control pull-request comments and their token.
>
> Start with fail-on none, validate the scope, and triage the baseline. Then choose blockers, any confirmed finding, or an axe impact threshold from critical through minor. A passing gate means only that this policy was not triggered. Later steps can use output paths, finding and blocker counts, requested and completed page counts, partial or skipped states, and the gate result.

**Why this matters:** This scene teaches the full public configuration surface and how to move from observation to enforceable continuous integration.

**Caption:** `Baseline first • then adopt a gate the team can enforce`

## Scene 16 — Close the remediation loop (12:45–13:25)

**Show:** Return to one real finding, then the source repository, deployment, **Run workflow**, and the new run's artifact area. A compact arrow overlay may label the sequence but must not obscure the UI.

**Read exactly:**

> The operating loop is reproduce, triage, fix, deploy, rerun, and compare. I preserve the before and after artifacts when an audit trail is required, and I repeat affected human checks after interaction, reading order, reflow, or assistive-technology changes. That is how the Action supports an accessibility practice: repeatable evidence in continuous integration, followed by accountable human assessment.

**Why this matters:** It leaves the learner with a sustainable process rather than a one-time scan.

**Caption:** `Reproduce → fix → deploy → rerun → compare → verify manually`

## Final production and accessibility review

Before publication, verify all of the following:

- The recording begins with creation of the workflow file, not an already-completed run.
- The pasted workflow exactly matches the approved guide.
- The target is the real `https://carlashub.github.io/a11y-test-cases/` page.
- All counts and findings shown come from the same newly recorded run.
- No result is called a WCAG certificate or proof of complete conformance.
- Automated keyboard signals are distinguished from full human keyboard testing.
- The separate Guidepup workflow is not presented as a consumer Action feature.
- Artifact download and ZIP extraction are visible.
- The real HTML, `.xlsx`, JSON, coverage, and manual checklist are visible; the absence of screenshots in this run is explained accurately.
- Manual, deployment, pull-request-preview, and scheduled operation are explained.
- Pull-request permission and fork limitations are explained without recommending unsafe elevated execution.
- Narration matches this approved text; captions match the final narration.
- Captions have speaker-independent punctuation, sufficient contrast, and do not cover controls or report evidence.
- The final MP4 is watched from beginning to end at normal size and with captions enabled before its link is published.
