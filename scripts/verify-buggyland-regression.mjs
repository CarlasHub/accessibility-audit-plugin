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
