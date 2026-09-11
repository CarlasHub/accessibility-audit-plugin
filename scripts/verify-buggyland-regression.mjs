import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const baselinePath = resolve(repositoryRoot, 'tests', 'fixtures', 'buggyland-regression.json');
const reportPaths = process.argv.slice(2).filter((argument) => argument !== '--skip-live');
const skipLive = process.argv.includes('--skip-live');

const standardCriteria = [
  '1.1.1', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5',
  '1.3.1', '1.3.2', '1.3.3', '1.3.4', '1.3.5',
  '1.4.1', '1.4.2', '1.4.3', '1.4.4', '1.4.5', '1.4.10', '1.4.11', '1.4.12', '1.4.13',
  '2.1.1', '2.1.2', '2.1.4', '2.2.1', '2.2.2', '2.3.1',
  '2.4.1', '2.4.2', '2.4.3', '2.4.4', '2.4.5', '2.4.6', '2.4.7', '2.4.11',
  '2.5.1', '2.5.2', '2.5.3', '2.5.4', '2.5.7', '2.5.8',
  '3.1.1', '3.1.2', '3.2.1', '3.2.2', '3.2.3', '3.2.4', '3.2.6',
  '3.3.1', '3.3.2', '3.3.3', '3.3.4', '3.3.7', '3.3.8', '4.1.2', '4.1.3'
];
const coverageAreas = [
  'viewport-render', 'keyboard-only', 'focus-order-and-visibility',
  'names-roles-states-relationships', 'structure-headings-landmarks', 'navigation-and-bypass',
  'links-and-buttons', 'images-and-alternatives', 'forms-errors-and-validation',
  'interactive-components', 'dynamic-content-and-status', 'zoom-text-spacing-and-responsive',
  'contrast-and-non-colour-cues', 'motion-autoplay-and-controls',
  'language-and-language-changes', 'page-title', 'broken-or-misleading-links',
  'automated-axe', 'manual-assessment'
];
const evidenceKinds = new Set(['axe', 'dom', 'keyboard', 'responsive', 'network', 'manual']);

if (reportPaths.length !== 2) {
  throw new Error('Usage: node scripts/verify-buggyland-regression.mjs <first-audit-results.json> <second-audit-results.json> [--skip-live]');
}

const [baseline, ...reports] = await Promise.all([
  readJson(baselinePath),
  ...reportPaths.map((reportPath) => readJson(resolve(reportPath)))
]);

