import { writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import type { AuditSummary, Finding } from '../types.js';
import { findingId } from './finding-id.js';

const STATUS_LABELS: Record<string, string> = {
  passed: 'Passed by available evidence',
  failed: 'Failed',
  inconclusive: 'Inconclusive',
  'confirmed-passed': 'Passed',
  'confirmed-failed': 'Failed',
  'tested-inconclusive': 'Inconclusive',
  'manual-review-required': 'Manual review',
  'not-tested': 'Not tested',
  'not-applicable': 'Not applicable'
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeLink(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function link(value: string, label = value): string {
  const href = safeLink(value);
  return href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : escapeHtml(label);
}

function list(values: string[], empty = 'None recorded'): string {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return unique.length ? `<ul>${unique.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : `<p>${empty}</p>`;
}

function count(summary: AuditSummary, predicate: (finding: Finding) => boolean): number {
  return summary.findings.filter(predicate).length;
}

function sourceLabel(value: string): string {
  const sources = value.split(',').map((source) => source.trim()).filter(Boolean);
  return [...new Map(sources.map((source) => [source.toLocaleLowerCase(), source])).values()].join(', ') || 'Not specified';
}

function findingRows(summary: AuditSummary, outputPath: string): string {
  if (!summary.findings.length) {
    return '<tr><td colspan="6" class="empty">No automated findings were recorded.</td></tr>';
  }
  return summary.findings.map((finding, index) => {
    const screenshots = finding.evidence
      .filter((item) => item.screenshot)
      .map((item) => {
        const screenshotPath = relative(dirname(outputPath), String(item.screenshot)).replaceAll('\\', '/');
        return `<li><a href="${escapeHtml(screenshotPath)}">${escapeHtml(item.viewport || 'Evidence screenshot')}</a></li>`;
      })
      .join('');
    const pages = finding.urls.map((url) => `<li>${link(url)}</li>`).join('');
    const selectors = finding.selectors.map((selector) => `<li><code>${escapeHtml(selector)}</code></li>`).join('');
    const id = findingId(finding, index);
    const impact = finding.classification === 'confirmed'
      ? { css: `severity-${finding.severity.toLowerCase()}`, label: finding.severity }
      : finding.classification === 'review'
        ? { css: 'badge-review', label: `Review priority: ${finding.severity}` }
        : finding.classification === 'blocker'
          ? { css: 'badge-blocker', label: 'Coverage blocked' }
          : { css: 'badge-manual', label: 'Human check' };
    return `<tr id="finding-${escapeHtml(id)}" data-search="${escapeHtml([
      finding.ruleId,
      finding.summary,
      finding.issue,
      finding.componentName,
      finding.componentLocation,
      finding.classification,
      finding.severity,
      ...finding.wcag,
      ...finding.urls
    ].filter(Boolean).join(' ').toLowerCase())}" data-classification="${escapeHtml(finding.classification)}" data-severity="${escapeHtml(finding.severity)}">
      <td><span class="finding-id">${escapeHtml(id)}</span><br><span class="muted">${escapeHtml(finding.ruleId)}</span></td>
      <td><span class="badge badge-${escapeHtml(finding.classification)}">${escapeHtml(finding.classification)}</span></td>
      <td><span class="badge ${escapeHtml(impact.css)}">${escapeHtml(impact.label)}</span></td>
      <td><strong>${escapeHtml(finding.summary)}</strong><p>${escapeHtml(finding.issue)}</p>
        <details><summary>Impact, testing and remediation</summary>
          <h3>Impact</h3><p>${escapeHtml(finding.impact)}</p>
          <h3>How to verify</h3><p>${escapeHtml(finding.testing)}</p>
          <h3>Recommended remediation</h3><p>${escapeHtml(finding.remediation)}</p>
          <h3>Component</h3><p>${escapeHtml(finding.componentName || finding.component)}${finding.componentLocation ? ` — ${escapeHtml(finding.componentLocation)}` : ''}</p>
          ${selectors ? `<h3>Selectors</h3><ul>${selectors}</ul>` : ''}
          ${screenshots ? `<h3>Evidence</h3><ul>${screenshots}</ul>` : ''}
        </details>
      </td>
      <td>${finding.wcag.length ? finding.wcag.map((criterion) => `<span class="criterion">${escapeHtml(criterion)}</span>`).join(' ') : '<span class="muted">Advisory</span>'}</td>
      <td><ul>${pages}</ul></td>
    </tr>`;
  }).join('');
}

function pageRows(summary: AuditSummary): string {
  const pages = new Map(summary.pages.map((page) => [page.url, page]));
  const skipped = new Map(summary.skippedUrls.map((item) => [item.url, item.reason]));
  const urls = [...new Set([...summary.requestedUrls, ...summary.auditedUrls, ...pages.keys(), ...skipped.keys()])];
  return urls.map((url) => {
    const page = pages.get(url);
    const viewports = page?.viewports.map((item) => item.viewport.name) ?? [];
    const errors = page?.viewports.flatMap((item) => item.errors) ?? [];
    const blockers = page?.viewports.flatMap((item) => item.interactionBlocker?.reason ? [item.interactionBlocker.reason] : []) ?? [];
    const status = skipped.has(url) ? 'Skipped' : page?.partial ? 'Partial' : page ? 'Audited' : 'Not started';
    return `<tr><td>${link(url)}</td><td><span class="status-dot status-${status.toLowerCase().replace(' ', '-')}"></span>${status}</td><td>${escapeHtml(viewports.join(', ') || '—')}</td><td>${list([skipped.get(url) || '', ...errors, ...blockers], 'None')}</td></tr>`;
  }).join('');
}

function coverageRows(summary: AuditSummary): string {
  return summary.coverage.flatMap((page) => page.viewports.flatMap((viewport) => viewport.assessments.map((assessment) => (
    `<tr><td>${link(page.url)}</td><td>${escapeHtml(viewport.viewport)}</td><td>${escapeHtml(assessment.area.replaceAll('-', ' '))}</td><td><span class="coverage coverage-${escapeHtml(assessment.status)}">${escapeHtml(STATUS_LABELS[assessment.status] || assessment.status)}</span></td><td>${escapeHtml(assessment.detail)}</td></tr>`
  )))).join('') || '<tr><td colspan="5" class="empty">No coverage results were recorded.</td></tr>';
}

function configuredJourneyRows(summary: AuditSummary): string {
  return summary.pages.flatMap((page) => page.viewports.flatMap((viewport) => (
    viewport.keyboard.journeys
      .filter((journey) => journey.source === 'configured')
      .map((journey) => `<tr><td>${link(page.url)}</td><td>${escapeHtml(viewport.viewport.name)}</td><td><strong>${escapeHtml(journey.title)}</strong><br><span class="muted">${escapeHtml(journey.id)}</span></td><td>${escapeHtml(journey.categories?.join(', ') || 'Not specified')}</td><td><span class="coverage coverage-${escapeHtml(journey.status)}">${escapeHtml(STATUS_LABELS[journey.status] || journey.status)}</span></td><td>${escapeHtml(`${journey.assertionCount ?? 0} assertion(s). ${journey.detail}`)}</td><td>${list(journey.steps, 'No steps completed.')}</td></tr>`)
  ))).join('') || '<tr><td colspan="7" class="empty">No configured task journeys were supplied for this audit.</td></tr>';
}

function manualRows(summary: AuditSummary): string {
  return summary.manualChecks.map((check) => `<tr><td><span class="finding-id">${escapeHtml(check.id)}</span></td><td><strong>${escapeHtml(check.title)}</strong></td><td>${check.wcag.map((criterion) => `<span class="criterion">${escapeHtml(criterion)}</span>`).join(' ') || 'Advisory'}</td><td>${escapeHtml(check.applicableTo)}</td><td>${escapeHtml(check.procedure)}</td><td>${escapeHtml(check.expectedEvidence ?? 'Record the tested scope, method, result, evidence, and reviewer verdict.')}</td><td><span class="coverage coverage-manual-review-required">Not tested</span></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No guided manual checks were generated.</td></tr>';
}

