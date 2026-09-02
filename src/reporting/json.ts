import { writeFile } from 'node:fs/promises';
import type { AuditSummary } from '../types.js';

export async function writeJsonReport(summary: AuditSummary, outputPath: string): Promise<string> {
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return outputPath;
}
