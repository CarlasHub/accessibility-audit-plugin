import type {
  CoverageArea,
  CoverageAssessment,
  CoverageStatus,
  Finding,
  PageAudit,
  PageCoverage,
  ViewportAudit
} from '../types.js';

function assessment(area: CoverageArea, status: CoverageStatus, detail: string): CoverageAssessment {
  return { area, status, detail };
}

function affectingFindings(findings: Finding[], audit: ViewportAudit): Finding[] {
  return findings.filter((finding) => (
    finding.urls.includes(audit.url)
    && finding.viewports.includes(audit.viewport.name)
  ));
}

function confirmed(findings: Finding[], predicate: (finding: Finding) => boolean): Finding[] {
  return findings.filter((finding) => (
    (finding.classification === 'confirmed' || finding.classification === 'blocker')
    && predicate(finding)
  ));
}

function resultForFindings(
  area: CoverageArea,
  findings: Finding[],
  predicate: (finding: Finding) => boolean,
  noFailureDetail: string
): CoverageAssessment {
  const failures = confirmed(findings, predicate);
  return failures.length
    ? assessment(area, 'confirmed-failed', `Confirmed finding(s): ${failures.map((finding) => finding.ruleId).join(', ')}.`)
    : assessment(area, 'tested-inconclusive', noFailureDetail);
}