function criterionRows(summary: AuditSummary): string {
  const criteria = summary.criteria ?? [];
  return criteria.map((criterion) => {
    const evidence = [
      ...criterion.findingIds.map((id) => `<a href="#finding-${escapeHtml(id)}">${escapeHtml(id)}</a>`),
      ...criterion.automatedEvidence.map((item) => escapeHtml(item))
    ];
    const evidenceList = evidence.length ? `<ul>${evidence.map((item) => `<li>${item}</li>`).join('')}</ul>` : '<p>No automated evidence mapped.</p>';
    return `<tr><td><a href="${escapeHtml(criterion.understandingUrl)}" target="_blank" rel="noopener noreferrer"><span class="finding-id">${escapeHtml(criterion.criterion)}</span></a><br><span class="muted">${escapeHtml(criterion.title)}</span></td><td>${escapeHtml(criterion.level)}</td><td>${escapeHtml(criterion.scope === 'standard' ? 'AA conformance target' : 'AAA advisory')}</td><td><span class="coverage coverage-${escapeHtml(criterion.status)}">${escapeHtml(STATUS_LABELS[criterion.status] || criterion.status)}</span></td><td>${evidenceList}</td><td>${escapeHtml(criterion.detail)}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty">No criterion ledger was generated.</td></tr>';
}

function renderReport(summary: AuditSummary, outputPath: string): string {
  const confirmed = count(summary, (finding) => finding.classification === 'confirmed');
  const reviews = count(summary, (finding) => finding.classification === 'review');
  const blockers = count(summary, (finding) => finding.classification === 'blocker');
  const serious = count(summary, (finding) => finding.classification === 'confirmed' && (finding.severity === 'Critical' || finding.severity === 'Serious'));
  const generated = Number.isNaN(Date.parse(summary.generatedAt)) ? summary.generatedAt : new Date(summary.generatedAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' });
  const target = summary.landingPageUrl || summary.requestedUrls[0] || 'Not specified';
  const aaaAdvisory = summary.aaaAdvisory ?? summary.wcagLevel === 'AAA';
  const conformance = `WCAG 2.2 Level A and AA${aaaAdvisory ? ', with separate Level AAA advisory checks' : ''}`;
  const criteria = summary.criteria ?? [];
  const unresolvedCriteria = criteria.filter((criterion) => criterion.scope === 'standard' && ['manual-review-required', 'inconclusive'].includes(criterion.status)).length;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Accessibility audit report — ${escapeHtml(target)}</title>
  <style>
    :root{--blue:#1a73e8;--blue-dark:#174ea6;--ink:#202124;--muted:#5f6368;--line:#dadce0;--surface:#f8f9fa;--red:#c5221f;--amber:#b06000;--green:#137333;--shadow:0 1px 2px rgba(60,64,67,.12),0 1px 3px 1px rgba(60,64,67,.08)}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:var(--ink);background:#fff;font:15px/1.55 Arial,"Helvetica Neue",sans-serif}a{color:var(--blue-dark);text-underline-offset:2px}a:hover{text-decoration-thickness:2px}:focus-visible{outline:3px solid #8ab4f8;outline-offset:3px}.skip{position:absolute;left:16px;top:-60px;background:#fff;padding:12px 16px;border:2px solid var(--blue);z-index:10}.skip:focus{top:12px}.masthead{border-bottom:1px solid var(--line);background:#fff}.masthead-inner,.page{max-width:1440px;margin:auto;padding-left:32px;padding-right:32px}.masthead-inner{height:72px;display:flex;align-items:center;gap:14px}.mark{width:36px;height:36px;border-radius:9px;background:var(--blue);color:#fff;display:grid;place-items:center;font-weight:700}.brand{font-size:18px;font-weight:600}.brand span{display:block;color:var(--muted);font-size:12px;font-weight:400}.page{padding-top:38px;padding-bottom:64px}.eyebrow{color:var(--blue-dark);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{font-size:38px;line-height:1.15;letter-spacing:-.6px;margin:8px 0 12px}h2{font-size:24px;margin:42px 0 14px;letter-spacing:-.2px}h3{font-size:14px;margin:16px 0 4px}.lede{font-size:17px;color:var(--muted);max-width:850px}.meta{display:flex;flex-wrap:wrap;gap:10px 26px;color:var(--muted);margin:20px 0 28px}.meta strong{color:var(--ink)}.notice{border-left:4px solid var(--blue);background:#e8f0fe;border-radius:0 8px 8px 0;padding:15px 18px;margin:26px 0}.notice.warning{border-color:var(--amber);background:#fef7e0}.metrics{display:grid;grid-template-columns:repeat(6,minmax(135px,1fr));gap:14px;margin:28px 0}.metric{border:1px solid var(--line);border-radius:12px;padding:18px;background:#fff;box-shadow:var(--shadow)}.metric strong{display:block;font-size:28px;line-height:1.1;margin-top:6px}.metric span{color:var(--muted);font-size:13px}.metric.attention strong{color:var(--red)}nav{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line);margin:28px calc(50% - 50vw);padding:0 max(32px,calc((100vw - 1440px)/2 + 32px));display:flex;gap:22px;overflow:auto}nav a{display:block;padding:14px 0;color:var(--muted);font-weight:600;text-decoration:none;white-space:nowrap}nav a:hover,nav a:focus{color:var(--blue-dark);border-bottom:2px solid var(--blue)}.toolbar{display:flex;flex-wrap:wrap;align-items:end;gap:12px;margin:16px 0}.field{display:grid;gap:5px}.field label{font-size:12px;font-weight:700;color:var(--muted)}input,select{min-height:42px;border:1px solid #9aa0a6;border-radius:6px;background:#fff;color:var(--ink);padding:8px 11px;font:inherit}input{width:min(420px,80vw)}input:focus,select:focus{outline:3px solid #d2e3fc;border-color:var(--blue)}.result-count{margin-left:auto;color:var(--muted);padding-bottom:10px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px}table{width:100%;border-collapse:collapse;min-width:900px}caption{text-align:left;padding:14px 16px;background:var(--surface);font-weight:600}th{position:sticky;top:0;background:#f1f3f4;text-align:left;font-size:12px;letter-spacing:.03em;text-transform:uppercase;color:#3c4043}th,td{padding:13px 14px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}tbody tr:hover{background:#f8fbff}td p{margin:5px 0}td ul{margin:0;padding-left:18px}.finding-id{font-weight:700;white-space:nowrap}.muted{color:var(--muted);font-size:13px}.badge,.criterion,.coverage{display:inline-block;border-radius:999px;font-size:12px;font-weight:700;line-height:1.4;padding:3px 8px;white-space:nowrap}.badge-confirmed,.severity-critical,.severity-serious,.coverage-confirmed-failed,.coverage-failed{color:#a50e0e;background:#fce8e6}.badge-review,.severity-moderate,.coverage-tested-inconclusive,.coverage-manual-review-required,.coverage-not-tested,.coverage-inconclusive{color:#8a4b00;background:#fef7e0}.badge-blocker{color:#fff;background:var(--red)}.badge-manual,.severity-minor,.severity-advisory,.coverage-not-applicable{color:#3c4043;background:#f1f3f4}.coverage-confirmed-passed,.coverage-passed{color:#0d652d;background:#e6f4ea}.criterion{margin:1px;color:#174ea6;background:#e8f0fe}details{margin-top:9px}summary{cursor:pointer;color:var(--blue-dark);font-weight:600}code{white-space:normal;overflow-wrap:anywhere;background:#f1f3f4;border-radius:3px;padding:1px 4px}.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:#9aa0a6}.status-audited{background:var(--green)}.status-partial,.status-skipped{background:var(--amber)}.empty{text-align:center;color:var(--muted);padding:32px}.limitations{display:grid;grid-template-columns:1fr 1fr;gap:16px}.panel{border:1px solid var(--line);border-radius:10px;padding:18px;background:var(--surface)}.panel ul{margin:8px 0;padding-left:20px}.footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
    @media(max-width:900px){.metrics{grid-template-columns:repeat(2,1fr)}.limitations{grid-template-columns:1fr}.masthead-inner,.page{padding-left:18px;padding-right:18px}h1{font-size:31px}.result-count{width:100%;margin-left:0}}
    @media print{nav,.toolbar,.skip{display:none}.page{max-width:none;padding:20px}.metrics{grid-template-columns:repeat(3,1fr)}.metric{box-shadow:none}details{display:block}details>summary{display:none}.table-wrap{overflow:visible}table{min-width:0;font-size:10px}th{position:static}a{color:inherit;text-decoration:none}}
  </style>
</head>
<body>
  <a class="skip" href="#main">Skip to report</a>
  <header class="masthead"><div class="masthead-inner"><div class="mark" aria-hidden="true">CA</div><div class="brand">CarlasHub Accessibility Audit<span>WCAG 2.2 evidence report</span></div></div></header>
  <main id="main" class="page">
    <p class="eyebrow">Audit status · ${escapeHtml(summary.status)}</p>
    <h1>Accessibility audit report</h1>
    <p class="lede">A structured review of ${link(target)} against ${escapeHtml(conformance)}, combining automated browser evidence with a defined manual-assessment plan.</p>
    <div class="meta"><span><strong>Generated:</strong> ${escapeHtml(generated)} UTC</span><span><strong>Auditor:</strong> ${escapeHtml(summary.auditor)}</span><span><strong>Source:</strong> ${escapeHtml(sourceLabel(summary.source))}</span></div>
    <div class="notice warning"><strong>Conformance decision: ${escapeHtml(summary.conformanceDecision === 'not-determined' || !summary.conformanceDecision ? 'Not determined' : summary.conformanceDecision)}.</strong> Automated evidence cannot certify WCAG conformance. A qualified human assessment and sign-off remain mandatory; failures require remediation and unresolved outcomes are not passes.</div>
    <section class="metrics" aria-label="Audit summary">
      <div class="metric"><span>Pages audited</span><strong>${summary.auditedUrls.length}</strong></div>
      <div class="metric"><span>Report items</span><strong>${summary.findings.length}</strong></div>
      <div class="metric attention"><span>Confirmed</span><strong>${confirmed}</strong></div>
      <div class="metric attention"><span>Confirmed serious / critical</span><strong>${serious}</strong></div>
      <div class="metric"><span>Needs review</span><strong>${reviews}</strong></div>
      <div class="metric"><span>Unresolved AA criteria</span><strong>${unresolvedCriteria}</strong></div>
    </section>
    ${blockers ? `<div class="notice"><strong>${blockers} audit blocker${blockers === 1 ? '' : 's'}:</strong> review the findings before treating coverage as complete.</div>` : ''}
    <nav aria-label="Report sections"><a href="#findings">Findings</a><a href="#criteria">WCAG criteria</a><a href="#pages">Pages</a><a href="#coverage">Coverage</a><a href="#journeys">Task journeys</a><a href="#manual">Manual checks</a><a href="#method">Method and limitations</a></nav>

    <section id="findings" aria-labelledby="findings-title"><h2 id="findings-title">Findings</h2><p class="lede">Confirmed rows are evidence-backed barriers and use impact severity. Review rows are candidates that require human validation; their label is review priority, not a confirmed impact rating. Expand a row for verification steps, remediation and linked evidence.</p>
      <div class="toolbar"><div class="field"><label for="finding-search">Search findings</label><input id="finding-search" type="search" placeholder="Rule, issue, page or WCAG criterion"></div><div class="field"><label for="classification-filter">Classification</label><select id="classification-filter"><option value="">All classifications</option><option value="confirmed">Confirmed</option><option value="review">Review</option><option value="blocker">Blocker</option><option value="manual">Manual</option></select></div><div class="field"><label for="severity-filter">Severity</label><select id="severity-filter"><option value="">All severities</option><option>Critical</option><option>Serious</option><option>Moderate</option><option>Minor</option><option>Advisory</option></select></div><div id="result-count" class="result-count" aria-live="polite"></div></div>
      <div class="table-wrap"><table><caption>Findings and evidence requiring action or validation</caption><thead><tr><th scope="col">ID / rule</th><th scope="col">Class</th><th scope="col">Impact / priority</th><th scope="col">Finding</th><th scope="col">WCAG</th><th scope="col">Pages</th></tr></thead><tbody id="finding-rows">${findingRows(summary, outputPath)}</tbody></table></div>
    </section>

    <section id="criteria" aria-labelledby="criteria-title"><h2 id="criteria-title">WCAG 2.2 criterion ledger</h2><p class="lede">Every success criterion is accounted for. The AA conformance target covers Levels A and AA; Level AAA appears only as optional advisory scope. ${unresolvedCriteria} criterion outcome${unresolvedCriteria === 1 ? '' : 's'} still require a human decision or more evidence.</p><div class="table-wrap"><table><caption>Criterion-by-criterion status and evidence</caption><thead><tr><th scope="col">Criterion</th><th scope="col">Level</th><th scope="col">Scope</th><th scope="col">Status</th><th scope="col">Evidence</th><th scope="col">Decision note</th></tr></thead><tbody>${criterionRows(summary)}</tbody></table></div></section>

    <section id="pages" aria-labelledby="pages-title"><h2 id="pages-title">Page inventory</h2><div class="table-wrap"><table><caption>Requested targets and audit status</caption><thead><tr><th scope="col">URL</th><th scope="col">Status</th><th scope="col">Viewports</th><th scope="col">Notes</th></tr></thead><tbody>${pageRows(summary)}</tbody></table></div></section>
    <section id="coverage" aria-labelledby="coverage-title"><h2 id="coverage-title">Test execution coverage</h2><p class="lede">This records which checks ran and the evidence they produced; it is not a conformance percentage. “Manual review”, “inconclusive” and “not tested” are unresolved outcomes—not passes.</p><div class="table-wrap"><table><caption>Execution evidence by page, viewport and audit area</caption><thead><tr><th scope="col">Page</th><th scope="col">Viewport</th><th scope="col">Area</th><th scope="col">Outcome</th><th scope="col">Evidence note</th></tr></thead><tbody>${coverageRows(summary)}</tbody></table></div></section>
    <section id="journeys" aria-labelledby="journeys-title"><h2 id="journeys-title">Configured task journeys</h2><p class="lede">Repeatable keyboard, form, interaction and live-region assertions supplied for this site. A DOM live-region result does not prove the quality of a screen-reader announcement.</p><div class="table-wrap"><table><caption>Site-specific task journey evidence</caption><thead><tr><th scope="col">Page</th><th scope="col">Viewport</th><th scope="col">Journey</th><th scope="col">Areas</th><th scope="col">Outcome</th><th scope="col">Result</th><th scope="col">Completed steps</th></tr></thead><tbody>${configuredJourneyRows(summary)}</tbody></table></div></section>
    <section id="manual" aria-labelledby="manual-title"><h2 id="manual-title">WCAG 2.2 A/AA human verification</h2><p class="lede">All 55 Level A and AA success criteria have a criterion-specific procedure and evidence prompt. Record an explicit verdict for each applicable criterion; “not tested” is unresolved, not a pass.</p><div class="table-wrap"><table><caption>Criterion-specific human assessment plan</caption><thead><tr><th scope="col">ID</th><th scope="col">Check</th><th scope="col">WCAG</th><th scope="col">Applies to</th><th scope="col">Procedure</th><th scope="col">Evidence to record</th><th scope="col">Status</th></tr></thead><tbody>${manualRows(summary)}</tbody></table></div></section>
    <section id="method" aria-labelledby="method-title"><h2 id="method-title">Method and limitations</h2><div class="limitations"><div class="panel"><h3>Audit scope</h3><ul><li>${escapeHtml(conformance)}</li>${summary.qualityContract ? `<li>Audit Quality Contract ${escapeHtml(summary.qualityContract.version)}; ${summary.qualityContract.criterionCount} Level A/AA criteria; ${escapeHtml(summary.qualityContract.findingPolicy)} finding policy</li>` : ''}<li>${summary.requestedUrls.length} requested URL${summary.requestedUrls.length === 1 ? '' : 's'}; ${summary.auditedUrls.length} audited</li><li>${summary.pages.flatMap((page) => page.viewports).length} page-and-viewport runs</li><li>Automated axe rules plus DOM, generic and configured keyboard journeys, 200% root-text resizing, text spacing, responsive/reflow, disclosure, tab and link checks</li><li>Native screen-reader transcripts, when supplied, are supporting evidence and do not replace expert assessment</li></ul></div><div class="panel"><h3>Known limitations</h3>${list([...summary.limitations, `${summary.manualChecks.length} guided manual check(s) require human completion.`, 'A qualified human must complete applicable checks and make the final conformance decision.'], 'No limitations recorded.')}</div></div></section>
    <footer class="footer">Generated by CarlasHub Accessibility Audit. Keep this file beside the <code>screenshots</code> folder so evidence links continue to work.</footer>
  </main>
  <script>
    (() => {
      const search = document.getElementById('finding-search');
      const classification = document.getElementById('classification-filter');
      const severity = document.getElementById('severity-filter');
      const rows = [...document.querySelectorAll('#finding-rows tr[data-search]')];
      const count = document.getElementById('result-count');
      const filter = () => {
        const query = search.value.trim().toLowerCase();
        let visible = 0;
        for (const row of rows) {
          const show = (!query || row.dataset.search.includes(query)) && (!classification.value || row.dataset.classification === classification.value) && (!severity.value || row.dataset.severity === severity.value);
          row.hidden = !show;
          if (show) visible += 1;
        }
        count.textContent = visible + ' of ' + rows.length + ' findings';
      };
      search.addEventListener('input', filter);
      classification.addEventListener('change', filter);
      severity.addEventListener('change', filter);
      filter();
    })();
  </script>
</body>
</html>`;
}

export async function writeHtmlReport(summary: AuditSummary, outputPath: string): Promise<string> {
  await writeFile(outputPath, `${renderReport(summary, outputPath)}\n`, 'utf8');
  return outputPath;
}
