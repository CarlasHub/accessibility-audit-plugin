import type { Finding } from '../types.js';

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export function consolidateFindings(findings: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const finding of findings) {
    const canonicalRule = (() => {
      if (['axe-image-alt', 'image-missing-alt'].includes(finding.ruleId)) return 'image-alt';
      if (['axe-label', 'form-field-no-label'].includes(finding.ruleId)) return 'form-label';
      if (['axe-button-name', 'axe-link-name', 'interactive-control-no-name'].includes(finding.ruleId)) return 'control-name';
      return finding.ruleId;
    })();
    const rootCause = JSON.stringify({
      canonicalRule,
      classification: finding.classification,
      severity: finding.severity,
      wcag: uniqueSorted(finding.wcag),
      summary: finding.summary,
      issue: finding.issue,
      remediation: finding.remediation
    });
    const pageIdentity = uniqueSorted(finding.urls).join('|');
    const consolidationScope = finding.sharedComponentKey
      ? `shared:${finding.sharedComponentKey}`
      : `page:${pageIdentity}`;
    const consolidationKey = `${consolidationScope}|${finding.component}|${rootCause}`;
    const existing = byKey.get(consolidationKey);
    if (!existing) {
      byKey.set(consolidationKey, {
        ...finding,
        wcag: uniqueSorted(finding.wcag),
        urls: uniqueSorted(finding.urls),
        viewports: uniqueSorted(finding.viewports),
        selectors: uniqueSorted(finding.selectors),
        evidence: [...finding.evidence]
      });
      continue;
    }
    existing.wcag = uniqueSorted([...existing.wcag, ...finding.wcag]);
    existing.urls = uniqueSorted([...existing.urls, ...finding.urls]);
    existing.viewports = uniqueSorted([...existing.viewports, ...finding.viewports]);
    existing.selectors = uniqueSorted([...existing.selectors, ...finding.selectors]);
    existing.evidence.push(...finding.evidence);
  }
  return [...byKey.values()].sort((a, b) => {
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
