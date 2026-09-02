# Test matrix reference

The engine runs headless desktop, 390px mobile, and 320px reflow checks for HTTP/runtime state, axe, DOM semantics, keyboard traversal, focus signals, disclosures, tab relationships and operation, reflow, text spacing, target sizing, table/media signals, and screenshots.

Same-origin link validation skips external, download, destructive, logout, and non-HTTP targets. Matching request-context and in-page 404/410 results are confirmed. Placeholder and 5xx results are reviews.

Element screenshots are used for finding evidence when capture succeeds; full-page screenshots are the fallback.

Automation does not prove complete keyboard journeys, supported screen-reader combinations, physical mobile behavior, content meaning, complete visual contrast, media alternatives, timing, flashing, gesture alternatives, consistency, error quality, accessible authentication, or WCAG exceptions.
