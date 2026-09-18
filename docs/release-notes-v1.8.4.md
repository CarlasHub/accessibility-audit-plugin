# v1.8.4 — Accurate responsive link-name evidence

This patch release makes link-name diagnostics follow the rendered accessibility tree and clearly distinguishes valid nested link text from text hidden by responsive CSS.

## What changed

- Visible text inside nested elements such as `<a><span>Explore this location</span></a>` is accepted as the link's accessible name.
- Text hidden with `display:none`, `visibility:hidden`, `visibility:collapse`, or `aria-hidden="true"` is excluded from ordinary name-from-content calculation.
- A failed link-name result now records the hidden text, its selector, and the computed reason it was excluded instead of showing source markup without the relevant rendered state.
- Remediation now covers responsive icon-only links: keep concise text exposed to the accessibility tree or provide an equivalent `aria-label` or valid `aria-labelledby` reference.

## Independent implementation checks

The regression test verifies the same fixture three ways:

- the plugin's DOM evidence collector;
- Chromium's accessibility-tree snapshot; and
- the bundled official axe-core 4.13 `link-name` implementation.

All three accept visible nested `<span>` text and reject a link whose only text is hidden with `display:none`.

## L'Oréal validation

The affected live page was scanned at desktop, mobile, and 320-pixel reflow sizes. The `Explore this location` link passes at desktop. At mobile and reflow sizes, the site's `.callout__fake-button` element computes to `display:none`, Chromium exposes the parent as an unnamed link, and axe-core reports `link-name`. The report now includes that breakpoint-specific cause.

This result follows the W3C Accessible Name and Description Computation 1.2 hidden-node rules and WCAG 2.2 Success Criterion 4.1.2. The product remains an evidence-backed pre-audit; automated results do not establish complete WCAG conformance.
