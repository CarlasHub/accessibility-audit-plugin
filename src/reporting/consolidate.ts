import type { Finding } from '../types.js';

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
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

export function consolidateFindings(findings: Finding[]): Finding[] {
  const merge = (existing: Finding, finding: Finding): void => {
    existing.wcag = uniqueSorted([...existing.wcag, ...finding.wcag]);
    existing.urls = uniqueSorted([...existing.urls, ...finding.urls]);
    existing.viewports = uniqueSorted([...existing.viewports, ...finding.viewports]);
    existing.selectors = uniqueSorted([...existing.selectors, ...finding.selectors]);
    existing.evidence.push(...finding.evidence);
  };
  const localFindings = new Map<string, Finding>();
  for (const finding of findings) {
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
      name: renderedName,
      // Generic unnamed controls can share identical markup across unrelated widgets.
      // Their rendered location is therefore required before cross-page consolidation.
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
