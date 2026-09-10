import { writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative } from 'node:path';
import type { AuditSummary } from '../types.js';
import { assignFindingIds } from './finding-id.js';

function portablePath(value: string, outputPath: string): string {
  if (!value) return value;
  const path = isAbsolute(value) ? relative(dirname(outputPath), value) : value;
  return path.replaceAll('\\', '/');
}

export function portableJsonSummary(summary: AuditSummary, outputPath: string): AuditSummary {
  const portable = structuredClone(summary);
  portable.findings = assignFindingIds(portable.findings);
  for (const page of portable.pages) {
    for (const viewport of page.viewports) {
      viewport.screenshot = portablePath(viewport.screenshot, outputPath);
      for (const item of viewport.elementScreenshots) item.path = portablePath(item.path, outputPath);
    }
  }
  for (const finding of portable.findings) {
    for (const evidence of finding.evidence) {
      if (evidence.screenshot) evidence.screenshot = portablePath(evidence.screenshot, outputPath);
    }
  }
  return portable;
}

export async function writeJsonReport(summary: AuditSummary, outputPath: string): Promise<string> {
  await writeFile(outputPath, `${JSON.stringify(portableJsonSummary(summary, outputPath), null, 2)}\n`, 'utf8');
  return outputPath;
}
