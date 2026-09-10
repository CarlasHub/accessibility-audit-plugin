import type { Finding } from '../types.js';

export function findingId(finding: Finding, index: number): string {
  return finding.id ?? `A11Y${String(index + 1).padStart(3, '0')}`;
}

export function assignFindingIds(findings: Finding[]): Finding[] {
  return findings.map((finding, index) => ({
    ...finding,
    id: findingId(finding, index)
  }));
}
