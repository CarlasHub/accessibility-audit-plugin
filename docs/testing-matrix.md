# Testing matrix

This table states what the engine actually runs. “Yes” means that the implemented check runs at that viewport; it does not mean every WCAG requirement in that area is automated or that an absent signal is a pass.

| Area | What it checks in plain language | Desktop | Mobile | 320 reflow | Classification boundary |
|---|---|---:|---:|---:|---|
| HTTP/final URL/runtime errors | Whether the page responds, redirects, or fails before it can be tested | Yes | Yes | Yes | Page blocker or runtime evidence |
| axe WCAG 2.2 A/AA and selected best practices | Machine-testable markup, names, relationships, contrast, and other rules; retains violations, incomplete results, pass counts, rule ids and related nodes | Yes | Yes | Yes | WCAG-tagged violations confirmed; best-practice violations may be reviewed; incomplete results remain JSON/inconclusive coverage and never become findings or passes |
| Landmarks, headings, ids, image-alt presence, names, labels | Whether common structure and controls expose required machine-readable information | Yes | Yes | Yes | Deterministic failures confirmed; meaning/count heuristics reviewed |
| Deterministic keyboard journeys and focus signals | Records forward Tab order, verifies reverse Shift+Tab order, activates the first visible bypass-block link, checks focus remains in the viewport, compares focused/unfocused visual styles, and checks five visible points for complete covering | Yes | Yes | Yes | Journey failures are retained for review; fully obscured focus can be confirmed; pseudo-element styling, modal-only paths, truncated sequences, and task completeness remain inconclusive/manual |
| Disclosure state, relationship, and focus order | Waits for the rendered control inventory, excludes hidden/inactive clones, establishes a collapsed baseline, verifies the focused live target, activates with Enter and Space, re-queries after replacement/re-render, waits for JavaScript/animations to settle, records visual visibility separately from `aria-hidden`/`inert` exposure, compares the same-moment final state, and samples the next Tab destination | Yes | Yes | Yes | Stale state is confirmed only from a uniquely resolved, settled post-interaction visual mismatch; unresolved identity, detachment, timeout, absent panel evidence, or failed setup remains JSON/inconclusive coverage and creates no finding. Missing `aria-controls` alone creates no finding. Generic disclosures and accordions are not required to close with Escape |
| Tab states, tabindex model, relationships, navigation, activation | Whether tab widgets connect tabs to panels and respond to expected keys | Yes | Yes | Yes | Broken references/unreachable controls confirmed; authoring-pattern differences reviewed; optional Home/End excluded |
| Same-origin link destinations | Whether rendered same-site links are empty, placeholders, missing fragments, or consistently unavailable; records candidate count, checked count, and truncation | Yes | N/A | N/A | Matching 404/410 or missing fragment confirmed; placeholders/5xx reviewed; a truncated run is inconclusive |
| Reflow layout integrity | Whether ordinary content overflows or clips, controls overlap, focus leaves the visible viewport, or visible interactive functionality disappears | Yes | Yes | Yes | Retained signals remain review evidence until a person assesses permitted two-dimensional layouts, context, and usability |
| WCAG text-spacing override | Whether increased line, paragraph, letter, and word spacing causes overflow, clipping, overlap, hidden controls, or lost functionality compared with the baseline | Yes | Yes | Yes | Retained signals remain review evidence until the rendered state and WCAG exceptions are assessed |
| Target size and spacing | Measures visible, on-screen, hit-tested targets, excludes inline text links, checks the 24 CSS pixel clearance geometry against neighbouring targets, and incorporates axe target-size signals | Yes | Yes | Yes | Hidden, off-screen, covered and size-only candidates do not become rows; retained spacing/axe signals remain review items until exceptions are assessed |
| Table and autoplay signals | Whether tables or automatically playing media need human review | Yes | Yes | Yes | Reviewed |
| Consent dismissal and blocking-surface detection | Whether a visible consent layer can be removed and whether any modal still prevents representative page interaction | Yes | Yes | Yes | Prefer reject/necessary; unresolved surfaces produce a consolidated coverage blocker and suppress underlying interaction checks |
| Contextual component screenshots | Focused evidence around the affected control and its surrounding component after reproducing applicable state | Yes | Yes | Yes | Retain at most one representative image per final confirmed, blocker, or review reporting unit when a stable locator/state can be captured; outline the target within a component boundary |
| Full-page screenshots | Page-wide evidence where no reliable component target exists | Yes | Yes | Yes | Page-level failures or unresolved blocking surfaces only; screenshots do not decide conformance |

