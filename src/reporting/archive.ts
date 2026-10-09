import { createWriteStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import archiver from 'archiver';

export function auditArchivePath(outputDir: string): string {
  const bundleName = basename(resolve(outputDir));
  // Construct the extension at runtime so JavaScript bundlers do not mistake
  // the generated archive for a static asset that must be relocated.
  const archiveName = [bundleName, '.', 'z', 'i', 'p'].join('');
  return resolve(dirname(resolve(outputDir)), archiveName);
}

export async function createAuditArchive(
  outputDir: string,
  reportPath: string,
  htmlPath: string,
  jsonPath: string,
  additionalPaths: string[] = []
): Promise<string> {
  const bundleName = basename(resolve(outputDir));
  const archivePath = auditArchivePath(outputDir);
  const screenshotsPath = resolve(outputDir, 'screenshots');
  const hasScreenshots = await access(screenshotsPath).then(() => true).catch(() => false);

  await new Promise<void>((resolveArchive, rejectArchive) => {
    const output = createWriteStream(archivePath, { flags: 'w' });
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.once('close', resolveArchive);
    output.once('error', rejectArchive);
    archive.once('error', rejectArchive);
    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT') rejectArchive(error);
    });
    archive.pipe(output);
    archive.file(reportPath, { name: `${bundleName}/${basename(reportPath)}` });
    archive.file(htmlPath, { name: `${bundleName}/${basename(htmlPath)}` });
    archive.file(jsonPath, { name: `${bundleName}/${basename(jsonPath)}` });
    for (const path of additionalPaths) {
      archive.file(path, { name: `${bundleName}/${basename(path)}` });
    }
    if (hasScreenshots) archive.directory(screenshotsPath, `${bundleName}/screenshots`);
    void archive.finalize().catch(rejectArchive);
  });

  return archivePath;
}
