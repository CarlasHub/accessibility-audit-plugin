import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const DEFAULT_AUDITOR = 'Automated';
export const DEFAULT_OUTPUT_DIR = resolve(homedir(), 'Accessibility Audit Results');
export const DEFAULT_REPORT_NAME = 'Accessibility_Audit_Report.xlsx';

export interface EmbeddedAuditInstructionOptions {
  targets?: string;
  auditor?: string;
  landingPageUrl?: string;
  outputDir?: string;
  allowedHosts?: string[];
  stagingOnly?: boolean;
}

export const EMBEDDED_AUDIT_WORKFLOW = `Run the accessibility-audit plugin against the supplied project pages. This workflow is site-independent: never assume the target belongs to a previous audit or reuse URLs, evidence, findings, wording, customer names, or site-specific rules from an earlier run.

Isolation and target rules:
1. Operate only through the accessibility-audit plugin. Do not install dependencies in, edit, format, lint, build, or test the target project's source code.
2. Do not create or modify AGENTS.md, CLAUDE.md, Cursor rules, repository policies, CI, hooks, package manifests, lockfiles, or other governance files in the target project, and do not treat them as audit inputs. The host agent must still obey all applicable instructions.
3. Write only to the configured accessibility-audit output directory. Treat all other project files as read-only except for a page-list file explicitly supplied as input.
4. Accept explicit HTTP(S) URLs or one XLSX, CSV, TXT, or JSON page-list path. Before starting, confirm the exact pages/input, the single landing-page QA URL, and the auditor in one concise interaction. Pre-fill the auditor as Automated unless the user supplied another name. Default the landing-page QA URL to the first resolved URL unless the user supplies it. Do not ask for information that can be derived from the URLs, page list, or defaults.
5. Use run_accessibility_audit for both explicit URLs and page-list files. Compatible clients display its confirmation form; when forms are unavailable, show the pages/input and default auditor in chat and retry with confirmed true after approval. The bundled report template is the default; do not ask the user to upload a template.
6. Derive allowedHosts from the supplied URLs or page list and pass the narrowest hosts or parent domains that cover them. Do not crawl or test another host without authorization.
7. Set stagingOnly to true only for an explicitly staging-only request when every target is a staging, QA, preview, test, or local host. Otherwise set it to false and rely on allowedHosts.

Execution rules:
1. Run every supplied page at desktop, mobile, and 320 CSS-pixel reflow viewports. Keep screenshots enabled. These browser checks run headlessly by default; use a headed browser only when the user explicitly requests it. If no supported browser exists, allow the plugin to install Playwright Chromium once in plugin-owned storage after confirmation; do not install it in the target project.
2. Run the implemented axe, DOM/semantic, keyboard/focus, responsive, disclosure/navigation, image/link-name, form/error-state, same-origin link-destination, tab relationship, and common component checks. A component that is absent from a page is not a pass for that component.
3. Validate same-origin links conservatively. Confirm 404/410 only when both the authenticated request context and an in-page fetch agree. Keep server errors, placeholder destinations, and ambiguous states as review items. Do not request external, download, logout, delete, or unsubscribe destinations.
4. Capture at most one representative contextual element screenshot per final confirmed, blocker, or review reporting unit when the relevant rendered state can be reproduced. Keep all occurrences traceable in JSON. Use full-page evidence only for page-level failures or an unresolved blocking surface. Store PNGs beside the workbook and add relative hyperlinks in Findings and Evidence. Never embed audit screenshots in the workbook.
5. Display progress through MCP notifications in Cursor, Claude, Codex, or Copilot and through stderr in terminal runs. The client Stop action or one Ctrl+C requests graceful cancellation: close active browser work, retain completed evidence, and write partial HTML and JSON plus a validated partial XLSX workbook. Label that output cancelled/partial. A second Ctrl+C is an immediate exit and may prevent final report writing.
6. Treat WCAG 2.2 Level AA as the public conformance target. AAA checks are optional advisory evidence and must never relabel the audit as an AAA conformance assessment. Do not claim that automation, axe, or a scripted screen-reader journey covers all WCAG 2.2 requirements. Retrieve list_guided_manual_checks, confirm that it contains one criterion-specific procedure and evidence prompt for each of the 55 active A/AA criteria, and preserve screen-reader, physical-device, content, visual, and judgment-based checks as outstanding until a qualified person performs them.
7. Treat deterministic reproduced failures as confirmed issues. Keep heuristics or unresolved content and visual questions as review issues. Keep unavailable pages as blockers. Keep unexecuted assistive-technology and judgment-based procedures as guided/manual checks.
8. Use one row for the same reusable component implementation and root cause across all affected pages, and group repeated DOM instances within that component. List every affected page individually in the merged row's Links cell. Keep a page-specific implementation, colour treatment, behaviour, success criterion, or remediation requirement on its own row. Do not merge unrelated findings merely because they share a host or WCAG criterion. Do not report missing aria-controls alone as a WCAG failure or standalone review for an ordinary disclosure/accordion; generic disclosures/accordions do not require Escape to close.
9. If a modal, consent layer, or other surface cannot be dismissed, record it as an interaction-coverage blocker, skip underlying state-based checks, and never interpret the resulting focus sequence or absence of findings as a page pass. Preserve axe incomplete results, unresolved focus-indicator samples, and incomplete interactions as raw JSON evidence and inconclusive coverage; do not promote them to workbook findings. Record every page/viewport/area outcome in the JSON coverage matrix using confirmed-passed, confirmed-failed, tested-inconclusive, manual-review-required, not-tested, or not-applicable.

Report rules:
1. Generate the self-contained accessible HTML report, seven-sheet CarlasHub WCAG 2.2 workbook, and JSON evidence. Preserve the six canonical template worksheets in their existing order, tab colours, accessible colour scheme, formulas, validations, filters, and the 25 Findings columns; append only the generated WCAG Criteria ledger. Remove placeholder values and do not add other worksheets or columns.
2. Populate Page Inventory with one structured row per requested or skipped URL, Evidence with one structured row per retained evidence item, Manual Checks with one criterion-specific procedure and evidence prompt for each of the 55 active WCAG 2.2 A/AA criteria, Findings with one row per reporting unit, and WCAG Criteria with every active WCAG 2.2 success criterion labelled passed, failed, manual-review-required, not-applicable, or inconclusive. Use portable relative links for screenshots and direct links for page URLs. Do not embed screenshots.
3. Put only concrete fixes in Notes. Do not mention Jira, ticket workflow, audit narration, or uncertainty in remediation fields.
4. Put the single landing-page QA URL in Audit Summary, use the supplied auditor name exactly, set every populated Findings row to Open, preserve confirmed, review, blocker, or manual as its Evidence type, and populate Owner and Effort from the finding. Validate the workbook with validate_accessibility_report before delivery.
5. Report whether the run completed or was cancelled, the exact HTML, workbook, JSON, and portable ZIP paths, pages completed/partial/not started, counts by confirmed/review/blocker/manual classification, Evidence row and linked screenshot counts, and workbook validation result.
6. Call the result an evidence-backed structured audit, not a certification or complete WCAG conformance verdict. Keep the conformance decision as not determined until qualified human assessment is complete. A confirmed pass applies only to the exact executed rule and state; axe incomplete results, truncated link checks, scripted keyboard or screen-reader journeys, and unexercised states are not passes.
7. Explain the result in plain language for a user who may not know WCAG. State that only supplied URLs were tested; define the evidence categories that are present; distinguish the workbook's Open workflow status from evidence confidence; identify outstanding guided checks; and tell the user to extract the ZIP and keep the workbook with its screenshots directory so relative evidence links work.`;