All browser work is headless by default. Link requests run once from the desktop DOM because responsive variants normally reuse destinations and repeated requests increase side effects and false positives.

Native screen-reader checks are intentionally separate from the cross-platform core audit. The manually dispatched workflow runs bounded Guidepup journeys on VoiceOver/WebKit for macOS and NVDA/Firefox for Windows, then uploads spoken transcripts and environment metadata. It does not cover mobile screen readers, all application tasks or states, announcement quality, or human understanding, so those outcomes remain mandatory human assessment.

## Release gates

The repository separates deterministic pull-request gates from live-site monitoring so a network change cannot make the unit suite flaky:

| Tier | Exact command or workflow | Release claim protected |
|---|---|---|
| Unit and report contracts | `npm run test:unit` | Failure isolation, classification boundaries, blocker detection, URL identity, deduplication, and HTML/XLSX/JSON/ZIP parity |
| Local browser fixtures | `npm run test:browser` | Desktop, mobile, 320 CSS pixel reflow, keyboard journeys, generated-report accessibility, and local end-to-end audit behaviour |
| Public built CLI | `npm run test:built-cli` | The documented `npm run audit` command invokes `dist/cli.js` and produces usable artifacts |
| Committed GitHub Action | `npm run build:action && npm run test:action` | Inputs, outputs, gate semantics, artifacts on failure/cancellation, PR-comment update behaviour, permissions failure, redirects, and the self-contained runtime bundle |
| Bundle/source parity | `npm run build:action && git diff --exit-code -- action/dist` | The committed Action JavaScript is generated from the reviewed source |
| Exact BuggyLand baseline from saved reports | `npm run test:buggyland -- path/to/run-1/audit-results.json path/to/run-2/audit-results.json` | URL/hash states, page and classification totals, stable identities, blocker isolation, deduplication, and two-run consistency |
| Live BuggyLand baseline | `npm run test:buggyland:live` | Runs the public built CLI twice, checks the live fixture/card counts, and applies the exact baseline gate |
| Marketplace payload | `npm run build:marketplace && npm run validate:marketplace && npm run test:marketplace && npm run test:marketplace-compatibility` | Packaged runtimes install, start, and match their manifests |

`.github/workflows/verify.yml` runs the first four pull-request tiers as separate jobs. `.github/workflows/action-fixture.yml` proves that `uses: ./` executes the committed Action bundle against a local fixture. `.github/workflows/buggyland-regression.yml` runs nightly and for prereleases. `.github/workflows/release-smoke.yml` repeats the built-product and packaging gates for every `v*` tag. Live regression failures require review; the baseline must never be updated merely to make CI green.

## Per-page coverage record

`audit-results.json` contains a `coverage` matrix for every started page and viewport. Each applicable area uses exactly one status:

- `confirmed-passed`: retained evidence proves the executed automated check and state passed; this never means the whole WCAG criterion passed;
- `confirmed-failed`: retained evidence proves a failure;
- `tested-inconclusive`: the check ran or sampled evidence, but it cannot support pass/fail certainty;
- `manual-review-required`: a person must perform the stated assessment;
- `not-tested`: the area did not run;
- `not-applicable`: the check is intentionally outside that viewport or no applicable component was established.

The matrix covers viewport execution, keyboard sampling, focus, names/roles/states/relationships, structure, navigation, links/buttons, images, forms/errors, interactive components, dynamic status, zoom/text spacing/responsive behaviour, contrast/non-colour cues, motion, language, title, broken links, axe and manual assessment. It does not invent passes from an empty finding list.

Automation provides evidence for many failures under WCAG 1.1.1, 1.3.1, 1.4.10, 2.1.1, 2.4.1, 2.4.3, 2.4.4, 2.4.7, 2.4.11, 2.5.8, 3.3.2, 4.1.2, and axe-supported criteria. The report also includes exactly one criterion-specific procedure and evidence prompt for each of the 55 active WCAG 2.2 Level A and AA success criteria. It does not prove complete conformance automatically. Form submission/error recovery, dynamic announcements, meaningful alternative text, descriptive title/heading/link quality, 200% zoom usability, physical mobile behaviour, all component states, non-text contrast, colour-only cues, motion timing, media alternatives, language accuracy and supported screen-reader output remain manual or inconclusive unless a specific retained failure proves otherwise.

See [WCAG basics](wcag-basics.md) for terminology and [Manual verification](manual-verification.md) for the remaining procedures.
