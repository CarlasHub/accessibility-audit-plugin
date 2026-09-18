# v1.8.3 — Multi-page workflows and evidence-gated scanner findings

This patch release fixes setup persistence and multi-URL execution while tightening the evidence required before the scanner reports accessibility failures or review candidates.

## What changed

- Landing-page setup drafts now retain repository choice, repository details, URL lists, and workflow fields across the new- and existing-repository paths.
- The GitHub Action and reusable workflow accept one URL per line or a JSON array and audit every authorized URL rather than using only the first value.
- Responsive clipping, 200% text-resize loss, table structure, and keyboard off-viewport checks now require complete, repeatable evidence before classification.
- Empty `#` links without an independently proven accessible-name or destination failure no longer become speculative review rows.
- Findings that represent the same root cause are consolidated while retaining all affected URLs, viewports, selectors, and evidence occurrences.
- HTML and XLSX output explain the evidence status and standards mapping without presenting automated output as conformance certification.

## Classification migration

This release advances the Audit Quality Contract from 1.1.0 to 1.2.0. Existing consumers do not need to change configuration, but should expect lower review counts and more conservative classifications for heuristic visual, resize, table, and keyboard signals. Integrations that assert the canonical `qualityContract.version` must update their expected value to `1.2.0`.

The supplied L'Oréal validation sample previously contained 102 review rows. Evidence replay and corrected classification retained 15 confirmed failures and 3 genuine review candidates, identified 1 execution blocker, and the corrected scan produced 4 additional confirmed findings. Repeated observations are consolidated in the final report, so raw candidate counts and final report-row counts are intentionally different.

## Quality and conformance boundary

Contract 1.2.0 requires reproducibility, applicability, complete collector evidence, useful locators, known-exception handling, and root-cause consolidation before a result can be labelled a confirmed failure. The implementation is checked with unit, adversarial, browser, report-parity, built-CLI, packaged-Action, marketplace, and two-run live BuggyLand regression gates.

This product remains an evidence-backed accessibility pre-audit. It does not claim complete automated WCAG conformance, zero false positives, or legal certification. Criteria and states that require content judgment, physical-device testing, native assistive technology, or a complete-process assessment remain unresolved for a qualified accessibility professional.

Native VoiceOver/WebKit and NVDA/Firefox evidence can only be collected on their supported operating systems. A release run that does not execute one of those native environments must preserve the corresponding checks as manual or inconclusive rather than treating them as passes.
