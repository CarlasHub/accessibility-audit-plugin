# WCAG test-quality audit

Date: 12 October 2026  
Plugin version reviewed: 1.8.7  
Primary target: <https://carlashub.github.io/a11y-test-cases/>  
Regression target: <https://carlashub.github.io/buggyland/>

Remediation updated: 14 October 2026

## Executive verdict

The plugin has a strong and deliberately conservative coverage model, but it cannot truthfully claim that all WCAG tests are performed automatically.

- All 55 active WCAG 2.2 Level A and AA success criteria are present in the criterion ledger and each has a criterion-specific manual procedure.
- The automated layer runs axe-core 4.13.0 with the WCAG 2.0, 2.1 and 2.2 A/AA tags, plus selected best-practice rules and the plugin's custom browser checks. The current tag set enables 100 axe rules.
- An automated pass never becomes a WCAG conformance pass by absence of findings. Unresolved criteria remain `manual-review-required` or `inconclusive`.
- The published A11y Test Cases site is a manual test-plan manager, not a seeded failure corpus. Auditing its interface tests that interface; it does not execute the site's 165 manual test steps and cannot establish the plugin's detection recall.
- The result-consolidation design removes exact duplicate finding rows, consolidates the same root cause across viewports before WCAG enrichment and intentionally retains each distinct evidence occurrence.
- The four material reporting/detection defects found on 12 October are resolved: AAA-only advice is outside standard counts/actions; hidden controls use an associated visible activation surface for target-size measurement; cross-viewport identity is stable; and generic axe `incomplete` nodes are actionable review findings while remaining inconclusive in the criterion ledger.

Overall assessment: **a defensible, evidence-backed pre-audit and remediation tool, but not an automated WCAG certification tool**. It is accurate to say: **“All 55 WCAG 2.2 A/AA criteria are accounted for through automated evidence plus guided manual checks.”**

## Remediation status

All product and quality-oracle defects assigned P1 or P2 in this review are implemented and covered by focused regression tests.

| Review item | Current status |
| --- | --- |
| AAA scope contaminates AA totals/actions | Resolved: standard, supplemental and advisory scopes are filterable, and only standard findings drive AA headlines and actions |
| Hidden file input target-size false positive | Resolved: the associated visible label is the measured activation surface while the logical control remains traceable |
| Semantic duplicate across viewports | Resolved: consolidation identity is independent of later WCAG enrichment and mappings are unioned |
| Generic axe incomplete evidence is hidden | Resolved: node-level review findings appear in outputs and the criterion ledger remains inconclusive |
| File input called a textbox | Resolved: reports identify the control as a file upload |
| Partial benchmark completion can pass silently | Resolved: the oracle asserts exact page statuses, errors, blockers and journey outcomes |
| Disclosure/tab collectors lack positive and negative fixtures | Resolved: valid, invalid, bounded and failure behavior has direct browser-fixture coverage |
| Benchmark relies on totals/digests | Resolved: 40 human-readable expected groups assert all 63 current findings, classifications and mappings |
| Finding rows and evidence occurrences appear duplicated | Resolved in reporting language and presentation: findings are root causes; occurrences retain page, viewport and state evidence |
| Broader official ACT consistency suite | Roadmap: valuable additional rule-by-rule validation, not a substitute for the current expected-outcome corpus |

The reproduction details and defect narratives below preserve the evidence observed on 12 October; each correction is labelled with its current implementation status.

## What was tested

The review combined:

1. source inspection of rule selection, finding creation, consolidation, criterion accounting and report rendering;
2. a fresh default Level AA audit of the live A11y Test Cases site at desktop, mobile and 320 CSS-pixel reflow viewports;
3. a fresh two-run BuggyLand regression audit;
4. focused automated tests for findings, consolidation, integrity and the quality contract;
5. comparison with W3C WCAG 2.2, WCAG-EM, ACT Rules and Deque axe-core documentation; and
6. independent reviewer checks of coverage, duplicate handling and the published test-case workflow.

### Reproduction record

