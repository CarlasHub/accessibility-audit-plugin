import type { Finding } from '../types.js';

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function conciseMergedText(first?: string, second?: string, limit = 6): string | undefined {
  let hadTruncation = false;
  const values = [...new Set([first, second]
    .flatMap((value) => value?.split(/;\s*/) ?? [])
    .map((value) => value.trim())
    .filter((value) => {
      if (/^and \d+ more$/i.test(value) || value === 'and additional affected components') {
        hadTruncation = true;
        return false;
      }
      return Boolean(value);
    }))];
  if (!values.length) return undefined;
  if (values.length <= limit && !hadTruncation) return values.join('; ');
  return `${values.slice(0, limit).join('; ')}; and additional affected components`;
}

function canonicalRule(ruleId: string): string {
  if (['axe-image-alt', 'image-missing-alt'].includes(ruleId)) return 'image-alt';
  if (['axe-label', 'form-field-no-label'].includes(ruleId)) return 'form-label';
  if (['axe-button-name', 'axe-link-name', 'interactive-control-no-name'].includes(ruleId)) return 'control-name';
  return ruleId;
}

function rootCause(finding: Finding): string {
  return JSON.stringify({
    canonicalRule: canonicalRule(finding.ruleId),
    classification: finding.classification,
    severity: finding.severity,
    wcag: uniqueSorted(finding.wcag),
    summary: finding.summary,
    issue: finding.issue,
    remediation: finding.remediation
  });
}

function mergeFindingContext(findings: Finding[]): Pick<Finding, 'urls' | 'viewports' | 'selectors' | 'evidence'> & {
  componentName?: string;
  componentLocation?: string;
} {
  const result: Pick<Finding, 'urls' | 'viewports' | 'selectors' | 'evidence'> & {
    componentName?: string;
    componentLocation?: string;
  } = {
    urls: uniqueSorted(findings.flatMap((finding) => finding.urls)),
    viewports: uniqueSorted(findings.flatMap((finding) => finding.viewports)),
    selectors: uniqueSorted(findings.flatMap((finding) => finding.selectors)),
    evidence: findings.flatMap((finding) => finding.evidence)
  };
  const componentName = findings.reduce<string | undefined>(
    (merged, finding) => conciseMergedText(merged, finding.componentName),
    undefined
  );
  const componentLocation = findings.reduce<string | undefined>(
    (merged, finding) => conciseMergedText(merged, finding.componentLocation),
    undefined
  );
  if (componentName) result.componentName = componentName;
  if (componentLocation) result.componentLocation = componentLocation;
  return result;
}

function findingHost(finding: Finding): string {
  try {
    return new URL(finding.urls[0] ?? '').host.toLowerCase();
  } catch {
    return uniqueSorted(finding.urls).join('|');
  }
}

function rollUpSitewideContrast(findings: Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  const untouched: Finding[] = [];
  for (const finding of findings) {
    if (finding.ruleId !== 'axe-color-contrast') {
      untouched.push(finding);
      continue;
    }
    const host = findingHost(finding);
    groups.set(host, [...(groups.get(host) ?? []), finding]);
  }
  for (const [host, grouped] of groups) {
    const first = grouped[0]!;
    const treatments = uniqueSorted(grouped.flatMap((finding) => {
      const match = finding.issue.match(/([^.;]+ foreground on [^.;]+ background measured [\d.]+:1; [\d.]+:1 is required)/i);
      return match?.[1] ? [match[1].trim()] : [];
    }));
    const measured = treatments.length
      ? treatments.join('; ')
      : 'See the recorded axe evidence for the measured foreground/background pairs and thresholds.';
    untouched.push({
      ...first,
      ...mergeFindingContext(grouped),
      key: `axe-color-contrast:sitewide-${host || 'audit-scope'}`,
      ruleId: 'axe-color-contrast',
      classification: 'confirmed',
      severity: grouped.some((finding) => finding.severity === 'Critical') ? 'Critical' : 'Serious',
      wcag: ['1.4.3'],
      summary: 'Site-wide text colour treatments have insufficient contrast',
      issue: `The listed site components use rendered foreground/background treatments that do not meet minimum text contrast. Measured treatments: ${measured}.`,
      impact: 'People with low vision or colour-vision deficiencies may be unable to read text wherever the affected colour treatments are used.',
      testing: 'Measure every listed foreground/background pair in each affected default, selected, hover and focus state. Confirm the applicable 4.5:1 normal-text or 3:1 large-text threshold and retain each page/selector result in the evidence.',
      remediation: 'Correct the shared colour-system tokens and any component-specific overrides so every listed text treatment reaches the applicable contrast threshold. Retest all affected components and interaction states after the palette changes.',
      component: 'site-wide text colour system',
      sharedComponentKey: `sitewide-color-contrast:${host || 'audit-scope'}`,
      assignment: 'Mixed',
      effort: 'Medium',
      translationRequired: 'No'
    });
  }
  return untouched;
}

