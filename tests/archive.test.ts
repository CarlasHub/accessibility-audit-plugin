import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createAuditArchive } from '../src/reporting/archive.js';

describe('portable audit archive', () => {
  it('packages the workbook, JSON, and screenshot directory beside the output folder', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'a11y-archive-'));
    const outputDir = join(parent, 'Audit Results');
    const screenshotDir = join(outputDir, 'screenshots', 'elements');
    await mkdir(screenshotDir, { recursive: true });
    const reportPath = join(outputDir, 'Audit.xlsx');
    const jsonPath = join(outputDir, 'audit-results.json');
    await Promise.all([
      writeFile(reportPath, 'workbook'),
      writeFile(jsonPath, '{}'),
      writeFile(join(screenshotDir, 'finding.png'), 'png')
    ]);

    const archivePath = await createAuditArchive(outputDir, reportPath, jsonPath);
    const archive = await readFile(archivePath);

    expect(archivePath).toBe(join(parent, 'Audit Results.zip'));
    expect(archive.subarray(0, 2).toString()).toBe('PK');
    expect(archive.toString('latin1')).toContain('Audit Results/Audit.xlsx');
    expect(archive.toString('latin1')).toContain('Audit Results/audit-results.json');
    expect(archive.toString('latin1')).toContain('Audit Results/screenshots/elements/finding.png');
  });
});
