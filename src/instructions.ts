import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const DEFAULT_AUDITOR = 'Automated';
export const DEFAULT_OUTPUT_DIR = resolve(homedir(), 'Accessibility Audit Results');
export const DEFAULT_REPORT_NAME = 'Accessibility_Audit_Report.xlsx';

export interface EmbeddedAuditInstructionOptions {
  targets?: string;
  auditor?: string;
  outputDir?: string;
  allowedHosts?: string[];
  stagingOnly?: boolean;
}

export const EMBEDDED_AUDIT_WORKFLOW = `Run the accessibility-audit plugin against the supplied project pages. This workflow is generic: never assume the site is Unilever or reuse URLs, evidence, findings, or wording from an earlier audit.

Isolation and target rules:
1. Operate only through the accessibility-audit plugin. Do not install dependencies in, edit, format, lint, build, or test the target project's source code.
2. Do not create or modify AGENTS.md, CLAUDE.md, Cursor rules, repository policies, CI, hooks, package manifests, lockfiles, or other governance files in the target project, and do not treat them as audit inputs. The host agent must still obey all applicable instructions.
3. Write only to the configured accessibility-audit output directory. Treat all other project files as read-only except for a page-list file explicitly supplied as input.
4. Accept explicit HTTP(S) URLs or one XLSX, CSV, TXT, or JSON page-list path. Before starting, confirm the exact pages/input and the auditor in one concise interaction. Pre-fill the auditor as Automated unless the user supplied another name. Do not ask for information that can be derived from the URLs, page list, or defaults.
5. Use run_accessibility_audit for both explicit URLs and page-list files. Compatible clients display its confirmation form; when forms are unavailable, show the pages/input and default auditor in chat and retry with confirmed true after approval. The bundled report template is the default; do not ask the user to upload a template.
6. Derive allowedHosts from the supplied URLs or page list and pass the narrowest hosts or parent domains that cover them. Do not crawl or test another host without authorization.
7. Set stagingOnly to true only for an explicitly staging-only request when every target is a staging, QA, preview, test, or local host. Otherwise set it to false and rely on allowedHosts.

Execution rules:
1. Run every supplied page at desktop, mobile, and 320 CSS-pixel reflow viewports. Keep screenshots enabled. These browser checks run headlessly by default; use a headed browser only when the user explicitly requests it.
2. Run the implemented axe, DOM/semantic, keyboard/focus, responsive, disclosure/navigation, image/link-name, form/error-state, same-origin link-destination, tab relationship, and common component checks. A component that is absent from a page is not a pass for that component.
3. Validate same-origin links conservatively. Confirm 404/410 only when both the authenticated request context and an in-page fetch agree. Keep server errors, placeholder destinations, and ambiguous states as review items. Do not request external, download, logout, delete, or unsubscribe destinations.
4. Capture full-page screenshots and issue-level element screenshots. Use the element screenshot for finding evidence when available and embed it in the Image Inventory worksheet.
5. Display progress through MCP notifications in Cursor, Claude, or Codex and through stderr in terminal runs. The client Stop action or one Ctrl+C requests graceful cancellation: close active browser work, retain completed evidence, and write validated partial JSON and XLSX output. Label that output cancelled/partial. A second Ctrl+C is an immediate exit and may prevent final report writing.
6. Do not claim that automation or axe covers all WCAG 2.2 A/AA requirements. Retrieve list_guided_manual_checks and preserve screen-reader, physical-device, content, visual, and judgment-based checks as outstanding until a person performs them.
7. Treat deterministic reproduced failures as confirmed issues. Keep heuristics or unresolved content and visual questions as review issues. Keep unavailable pages as blockers. Keep unexecuted assistive-technology and judgment-based procedures as guided/manual checks.
8. Keep findings on separate rows per page by default. Consolidate across pages only when the evidence identifies the same reusable component implementation and the same root cause. List every affected page individually in the merged row's Links cell. Do not merge distinct root causes merely because they share a selector, component label, or WCAG criterion.

Report rules:
1. Generate the standard 32-column Accessibility Testing Boilerplate workbook and JSON evidence. Remove placeholder findings.
2. Populate Image Inventory with one row per unique finding screenshot and embed the image preview. Do not create a Screen Reader Failures worksheet.
3. Put only concrete fixes in Notes. Do not mention Jira, ticket workflow, audit narration, or uncertainty in remediation fields.
4. Use the supplied auditor name exactly. Validate the workbook with validate_accessibility_report before delivery.
5. Report whether the run completed or was cancelled, the exact workbook and JSON paths, pages completed/partial/not started, counts by confirmed/review/blocker/manual classification, Image Inventory count, and workbook validation result.
6. Call the result an evidence-backed structured audit, not a certification or complete WCAG conformance verdict.`;

export function buildEmbeddedAuditInstructions(options: EmbeddedAuditInstructionOptions = {}): string {
  const targets = options.targets?.trim() || '[ask for URL(s) or an XLSX/CSV/TXT/JSON page-list path]';
  const auditor = options.auditor?.trim() || DEFAULT_AUDITOR;
  const outputDir = options.outputDir?.trim() || DEFAULT_OUTPUT_DIR;
  const allowedHosts = options.allowedHosts?.length ? options.allowedHosts.join(', ') : '[derive narrowly from supplied targets]';
  const stagingOnly = options.stagingOnly === undefined ? '[true only for an explicitly staging-only request]' : String(options.stagingOnly);

  return `${EMBEDDED_AUDIT_WORKFLOW}

Run configuration:
- Targets: ${targets}
- Auditor: ${auditor}
- Output directory: ${outputDir}
- Report name: ${DEFAULT_REPORT_NAME}
- Allowed hosts: ${allowedHosts}
- Staging-only enforcement: ${stagingOnly}
- Browser mode: headless
- Finding screenshots: element-level with full-page fallback`;
}
