import { writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import type { AuditSummary, Finding } from '../types.js';
import { assertCanonicalAuditSummary } from '../audit/canonical-validation.js';
import { AUDIT_SCOPE_LABEL } from '../scope.js';
import { buildExecutiveSummary } from './executive-summary.js';
import {
  buildTopActions,
  findingActionGuidance,
  findingClassificationLabel,
  findingPriorityLabel
} from './finding-actions.js';
import {
  comparisonCategories,
  comparisonHeadline,
  comparisonPriorityLabel,
  RESOLUTION_SCOPE_NOTE
} from './comparison-presentation.js';
import { findingId } from './finding-id.js';

export { findingActionGuidance } from './finding-actions.js';

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

export function findingTicketText(finding: Finding, index: number): string {
  const id = findingId(finding, index);
  const standards = [...new Set([...finding.wcag, ...(finding.standards ?? [])])];
  const component = [finding.componentName || finding.component, finding.componentLocation]
    .filter(Boolean)
    .join(' — ');
  const lines = [
    `[${id}] ${finding.summary}`,
    '',
    `Evidence type: ${findingClassificationLabel(finding.classification)}`,
    `Impact / priority: ${findingPriorityLabel(finding)}`,
    `WCAG / standard: ${standards.join(', ') || 'Advisory'}`,
    `Affected viewports: ${finding.viewports.join(', ') || 'Not specified'}`,
    `Component / location: ${component || 'Not specified'}`,
    `Suggested owner: ${finding.assignment}`,
    `Estimated effort: ${finding.effort}`,
    `Translation review: ${finding.translationRequired}`,
    '',
    'Affected pages:',
    ...finding.urls.map((url) => `- ${url}`),
    '',
    'Issue:',
    finding.issue,
    '',
    'Why this matters:',
    finding.impact,
    '',
    'How this was checked:',
    finding.testing,
    '',
    'Recommended fix:',
    finding.remediation,
    '',
    'Next step:',
    findingActionGuidance(finding.classification)
  ];
  if (finding.selectors.length) {
    lines.push('', 'Technical selectors:', ...finding.selectors.map((selector) => `- ${selector}`));
  }
  return lines.join('\n');
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
    const ticket = findingTicketText(finding, index);
    const impact = finding.classification === 'confirmed'
      ? { css: `severity-${finding.severity.toLowerCase()}`, label: findingPriorityLabel(finding) }
      : finding.classification === 'review'
        ? { css: 'badge-review', label: findingPriorityLabel(finding) }
        : finding.classification === 'blocker'
          ? { css: 'badge-blocker', label: findingPriorityLabel(finding) }
          : { css: 'badge-manual', label: findingPriorityLabel(finding) };
    return `<tr id="finding-${escapeHtml(id)}" data-search="${escapeHtml([
      finding.ruleId,
      finding.summary,
      finding.issue,
      finding.componentName,
      finding.componentLocation,
      finding.classification,
      finding.severity,
      ...finding.wcag,
      ...(finding.standards ?? []),
      ...finding.urls
    ].filter(Boolean).join(' ').toLowerCase())}" data-classification="${escapeHtml(finding.classification)}" data-severity="${escapeHtml(finding.severity)}">
      <td><span class="finding-id">${escapeHtml(id)}</span><br><span class="muted">${escapeHtml(finding.ruleId)}</span></td>
      <td><span class="badge badge-${escapeHtml(finding.classification)}">${escapeHtml(finding.classification)}</span></td>
      <td><span class="badge ${escapeHtml(impact.css)}">${escapeHtml(impact.label)}</span></td>
      <td><strong>${escapeHtml(finding.summary)}</strong><p>${escapeHtml(finding.issue)}</p>
        <details><summary>Understand and resolve this finding</summary>
          <p class="finding-guidance"><strong>What to do with this result:</strong> ${escapeHtml(findingActionGuidance(finding.classification))}</p>
          <h3>Why this matters</h3><p>${escapeHtml(finding.impact)}</p>
          <h3>How this was checked</h3><p>${escapeHtml(finding.testing)}</p>
          <h3>How to fix it</h3><p>${escapeHtml(finding.remediation)}</p>
          <h3>Affected component</h3><p>${escapeHtml(finding.componentName || finding.component)}${finding.componentLocation ? ` — ${escapeHtml(finding.componentLocation)}` : ''}</p>
          ${selectors ? `<h3>Technical selectors</h3><ul>${selectors}</ul>` : ''}
          ${screenshots ? `<h3>Evidence screenshots</h3><ul>${screenshots}</ul>` : ''}
          <div class="finding-actions"><button type="button" class="copy-ticket" data-ticket="${escapeHtml(ticket)}" data-finding-id="${escapeHtml(id)}" aria-describedby="copy-status-${escapeHtml(id)}">Copy ticket</button><span id="copy-status-${escapeHtml(id)}" class="copy-status" role="status" aria-live="polite"></span></div>
        </details>
      </td>
      <td>${finding.standards?.length
        ? finding.standards.map((standard) => `<span class="criterion">${escapeHtml(standard)}</span>`).join(' ')
        : finding.wcag.length
          ? finding.wcag.map((criterion) => `<span class="criterion">${escapeHtml(criterion)}</span>`).join(' ')
          : '<span class="muted">Advisory</span>'}</td>
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

function comparisonSection(summary: AuditSummary): string {
  const comparison = summary.comparison;
  if (!comparison) return '';
  const categories = comparisonCategories(comparison);
  const rows = categories.flatMap((category) => category.records.map((record) => {
    const urls = record.urls.length
      ? `<ul>${record.urls.map((url) => `<li>${link(url)}</li>`).join('')}</ul>`
      : '<p>Not recorded</p>';
    return `<tr><td><span class="badge comparison-${escapeHtml(category.key)}">${escapeHtml(category.shortLabel)}</span><br><span class="muted">${escapeHtml(category.explanation)}</span></td><td><span class="finding-id">${escapeHtml(record.id ?? 'Not recorded')}</span><br><code>${escapeHtml(record.fingerprint)}</code></td><td>${escapeHtml(findingClassificationLabel(record.classification))}</td><td>${escapeHtml(comparisonPriorityLabel(record))}</td><td>${escapeHtml(record.summary)}</td><td>${urls}</td><td>${list(record.viewports, 'Not recorded')}</td></tr>`;
  })).join('') || '<tr><td colspan="7" class="empty">No baseline or current findings were available to compare.</td></tr>';
  const baselineDateIsValid = comparison.baselineGeneratedAt && !Number.isNaN(Date.parse(comparison.baselineGeneratedAt));
  const generatedAt = baselineDateIsValid
    ? new Date(comparison.baselineGeneratedAt!).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' })
    : comparison.baselineGeneratedAt ?? 'Not recorded';
  const limitationItems = comparison.limitations.length
    ? `<ul>${comparison.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join('')}</ul>`
    : '<p>No additional comparison limitations were recorded.</p>';
  return `<section id="comparison" aria-labelledby="comparison-title">
      <h2 id="comparison-title">Baseline comparison</h2>
      <p class="lede"><strong>${escapeHtml(comparisonHeadline(comparison))}</strong></p>
      <div class="panel comparison-meta"><p><strong>Baseline:</strong> ${escapeHtml(comparison.baselineSource)}</p><p><strong>Baseline generated:</strong> ${escapeHtml(generatedAt)}${baselineDateIsValid ? ' UTC' : ''}</p><p><strong>Coverage:</strong> ${escapeHtml(comparison.coverage === 'complete' ? 'Complete equivalent scope' : 'Partial equivalent scope')}</p></div>
      <div class="metrics comparison-metrics" aria-label="Baseline comparison summary">${categories.map((category) => `<div class="metric"><span>${escapeHtml(category.label)}</span><strong>${category.records.length}</strong></div>`).join('')}</div>
      <div class="notice warning"><strong>Interpret resolved findings carefully.</strong> ${escapeHtml(RESOLUTION_SCOPE_NOTE)}</div>
      <div class="table-wrap"><table><caption>Finding changes compared with the selected baseline</caption><thead><tr><th scope="col">Change</th><th scope="col">Finding / match key</th><th scope="col">Class</th><th scope="col">Impact / priority</th><th scope="col">Finding</th><th scope="col">Affected URLs</th><th scope="col">Viewports</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="panel comparison-limitations"><h3>Comparison limitations</h3>${limitationItems}</div>
    </section>`;
}

function historySection(summary: AuditSummary): string {
  const history = summary.history;
  if (!history) return '';
  const rows = history.points.map((point, index) => {
    const generatedAt = Number.isNaN(Date.parse(point.generatedAt))
      ? point.generatedAt
      : `${new Date(point.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
    const delta = point.comparisonToPrevious;
    const change = !delta
      ? 'Starting point'
      : `${delta.coverage === 'complete' ? 'Complete scope' : 'Partial scope'}: ${delta.newCount} new, ${delta.unchangedCount} unchanged, ${delta.resolvedCount} resolved${delta.coverage === 'partial' ? `, ${delta.indeterminateCurrentCount} indeterminate, ${delta.unobservedPreviousCount} previously observed but not re-observed` : ''}`;
    return `<tr><th scope="row">${escapeHtml(point.source)}${index === history.points.length - 1 ? '<br><span class="badge comparison-unchanged">Latest</span>' : ''}</th><td>${escapeHtml(generatedAt)}</td><td>${escapeHtml(point.status)}</td><td>${point.auditedPageCount} / ${point.requestedPageCount}</td><td>${point.findingCount}</td><td>${point.confirmedCount}</td><td>${point.reviewCount}</td><td>${point.blockerCount}</td><td>${point.manualCount}</td><td>${point.criticalConfirmedCount}</td><td>${point.seriousConfirmedCount}</td><td>${escapeHtml(change)}</td></tr>`;
  }).join('');
  const limitations = history.limitations.length
    ? `<ul>${history.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join('')}</ul>`
    : '<p>No additional history limitations were recorded.</p>';
  return `<section id="history" aria-labelledby="history-title">
      <h2 id="history-title">History and trends</h2>
      <p class="lede">Chronological audit snapshots with each change measured against the immediately preceding snapshot. Resolution counts are only definitive when the compared audit scopes are equivalent.</p>
      <div class="table-wrap"><table><caption>Audit history from oldest to latest</caption><thead><tr><th scope="col">Audit</th><th scope="col">Generated</th><th scope="col">Status</th><th scope="col">Pages audited / requested</th><th scope="col">Findings</th><th scope="col">Confirmed</th><th scope="col">Review</th><th scope="col">Blockers</th><th scope="col">Manual</th><th scope="col">Critical confirmed</th><th scope="col">Serious confirmed</th><th scope="col">Change from previous</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="panel comparison-limitations"><h3>History limitations</h3>${limitations}</div>
    </section>`;
}

function renderReport(summary: AuditSummary, outputPath: string): string {
  const executiveSummary = buildExecutiveSummary(summary);
  const topActions = buildTopActions(summary);
  const topActionItems = topActions.map((action) => {
    const pageLabel = `${action.affectedPageCount} affected page${action.affectedPageCount === 1 ? '' : 's'}`;
    return `<li class="top-action panel">
      <div class="top-action-badges"><span class="badge badge-${escapeHtml(action.finding.classification)}" aria-label="Evidence type: ${escapeHtml(action.classificationLabel)}">${escapeHtml(action.conciseClassificationLabel)}</span><span class="badge ${action.finding.classification === 'confirmed' ? `severity-${escapeHtml(action.finding.severity.toLowerCase())}` : `badge-${escapeHtml(action.finding.classification)}`}">${escapeHtml(action.priorityLabel)}</span></div>
      <h3><a href="#finding-${escapeHtml(action.id)}"><span class="finding-id">${escapeHtml(action.id)}</span> ${escapeHtml(action.finding.summary)}</a></h3>
      <p>${escapeHtml(action.nextStep)}</p>
      <p class="top-action-meta"><strong>Owner:</strong> ${escapeHtml(action.finding.assignment)} <span aria-hidden="true">·</span> <strong>Effort:</strong> ${escapeHtml(action.finding.effort)} <span aria-hidden="true">·</span> ${escapeHtml(pageLabel)}</p>
    </li>`;
  }).join('');
  const topActionContent = topActionItems
    ? `<ol class="top-action-list">${topActionItems}</ol>${summary.findings.length > topActions.length ? `<p class="top-action-count">Showing ${topActions.length} of ${summary.findings.length} report items. <a href="#findings">Review all findings</a>.</p>` : ''}`
    : `<div class="panel"><p><strong>No report items require triage.</strong> ${escapeHtml(executiveSummary.nextStep)}</p></div>`;
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
  const comparison = comparisonSection(summary);
  const history = historySection(summary);
  const comparisonSummaryLink = summary.comparison ? '<a href="#comparison">Review baseline changes</a>' : '';
  const comparisonNavLink = summary.comparison ? '<a href="#comparison">Baseline comparison</a>' : '';
  const historySummaryLink = summary.history ? '<a href="#history">Review audit trends</a>' : '';
  const historyNavLink = summary.history ? '<a href="#history">History and trends</a>' : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Accessibility audit report — ${escapeHtml(target)}</title>
  <style>
    :root{--blue:#1a73e8;--blue-dark:#174ea6;--ink:#202124;--muted:#5f6368;--line:#dadce0;--surface:#f8f9fa;--red:#c5221f;--amber:#b06000;--green:#137333;--shadow:0 1px 2px rgba(60,64,67,.12),0 1px 3px 1px rgba(60,64,67,.08)}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:var(--ink);background:#fff;font:15px/1.55 Arial,"Helvetica Neue",sans-serif}a{color:var(--blue-dark);text-underline-offset:2px}a:hover{text-decoration-thickness:2px}:focus-visible{outline:3px solid #8ab4f8;outline-offset:3px}.skip{position:absolute;left:16px;top:-60px;background:#fff;padding:12px 16px;border:2px solid var(--blue);z-index:10}.skip:focus{top:12px}.masthead{border-bottom:1px solid var(--line);background:#fff}.masthead-inner,.page{max-width:1440px;margin:auto;padding-left:32px;padding-right:32px}.masthead-inner{height:72px;display:flex;align-items:center;gap:14px}.mark{width:36px;height:36px;border-radius:9px;background:var(--blue);color:#fff;display:grid;place-items:center;font-weight:700}.brand{font-size:18px;font-weight:600}.brand span{display:block;color:var(--muted);font-size:12px;font-weight:400}.page{padding-top:38px;padding-bottom:64px}.eyebrow{color:var(--blue-dark);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{font-size:38px;line-height:1.15;letter-spacing:-.6px;margin:8px 0 12px}h2{font-size:24px;margin:42px 0 14px;letter-spacing:-.2px}h3{font-size:14px;margin:16px 0 4px}.lede{font-size:17px;color:var(--muted);max-width:850px}.meta{display:flex;flex-wrap:wrap;gap:10px 26px;color:var(--muted);margin:20px 0 24px}.meta strong{color:var(--ink)}.notice{border-left:4px solid var(--blue);background:#e8f0fe;border-radius:0 8px 8px 0;padding:15px 18px;margin:26px 0}.notice.warning{border-color:var(--amber);background:#fef7e0}.metrics{display:grid;grid-template-columns:repeat(6,minmax(135px,1fr));gap:14px;margin:22px 0}.comparison-metrics{grid-template-columns:repeat(5,minmax(135px,1fr))}.metric{border:1px solid var(--line);border-radius:12px;padding:18px;background:#fff;box-shadow:var(--shadow)}.metric strong{display:block;font-size:28px;line-height:1.1;margin-top:6px}.metric span{color:var(--muted);font-size:13px}.metric.attention strong{color:var(--red)}.executive-summary{border:1px solid #aecbfa;border-radius:14px;background:#f8fbff;padding:22px 24px;margin:24px 0;box-shadow:var(--shadow)}.executive-summary h2{font-size:20px;margin:0}.executive-headline{font-size:19px;max-width:950px;margin:10px 0 18px}.executive-panels{display:grid;grid-template-columns:1fr 1fr;gap:16px}.executive-panels .panel{background:#fff}.executive-panels .panel h3{margin-top:0}.summary-links{display:flex;flex-wrap:wrap;gap:10px 22px;margin-top:18px;padding-top:15px;border-top:1px solid #d2e3fc}.summary-links a{font-weight:700}.top-actions{margin:30px 0}.top-actions h2{margin-bottom:4px}.top-action-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;list-style:none;margin:16px 0 0;padding:0}.top-action{background:#fff;box-shadow:var(--shadow)}.top-action h3{font-size:16px;line-height:1.35;margin:12px 0 8px}.top-action h3 a{text-decoration-thickness:1px}.top-action p{margin:8px 0}.top-action-badges{display:flex;flex-wrap:wrap;gap:6px}.top-action-meta{color:var(--muted);font-size:13px}.top-action-count{color:var(--muted)}nav{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line);margin:28px calc(50% - 50vw);padding:0 max(32px,calc((100vw - 1440px)/2 + 32px));display:flex;gap:22px;overflow:auto}nav a{display:block;padding:14px 0;color:var(--muted);font-weight:600;text-decoration:none;white-space:nowrap}nav a:hover,nav a:focus{color:var(--blue-dark);border-bottom:2px solid var(--blue)}.toolbar{display:flex;flex-wrap:wrap;align-items:end;gap:12px;margin:16px 0}.field{display:grid;gap:5px}.field label{font-size:12px;font-weight:700;color:var(--muted)}input,select{min-height:42px;border:1px solid #9aa0a6;border-radius:6px;background:#fff;color:var(--ink);padding:8px 11px;font:inherit}input{width:min(420px,80vw)}input:focus,select:focus{outline:3px solid #d2e3fc;border-color:var(--blue)}.result-count{margin-left:auto;color:var(--muted);padding-bottom:10px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px}table{width:100%;border-collapse:collapse;min-width:900px}caption{text-align:left;padding:14px 16px;background:var(--surface);font-weight:600}th{position:sticky;top:0;background:#f1f3f4;text-align:left;font-size:12px;letter-spacing:.03em;text-transform:uppercase;color:#3c4043}th,td{padding:13px 14px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}tbody tr:hover{background:#f8fbff}td p{margin:5px 0}td ul{margin:0;padding-left:18px}.finding-id{font-weight:700;white-space:nowrap}.finding-guidance{border-left:3px solid var(--blue);background:#f8fbff;padding:10px 12px;margin:12px 0}.finding-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:16px}.copy-ticket{min-height:40px;border:1px solid var(--blue-dark);border-radius:6px;background:#fff;color:var(--blue-dark);padding:7px 12px;font:inherit;font-weight:700;cursor:pointer}.copy-ticket:hover{background:#e8f0fe}.copy-ticket:disabled{cursor:wait;opacity:.7}.copy-status{color:var(--muted);font-size:13px}.muted{color:var(--muted);font-size:13px}.badge,.criterion,.coverage{display:inline-block;border-radius:999px;font-size:12px;font-weight:700;line-height:1.4;padding:3px 8px;white-space:nowrap}.badge-confirmed,.severity-critical,.severity-serious,.coverage-confirmed-failed,.coverage-failed,.comparison-new{color:#a50e0e;background:#fce8e6}.badge-review,.severity-moderate,.coverage-tested-inconclusive,.coverage-manual-review-required,.coverage-not-tested,.coverage-inconclusive,.comparison-indeterminate-current{color:#8a4b00;background:#fef7e0}.badge-blocker{color:#fff;background:var(--red)}.badge-manual,.severity-minor,.severity-advisory,.coverage-not-applicable,.comparison-unobserved-baseline{color:#3c4043;background:#f1f3f4}.coverage-confirmed-passed,.coverage-passed,.comparison-resolved{color:#0d652d;background:#e6f4ea}.comparison-unchanged{color:#174ea6;background:#e8f0fe}.comparison-meta{display:flex;flex-wrap:wrap;gap:8px 28px}.comparison-meta p{margin:0}.comparison-limitations{margin-top:18px}.comparison-limitations h3{margin-top:0}.criterion{margin:1px;color:#174ea6;background:#e8f0fe}details{margin-top:9px}summary{cursor:pointer;color:var(--blue-dark);font-weight:600}code{white-space:normal;overflow-wrap:anywhere;background:#f1f3f4;border-radius:3px;padding:1px 4px}.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:#9aa0a6}.status-audited{background:var(--green)}.status-partial,.status-skipped{background:var(--amber)}.empty{text-align:center;color:var(--muted);padding:32px}.limitations{display:grid;grid-template-columns:1fr 1fr;gap:16px}.panel{border:1px solid var(--line);border-radius:10px;padding:18px;background:var(--surface)}.panel ul{margin:8px 0;padding-left:20px}.footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
    @media(max-width:900px){.metrics{grid-template-columns:repeat(2,1fr)}.limitations,.executive-panels,.top-action-list{grid-template-columns:1fr}.masthead-inner,.page{padding-left:18px;padding-right:18px}h1{font-size:31px}.result-count{width:100%;margin-left:0}}
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
    <div class="meta"><span><strong>Generated:</strong> ${escapeHtml(generated)} UTC</span><span><strong>Auditor:</strong> ${escapeHtml(summary.auditor)}</span><span><strong>Source:</strong> ${escapeHtml(sourceLabel(summary.source))}</span>${summary.browserEngine ? `<span><strong>Browser:</strong> ${escapeHtml(summary.browserEngine)}</span>` : ''}</div>
    <section id="executive-summary" class="executive-summary" aria-labelledby="executive-summary-title">
      <h2 id="executive-summary-title">Executive summary</h2>
      <p class="executive-headline"><strong>${escapeHtml(executiveSummary.headline)}</strong></p>
      <div class="executive-panels">
        <div class="panel"><h3>Current position</h3><p>${escapeHtml(executiveSummary.currentPosition)}</p></div>
        <div class="panel"><h3>Recommended next step</h3><p>${escapeHtml(executiveSummary.nextStep)}</p></div>
      </div>
      <div class="summary-links" aria-label="Start reviewing this report"><a href="#top-actions">Start with top actions</a>${comparisonSummaryLink}${historySummaryLink}<a href="#findings">Review findings</a><a href="#criteria">Check WCAG criteria</a><a href="#pages">Inspect page coverage</a></div>
    </section>
    <section id="top-actions" class="top-actions" aria-labelledby="top-actions-title">
      <h2 id="top-actions-title">Top actions</h2>
      <p class="lede">Ordered by restoring audit coverage, confirmed user impact, human validation, then manual evidence.</p>
      ${topActionContent}
    </section>
    ${blockers ? `<div class="notice"><strong>${blockers} audit blocker${blockers === 1 ? '' : 's'}:</strong> review the findings before treating coverage as complete.</div>` : ''}
    <section class="metrics" aria-label="Audit summary">
      <div class="metric"><span>Pages audited</span><strong>${summary.auditedUrls.length}</strong></div>
      <div class="metric"><span>Report items</span><strong>${summary.findings.length}</strong></div>
      <div class="metric attention"><span>Confirmed</span><strong>${confirmed}</strong></div>
      <div class="metric attention"><span>Confirmed serious / critical</span><strong>${serious}</strong></div>
      <div class="metric"><span>Needs review</span><strong>${reviews}</strong></div>
      <div class="metric"><span>Unresolved AA criteria</span><strong>${unresolvedCriteria}</strong></div>
    </section>
    <div class="notice warning"><strong>Conformance decision: ${escapeHtml(summary.conformanceDecision === 'not-determined' || !summary.conformanceDecision ? 'Not determined' : summary.conformanceDecision)}.</strong> Automated evidence cannot certify WCAG conformance. A qualified human assessment and sign-off remain mandatory; failures require remediation and unresolved outcomes are not passes.</div>
    <nav aria-label="Report sections"><a href="#top-actions">Top actions</a>${comparisonNavLink}${historyNavLink}<a href="#findings">Findings</a><a href="#criteria">WCAG criteria</a><a href="#pages">Pages</a><a href="#coverage">Coverage</a><a href="#journeys">Task journeys</a><a href="#manual">Manual checks</a><a href="#method">Method and limitations</a></nav>

    ${comparison}
    ${history}

    <section id="findings" aria-labelledby="findings-title"><h2 id="findings-title">Findings</h2><p class="lede">Confirmed rows are reproduced barriers to assign and retest. Review rows need a documented human decision before they become failures. Blockers mean the affected scope must be restored and rerun; manual rows require a person to complete the procedure. Ratings on non-confirmed rows are review priority, not confirmed impact severity. Expand a row for plain-language impact, assessment steps, remediation and linked evidence.</p>
      <div class="toolbar"><div class="field"><label for="finding-search">Search findings</label><input id="finding-search" type="search" placeholder="Rule, issue, page or WCAG criterion"></div><div class="field"><label for="classification-filter">Classification</label><select id="classification-filter"><option value="">All classifications</option><option value="confirmed">Confirmed</option><option value="review">Review</option><option value="blocker">Blocker</option><option value="manual">Manual</option></select></div><div class="field"><label for="severity-filter">Severity</label><select id="severity-filter"><option value="">All severities</option><option>Critical</option><option>Serious</option><option>Moderate</option><option>Minor</option><option>Advisory</option></select></div><div id="result-count" class="result-count" aria-live="polite"></div></div>
      <div class="table-wrap"><table><caption>Findings and evidence requiring action or validation</caption><thead><tr><th scope="col">ID / rule</th><th scope="col">Class</th><th scope="col">Impact / priority</th><th scope="col">Finding</th><th scope="col">Standards / rule source</th><th scope="col">Pages</th></tr></thead><tbody id="finding-rows">${findingRows(summary, outputPath)}</tbody></table></div>
    </section>

    <section id="criteria" aria-labelledby="criteria-title"><h2 id="criteria-title">WCAG 2.2 criterion ledger</h2><p class="lede">Every success criterion is accounted for. The AA conformance target covers Levels A and AA; Level AAA appears only as optional advisory scope. ${unresolvedCriteria} criterion outcome${unresolvedCriteria === 1 ? '' : 's'} still require a human decision or more evidence.</p><div class="table-wrap"><table><caption>Criterion-by-criterion status and evidence</caption><thead><tr><th scope="col">Criterion</th><th scope="col">Level</th><th scope="col">Scope</th><th scope="col">Status</th><th scope="col">Evidence</th><th scope="col">Decision note</th></tr></thead><tbody>${criterionRows(summary)}</tbody></table></div></section>

    <section id="pages" aria-labelledby="pages-title"><h2 id="pages-title">Page inventory</h2><div class="table-wrap"><table><caption>Requested targets and audit status</caption><thead><tr><th scope="col">URL</th><th scope="col">Status</th><th scope="col">Viewports</th><th scope="col">Notes</th></tr></thead><tbody>${pageRows(summary)}</tbody></table></div></section>
    <section id="coverage" aria-labelledby="coverage-title"><h2 id="coverage-title">Test execution coverage</h2><p class="lede">This records which checks ran and the evidence they produced; it is not a conformance percentage. “Manual review”, “inconclusive” and “not tested” are unresolved outcomes—not passes.</p><div class="table-wrap"><table><caption>Execution evidence by page, viewport and audit area</caption><thead><tr><th scope="col">Page</th><th scope="col">Viewport</th><th scope="col">Area</th><th scope="col">Outcome</th><th scope="col">Evidence note</th></tr></thead><tbody>${coverageRows(summary)}</tbody></table></div></section>
    <section id="journeys" aria-labelledby="journeys-title"><h2 id="journeys-title">Configured task journeys</h2><p class="lede">Repeatable keyboard, form, interaction and live-region assertions supplied for this site. A DOM live-region result does not prove the quality of a screen-reader announcement.</p><div class="table-wrap"><table><caption>Site-specific task journey evidence</caption><thead><tr><th scope="col">Page</th><th scope="col">Viewport</th><th scope="col">Journey</th><th scope="col">Areas</th><th scope="col">Outcome</th><th scope="col">Result</th><th scope="col">Completed steps</th></tr></thead><tbody>${configuredJourneyRows(summary)}</tbody></table></div></section>
    <section id="manual" aria-labelledby="manual-title"><h2 id="manual-title">WCAG 2.2 A/AA human verification</h2><p class="lede">All 55 Level A and AA success criteria have a criterion-specific procedure and evidence prompt. Record an explicit verdict for each applicable criterion; “not tested” is unresolved, not a pass.</p><div class="table-wrap"><table><caption>Criterion-specific human assessment plan</caption><thead><tr><th scope="col">ID</th><th scope="col">Check</th><th scope="col">WCAG</th><th scope="col">Applies to</th><th scope="col">Procedure</th><th scope="col">Evidence to record</th><th scope="col">Status</th></tr></thead><tbody>${manualRows(summary)}</tbody></table></div></section>
    <section id="method" aria-labelledby="method-title"><h2 id="method-title">Method and limitations</h2><div class="limitations"><div class="panel"><h3>Audit scope</h3><ul><li>${escapeHtml(conformance)}</li>${summary.qualityContract ? `<li>Audit Quality Contract ${escapeHtml(summary.qualityContract.version)}; ${summary.qualityContract.criterionCount} Level A/AA criteria; ${escapeHtml(summary.qualityContract.findingPolicy)} finding policy</li>` : ''}<li>${escapeHtml(AUDIT_SCOPE_LABEL)}; links are never added as audit targets</li><li>${summary.requestedUrls.length} requested URL${summary.requestedUrls.length === 1 ? '' : 's'}; ${summary.auditedUrls.length} audited</li><li>${summary.pages.flatMap((page) => page.viewports).length} page-and-viewport runs</li><li>Automated axe rules plus DOM, generic and configured keyboard journeys, 200% root-text resizing, text spacing, responsive/reflow, disclosure, tab and link checks</li><li>Native screen-reader transcripts, when supplied, are supporting evidence and do not replace expert assessment</li></ul></div><div class="panel"><h3>Known limitations</h3>${list([...summary.limitations, `${summary.manualChecks.length} guided manual check(s) require human completion.`, 'A qualified human must complete applicable checks and make the final conformance decision.'], 'No limitations recorded.')}</div></div></section>
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
      const copyText = async (value) => {
        try {
          if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard API unavailable');
          await navigator.clipboard.writeText(value);
        } catch {
          const textarea = document.createElement('textarea');
          textarea.value = value;
          textarea.setAttribute('readonly', '');
          textarea.setAttribute('data-copy-fallback-buffer', '');
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.append(textarea);
          textarea.select();
          const copied = document.execCommand('copy');
          textarea.remove();
          if (!copied) throw new Error('Copy command failed');
        }
      };
      for (const button of document.querySelectorAll('.copy-ticket')) {
        button.addEventListener('click', async () => {
          const statusId = button.getAttribute('aria-describedby');
          const status = statusId ? document.getElementById(statusId) : null;
          const restoreFocus = document.activeElement === button;
          let userMovedFocus = false;
          const noteFocusMove = (event) => {
            const target = event.target;
            if (target !== button && !(target instanceof Element && target.hasAttribute('data-copy-fallback-buffer'))) userMovedFocus = true;
          };
          const notePointerMove = (event) => {
            if (event.target !== button) userMovedFocus = true;
          };
          document.addEventListener('focusin', noteFocusMove, true);
          document.addEventListener('pointerdown', notePointerMove, true);
          button.disabled = true;
          if (status) status.textContent = 'Copying ticket…';
          try {
            await copyText(button.dataset.ticket || '');
            if (status) status.textContent = 'Copied ' + button.dataset.findingId + ' ticket.';
          } catch {
            if (status) status.textContent = 'Could not copy this ticket. Select the finding details and copy them manually.';
          } finally {
            document.removeEventListener('focusin', noteFocusMove, true);
            document.removeEventListener('pointerdown', notePointerMove, true);
            button.disabled = false;
            if (restoreFocus && !userMovedFocus && (document.activeElement === document.body || document.activeElement === document.documentElement)) button.focus();
          }
        });
      }
    })();
  </script>
</body>
</html>`;
}

export async function writeHtmlReport(summary: AuditSummary, outputPath: string): Promise<string> {
  assertCanonicalAuditSummary(summary);
  await writeFile(outputPath, `${renderReport(summary, outputPath)}\n`, 'utf8');
  return outputPath;
}
