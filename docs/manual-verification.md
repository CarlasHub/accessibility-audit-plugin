# Manual verification

Automation does not complete a WCAG 2.2 A/AA evaluation. Use this guide after every run and record each applicable procedure as `Pass`, `Fail`, `Not applicable` with a reason, or `Not tested`. Do not report an unperformed check as passed.

## First validate the generated evidence

1. Confirm the workbook auditor, landing-page QA URL, and requested URL scope.
2. Confirm `Page Inventory` lists only the URLs whose browser testing started; confirm completed, partial, not-started, and skipped counts in JSON.
3. Confirm each page completed at desktop, mobile, and 320px reflow or has a clear blocker.
4. Inspect every `coverage` entry in JSON. Treat `tested-inconclusive`, `manual-review-required`, `not-tested`, and `not-applicable` literally; do not convert them to passes. Confirm axe incomplete results, keyboard/link truncation, and modal blockers agree with the underlying viewport evidence.
5. Confirm every Findings row is populated and has no placeholder ID or text.
6. Keep confirmed failures, review items, blockers, and manual checks separate.
7. Open each Evidence relative link and match it to the page, viewport, rule, selector, component name, location, and result recorded in Findings and JSON.
8. Confirm consolidated rows list every affected page and genuinely share one component implementation, observed behaviour, success criterion, root cause, impact, and remediation.
9. Confirm Notes contains only actionable remediation.
10. Manually verify placeholder and 5xx link signals before treating them as defects.

## Complete keyboard-only journeys

For every unique page template and interactive component state:

1. Put the pointer aside and start at the browser address bar or beginning of the document.
2. Use `Tab` and `Shift+Tab` to move through all interactive content.
3. Use `Enter`, `Space`, and arrow keys according to the control type. Test `Escape` only where the chosen pattern requires or documents it, such as dialogs and applicable menus or popovers; do not fail an ordinary accordion or disclosure solely because Escape does not close it.
4. Open and close navigation menus, disclosures, dialogs, search, tabs, carousels, forms, and validation states.
5. Confirm focus follows a logical order, remains visible, is not fully hidden by sticky content, and returns to a sensible control when a temporary layer closes.
6. Confirm every action is available without a pointer and focus never becomes trapped.
7. Complete the page’s real tasks, including recovery from errors—not only a sequence of Tab presses.

Record the browser and operating system. Reproduce any failure with the exact control name, starting state, key sequence, resulting state, and affected page.

## Test supported screen-reader and browser combinations

The optional native GitHub Actions workflow can run bounded Guidepup journeys with VoiceOver on macOS and NVDA on Windows and retain spoken transcripts with environment metadata. That evidence helps reproduce announcements, but it does not determine whether a complete task is understandable or prove conformance. A tester familiar with the agreed assistive technologies must still manually test the desktop and mobile combinations supported by the product.

For navigation, forms, search, tabs, dialogs, carousels, and dynamic messages, confirm:

- meaningful names and appropriate roles;
- states and values such as expanded, selected, checked, required, invalid, and current;
- logical reading and focus order;
- instructions and errors are associated with the relevant control;
- status and validation changes are announced without unexpected focus movement;
- headings, regions, lists, tables, and form groups provide useful navigation;
- visible labels and announced names are consistent enough for speech-input users.

Record the screen reader, version, browser, browser version, operating system, commands used, announcement heard, expected result, and outcome. When a native CI transcript exists, cite it as supporting evidence and record what the human tester independently verified.

## Verify zoom, text resize, and reflow

For every unique responsive template:

1. Test 200% browser zoom.
2. Test the equivalent of 400% zoom at a 1280 CSS-pixel-wide starting viewport, producing a 320 CSS-pixel reflow view.
3. Apply the WCAG text-spacing values: line height 1.5 times the font size, paragraph spacing 2 times, letter spacing 0.12 times, and word spacing 0.16 times.
4. Confirm content and controls do not overlap, clip, disappear, or require two-dimensional scrolling, except for content with a permitted two-dimensional layout such as some data tables or maps.
5. Confirm sticky headers, dialogs, cookie controls, and zoomed controls do not cover focused content.

The automated overflow and text-spacing signals are starting evidence; a person must assess exceptions and visual usability.

## Measure contrast and visible states

Check text, icons, control boundaries, validation indicators, and focus indicators in default, hover, focus, selected, active, disabled, and error states. Include content over gradients, photographs, video, transparency, and other backgrounds that automated tools cannot reliably resolve.

Record the sampled foreground/background values, measured ratio, text size/weight where relevant, required threshold, component state, and tool used. Do not rely on visual estimation alone.

## Review content meaning and alternatives

Check every meaningful image, icon, chart, audio/video item, heading, label, instruction, and link in context. Confirm:

- informative images communicate their purpose or information;
- decorative images are ignored appropriately;
- linked images describe the link destination or action, not only their appearance;
- captions, transcripts, and audio descriptions are accurate and synchronized where required;
- headings and labels describe their topic or purpose;
- link text makes sense in its surrounding context;
- changes in human language are identified;
- instructions do not rely only on shape, color, sound, or visual location.

An automated check can detect a missing attribute or empty name, but it cannot decide whether existing wording is meaningful.

## Review consistency, errors, and cognitive support

Complete repeated navigation, help, authentication, and data-entry flows. Confirm:

- repeated navigation and controls stay in a consistent relative order and use consistent names;
- help is available consistently where required;
- errors identify the affected field and explain how to correct it;
- error prevention and confirmation are available for important submissions;
- previously supplied information is not requested again without a permitted reason;
- authentication does not depend only on memory, transcription, or solving a cognitive-function test;
- time limits, moving content, interruptions, and session expiry provide required controls and warnings.

Use realistic valid and invalid data. Avoid submitting destructive, financial, legal, or production-changing actions unless the test environment and authorization explicitly permit them.

## Test physical mobile devices and touch

Use supported physical devices in portrait and landscape. Confirm:

- content is available in both orientations unless one orientation is essential;
- touch controls are usable and target-spacing exceptions are assessed;
- pointer cancellation works and actions do not occur unexpectedly on touch-down;
- alternatives exist for multipoint, path-based, motion, and dragging gestures;
- responsive navigation and overlays work with touch and a supported mobile screen reader;
- the on-screen keyboard, zoom, and sticky content do not hide the active control or instructions.

Browser viewport emulation is useful responsive evidence, but it does not reproduce the complete behavior of physical hardware or mobile assistive technology.

## Close the audit

1. Resolve and rerun blockers.
2. Complete every review item’s Test method.
3. Assign accepted failures and update estimates.
4. Retest fixes using the original failure steps and affected assistive technologies.
5. Run regression checks across every page listed on a consolidated component finding.
6. Record remaining limitations and untested combinations.
7. Do not infer a pass from the absence of an automated signal.
