import { writeFile } from 'node:fs/promises';
import type { AuditSummary, Finding, Severity } from '../types.js';
import { assertCanonicalAuditSummary } from '../audit/canonical-validation.js';
import { assignFindingIds } from './finding-id.js';

const SARIF_SCHEMA = 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json';

type SarifLevel = 'error' | 'warning' | 'note';

function sarifLevel(finding: Finding): SarifLevel {
  if (finding.classification !== 'confirmed') {
    return finding.classification === 'blocker' ? 'warning' : 'note';
  }
  const levels: Record<Severity, SarifLevel> = {
    Critical: 'error',
    Serious: 'error',
    Moderate: 'warning',
    Minor: 'note',
    Advisory: 'note'
  };
  return levels[finding.severity];
}

function resultKind(finding: Finding): 'fail' | 'review' {
  return finding.classification === 'confirmed' ? 'fail' : 'review';
}

export function sarifReport(summary: AuditSummary): Record<string, unknown> {
  assertCanonicalAuditSummary(summary);
  const findings = assignFindingIds(summary.findings);
  const ruleFindings = new Map<string, Finding>();
  for (const finding of findings) {
    if (!ruleFindings.has(finding.ruleId)) ruleFindings.set(finding.ruleId, finding);
  }

  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'CarlasHub Accessibility Audit',
          informationUri: 'https://github.com/CarlasHub/accessibility-audit-plugin',
          rules: [...ruleFindings.values()].map((finding) => ({
            id: finding.ruleId,
            name: finding.ruleId,
            shortDescription: { text: finding.summary },
            fullDescription: { text: finding.issue },
            defaultConfiguration: { level: sarifLevel(finding) },
            properties: {
              tags: ['accessibility', ...finding.wcag.map((criterion) => `WCAG ${criterion}`)]
            }
          }))
        }
      },
      properties: {
        auditStatus: summary.status,
        generatedAt: summary.generatedAt,
        conformanceDecision: summary.conformanceDecision ?? 'not-determined'
      },
      artifacts: [...new Set(summary.requestedUrls)].map((url) => ({ location: { uri: url } })),
      results: findings.map((finding) => ({
        ruleId: finding.ruleId,
        kind: resultKind(finding),
        level: sarifLevel(finding),
        message: { text: `${finding.summary}: ${finding.issue}` },
        locations: finding.urls.map((url, index) => ({
          physicalLocation: { artifactLocation: { uri: url } },
          ...(finding.selectors[index] || finding.selectors[0]
            ? { logicalLocations: [{ name: finding.selectors[index] ?? finding.selectors[0], kind: 'element' }] }
            : {})
        })),
        partialFingerprints: { 'accessibility-audit/v1': finding.fingerprint },
        properties: {
          auditFindingId: finding.id,
          classification: finding.classification,
          severity: finding.severity,
          wcag: finding.wcag,
          component: finding.component,
          selectors: finding.selectors,
          viewports: finding.viewports,
          remediation: finding.remediation,
          testing: finding.testing,
          assignment: finding.assignment,
          effort: finding.effort,
          evidenceCount: finding.evidence.length
        }
      }))
    }]
  };
}

export async function writeSarifReport(summary: AuditSummary, outputPath: string): Promise<string> {
  const report = sarifReport(summary);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}
