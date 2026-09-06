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
    }))].sort((a, b) => a.localeCompare(b));
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
    evidence: [...new Map(findings.flatMap((finding) => finding.evidence).map((item) => [
      JSON.stringify([item.kind, item.pageUrl, item.viewport ?? '', item.selector ?? '', item.detail, item.screenshot ?? '']),
      item
    ])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
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

function rollUpBrokenComponentLinks(findings: Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  const untouched: Finding[] = [];
  for (const finding of findings) {
    const missingFragment = finding.ruleId === 'link-broken-destination'
      && finding.evidence.some((item) => /in-page fragment/i.test(item.detail));
    if (!missingFragment) {
      untouched.push(finding);
      continue;
    }
    const key = `${findingHost(finding)}|${finding.component}|${finding.componentLocation ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  for (const [groupKey, unsorted] of groups) {
    const grouped = [...unsorted].sort((a, b) => a.key.localeCompare(b.key));
    if (grouped.length === 1) {
      untouched.push(grouped[0]!);
      continue;
    }
    const first = grouped[0]!;
    const context = mergeFindingContext(grouped);
    untouched.push({
      ...first,
      ...context,
      key: `link-broken-destination:component:${groupKey}`,
      classification: 'confirmed',
      severity: 'Moderate',
      wcag: ['Best Practice'],
      summary: 'In-page navigation links point to missing sections',
      issue: `The ${grouped.length} listed links in the same in-page navigation component reference fragment identifiers that are not present in the rendered affected pages.`,
      impact: 'Activating these links does not move to the promised section, causing confusion and extra navigation for keyboard, screen-reader and other users.',
      testing: 'Activate or inspect each listed in-page navigation link and confirm that its fragment identifier matches one unique id or named anchor in the same rendered document.',
      remediation: 'Update each href fragment to the intended existing section id or restore the missing section target. Retest every listed link on every affected page.',
      sharedComponentKey: `broken-fragment-component:${groupKey}`,
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'No'
    });
  }
  return untouched;
}

function reviewLinkEvidenceSignature(finding: Finding): string | null {
  const item = finding.evidence.find((evidence) => evidence.kind === 'network');
  if (!item) return null;
  try {
    const detail = JSON.parse(item.detail) as { href?: unknown; reason?: unknown; status?: unknown };
    return JSON.stringify({
      href: typeof detail.href === 'string' ? detail.href : '',
      reason: typeof detail.reason === 'string' ? detail.reason : '',
      status: typeof detail.status === 'number' ? detail.status : null
    });
  } catch {
    return null;
  }
}

function rollUpReviewComponentLinks(findings: Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  const untouched: Finding[] = [];
  for (const finding of findings) {
    const signature = finding.ruleId === 'link-destination-review'
      ? reviewLinkEvidenceSignature(finding)
      : null;
    if (!signature || !finding.componentLocation) {
      untouched.push(finding);
      continue;
    }
    const key = `${findingHost(finding)}|${finding.componentLocation}|${signature}`;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  for (const [groupKey, grouped] of groups) {
    if (grouped.length === 1) {
      untouched.push(grouped[0]!);
      continue;
    }
    const first = [...grouped].sort((a, b) => a.key.localeCompare(b.key))[0]!;
    const context = mergeFindingContext(grouped);
    const signature = reviewLinkEvidenceSignature(first);
    const parsed = signature ? JSON.parse(signature) as { href: string; reason: string } : { href: '', reason: '' };
    const occurrenceCount = context.evidence.filter((item) => item.kind === 'network').length;
    untouched.push({
      ...first,
      ...context,
      key: `link-destination-review:component:${groupKey}`,
      summary: 'Review placeholder links in the same component',
      issue: `${occurrenceCount} listed link occurrence(s) in the same rendered component point to ${parsed.href || 'an empty destination'}. ${parsed.reason}`,
      impact: 'The links may not provide reliable destinations or may use the wrong semantic control.',
      testing: 'Activate or inspect each listed link in this rendered component. Confirm whether it should navigate to a real destination or perform an action as a native button before treating the signal as a defect.',
      remediation: 'Replace placeholder destinations with working URLs. If a control performs an action instead of navigation, implement it as a native button and preserve an accurate accessible name.',
      component: `placeholder links at ${first.componentLocation}`,
      sharedComponentKey: `review-link-component:${groupKey}`,
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'No'
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
    const context = mergeFindingContext([existing, finding]);
    existing.wcag = uniqueSorted([...existing.wcag, ...finding.wcag]);
    existing.urls = context.urls;
    existing.viewports = context.viewports;
    existing.selectors = context.selectors;
    existing.evidence = context.evidence;
    if (context.componentName) existing.componentName = context.componentName;
    if (context.componentLocation) existing.componentLocation = context.componentLocation;
  };
  const localFindings = new Map<string, Finding>();
  const ordered = [...findings].sort((a, b) => JSON.stringify([
    a.ruleId,
    a.key,
    uniqueSorted(a.urls),
    uniqueSorted(a.viewports),
    uniqueSorted(a.selectors),
    a.componentName ?? '',
    a.componentLocation ?? ''
  ]).localeCompare(JSON.stringify([
    b.ruleId,
    b.key,
    uniqueSorted(b.urls),
    uniqueSorted(b.viewports),
    uniqueSorted(b.selectors),
    b.componentName ?? '',
    b.componentLocation ?? ''
  ])));
  const reportingUnits = rollUpReviewComponentLinks(
    rollUpBrokenComponentLinks(rollUpDescriptionListStructure(ordered))
  );
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
    return rank[a.classification] - rank[b.classification]
      || a.ruleId.localeCompare(b.ruleId)
      || a.key.localeCompare(b.key)
      || uniqueSorted(a.urls).join('|').localeCompare(uniqueSorted(b.urls).join('|'));
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