The runs used plugin 1.8.7 at Git revision `a5b3e2e0d8c2bc57f3f9e7ec56a2009b6956caba`, Node.js 26.0.0, Playwright 1.63.0, axe-core 4.13.0 and Playwright's default headless Chromium. No configuration file, journeys or browser override was supplied for the live-site runs.

```sh
node dist/cli.js audit https://carlashub.github.io/a11y-test-cases/ \
  --yes --output /tmp/a11y-quality-audit.ycPafT \
  --exact-host carlashub.github.io --max-pages 1 --max-links 200 \
  --no-screenshots

node dist/cli.js audit https://carlashub.github.io/a11y-test-cases/ \
  --exact-host carlashub.github.io \
  --output /tmp/a11y-test-cases-aaa.8sQeH4 \
  --no-screenshots --yes --aaa-advisory

BUGGYLAND_OUTPUT_DIR=/tmp/a11y-buggyland-quality-20261012 \
  npm run test:buggyland

npm exec vitest run tests/consolidate.test.ts \
  tests/audit-integrity.test.ts tests/finding-id.test.ts tests/findings.test.ts
```

The two live-run `audit-results.json` SHA-256 values were `195a154da630bc926e1615e51b092a12b68a7cf76231e817c95610376b788846` for default AA and `9c3255bad25acbc44db169e969fc04b603523a1af8c4958ff4f0426dd4474a1d` for AA plus AAA advisory. The AAA result was generated at `2026-10-12T17:02:04.412Z`. These hashes identify the reviewed output but do not make a mutable live site immutable; later reproduction can differ when the site or browser changes. The focused command passed 66 tests across four files.

## Coverage: what the plugin actually performs

### Automated checks

The runner selects axe tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`, then adds best-practice checks. When AAA advisory is enabled, the corresponding AAA tags are also added. See [`src/audit/runner.ts`](../src/audit/runner.ts#L236).

This gives broad automated coverage, but neither axe rules nor custom checks cover every requirement of every WCAG success criterion. Deque states that axe-core finds about 57% of WCAG issues automatically and returns uncertain cases as `incomplete`. W3C likewise says some checks cannot be automated and tools can produce inaccurate results.

### Manual checks and criterion accounting

The plugin generates one procedure for each of the 55 active Level A/AA criteria. The quality contract verifies that the standard ledger and manual-check collection both contain exactly those 55 unique criteria. The ledger uses confirmed findings as failures and review/incomplete evidence as inconclusive; otherwise it keeps the criterion at `manual-review-required`. See [`src/audit/wcag-criteria.ts`](../src/audit/wcag-criteria.ts#L146) and [`src/audit/manual-checks.ts`](../src/audit/manual-checks.ts#L69).

This is the right safety boundary. A manual-check row means **a test still needs to be performed and recorded**; it does not mean that the manual test already ran. The report must preserve that distinction anywhere it describes “55 checks.”

### Conformance boundary

WCAG 2.2 conformance applies to full pages, including responsive variations, and to every page in a complete process. W3C's WCAG-EM additionally expects scope definition, site exploration, representative sampling, evaluation and reporting by people with the required expertise. Therefore crawler coverage plus automated rules is evidence for an evaluation, not a conformance determination.

## Live A11y Test Cases result

The default AA audit completed one page at all three configured viewports:

| Measure | Result |
| --- | ---: |
| Confirmed findings | 0 |
| Review findings | 1 |
| Coverage blockers | 0 |
| Guided manual checks | 55 |
| Standard criteria inconclusive | 2 |
| Standard criteria awaiting manual review | 53 |
| axe violations per viewport | 0 |
| axe incomplete rules per viewport | 1 |

The historical run's axe incomplete result was `aria-prohibited-attr`, with two nodes at each viewport. At the time it was retained only in raw evidence and made the affected criteria inconclusive. The current implementation additionally turns each unresolved node into an actionable `Needs review` finding in HTML and Excel without treating it as a confirmed failure or pass.

The A11y Test Cases repository describes 14 component procedures, 17 task groups, 55 criterion checks and 165 criterion-check steps. Those are procedures managed by the target application; the plugin does not import or execute them. Consequently, this target is useful for demonstrating an audit workflow, but not for measuring detector precision or recall. A recall benchmark needs intentionally seeded failures and a machine-readable expected-result manifest.

## Historical quality defects and implemented corrections

### P1 — AAA advisory findings pollute the standard remediation headline

With the tutorial's optional AA + AAA advisory configuration, the reviewer run produced 54 finding rows: 53 confirmed `axe-color-contrast-enhanced` findings mapped to WCAG 1.4.6 Level AAA, and one Minor review. The report then described 53 confirmed barriers as requiring priority remediation and included them in the same top-action pool as the AA scope.

The criterion ledger correctly labels AAA as advisory, but the executive summary and action ranking count all confirmed findings without applying that scope. See [`src/reporting/executive-summary.ts`](../src/reporting/executive-summary.ts#L25), [`src/reporting/finding-actions.ts`](../src/reporting/finding-actions.ts#L98) and [`src/audit/wcag-criteria.ts`](../src/audit/wcag-criteria.ts#L146).

Implemented correction:

- carry `standard` versus `advisory` scope on each finding;
- exclude advisory-only findings from the AA confirmed-barrier headline and standard-scope top actions;
- show a separate “AAA advisory observations” total and action list; and
- add tests proving that optional advisory failures never alter the Level AA conformance summary.

### P1 — Target-size false positive on a visually hidden file input

The only AA finding on the live site reports `#import-test-plan` as a 1×1 CSS-pixel target for WCAG 2.5.8. The input is intentionally visually hidden and has an associated visible `<label>` of approximately 259×39 CSS pixels. Activating that label activates the same file picker.

