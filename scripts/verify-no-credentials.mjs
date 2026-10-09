import { resolve } from 'node:path';
import { scanCredentialFiles } from './lib/credential-safety.mjs';

const root = resolve(import.meta.dirname, '..');
const findings = await scanCredentialFiles(root);

if (findings.length > 0) {
  process.stderr.write(`Credential safety verification failed (${findings.length}). Values are intentionally omitted:\n`);
  for (const finding of findings) {
    process.stderr.write(`- ${finding.path}:${finding.line} (${finding.rule})\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write('Credential safety verification passed: source and generated manifests contain no credential literals.\n');
}