function rollUpDisclosureSemantics(findings: Finding[]): Finding[] {
  const disclosureRules = new Set([
    'disclosure-state-and-relationship',
    'disclosure-state-and-relationship-review',
    'disclosure-state-not-updated',
    'disclosure-state-review',
    'disclosure-controls-review'
  ]);
  const groups = new Map<string, Finding[]>();
  const untouched: Finding[] = [];
  for (const finding of findings) {
    if (!disclosureRules.has(finding.ruleId)) {
      untouched.push(finding);
      continue;
    }
    const key = finding.sharedComponentKey
      ? `shared:${finding.sharedComponentKey}`
      : `page:${uniqueSorted(finding.urls).join('|')}|${finding.component}`;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  for (const grouped of groups.values()) {
    const stateFinding = grouped.find((finding) => finding.ruleId !== 'disclosure-controls-review');
    const hasConfirmedState = grouped.some((finding) => (
      finding.classification === 'confirmed'
      && (finding.ruleId === 'disclosure-state-and-relationship' || finding.ruleId === 'disclosure-state-not-updated')
    ));
    const hasRelationshipEvidence = grouped.some((finding) => (
      finding.ruleId === 'disclosure-state-and-relationship'
      || finding.ruleId === 'disclosure-state-and-relationship-review'
      || finding.ruleId === 'disclosure-controls-review'
    ));
    if (!stateFinding) {
      untouched.push(...grouped);
      continue;
    }
    untouched.push({
      ...stateFinding,
      ...mergeFindingContext(grouped),
      key: `${hasConfirmedState ? 'disclosure-state' : 'disclosure-state-review'}${hasRelationshipEvidence ? '-and-relationship' : ''}:${stateFinding.sharedComponentKey ?? stateFinding.key}`,
      ruleId: hasConfirmedState
        ? (hasRelationshipEvidence ? 'disclosure-state-and-relationship' : 'disclosure-state-not-updated')
        : (hasRelationshipEvidence ? 'disclosure-state-and-relationship-review' : 'disclosure-state-review'),
      classification: hasConfirmedState ? 'confirmed' : 'review',
      severity: hasConfirmedState ? 'Serious' : 'Moderate',
      wcag: ['4.1.2'],
      summary: hasConfirmedState
        ? (hasRelationshipEvidence
            ? 'Disclosure state is incorrect and its controlled-region relationship needs review'
            : 'Disclosure state is not programmatically updated')
        : (hasRelationshipEvidence
            ? 'Review disclosure activation, state, and controlled-region relationship'
            : 'Review whether disclosure state updates after activation'),
      issue: hasConfirmedState
        ? (hasRelationshipEvidence
            ? 'Activating the listed disclosure trigger visibly revealed controlled content without reliably updating aria-expanded on the confirmed affected instances. The same reusable component also omits aria-controls in additional recorded instances; that absence is relationship context and is not independently treated as a WCAG failure.'
            : 'Activating the listed disclosure trigger visibly revealed controlled content without reliably updating aria-expanded on the confirmed affected instances.')
        : (hasRelationshipEvidence
            ? 'Automated activation did not change aria-expanded, but the controlled content could not be identified well enough to prove that it visibly opened. The same reusable component omits aria-controls; both signals require one component-level review and neither is independently treated as a confirmed failure.'
            : 'Automated activation did not change aria-expanded, but the controlled content could not be identified well enough to prove that it visibly opened. Review whether this is a state mismatch or a keyboard-activation problem.'),
      impact: 'Screen-reader users cannot reliably determine whether the affected content is open or closed. Where the structure does not otherwise communicate the relationship, they may also receive less context about which content is affected.',
      testing: 'On every listed page and viewport, activate the named trigger with Enter and Space and compare the visible state with aria-expanded. Separately inspect whether the chosen disclosure pattern communicates its controlled content; do not fail an ordinary disclosure solely because aria-controls is absent.',
      remediation: 'Use a native button and synchronize aria-expanded with the visible state whenever the component opens or closes. If the chosen pattern needs an explicit controlled-region relationship, add a stable unique panel id and reference it with aria-controls without duplicating native semantics.'
    });
  }
  return untouched;
}

function rollUpDescriptionListStructure(findings: Finding[]): Finding[] {
  const descriptionListRules = new Set(['axe-definition-list', 'axe-dlitem']);
  const groups = new Map<string, Finding[]>();
  const untouched: Finding[] = [];
  for (const finding of findings) {
    if (!descriptionListRules.has(finding.ruleId)) {
      untouched.push(finding);
      continue;
    }
    const page = uniqueSorted(finding.urls).join('|');
    const location = finding.componentLocation?.trim() ?? '';
    const key = `${page}|${location}`;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  for (const grouped of groups.values()) {
    const first = grouped[0]!;
    const containerFinding = grouped.find((finding) => finding.ruleId === 'axe-definition-list');
    const componentNames = uniqueSorted(grouped.map((finding) => finding.componentName ?? finding.component));
    untouched.push({
      ...first,
      key: `axe-description-list-structure:${first.key.split(':').at(-1) ?? 'grouped'}`,
      ruleId: 'axe-description-list-structure',
      classification: 'confirmed',
      severity: grouped.some((finding) => finding.severity === 'Critical') ? 'Critical' : 'Serious',
      wcag: uniqueSorted(grouped.flatMap((finding) => finding.wcag)),
      summary: 'Description-list markup has an invalid parent/child structure',
      issue: 'The description list contains invalid wrapper elements, leaving its dt and dd items outside the required direct dl structure. These axe signals describe one component/root cause and are reported together.',
      impact: 'Screen readers may not expose the job-detail terms and descriptions as one coherent description list.',
      testing: 'Inspect the listed dl, dt and dd elements as one component. Confirm that each term and description is contained in a valid dl and that only permitted grouping elements occur as direct children.',
      remediation: 'Place each dt/dd group directly inside the dl, or wrap complete groups in div elements permitted by HTML. Remove span or other invalid wrappers between the dl and its terms/descriptions, then rerun the definition-list and dlitem checks.',
      component: 'description list structure',
      componentName: containerFinding?.componentName ?? (componentNames.length <= 4
        ? componentNames.join('; ')
        : `${componentNames.slice(0, 4).join('; ')}; and ${componentNames.length - 4} more`),
      sharedComponentKey: `description-list-structure:${first.componentLocation ?? first.component}`,
      urls: uniqueSorted(grouped.flatMap((finding) => finding.urls)),
      viewports: uniqueSorted(grouped.flatMap((finding) => finding.viewports)),
      selectors: uniqueSorted(grouped.flatMap((finding) => finding.selectors)),
      evidence: grouped.flatMap((finding) => finding.evidence),
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'No'
    });
  }
  return untouched;
}

export function consolidateFindings(findings: Finding[]): Finding[] {
  const merge = (existing: Finding, finding: Finding): void => {
    existing.wcag = uniqueSorted([...existing.wcag, ...finding.wcag]);
    existing.urls = uniqueSorted([...existing.urls, ...finding.urls]);
    existing.viewports = uniqueSorted([...existing.viewports, ...finding.viewports]);
    existing.selectors = uniqueSorted([...existing.selectors, ...finding.selectors]);
    existing.evidence.push(...finding.evidence);
    const mergedName = conciseMergedText(existing.componentName, finding.componentName);
    const mergedLocation = conciseMergedText(existing.componentLocation, finding.componentLocation);
    if (mergedName) existing.componentName = mergedName;
    if (mergedLocation) existing.componentLocation = mergedLocation;
  };
  const localFindings = new Map<string, Finding>();
  const reportingUnits = rollUpDisclosureSemantics(rollUpSitewideContrast(rollUpDescriptionListStructure(findings)));
  for (const finding of reportingUnits) {
    const pageIdentity = uniqueSorted(finding.urls).join('|');
    const localKey = `page:${pageIdentity}|${finding.component}|${rootCause(finding)}`;
    const existing = localFindings.get(localKey);
    if (!existing) {
      localFindings.set(localKey, {
        ...finding,
        wcag: uniqueSorted(finding.wcag),
        urls: uniqueSorted(finding.urls),
        viewports: uniqueSorted(finding.viewports),
        selectors: uniqueSorted(finding.selectors),
        evidence: [...finding.evidence]
      });
      continue;
    }
    merge(existing, finding);
  }

  const consolidated = new Map<string, Finding>();
  for (const finding of localFindings.values()) {
    const pageIdentity = uniqueSorted(finding.urls).join('|');
    const renderedName = finding.componentName ?? finding.component;
    const renderedIdentity = JSON.stringify({
      // Generic unnamed controls can share identical markup across unrelated widgets.
      // Their rendered location is therefore required before cross-page consolidation.
      name: finding.sharedComponentKey ? '' : renderedName,
      location: /^Unnamed\b/i.test(renderedName) ? finding.componentLocation ?? '' : ''
    });
    const scope = finding.sharedComponentKey
      ? `shared:${finding.sharedComponentKey}|rendered:${renderedIdentity}`
      : `page:${pageIdentity}`;
    const key = `${scope}|${finding.component}|${rootCause(finding)}`;
    const existing = consolidated.get(key);
    if (!existing) {
      consolidated.set(key, finding);
      continue;
    }
    merge(existing, finding);
  }
  return [...consolidated.values()].sort((a, b) => {
    const rank = { blocker: 0, confirmed: 1, review: 2, manual: 3 } as const;
    return rank[a.classification] - rank[b.classification] || a.ruleId.localeCompare(b.ruleId);
  });
}

export function assertRemediationOnlyNotes(findings: Finding[]): void {
  for (const finding of findings) {
    if (/jira/i.test(finding.remediation)) {
      throw new Error(`Finding ${finding.key} contains a Jira reference in remediation Notes.`);
    }
    if (!finding.remediation.trim()) {
      throw new Error(`Finding ${finding.key} has empty remediation Notes.`);
    }
  }
}
