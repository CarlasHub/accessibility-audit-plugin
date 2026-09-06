# Testing matrix

This table states what the engine actually runs. “Yes” means that the implemented check runs at that viewport; it does not mean every WCAG requirement in that area is automated or that an absent signal is a pass.

| Area | What it checks in plain language | Desktop | Mobile | 320 reflow | Classification boundary |
|---|---|---:|---:|---:|---|
| HTTP/final URL/runtime errors | Whether the page responds, redirects, or fails before it can be tested | Yes | Yes | Yes | Page blocker or runtime evidence |
| axe WCAG 2.2 A/AA and selected best practices | Machine-testable markup, names, relationships, contrast, and other rules; retains violations, incomplete results, pass counts, rule ids and related nodes | Yes | Yes | Yes | WCAG-tagged violations confirmed; best-practice violations may be reviewed; incomplete results remain JSON/inconclusive coverage and never become findings or passes |
| Landmarks, headings, ids, image-alt presence, names, labels | Whether common structure and controls expose required machine-readable information | Yes | Yes | Yes | Deterministic failures confirmed; meaning/count heuristics reviewed |
| Sequential Tab traversal and focus signals | Samples the document Tab sequence, records whether it cycles or reaches the configured limit, compares focused/unfocused visual styles, and checks five visible points for complete covering | Yes | Yes | Yes | Fully obscured focus can be confirmed; absence of a computed style change remains raw JSON/manual evidence because pseudo-elements and visual context are not established; modal-only and truncated sequences are inconclusive |
| Disclosure state, relationship, and focus order | Establishes a collapsed baseline, activates with Enter and Space, compares `aria-expanded` with controlled-content visibility, and samples the next Tab destination | Yes | Yes | Yes | Stale state is confirmed only after the interaction and visible mismatch are observed; unresolved or failed setup remains JSON/inconclusive coverage and creates no finding. Missing `aria-controls` alone creates no finding. Generic disclosures and accordions are not required to close with Escape |
| Tab states, tabindex model, relationships, navigation, activation | Whether tab widgets connect tabs to panels and respond to expected keys | Yes | Yes | Yes | Broken references/unreachable controls confirmed; authoring-pattern differences reviewed; optional Home/End excluded |
| Same-origin link destinations | Whether rendered same-site links are empty, placeholders, missing fragments, or consistently unavailable; records candidate count, checked count, and truncation | Yes | N/A | N/A | Matching 404/410 or missing fragment confirmed; placeholders/5xx reviewed; a truncated run is inconclusive |
| Horizontal overflow and culprit bounds | Whether narrow layouts push ordinary content outside the horizontal viewport | Yes | Yes | Yes | Overflow reviewed until permitted exceptions are assessed |
| WCAG text-spacing override | Whether increased line, paragraph, letter, and word spacing causes measurable overflow | Yes | Yes | Yes | Reviewed until clipping/overlap is visually confirmed |
| Target size and spacing | Measures visible, on-screen, hit-tested targets, excludes inline text links, checks the 24 CSS pixel clearance geometry against neighbouring targets, and incorporates axe target-size signals | Yes | Yes | Yes | Hidden, off-screen, covered and size-only candidates do not become rows; retained spacing/axe signals remain review items until exceptions are assessed |
| Table and autoplay signals | Whether tables or automatically playing media need human review | Yes | Yes | Yes | Reviewed |
| Consent dismissal and blocking-surface detection | Whether a visible consent layer can be removed and whether any modal still prevents representative page interaction | Yes | Yes | Yes | Prefer reject/necessary; unresolved surfaces produce a consolidated coverage blocker and suppress underlying interaction checks |
| Contextual component screenshots | Focused evidence around the affected control and its surrounding component after reproducing applicable state | Yes | Yes | Yes | Retain at most one representative image per final confirmed, blocker, or review reporting unit when a stable locator/state can be captured; outline the target within a component boundary |
| Full-page screenshots | Page-wide evidence where no reliable component target exists | Yes | Yes | Yes | Page-level failures or unresolved blocking surfaces only; screenshots do not decide conformance |

All browser work is headless by default. Link requests run once from the desktop DOM because responsive variants normally reuse destinations and repeated requests increase side effects and false positives.

## Per-page coverage record

`audit-results.json` contains a `coverage` matrix for every started page and viewport. Each applicable area uses exactly one status:

- `confirmed-passed`: retained evidence proves the executed automated check and state passed; this never means the whole WCAG criterion passed;
- `confirmed-failed`: retained evidence proves a failure;
- `tested-inconclusive`: the check ran or sampled evidence, but it cannot support pass/fail certainty;
- `manual-review-required`: a person must perform the stated assessment;
- `not-tested`: the area did not run;
- `not-applicable`: the check is intentionally outside that viewport or no applicable component was established.

The matrix covers viewport execution, keyboard sampling, focus, names/roles/states/relationships, structure, navigation, links/buttons, images, forms/errors, interactive components, dynamic status, zoom/text spacing/responsive behaviour, contrast/non-colour cues, motion, language, title, broken links, axe and manual assessment. It does not invent passes from an empty finding list.

Automation provides evidence for many failures under WCAG 1.1.1, 1.3.1, 1.4.10, 2.1.1, 2.4.1, 2.4.3, 2.4.4, 2.4.7, 2.4.11, 2.5.8, 3.3.2, 4.1.2, and axe-supported criteria. It does not prove complete WCAG 2.2 A/AA conformance. Form submission/error recovery, dynamic announcements, meaningful alternative text, descriptive title/heading/link quality, 200% zoom usability, physical mobile behaviour, all component states, non-text contrast, colour-only cues, motion timing, media alternatives, language accuracy and supported screen-reader output remain manual or inconclusive unless a specific retained failure proves otherwise.

See [WCAG basics](wcag-basics.md) for terminology and [Manual verification](manual-verification.md) for the remaining procedures.