export function buildEmbeddedAuditInstructions(options: EmbeddedAuditInstructionOptions = {}): string {
  const targets = options.targets?.trim() || '[ask for URL(s) or an XLSX/CSV/TXT/JSON page-list path]';
  const auditor = options.auditor?.trim() || DEFAULT_AUDITOR;
  const landingPageUrl = options.landingPageUrl?.trim() || '[first resolved URL]';
  const outputDir = options.outputDir?.trim() || DEFAULT_OUTPUT_DIR;
  const allowedHosts = options.allowedHosts?.length ? options.allowedHosts.join(', ') : '[derive narrowly from supplied targets]';
  const stagingOnly = options.stagingOnly === undefined ? '[true only for an explicitly staging-only request]' : String(options.stagingOnly);

  return `${EMBEDDED_AUDIT_WORKFLOW}

Run configuration:
- Targets: ${targets}
- Auditor: ${auditor}
- Landing-page QA URL: ${landingPageUrl}
- Output directory: ${outputDir}
- Report name: ${DEFAULT_REPORT_NAME}
- Allowed hosts: ${allowedHosts}
- Staging-only enforcement: ${stagingOnly}
- Browser mode: headless
- Automatic browser installation: enabled when no supported Chromium browser is available
- Finding screenshots: at most one linked representative contextual image per final confirmed, blocker, or review reporting unit when capture succeeds; full-page evidence only for page-level findings or unresolved blockers`;
}