function viewportCoverage(audit: ViewportAudit, findings: Finding[]): CoverageAssessment[] {
  const loaded = (
    (audit.status !== null && audit.status < 400)
    || (/^(file|data):/i.test(audit.finalUrl) && audit.errors.length === 0)
  );
  if (!loaded) {
    return [
      assessment('viewport-render', 'confirmed-failed', `The page did not load successfully: HTTP ${audit.status ?? 'no response'}.`),
      ...([
        'keyboard-only',
        'focus-order-and-visibility',
        'names-roles-states-relationships',
        'structure-headings-landmarks',
        'navigation-and-bypass',
        'links-and-buttons',
        'images-and-alternatives',
        'forms-errors-and-validation',
        'interactive-components',
        'dynamic-content-and-status',
        'zoom-text-spacing-and-responsive',
        'contrast-and-non-colour-cues',
        'motion-autoplay-and-controls',
        'language-and-language-changes',
        'page-title',
        'broken-or-misleading-links',
        'automated-axe',
        'manual-assessment'
      ] as CoverageArea[]).map((area) => assessment(area, 'not-tested', 'The page-load failure prevented this check.'))
    ];
  }

  const blocker = audit.interactionBlocker
    ?? (audit.keyboard.scope === 'modal-only'
      ? {
          selector: audit.keyboard.modalSelector ?? 'modal surface',
          role: 'dialog',
          name: '',
          reason: 'Sequential focus remained inside one modal surface.'
        }
      : null);
  const keyboardDetail = blocker
    ? `Interaction coverage was blocked by ${blocker.selector}: ${blocker.reason}`
    : audit.keyboard.truncated
      ? `The keyboard sequence reached its configured limit after ${audit.keyboard.sequence.length} controls.`
      : `Automated Tab traversal recorded ${audit.keyboard.sequence.length} controls; complete task-based keyboard testing still requires manual review.`;
  const relevant = affectingFindings(findings, audit);
  const autoplayPresent = audit.dom.autoplayMedia.length > 0;
  const axeStatus: CoverageStatus = !audit.axeRun.completed
    ? 'tested-inconclusive'
    : audit.axeRun.violationCount > 0
      ? 'confirmed-failed'
      : audit.axeRun.incompleteCount > 0
        ? 'tested-inconclusive'
        : 'confirmed-passed';

  return [
    assessment('viewport-render', 'confirmed-passed', `The page returned HTTP ${audit.status ?? 'local document'} and the viewport audit started.`),
    assessment('keyboard-only', 'tested-inconclusive', keyboardDetail),
    assessment('focus-order-and-visibility', 'tested-inconclusive', blocker
      ? keyboardDetail
      : 'Automated focus samples were collected, but complete order, visibility, obscuration and task operation require manual verification.'),
    resultForFindings(
      'names-roles-states-relationships',
      relevant,
      (finding) => finding.wcag.includes('4.1.2') || /name|role|state|relationship|aria/i.test(finding.ruleId),
      'Initial-state DOM, axe and selected interaction checks ran; unexercised states and assistive-technology output remain inconclusive.'
    ),
    resultForFindings(
      'structure-headings-landmarks',
      relevant,
      (finding) => /heading|landmark|region|main|list|table/i.test(finding.ruleId),
      'Initial headings and landmarks were inspected; semantic meaning and complete landmark navigation require manual review.'
    ),
    resultForFindings(
      'navigation-and-bypass',
      relevant,
      (finding) => /navigation|skip|main-menu|focus-order/i.test(`${finding.ruleId} ${finding.componentName ?? ''}`),
      blocker
        ? keyboardDetail
        : 'Navigation controls were included in structural and disclosure checks; a complete skip-link and keyboard journey remains inconclusive.'
    ),
    resultForFindings(
      'links-and-buttons',
      relevant,
      (finding) => /link|button|command-name|control-no-name/i.test(finding.ruleId),
      'Initial names and desktop same-origin destinations were checked; responsive-only, external and action-style controls remain incomplete.'
    ),
    resultForFindings(
      'images-and-alternatives',
      relevant,
      (finding) => /image|alt/i.test(finding.ruleId),
      'Image-alt presence was checked automatically; purpose, equivalence and decorative treatment require manual review.'
    ),
    resultForFindings(
      'forms-errors-and-validation',
      relevant,
      (finding) => /form|field|label|error|validation/i.test(finding.ruleId),
      'Initial field labels were inspected, but forms were not submitted with valid and invalid data; errors and status announcements are inconclusive.'
    ),
    resultForFindings(
      'interactive-components',
      relevant,
      (finding) => /disclosure|tabs|dialog|menu|carousel|filter/i.test(`${finding.ruleId} ${finding.component}`),
      blocker
        ? keyboardDetail
        : 'Disclosures and tab patterns were sampled; every open/closed/validated state and other widget pattern still requires completion.'
    ),
    assessment('dynamic-content-and-status', 'not-tested', 'No complete status-message or asynchronous-update announcement test was recorded.'),
    resultForFindings(
      'zoom-text-spacing-and-responsive',
      relevant,
      (finding) => /reflow|overflow|text-spacing/i.test(finding.ruleId),
      'Viewport width and document overflow were measured, but 200% zoom and visual clipping/overlap/loss require manual review.'
    ),
    resultForFindings(
      'contrast-and-non-colour-cues',
      relevant,
      (finding) => /contrast|use-of-color|colour/i.test(finding.ruleId),
      'Axe inspected supported initial-state text contrast; non-text contrast, colour-only cues and all interaction states remain inconclusive.'
    ),
    assessment('motion-autoplay-and-controls', autoplayPresent ? 'manual-review-required' : 'tested-inconclusive', autoplayPresent
      ? 'Autoplay media was detected; duration, audio, motion and pause/stop/hide controls require timed manual testing.'
      : 'No visible autoplay media attribute was detected; scripted/CSS motion, duration and controls remain inconclusive.'),
    assessment('language-and-language-changes', 'manual-review-required', 'Page and part-language accuracy requires content and assistive-technology review.'),
    assessment('page-title', audit.title.trim() ? 'tested-inconclusive' : 'confirmed-failed', audit.title.trim()
      ? `The rendered document title was recorded as “${audit.title.trim()}”; whether it adequately identifies the page still requires review.`
      : 'The rendered document title was empty.'),
    assessment('broken-or-misleading-links', audit.viewport.name === 'desktop'
      ? (confirmed(relevant, (finding) => finding.ruleId === 'link-broken-destination').length ? 'confirmed-failed' : 'tested-inconclusive')
      : 'not-applicable', audit.viewport.name === 'desktop'
      ? audit.linkRun.completed
        ? `Checked ${audit.linkRun.checkedCount} of ${audit.linkRun.candidateCount} rendered link candidate(s). ${audit.linkRun.truncated ? 'The configured limit left candidates untested.' : 'External, destructive, download and non-HTTP destinations remain outside the automated scope.'}`
        : `Destination checks did not complete: ${audit.linkRun.error ?? 'unknown reason'}.`
      : 'Destination checks intentionally run once from the desktop DOM; this responsive viewport is not a separate link-check scope.'),
    assessment('automated-axe', axeStatus, audit.axeRun.completed
      ? `axe completed with ${audit.axeRun.violationCount} violation result(s), ${audit.axeRun.incompleteCount} incomplete result(s), and ${audit.axeRun.passCount} pass result(s). This status applies only to the executed axe rules and state.`
      : `axe did not complete: ${audit.axeRun.error ?? 'unknown error'}.`),
    assessment('manual-assessment', 'manual-review-required', 'Screen-reader, physical-device, content-meaning and judgment-based WCAG checks remain outstanding.')
  ];
}

export function buildCoverageMatrix(pages: PageAudit[], findings: Finding[]): PageCoverage[] {
  return pages.map((page) => ({
    url: page.url,
    viewports: page.viewports.map((audit) => ({
      viewport: audit.viewport.name,
      assessments: viewportCoverage(audit, findings)
    }))
  }));
}
