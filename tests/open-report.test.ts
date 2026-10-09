import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { openReport, reportOpenCommand } from '../src/open-report.js';

describe('report opening', () => {
  it.each([
    ['darwin', 'open'],
    ['win32', 'explorer.exe'],
    ['linux', 'xdg-open']
  ] as const)('uses the native opener on %s and passes the path as one argument', (platform, command) => {
    expect(reportOpenCommand('/tmp/report with spaces.html', platform)).toEqual({
      command,
      args: ['/tmp/report with spaces.html']
    });
  });

  it('reports unsupported platforms without starting a process', async () => {
    const spawnProcess = vi.fn();
    expect(await openReport('/tmp/report.html', 'aix', spawnProcess)).toBe(false);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('opens without a shell and detaches from the CLI process', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() }) as unknown as ReturnType<typeof spawn>;
    const spawnProcess = vi.fn(() => child);
    const opened = openReport('/tmp/report with spaces.html', 'linux', spawnProcess);
    child.emit('spawn');

    await expect(opened).resolves.toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith('xdg-open', ['/tmp/report with spaces.html'], {
      detached: true,
      shell: false,
      stdio: 'ignore'
    });
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('returns false when the native opener cannot start', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() }) as unknown as ReturnType<typeof spawn>;
    const opened = openReport('/tmp/report.html', 'linux', () => child);
    child.emit('error', new Error('opener unavailable'));
    await expect(opened).resolves.toBe(false);
  });
});
