import { spawn, type SpawnOptions } from 'node:child_process';

export interface ReportOpenCommand {
  command: string;
  args: string[];
}

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ReturnType<typeof spawn>;

export function reportOpenCommand(
  reportPath: string,
  platform: NodeJS.Platform = process.platform
): ReportOpenCommand | null {
  if (platform === 'darwin') return { command: 'open', args: [reportPath] };
  if (platform === 'win32') return { command: 'explorer.exe', args: [reportPath] };
  if (platform === 'linux') return { command: 'xdg-open', args: [reportPath] };
  return null;
}

export async function openReport(
  reportPath: string,
  platform: NodeJS.Platform = process.platform,
  spawnProcess: SpawnProcess = spawn
): Promise<boolean> {
  const launch = reportOpenCommand(reportPath, platform);
  if (!launch) return false;

  return await new Promise<boolean>((resolveOpen) => {
    const child = spawnProcess(launch.command, launch.args, {
      detached: true,
      shell: false,
      stdio: 'ignore'
    });
    child.once('spawn', () => {
      child.unref();
      resolveOpen(true);
    });
    child.once('error', () => { resolveOpen(false); });
  });
}
