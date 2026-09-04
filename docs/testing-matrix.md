# Testing matrix

This table states what the engine actually runs. “Yes” means that the implemented check runs at that viewport; it does not mean every WCAG requirement in that area is automated or that an absent signal is a pass.

| Area | What it checks in plain language | Desktop | Mobile | 320 reflow | Classification boundary |
|---|---|---:|---:|---:|---|
| HTTP/final URL/runtime errors | Whether the page responds, redirects, or fails before it can be tested | Yes | Yes | Yes | Page blocker or runtime evidence |
| axe WCAG 2.2 A/AA and selected best practices | Machine-testable markup, names, relationships, contrast, and other rules | Yes | Yes | Yes | WCAG-tagged violations confirmed; best-practice-only signals reviewed |
| Landmarks, headings, ids, image-alt presence, names, labels | Whether common structure and controls expose required machine-readable information | Yes | Yes | Yes | Deterministic failures confirmed; meaning/count heuristics reviewed |
| Sequential Tab traversal and focus signals | Whether focus can move through rendered controls and whether it appears visible and unobscured | Yes | Yes | Yes | Obscuration confirmed; visual-indicator heuristics reviewed |
| Disclosure state, relationship, and focus order | Whether expandable controls expose accurate state/content relationships and follow a coherent Tab sequence | Yes | Yes | Yes | Stale state is confirmed only when content is observed to open; unresolved activation/relationship/focus evidence is reviewed. Generic disclosures and accordions are not required to close with Escape |
| Tab states, tabindex model, relationships, navigation, activation | Whether tab widgets connect tabs to panels and respond to expected keys | Yes | Yes | Yes | Broken references/unreachable controls confirmed; authoring-pattern differences reviewed; optional Home/End excluded |
| Same-origin link destinations | Whether rendered same-site links are empty, placeholders, missing fragments, or consistently unavailable | Yes | No | No | Matching 404/410 or missing fragment confirmed; placeholders/5xx reviewed |
| Horizontal overflow and culprit bounds | Whether narrow layouts push ordinary content outside the horizontal viewport | Yes | Yes | Yes | Overflow reviewed until permitted exceptions are assessed |
| WCAG text-spacing override | Whether increased line, paragraph, letter, and word spacing causes measurable overflow | Yes | Yes | Yes | Reviewed until clipping/overlap is visually confirmed |
| Target size and spacing | Measures undersized targets, excludes inline text links, checks the 24 CSS pixel clearance geometry against neighbouring targets, and incorporates axe target-size violation/incomplete signals | Yes | Yes | Yes | No row for size alone; spacing conflicts and axe signals are grouped by component and reviewed because other WCAG exceptions still require judgment |
| Table and autoplay signals | Whether tables or automatically playing media need human review | Yes | Yes | Yes | Reviewed |
| Consent dismissal before checks and evidence | Whether a visible consent layer can be removed so it does not obscure the tested page | Yes | Yes | Yes | Prefer reject/necessary; record the action and any failure in JSON |
| Contextual component screenshots | Focused evidence around the affected control and its surrounding component | Yes | Yes | Yes | Confirmed component failures only; outline the target within a component boundary |
| Full-page screenshots | Page-wide evidence where no reliable component target exists | Yes | Yes | Yes | Page-level failures and blockers without a component locator only; screenshots do not decide conformance |

All browser work is headless by default. Link requests run once from the desktop DOM because responsive variants normally reuse destinations and repeated requests increase side effects and false positives.

Automation provides evidence for many failures under WCAG 1.1.1, 1.3.1, 1.4.10, 2.1.1, 2.4.1, 2.4.3, 2.4.4, 2.4.7, 2.4.11, 2.5.8, 3.3.2, 4.1.2, and axe-supported criteria. It does not prove complete WCAG 2.2 A/AA conformance.

See [WCAG basics](wcag-basics.md) for terminology and [Manual verification](manual-verification.md) for the remaining procedures.
