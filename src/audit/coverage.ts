import type {
  CoverageArea,
  CoverageAssessment,
  CoverageStatus,
  Finding,
  PageAudit,
  PageCoverage,
  ViewportAudit
} from '../types.js';

const ALL_COVERAGE_AREAS: CoverageArea[] = [
  'viewport-render',
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
];

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
  return findings.filter((finding) => finding.classification === 'confirmed' && predicate(finding));
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
    || /^(file|data):/i.test(audit.finalUrl)
  );
  if (!loaded) {
    return ALL_COVERAGE_AREAS.map((area) => assessment(
      area,
      'not-tested',
      area === 'viewport-render'
        ? `The page could not be tested because it did not load: HTTP ${audit.status ?? 'no response'}.`
        : 'The page-load failure prevented this check.',
    ));
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
  const checkError = (prefix: string): string | undefined => audit.errors.find((message) => message.startsWith(prefix));
  const domError = checkError('DOM checks error:');
  const keyboardError = checkError('Keyboard checks error:');
  const configuredJourneyError = checkError('Configured journey checks error:');
  const disclosureError = checkError('Disclosure checks error:');
  const tabError = checkError('Tab checks error:');
  const responsiveError = checkError('Responsive checks error:');
  const responsiveComplete = audit.responsive.completed === true;
  const contextError = checkError('Element context check error:');
  const screenshotError = checkError('Screenshot check error:');
  const journeyResults = audit.keyboard.journeys.map((journey) => `${journey.title}: ${journey.status}`).join('; ');
  const configuredJourneys = audit.keyboard.journeys.filter((journey) => journey.source === 'configured');
  const configuredByCategory = (category: NonNullable<(typeof configuredJourneys)[number]['categories']>[number]) => (
    configuredJourneys.filter((journey) => journey.categories?.includes(category))
  );
  const configuredDetail = (category: Parameters<typeof configuredByCategory>[0]): string => {
    const matches = configuredByCategory(category);
    return matches.length
      ? matches.map((journey) => `${journey.title}: ${journey.status} (${journey.assertionCount ?? 0} assertion(s))`).join('; ')
      : 'No configured journey covered this area.';
  };
  const keyboardDetail = blocker
    ? `Interaction coverage was blocked by ${blocker.selector}: ${blocker.reason}`
    : keyboardError
      ? `Keyboard checks did not complete: ${keyboardError.slice('Keyboard checks error:'.length).trim()}`
    : audit.keyboard.truncated
      ? `The keyboard sequence reached its configured limit after ${audit.keyboard.sequence.length} controls.`
      : configuredJourneyError
        ? `Configured journeys did not complete: ${configuredJourneyError.slice('Configured journey checks error:'.length).trim()}`
      : `Deterministic forward/reverse and bypass journeys accompanied ${audit.keyboard.sequence.length} focus samples${journeyResults ? ` (${journeyResults})` : ''}; configured tasks add repeatable evidence, but complete keyboard testing still requires manual review.`;
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
    assessment('viewport-render', screenshotError || contextError ? 'tested-inconclusive' : 'confirmed-passed', screenshotError
      ? `The page rendered, but visual evidence capture did not complete: ${screenshotError.slice('Screenshot check error:'.length).trim()}`
      : contextError
        ? `The page rendered, but element context collection did not complete: ${contextError.slice('Element context check error:'.length).trim()}`
      : `The page returned HTTP ${audit.status ?? 'local document'} and the viewport audit started.`),
    assessment('keyboard-only', 'tested-inconclusive', keyboardDetail),
    assessment('focus-order-and-visibility', 'tested-inconclusive', blocker
      ? keyboardDetail
      : 'Automated focus samples were collected, but complete order, visibility, obscuration and task operation require manual verification.'),
    resultForFindings(
      'names-roles-states-relationships',
      relevant,
      (finding) => finding.wcag.includes('4.1.2') || /name|role|state|relationship|aria/i.test(finding.ruleId),
      domError
        ? `DOM checks did not complete: ${domError.slice('DOM checks error:'.length).trim()}`
        : 'Initial-state DOM, axe and selected interaction checks ran; unexercised states and assistive-technology output remain inconclusive.'
    ),
    resultForFindings(
      'structure-headings-landmarks',
      relevant,
      (finding) => /heading|landmark|region|main|list|table/i.test(finding.ruleId),
      domError
        ? `DOM structure checks did not complete: ${domError.slice('DOM checks error:'.length).trim()}`
        : 'Initial headings and landmarks were inspected; semantic meaning and complete landmark navigation require manual review.'
    ),
    resultForFindings(
      'navigation-and-bypass',
      relevant,
      (finding) => /navigation|skip|main-menu|focus-order/i.test(`${finding.ruleId} ${finding.componentName ?? ''}`),
      blocker
        ? keyboardDetail
        : 'A deterministic bypass-blocks journey accompanied structural and disclosure checks; alternative bypass mechanisms and complete navigation still require review.'
    ),
    resultForFindings(
      'links-and-buttons',
      relevant,
      (finding) => /link|button|command-name|control-no-name/i.test(finding.ruleId),
      domError
        ? `DOM name checks did not complete: ${domError.slice('DOM checks error:'.length).trim()}`
        : 'Initial names and desktop same-origin destinations were checked; responsive-only, external and action-style controls remain incomplete.'
    ),
    resultForFindings(
      'images-and-alternatives',
      relevant,
      (finding) => /image|alt/i.test(finding.ruleId),
      domError
        ? `DOM image checks did not complete: ${domError.slice('DOM checks error:'.length).trim()}`
        : 'Image-alt presence was checked automatically; purpose, equivalence and decorative treatment require manual review.'
    ),
    resultForFindings(
      'forms-errors-and-validation',
      relevant,
      (finding) => /form|field|label|error|validation/i.test(finding.ruleId),
      domError
        ? `DOM form checks did not complete: ${domError.slice('DOM checks error:'.length).trim()}`
        : `${configuredDetail('forms')} Initial field labels were inspected; only the explicitly configured form states were submitted or asserted, and human review remains required.`
    ),
    resultForFindings(
      'interactive-components',
      relevant,
      (finding) => /disclosure|tabs|dialog|menu|carousel|filter/i.test(`${finding.ruleId} ${finding.component}`),
      blocker
        ? keyboardDetail
        : disclosureError || tabError
          ? `Interactive component checks did not complete: ${(disclosureError ?? tabError)?.replace(/^(?:Disclosure|Tab) checks error:\s*/, '')}`
        : `${configuredDetail('interaction')} Disclosures and tab patterns were sampled; unconfigured widgets and assistive-technology behaviour remain inconclusive.`
    ),
    assessment(
      'dynamic-content-and-status',
      configuredByCategory('dynamic-content').length ? 'tested-inconclusive' : 'not-tested',
      `${configuredDetail('dynamic-content')} A DOM live-region mutation is evidence of an update, not proof that every screen reader announces it correctly.`
    ),
    resultForFindings(
      'zoom-text-spacing-and-responsive',
      relevant,
      (finding) => /reflow|responsive|overflow|text-spacing/i.test(finding.ruleId),
      responsiveError
        ? `Responsive checks did not complete: ${responsiveError.slice('Responsive checks error:'.length).trim()}`
        : !responsiveComplete
          ? 'Responsive checks did not produce complete evidence for the default, 200% root text-resize, and WCAG text-spacing phases; rerun the audit and complete human reflow and zoom review.'
        : 'At 320 CSS pixels, overflow, clipping and interactive overlap were sampled in the default state, with a 200% root text resize, and with WCAG text spacing; browser zoom, permitted exceptions, and complete content loss still require human review.'
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
    resultForFindings(
      'page-title',
      relevant,
      (finding) => /(?:document|page)-title/i.test(finding.ruleId),
      audit.title.trim()
        ? `The rendered document title was recorded as “${audit.title.trim()}”; whether it adequately identifies the page still requires review.`
        : 'The rendered document title was empty, but no completed rule evidence established a confirmed failure.'
    ),
    audit.viewport.name === 'desktop'
      ? resultForFindings(
        'broken-or-misleading-links',
        relevant,
        (finding) => finding.ruleId === 'link-broken-destination',
        audit.linkRun.completed
          ? `Checked ${audit.linkRun.checkedCount} of ${audit.linkRun.candidateCount} rendered link candidate(s). ${audit.linkRun.truncated ? 'The configured limit left candidates untested.' : 'External, destructive, download and non-HTTP destinations remain outside the automated scope.'}`
          : `Destination checks did not complete: ${audit.linkRun.error ?? 'unknown reason'}.`
      )
      : assessment('broken-or-misleading-links', 'not-applicable', 'Destination checks intentionally run once from the desktop DOM; this responsive viewport is not a separate link-check scope.'),
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
