import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { formatDoctorReport, probeOutputDirectory, runDoctor } from '../src/doctor.js';

function passingDependencies() {
  return {
    nodeVersion: '22.12.0',
    assertTemplate: vi.fn(async () => undefined),
    probeOutput: vi.fn(async () => undefined),
    launchBrowser: vi.fn(async (options: object | undefined, engine?: 'chromium' | 'firefox' | 'webkit') => {
      void options;
      void engine;
      return { close: vi.fn(async () => undefined) };
    })
  };
}

describe('audit doctor', () => {
  it('reports a ready environment after checking every prerequisite without installing software', async () => {
    const dependencies = passingDependencies();
    const report = await runDoctor({}, dependencies);

    expect(report.status).toBe('ready');
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ['node', 'pass'],
      ['template', 'pass'],
      ['output', 'pass'],
      ['browser', 'pass']
    ]);
    expect(dependencies.launchBrowser).toHaveBeenCalledTimes(1);
    expect(dependencies.launchBrowser.mock.calls[0]?.[0]).toMatchObject({ headless: true });
    expect(formatDoctorReport(report)).toContain('Ready to run an accessibility audit.');
  });

  it('returns stable, actionable failures without exposing configured local paths', async () => {
    const secretOutput = '/Users/example/Private Client/results';
    const secretTemplate = '/Users/example/Private Client/template.xlsx';
    const report = await runDoctor({
      outputDir: secretOutput,
      templatePath: secretTemplate,
      executablePath: '/Users/example/Browsers/chromium'
    }, {
      nodeVersion: '20.19.0',
      assertTemplate: vi.fn(async () => { throw new Error(`Missing ${secretTemplate}`); }),
      probeOutput: vi.fn(async () => { throw new Error(`Denied ${secretOutput}`); }),
      launchBrowser: vi.fn(async () => { throw new Error('Executable does not exist at /Users/example/Browsers/chromium'); })
    });
    const serialized = JSON.stringify(report);

    expect(report.status).toBe('needs-attention');
    expect(report.checks.every((check) => check.status === 'fail')).toBe(true);
    expect(report.checks.flatMap((check) => check.nextActions)).toEqual(expect.arrayContaining([
      expect.stringContaining('Node.js 22'),
      expect.stringContaining('--template'),
      expect.stringContaining('--output'),
      expect.stringContaining('--executable-path')
    ]));
    expect(serialized).not.toContain('/Users/example');
  });

  it('falls back through bundled Chromium, Chrome, and Edge when no browser is configured', async () => {
    const close = vi.fn(async () => undefined);
    const launchBrowser = vi.fn()
      .mockRejectedValueOnce(new Error('Executable does not exist'))
      .mockRejectedValueOnce(new Error('Browser channel chrome not found'))
      .mockResolvedValueOnce({ close });
    const report = await runDoctor({}, { ...passingDependencies(), launchBrowser });

    expect(report.status).toBe('ready');
    expect(launchBrowser).toHaveBeenCalledTimes(3);
    expect(launchBrowser.mock.calls.map((call) => call[0]?.channel)).toEqual([undefined, 'chrome', 'msedge']);
    expect(close).toHaveBeenCalledOnce();
  });

  it('checks only the selected opt-in engine and rejects Chromium channels for it', async () => {
    const dependencies = passingDependencies();
    const report = await runDoctor({ browserEngine: 'firefox' }, dependencies);

    expect(report.status).toBe('ready');
    expect(dependencies.launchBrowser).toHaveBeenCalledOnce();
    expect(dependencies.launchBrowser.mock.calls[0]?.[1]).toBe('firefox');
    expect(report.checks.find((check) => check.id === 'browser')?.detail).toContain('Playwright Firefox');

    const invalid = await runDoctor({ browserEngine: 'webkit', channel: 'chrome' }, passingDependencies());
    expect(invalid.status).toBe('needs-attention');
    expect(invalid.checks.find((check) => check.id === 'browser')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('only with the Chromium engine')
    });
  });

  it('checks a future output location with a temporary probe and leaves no probe behind', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'a11y-doctor-'));
    const intendedOutput = join(parent, 'future', 'results');
    try {
      await probeOutputDirectory(intendedOutput);
      expect(await readdir(parent)).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('fails when reports fit inside the output directory but its sibling ZIP cannot be created', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'a11y-doctor-archive-parent-'));
    const output = join(parent, 'results');
    await mkdir(output);
    const checked: string[] = [];
    const probeWritable = vi.fn(async (path: string) => {
      checked.push(path);
      if (path === parent) throw new Error('Archive parent is not writable');
    });
    try {
      const report = await runDoctor({ outputDir: output }, {
        ...passingDependencies(),
        probeOutput: (path) => probeOutputDirectory(path, probeWritable)
      });

      expect(checked).toEqual([output, parent]);
      expect(report.status).toBe('needs-attention');
      expect(report.checks.find((check) => check.id === 'output')).toMatchObject({ status: 'fail' });
      expect(JSON.stringify(report)).not.toContain(parent);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('does not modify an existing portable archive while checking its write access', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'a11y-doctor-existing-archive-'));
    const output = join(parent, 'results');
    const archive = join(parent, 'results.zip');
    try {
      await mkdir(output);
      await writeFile(archive, 'keep this archive');
      await probeOutputDirectory(output);

      expect(await readFile(archive, 'utf8')).toBe('keep this archive');
      expect((await readdir(parent)).sort()).toEqual(['results', 'results.zip']);
      expect(await readdir(output)).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a dangling archive symlink without modifying or removing it',
    async () => {
      const parent = await mkdtemp(join(tmpdir(), 'a11y-doctor-dangling-archive-'));
      const output = join(parent, 'results');
      const archive = join(parent, 'results.zip');
      const missingTarget = join(parent, 'missing', 'archive.zip');
      try {
        await mkdir(output);
        await symlink(missingTarget, archive);

        await expect(probeOutputDirectory(output)).rejects.toThrow('not a regular file');
        expect(await import('node:fs/promises').then(({ readlink }) => readlink(archive))).toBe(missingTarget);
        expect((await readdir(parent)).sort()).toEqual(['results', 'results.zip']);
        expect(await readdir(output)).toEqual([]);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    }
  );

  it('rejects an output location that is an existing file', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'a11y-doctor-file-'));
    const file = join(parent, 'results');
    try {
      await writeFile(file, 'not a directory');
      await expect(probeOutputDirectory(file)).rejects.toThrow('existing file');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
