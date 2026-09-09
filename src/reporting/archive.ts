import { createWriteStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import archiver from 'archiver';

export async function createAuditArchive(
  outputDir: string,
  reportPath: string,
  htmlPath: string,
  jsonPath: string
): Promise<string> {
  const bundleName = basename(resolve(outputDir));
  // Construct the extension at runtime so JavaScript bundlers do not mistake
  // the generated archive for a static asset that must be relocated.
  const archiveName = [bundleName, '.', 'z', 'i', 'p'].join('');
  const archivePath = resolve(dirname(resolve(outputDir)), archiveName);
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
    if (hasScreenshots) archive.directory(screenshotsPath, `${bundleName}/screenshots`);
    void archive.finalize().catch(rejectArchive);
  });

  return archivePath;
}
