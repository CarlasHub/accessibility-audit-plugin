# Testing matrix

| Area | Desktop | Mobile | 320 reflow | Classification boundary |
|---|---:|---:|---:|---|
| HTTP/final URL/runtime errors | Yes | Yes | Yes | Page blocker or runtime evidence |
| axe WCAG 2.2 A/AA and selected best practices | Yes | Yes | Yes | Confirmed only for reported violations |
| Landmarks, headings, ids, image-alt presence, names, labels | Yes | Yes | Yes | Deterministic failures confirmed; meaning/count heuristics reviewed |
| Sequential Tab traversal and focus signals | Yes | Yes | Yes | Obscuration confirmed; visual indicator heuristics reviewed |
| Disclosure state, focus order, and Escape | Yes | Yes | Yes | State failures confirmed; focus sequence and optional Escape behavior reviewed |
| Tab states, tabindex model, relationships, navigation, activation | Yes | Yes | Yes | Broken references/unreachable controls confirmed; authoring-pattern differences reviewed; optional Home/End excluded |
| Same-origin link destinations | Yes | No | No | Matching 404/410 or missing fragment confirmed; placeholders/5xx reviewed |
| Horizontal overflow and culprit bounds | Yes | Yes | Yes | 320px overflow reviewed until exceptions are assessed |
| WCAG text-spacing override | Yes | Yes | Yes | Reviewed until clipping/overlap is visually confirmed |
| Target size | Yes | Yes | Yes | Reviewed because spacing and other exceptions apply |
| Table and autoplay signals | Yes | Yes | Yes | Reviewed |
| Full-page and issue-level screenshots | Yes | Yes | Yes | Evidence only; screenshots do not decide conformance |

All browser work is headless by default. Link requests run once from the desktop DOM because responsive variants normally reuse destinations and repeated requests increase side effects and false positives.

Automation provides evidence for many failures under WCAG 1.1.1, 1.3.1, 1.4.10, 2.1.1, 2.4.1, 2.4.3, 2.4.4, 2.4.7, 2.4.11, 2.5.8, 3.3.2, 4.1.2, and axe-supported criteria. It does not prove complete WCAG 2.2 A/AA conformance.
