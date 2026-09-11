# WCAG basics for report users

## What accessibility means here

Web accessibility means people with disabilities can perceive, understand, navigate, and operate a website or application and can contribute information where required. Barriers can affect people who use a keyboard, screen reader, screen magnification, voice control, touch, captions, adapted colors, or other strategies and technologies.

## What WCAG is

WCAG is the Web Content Accessibility Guidelines published by the World Wide Web Consortium (W3C). This plugin targets testable evidence related to WCAG 2.2 Level A and Level AA.

The report explicitly accounts for all 55 active Level A and AA success criteria. It supplies one human-verification procedure and evidence prompt per criterion because complete criteria coverage cannot be reduced to automated rule coverage. WCAG 4.1.1 is not included because it was removed in WCAG 2.2; the 31 active Level AAA criteria are optional advisory coverage.

WCAG is organized around four principles:

- **Perceivable:** users can obtain the information, for example through text alternatives, captions, adaptable structure, and sufficient contrast.
- **Operable:** users can navigate and operate controls, including by keyboard, without traps or obscured focus.
- **Understandable:** content, navigation, instructions, and errors are predictable and understandable.
- **Robust:** browsers and assistive technologies can determine the name, role, state, and relationships of content and controls.

## What A, AA, and AAA mean

- **Level A** is the minimum conformance level.
- **Level AA** includes every applicable Level A and Level AA success criterion. It is the target used by this plugin.
- **Level AAA** includes A, AA, and AAA, but this plugin is not presented as a complete AAA audit.

The level describes the conformance requirement. It does not describe defect severity, engineering difficulty, business priority, or confidence in an automated result.

## What a success-criterion number means

A reference such as `2.4.3 Focus Order` identifies one testable WCAG success criterion:

- `2` identifies the Operable principle;
- `4` identifies the Navigable guideline;
- `3` identifies the Focus Order success criterion within that guideline.

The workbook’s `SC1`, `SC2`, and `SC3` fields map a finding to up to three relevant criteria. The adjacent level, synopsis, and Understanding fields are populated from the bundled WCAG lookup. A mapping helps organize the evidence; it is not by itself a conformance decision.

## Why automation is incomplete

Automated checks are useful when a failure can be determined from code, browser state, geometry, or a repeatable interaction. They cannot reliably decide whether content is meaningful, whether every journey works with assistive technology, whether a visual exception applies, or whether the experience is understandable in context.

Examples:

| Signal | What automation can determine | What a person still decides |
|---|---|---|
| Image has no `alt` attribute | The attribute is absent. | Whether the image is informative or decorative and what alternative communicates its purpose. |
| Button has no accessible name | The rendered control is unnamed. | The clearest name for its action in context. |
| Text contrast | Some flat foreground/background combinations can be calculated. | States over gradients, images, transparency, and other unresolved backgrounds. |
| Small touch target | The rendered dimensions are below a threshold. | Whether a WCAG spacing or equivalent-control exception applies. |
| Keyboard sequence | Focus order and selected component behaviors can be exercised. | Whether complete application journeys are logical and usable. |
| Screen-reader support | Relevant structure and accessible properties can be inspected. | What supported screen-reader/browser combinations actually announce and whether the experience is understandable. |

Therefore:

- no automated finding does not mean “pass”;
- a review signal does not mean “confirmed failure”;
- a page blocker does not mean “not applicable”;
- a screenshot is supporting evidence, not a complete test by itself;
- a complete WCAG conformance claim requires the full-page scope, applicable criteria, all responsive variations, and knowledgeable human evaluation.

## Evidence category versus severity

The plugin records two independent dimensions:

**Evidence category** answers “how certain is this result?”

- `confirmed`: deterministic failure evidence was reproduced;
- `review`: a person must decide using the provided procedure;
- `blocker`: the requested page was not testable;
- `manual`: automation cannot make the decision.

**Severity** answers “how much could this barrier affect users?”

- `Critical`: likely prevents completion of a core task for affected users.
- `Serious`: creates a major barrier or loss of important information/functionality.
- `Moderate`: causes meaningful difficulty but usually has a workaround.
- `Minor`: limited or localized impact that should still be corrected.

Severity is an initial assessment. Teams should also consider task criticality, frequency, affected users, reach across pages, legal/contractual requirements, and remediation dependencies when prioritizing work.

## Authoritative references

- [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/)
- [Evaluating Web Accessibility Overview](https://www.w3.org/WAI/test-evaluate/)
- [Selecting Web Accessibility Evaluation Tools](https://www.w3.org/WAI/test-evaluate/tools/selecting/)
- [How to Meet WCAG 2.2 (Quick Reference)](https://www.w3.org/WAI/WCAG22/quickref/)