function readJson(path) {
  return readFile(path, 'utf8').then((value) => JSON.parse(value));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function uniqueSorted(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

function sameValues(actual, expected) {
  return JSON.stringify(uniqueSorted(actual)) === JSON.stringify(uniqueSorted(expected));
}

function normalizedFindingIdentities(report, { includeSelectors = false } = {}) {
  // Rendered overflow can add an axe selector on one OS but not another. Keep the
  // cross-platform baseline structural, then require selector stability between
  // the two independent runs made on the same runner below.
  return report.findings.map((finding) => ({
    id: finding.id,
    classification: finding.classification,
    ruleId: finding.ruleId,
    severity: finding.severity,
    wcag: uniqueSorted(finding.wcag),
    urls: uniqueSorted(finding.urls),
    ...(includeSelectors ? { selectors: uniqueSorted(finding.selectors) } : {})
  })).sort((first, second) => first.id.localeCompare(second.id));
}

function identityDigest(report) {
  return createHash('sha256')
    .update(JSON.stringify(normalizedFindingIdentities(report)))
    .digest('hex');
}

const equivalentFamilies = new Map([
  ['axe-image-alt', 'image-alt'],
  ['image-missing-alt', 'image-alt'],
  ['axe-label', 'form-label'],
  ['axe-select-name', 'form-label'],
  ['axe-textarea-name', 'form-label'],
  ['form-field-no-label', 'form-label'],
  ['axe-aria-command-name', 'control-name'],
  ['axe-button-name', 'control-name'],
  ['axe-input-button-name', 'control-name'],
  ['axe-link-name', 'control-name'],
  ['interactive-control-no-name', 'control-name']
]);

function normalizeText(value = '') {
  return value.trim().replace(/\s+/g, ' ');
}

function evidenceOverlaps(first, second) {
  return first.evidence.some((firstEvidence) => second.evidence.some((secondEvidence) => (
    firstEvidence.pageUrl === secondEvidence.pageUrl
    && (
      (firstEvidence.selector && normalizeText(firstEvidence.selector) === normalizeText(secondEvidence.selector))
      || (firstEvidence.detail && normalizeText(firstEvidence.detail) === normalizeText(secondEvidence.detail))
    )
  )));
}

function assertNoEquivalentDuplicates(report, label) {
  for (let firstIndex = 0; firstIndex < report.findings.length; firstIndex += 1) {
    const first = report.findings[firstIndex];
    const family = equivalentFamilies.get(first.ruleId);
    if (!family) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < report.findings.length; secondIndex += 1) {
      const second = report.findings[secondIndex];
      if (equivalentFamilies.get(second.ruleId) !== family) continue;
      const isAxeDomPair = first.ruleId.startsWith('axe-') !== second.ruleId.startsWith('axe-');
      assert(
        !isAxeDomPair || !evidenceOverlaps(first, second),
        `${label}: ${first.id} and ${second.id} duplicate the same ${family} element.`
      );
    }
  }
}

function assertNoConfirmedIncompleteAxe(report, label) {
  const incomplete = new Set();
  const violations = new Set();
  for (const page of report.pages) {
    for (const viewport of page.viewports) {
      for (const result of viewport.axe) {
        const destination = result.resultType === 'incomplete' ? incomplete : violations;
        for (const node of result.nodes) {
          for (const selector of node.target ?? []) {
            destination.add(JSON.stringify([page.url, viewport.viewport.name, result.id, selector]));
          }
        }
      }
    }
  }

  for (const finding of report.findings.filter((item) => item.classification === 'confirmed' && item.ruleId.startsWith('axe-'))) {
    const axeRule = finding.ruleId.slice(4);
    for (const evidence of finding.evidence.filter((item) => item.kind === 'axe')) {
      const identity = JSON.stringify([evidence.pageUrl, evidence.viewport, axeRule, evidence.selector]);
      assert(violations.has(identity), `${label}: confirmed ${finding.id} is not backed by a matching axe violation.`);
      assert(!incomplete.has(identity), `${label}: confirmed ${finding.id} was derived from an incomplete axe result.`);
    }
  }
}

function assertCoverageContract(report, label, blockedUrls) {
  assert(report.coverage.length === baseline.urls.length, `${label}: coverage must include every requested URL state.`);
  const coverageByUrl = new Map(report.coverage.map((page) => [page.url, page]));
  assert(coverageByUrl.size === report.coverage.length, `${label}: coverage contains duplicate URL entries.`);

  for (const url of baseline.urls) {
    const page = coverageByUrl.get(url);
    assert(page, `${label}: coverage is missing ${url}.`);
    assert(sameValues(page.viewports.map((item) => item.viewport), baseline.viewports), `${label}: coverage viewports changed for ${url}.`);
    assert(new Set(page.viewports.map((item) => item.viewport)).size === baseline.viewports.length, `${label}: coverage contains duplicate viewports for ${url}.`);
    for (const viewport of page.viewports) {
      assert(sameValues(viewport.assessments.map((item) => item.area), coverageAreas), `${label}: ${url} at ${viewport.viewport} does not cover all 19 audit areas.`);
      assert(new Set(viewport.assessments.map((item) => item.area)).size === coverageAreas.length, `${label}: duplicate audit areas exist for ${url} at ${viewport.viewport}.`);
      assert(viewport.assessments.every((item) => normalizeText(item.detail)), `${label}: a coverage result lacks an explanation for ${url} at ${viewport.viewport}.`);
      assert(viewport.assessments.find((item) => item.area === 'manual-assessment')?.status === 'manual-review-required', `${label}: mandatory human assessment is not disclosed for ${url} at ${viewport.viewport}.`);

      if (blockedUrls.has(url)) {
        for (const area of ['keyboard-only', 'focus-order-and-visibility', 'navigation-and-bypass', 'interactive-components']) {
          const status = viewport.assessments.find((item) => item.area === area)?.status;
          assert(status !== 'confirmed-passed', `${label}: ${area} was falsely passed behind the blocker on ${url} at ${viewport.viewport}.`);
        }
      }

      for (const item of viewport.assessments.filter((assessment) => assessment.status === 'confirmed-failed')) {
        if (item.area === 'automated-axe') continue;
        assert(item.detail.startsWith('Confirmed finding(s):'), `${label}: ${item.area} claims failure without identified confirmed findings on ${url} at ${viewport.viewport}.`);
      }
    }
  }
}

function assertCriterionContract(report, label) {
  assert(Array.isArray(report.criteria) && report.criteria.length === 86, `${label}: the criterion ledger must contain all 86 active WCAG 2.2 criteria.`);
  assert(new Set(report.criteria.map((item) => item.criterion)).size === 86, `${label}: the criterion ledger contains duplicates.`);
  assert(!report.criteria.some((item) => item.criterion === '4.1.1'), `${label}: obsolete criterion 4.1.1 must not be reported as active WCAG 2.2.`);

  const standard = report.criteria.filter((item) => item.scope === 'standard');
  const advisory = report.criteria.filter((item) => item.scope === 'advisory');
  assert(sameValues(standard.map((item) => item.criterion), standardCriteria), `${label}: the exact 55 WCAG 2.2 A/AA criteria are not represented.`);
  assert(advisory.length === 31 && advisory.every((item) => item.level === 'AAA'), `${label}: the 31 AAA criteria must be clearly advisory.`);
  assert(standard.every((item) => item.level === 'A' || item.level === 'AA'), `${label}: the standard ledger contains a criterion outside the A/AA target.`);
  assert(standard.every((item) => item.status !== 'passed'), `${label}: automation must not claim criterion-level WCAG passes before human review.`);

  const findingById = new Map(report.findings.map((finding) => [finding.id, finding]));
  assert(findingById.size === report.findings.length, `${label}: finding IDs are not unique.`);
  for (const criterion of report.criteria) {
    assert(normalizeText(criterion.detail), `${label}: criterion ${criterion.criterion} has no status explanation.`);
    assert(criterion.findingIds.every((id) => findingById.has(id)), `${label}: criterion ${criterion.criterion} references an unknown finding.`);
    assert(criterion.findingIds.every((id) => findingById.get(id).wcag.includes(criterion.criterion)), `${label}: criterion ${criterion.criterion} references a finding not mapped to it.`);
  }

  for (const criterion of standard) {
    const confirmedIds = report.findings
      .filter((finding) => finding.classification === 'confirmed' && finding.wcag.includes(criterion.criterion))
      .map((finding) => finding.id);
    assert((criterion.status === 'failed') === (confirmedIds.length > 0), `${label}: criterion ${criterion.criterion} has an unsupported failure status.`);
    if (criterion.status === 'failed') {
      assert(criterion.findingIds.length > 0, `${label}: failed criterion ${criterion.criterion} has no finding evidence.`);
      assert(criterion.findingIds.every((id) => findingById.get(id).classification === 'confirmed'), `${label}: review or blocker evidence was treated as a failure for ${criterion.criterion}.`);
      assert(sameValues(criterion.findingIds, confirmedIds), `${label}: failed criterion ${criterion.criterion} does not list every confirmed finding.`);
    }
  }
}

function assertEvidenceContract(report, label) {
  const criterionIds = new Set(report.criteria.map((item) => item.criterion));
  const pageViewports = new Map(report.pages.map((page) => [page.url, new Set(page.viewports.map((viewport) => viewport.viewport.name))]));
  for (const finding of report.findings) {
    assert(finding.urls.length > 0 && finding.urls.every((url) => pageViewports.has(url)), `${label}: ${finding.id} references an unaudited URL.`);
    assert(finding.viewports.length > 0 && finding.viewports.every((viewport) => baseline.viewports.includes(viewport)), `${label}: ${finding.id} references an unaudited viewport.`);
    assert(finding.wcag.length > 0 && finding.wcag.every((criterion) => criterionIds.has(criterion) || criterion === 'Best Practice' || criterion === 'None'), `${label}: ${finding.id} has an invalid WCAG reference.`);
    if (finding.classification === 'blocker') {
      assert(finding.wcag.every((criterion) => criterion === 'None'), `${label}: blocker ${finding.id} must not be presented as a WCAG failure.`);
    }
    assert(finding.evidence.length > 0, `${label}: ${finding.id} has no evidence.`);
    for (const evidence of finding.evidence) {
      assert(evidenceKinds.has(evidence.kind), `${label}: ${finding.id} has an invalid evidence kind.`);
      assert(pageViewports.has(evidence.pageUrl), `${label}: ${finding.id} evidence references an unaudited URL.`);
      assert(normalizeText(evidence.detail), `${label}: ${finding.id} contains empty evidence.`);
      if (evidence.viewport) {
        assert(pageViewports.get(evidence.pageUrl).has(evidence.viewport), `${label}: ${finding.id} evidence references an unaudited URL/viewport pair.`);
      }
    }
  }

  assert(report.manualChecks.length === 55, `${label}: exactly 55 A/AA manual checks are required.`);
  assert(new Set(report.manualChecks.map((check) => check.id)).size === 55, `${label}: manual-check IDs are not unique.`);
  assert(sameValues(report.manualChecks.flatMap((check) => check.wcag), standardCriteria), `${label}: the manual plan does not map one-to-one to all 55 A/AA criteria.`);
  assert(report.manualChecks.every((check) => check.classification === 'manual' && check.wcag.length === 1), `${label}: each manual check must map to exactly one criterion.`);
  assert(report.manualChecks.every((check) => normalizeText(check.title) && normalizeText(check.procedure) && normalizeText(check.applicableTo) && normalizeText(check.expectedEvidence)), `${label}: every manual check needs a title, procedure, applicability and evidence requirement.`);
}

function assertConfiguredJourneyContract(report, label, blockedUrls) {
  const expectedIds = baseline.configuredJourneys.ids;
  const expectedCategories = ['keyboard', 'forms', 'interaction', 'dynamic-content'];
  const allConfigured = [];
  for (const page of report.pages) {
    for (const viewport of page.viewports) {
      const configured = viewport.keyboard.journeys.filter((journey) => journey.source === 'configured');
      if (blockedUrls.has(page.url)) {
        assert(configured.length === 0, `${label}: configured journeys ran behind the blocker on ${page.url} at ${viewport.viewport.name}.`);
        continue;
      }
      assert(sameValues(configured.map((journey) => journey.id), expectedIds), `${label}: configured journey IDs changed on ${page.url} at ${viewport.viewport.name}.`);
      assert(sameValues(configured.flatMap((journey) => journey.categories ?? []), expectedCategories), `${label}: configured journeys do not cover all required task categories on ${page.url} at ${viewport.viewport.name}.`);
      assert(configured.every((journey) => journey.status !== 'inconclusive'), `${label}: a deterministic configured journey was inconclusive on ${page.url} at ${viewport.viewport.name}.`);
      assert(
        configured.every((journey) => (journey.assertionCount ?? 0) > 0
          || (journey.status === 'failed' && /could not receive focus|did not retain focus/.test(journey.detail))),
        `${label}: a configured journey has neither an executed assertion nor deterministic focus-failure evidence on ${page.url} at ${viewport.viewport.name}.`
      );
      assert(configured.every((journey) => journey.steps.length > 0 && normalizeText(journey.detail)), `${label}: configured journey evidence is incomplete on ${page.url} at ${viewport.viewport.name}.`);
      allConfigured.push(...configured);
    }
  }
  const statuses = Object.fromEntries(['passed', 'failed', 'inconclusive'].map((status) => [
    status,
    allConfigured.filter((journey) => journey.status === status).length
  ]));
  for (const status of ['passed', 'failed', 'inconclusive']) {
    assert(statuses[status] === baseline.configuredJourneys[status], `${label}: expected ${baseline.configuredJourneys[status]} configured journeys to be ${status}, received ${statuses[status]}.`);
  }
  assert(allConfigured.length === baseline.configuredJourneys.total, `${label}: configured journey total changed.`);
}

function assertReport(report, label) {
  assert(report.status === 'completed', `${label}: audit status must be completed.`);
  assert(sameValues(report.requestedUrls, baseline.urls), `${label}: requested URL/hash-state coverage changed.`);
  assert(sameValues(report.auditedUrls, baseline.urls), `${label}: audited URL/hash-state coverage changed.`);
  assert(report.skippedUrls.length === 0, `${label}: no BuggyLand target may be skipped.`);
  assert(report.pages.length === baseline.urls.length, `${label}: expected ${baseline.urls.length} page states.`);

  const classificationCounts = Object.fromEntries(['confirmed', 'review', 'blocker'].map((classification) => [
    classification,
    report.findings.filter((finding) => finding.classification === classification).length
  ]));
  for (const classification of ['confirmed', 'review', 'blocker']) {
    assert(
      classificationCounts[classification] === baseline.classifications[classification],
      `${label}: expected ${baseline.classifications[classification]} ${classification} findings, received ${classificationCounts[classification]}.`
    );
  }
  assert(report.manualChecks.length === baseline.classifications.manualChecks, `${label}: manual-check count changed.`);
  assert(report.findings.length === baseline.classifications.totalFindings, `${label}: total finding count changed.`);

  let completedPages = 0;
  let partialPages = 0;
  const blockedUrls = new Set();
  for (const page of report.pages) {
    const shouldBeBlocked = new globalThis.URL(page.url).hash === '#special';
    assert(sameValues(page.viewports.map((viewport) => viewport.viewport.name), baseline.viewports), `${label}: viewport coverage changed for ${page.url}.`);
    assert(Boolean(page.partial) === shouldBeBlocked, `${label}: partial status is wrong for ${page.url}.`);
    if (page.partial) partialPages += 1;
    else completedPages += 1;

    for (const viewport of page.viewports) {
      assert(viewport.axeRun.completed, `${label}: axe did not complete for ${page.url} at ${viewport.viewport.name}.`);
      assert(Boolean(viewport.partial) === shouldBeBlocked, `${label}: viewport partial status is wrong for ${page.url} at ${viewport.viewport.name}.`);
      if (shouldBeBlocked) {
        blockedUrls.add(page.url);
        assert(viewport.interactionBlocker?.selector === baseline.blockerSelector, `${label}: expected the known fullscreen blocker for ${page.url} at ${viewport.viewport.name}.`);
        assert(viewport.keyboard.scope === 'unknown', `${label}: page-level keyboard testing must remain unclaimed behind the blocker for ${page.url} at ${viewport.viewport.name}.`);
        assert(viewport.keyboard.sequence.length === 0 && viewport.keyboard.journeys.length === 0, `${label}: keyboard evidence was emitted behind the blocker for ${page.url} at ${viewport.viewport.name}.`);
      } else {
        assert(viewport.interactionBlocker === null, `${label}: unexpected blocker on ${page.url} at ${viewport.viewport.name}.`);
        assert(viewport.errors.length === 0, `${label}: unexpected coverage error on ${page.url} at ${viewport.viewport.name}.`);
      }
    }
  }
  assert(completedPages === baseline.fullyCompletedPages, `${label}: fully completed page count changed.`);
  assert(partialPages === baseline.partialPages, `${label}: partial page count changed.`);

  assertCoverageContract(report, label, blockedUrls);
  assertCriterionContract(report, label);
  assertEvidenceContract(report, label);
  assertConfiguredJourneyContract(report, label, blockedUrls);

  const interactionRule = /^(?:keyboard-|focus-|disclosure-|tabs?-)/;
  for (const finding of report.findings.filter((item) => interactionRule.test(item.ruleId))) {
    assert(!finding.urls.some((url) => blockedUrls.has(url)), `${label}: ${finding.id} claims page-level interaction evidence behind a blocker.`);
  }

  const ids = report.findings.map((finding) => finding.id);
  assert(ids.every((id, index) => id === `A11Y${String(index + 1).padStart(3, '0')}`), `${label}: finding IDs must be complete, ordered and gap-free.`);
  assert(identityDigest(report) === baseline.findingIdentitySha256, `${label}: normalized finding identities changed from the reviewed baseline.`);
  assertNoConfirmedIncompleteAxe(report, label);
  assertNoEquivalentDuplicates(report, label);
}

reports.forEach((report, index) => assertReport(report, `run ${index + 1}`));
assert(
  JSON.stringify(normalizedFindingIdentities(reports[0], { includeSelectors: true }))
    === JSON.stringify(normalizedFindingIdentities(reports[1], { includeSelectors: true })),
  'The two BuggyLand runs produced different normalized finding identities or selectors.'
);

if (!skipLive) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const fixture of baseline.fixturePages) {
      await page.goto(fixture.url, { waitUntil: 'networkidle', timeout: 30_000 });
      const counts = await page.evaluate(() => ({
        cards: globalThis.document.querySelectorAll('#bug-grid section.card').length,
        examples: globalThis.document.querySelectorAll('#bug-grid .bug').length
      }));
      assert(counts.cards === fixture.cards, `Live fixture ${fixture.url} has ${counts.cards} cards; expected ${fixture.cards}.`);
      assert(counts.examples === fixture.examples, `Live fixture ${fixture.url} has ${counts.examples} examples; expected ${fixture.examples}.`);
    }
  } finally {
    await browser.close();
  }
}

process.stdout.write(`BuggyLand regression passed for ${reports.length} independent audit runs.\n`);
