# Test matrix reference

The engine runs headless desktop, 390px mobile, and 320px reflow checks for HTTP/runtime state, axe, DOM semantics, keyboard traversal, focus signals, disclosures, tab relationships and operation, reflow, text spacing, target sizing, table/media signals, and screenshots.

Same-origin link validation skips external, download, destructive, logout, and non-HTTP targets. Matching request-context and in-page 404/410 results are confirmed. Placeholder and 5xx results are reviews.

Visible consent banners are dismissed before interaction checks and evidence capture, preferring reject or necessary-only actions. Contextual component screenshots are used for confirmed-failure and blocker evidence when capture succeeds. Full-page screenshots are reserved for page-level failures or blockers without a component locator. Review and manual signals do not generate screenshot evidence.

Automation does not prove complete keyboard journeys, supported screen-reader combinations, physical mobile behavior, content meaning, complete visual contrast, media alternatives, timing, flashing, gesture alternatives, consistency, error quality, accessible authentication, or WCAG exceptions.