The plugin already recognizes common visually hidden patterns in another browser check, but the target-size check neither reuses that logic nor measures an associated label as the operative pointer target. See [`src/audit/browser-checks.ts`](../src/audit/browser-checks.ts#L224) and [`src/audit/browser-checks.ts`](../src/audit/browser-checks.ts#L868).

Implemented correction:

- resolve labels and other equivalent activation surfaces before judging target geometry;
- omit the hidden implementation control when a conforming visible target invokes it;
- keep the review when no adequate visible activation surface exists; and
- add passed, failed and ambiguous regression fixtures for this pattern.

### P1 — One semantic duplicate is split across viewports

The current BuggyLand result has no byte-identical duplicate finding rows, but `axe-select-name` for the same `select` element on each of two pages is divided between `A11Y020` and `A11Y021`. One row contains desktop evidence after an axe/custom-family merge and the other contains mobile/reflow evidence. The pre-consolidation merge changes the WCAG set, while the later root-cause identity includes that WCAG set, so otherwise identical evidence no longer groups together.

Implemented correction:

- derive stable consolidation identity before enrichment, or exclude enrichment-only WCAG differences from the identity;
- merge equivalent axe/custom families after same-page, same-element viewport normalization; and
- add a regression where only one viewport receives the equivalent custom-family observation.

### P2 — File input is described as a textbox

The target-size result calls “Import working CSV” a textbox because the role classifier sends all non-button, non-checkbox and non-radio inputs to a textbox fallback. See [`src/audit/page-preparation.ts`](../src/audit/page-preparation.ts#L275).

Implemented correction: `input[type=file]` is classified as a file-upload control and covered by a focused test.

### P1 — Generic axe `incomplete` evidence is omitted from actionable findings

The live run contained an axe incomplete rule at every viewport. The JSON retains it and the ledger becomes inconclusive, but generic incomplete results are deliberately discarded during finding creation. HTML and Excel users therefore do not receive the affected rule, selector, page, viewport, help text or review action even though the criterion is unresolved. See [`src/audit/findings.ts`](../src/audit/findings.ts#L302) and the behavior locked by [`tests/findings.test.ts`](../tests/findings.test.ts#L891).

Implemented correction: generic axe incomplete nodes create `Needs review` findings in HTML and Excel while preserving their `inconclusive` ledger status. They are never presented as confirmed failures or passes.

### P2 — A passing regression accepts partial page completion

Both fresh BuggyLand runs were deterministic and passed the quality contract, but only two of four requested pages were fully completed; two were marked partial. Partial can be a valid controlled outcome, yet a benchmark intended to guard detection quality should state the expected completion status per page and fail when it changes unexpectedly.

Implemented correction: the BuggyLand oracle asserts exact page statuses and expected journey outcomes, including controlled partial results and collector failures.

### P2 — Disclosure and tab heuristics lack direct behavioral regression coverage

The production runner executes custom disclosure and tab checks, but the integration suite covers these paths only with injected error stubs. It does not exercise valid and invalid disclosure/tab behavior in a live browser fixture. See [`src/audit/browser-checks.ts`](../src/audit/browser-checks.ts#L1722), [`src/audit/browser-checks.ts`](../src/audit/browser-checks.ts#L1928) and [`tests/integration.test.ts`](../tests/integration.test.ts#L96).

Implemented correction: fixtures cover valid and invalid semantics, keyboard activation, dynamic `aria-expanded` and `aria-selected` changes, bounded collection/error behavior and final finding classification.

### P2 — The published benchmark count needs clearer scope

The README's historical A11y Test Cases result can be read as detection evidence, but 51 of its 52 findings came from the optional AAA enhanced-contrast check. The page itself has no seeded-failure manifest, so the count does not measure recall.

Implemented correction: documentation labels A11y Test Cases as a workflow/tutorial target, discloses the advisory source of the historical count and reserves detection-quality claims for BuggyLand's expected-outcome corpus.

## Historical repeated-results analysis

The historical 12 October 2026 pre-remediation BuggyLand run produced 57 final findings and 443 evidence records. The table below describes that historical result; the current regression baseline is documented separately above.

| Question | Result |
| --- | --- |
| Exact duplicate final finding rows | None found |
| Exact repeated evidence inside one finding | None found |
| Findings whose summary text also appears on another row | 48 of 57 |
| Confirmed semantic split | Historical run: `axe-select-name` split into two rows on each of two pages; current regression requires one root-cause row across viewports |
| Why evidence is much larger than findings | Evidence is intentionally retained per page, viewport, state and observation |

Most repeated titles are legitimate: the same rule affects different elements or pages, or a single finding combines evidence from multiple viewports and states. The lossless-evidence contract deliberately prevents observations from disappearing, and the Excel Evidence sheet writes one row per retained occurrence.

That traceability is valuable. Current report language distinguishes root-cause findings from occurrence-level evidence so repeated viewport/state observations do not look like repeated issues.

1. show one consolidated finding row by default;
2. summarize occurrences as “2 pages · 3 viewports · 8 observations”;
3. keep page/viewport/state evidence inside an expandable section or secondary Evidence sheet;
4. label evidence rows as occurrences, not findings; and
5. add a semantic-duplicate quality gate based on stable page/element/rule identity, not only final-row equality.

## Strengths confirmed

- Every active WCAG 2.2 A/AA criterion is accounted for exactly once in the standard ledger.
- The plugin does not infer conformance from a clean automated scan.
- Confirmed, review and blocker classifications are separated.
- Full raw evidence is preserved for traceability.
- Exact duplicate observations consolidate deterministically into one final finding while retaining their evidence.
- Equivalent axe and custom checks are merged for known families when page and rendered-element evidence match.
- `npm exec vitest run tests/consolidate.test.ts tests/audit-integrity.test.ts tests/finding-id.test.ts tests/findings.test.ts` passed 66 tests across four files.
- Two fresh BuggyLand runs produced the same category totals: 32 confirmed, 30 review and 1 blocker finding, with 55 manual checks and valid output workbooks.
- The documentation generally states the correct limit: this is evidence for human assessment, not automated certification.

## Quality-oracle layers and remaining roadmap

Aggregate counts and deterministic output are necessary but not sufficient. A false positive can replace a missed expected finding while the total count remains unchanged. The current benchmark therefore asserts expected identities and outcomes, not only totals.

Oracle layers and status:

1. **Implemented — targeted fixtures:** passed, failed and ambiguous fixtures exercise custom checks and consolidation exceptions touched by this review.
2. **Implemented — expected finding manifest:** 40 readable structural groups assert the rule, page, element identity, classification and WCAG mappings of all 63 BuggyLand findings.
3. **Roadmap — broader ACT consistency suite:** consume official ACT passed, failed and inapplicable examples for each supported ACT-mappable rule. W3C considers an implementation consistent only when expected outcomes and mapped criteria agree across all examples.
4. **Implemented — negative fixtures:** accessible implementations resembling failures include visually hidden native controls with visible labels and valid disclosure/tab behavior.
5. **Implemented — cross-viewport invariance:** an unchanged element/root cause consolidates regardless of which viewport adds custom enrichment.
6. **Implemented — completion oracle:** requested/audited/partial/skipped pages, errors, blockers and journey outcomes are exact assertions.
7. **Implemented — report assertions:** standard/advisory scope, incomplete evidence and finding-versus-occurrence wording are exercised across generated report formats.

## Implementation status

| Priority | Work | Status and acceptance signal |
| --- | --- | --- |
| P1 | Separate AAA advisory findings from AA executive counts/actions | Resolved: AAA-only failures do not increase AA barrier totals/actions |
| P1 | Fix hidden-input/visible-label target-size analysis | Resolved: the visible activation label is measured and traceable |
| P1 | Stabilize cross-viewport consolidation identity | Resolved: each unchanged root cause has one finding with unioned evidence/mappings |
| P1 | Surface generic axe incomplete nodes as review findings | Resolved: incomplete nodes are actionable without becoming confirmed failures |
| P1 | Add expected-result manifests and negative fixtures | Resolved: CI fails on missing, added, reclassified or remapped results |
| P2 | Assert expected page and journey completion | Resolved: unexpected status, error, blocker or journey outcomes fail the benchmark |
| P2 | Add direct disclosure/tab browser fixtures | Resolved: valid, invalid, truncated and failed behavior is covered |
| P2 | Clarify the published A11y Test Cases result | Resolved: workflow evidence is separate from detector accuracy |
| P2 | Distinguish findings from occurrences | Resolved: users see root-cause totals separately from evidence occurrences |
| P2 | Correct file-input control naming | Resolved: reports use “file upload,” not “textbox” |
| P3 | Publish broader ACT consistency coverage | Roadmap: add official passed/failed/inapplicable examples rule by rule |

## Official quality references

- [WCAG 2.2 conformance requirements](https://www.w3.org/TR/WCAG22/#conformance-reqs): conformance covers complete pages and processes.
- [W3C Evaluation Tools Overview](https://www.w3.org/WAI/test-evaluate/tools/): some checks cannot be automated and tool results can be inaccurate.
- [W3C WCAG-EM Overview](https://www.w3.org/WAI/test-evaluate/conformance/wcag-em/): define scope, explore the product, select a representative sample, evaluate it and report results.
- [W3C About ACT Rules](https://www.w3.org/WAI/standards-guidelines/act/rules/about/): ACT rules are informative partial checks; passing one does not establish full success-criterion conformance.
- [W3C ACT implementations](https://www.w3.org/WAI/standards-guidelines/act/implementations/): consistency is measured against passed, failed and inapplicable examples and expected WCAG mappings.
- [W3C ACT test cases](https://www.w3.org/WAI/standards-guidelines/act/report/testcases/): machine-readable expected outcomes are available for tool testing.
- [Deque axe-core](https://github.com/dequelabs/axe-core): axe-core reports violations and incomplete results and estimates that automation finds about 57% of WCAG issues on average.
- [A11y Test Cases repository](https://github.com/CarlasHub/a11y-test-cases): the audited site is a structured manual evaluation manager rather than an intentional-failure detector benchmark.

## Final quality statement

The plugin now provides broad automated detection, actionable uncertain evidence, lossless occurrences, exact expected-outcome regression coverage, explicit standard/supplemental/advisory filtering, full A/AA criterion accounting and a complete guided manual checklist. It does **not** perform every WCAG test automatically, and the generated 55 manual rows are work still to be completed by a qualified evaluator. The four P1 defects and all P2 items above are resolved; broader official ACT example coverage remains the next accuracy investment, not a prerequisite for honestly describing the product as an evidence-backed accessibility pre-audit and remediation tool.
