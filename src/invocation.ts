import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function isDirectInvocation(moduleUrl: string, argvPath?: string): boolean {
  if (!argvPath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvPath));
  } catch {
    return moduleUrl === pathToFileURL(resolve(argvPath)).href;
  }
}
