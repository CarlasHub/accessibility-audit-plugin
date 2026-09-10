import type { Page, TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { resolve } from 'node:path';

export interface ScreenReaderJourneyStep {
  command: string;
  spokenPhrase: string;
}

interface ScreenReaderEvidenceInput {
  page: Page;
  testInfo: TestInfo;
  targetUrl: string;
  screenReader: 'VoiceOver' | 'NVDA';
  journey: ScreenReaderJourneyStep[];
  transcript: string[];
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function targetUrl(): string {
  const value = process.env.A11Y_TARGET_URL?.trim();
  if (!value) throw new Error('Set A11Y_TARGET_URL to the explicit http(s) page to assess.');
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('A11Y_TARGET_URL must use http or https.');
  return parsed.href;
}

export function screenReaderTargetUrl(): string {
  return targetUrl();
}

export function navigationStepLimit(): number {
  const parsed = Number(process.env.A11Y_SCREEN_READER_STEPS ?? '20');
  return Number.isInteger(parsed) && parsed >= 4 && parsed <= 100 ? parsed : 20;
}

export async function writeScreenReaderEvidence(input: ScreenReaderEvidenceInput): Promise<void> {
  const browser = input.page.context().browser();
  const inventory = await input.page.evaluate(() => ({
    documentTitle: document.title,
    language: document.documentElement.lang || null,
    headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((element) => ({
      level: Number(element.tagName.slice(1)),
      text: element.textContent?.trim() ?? ''
    })),
    landmarks: [...document.querySelectorAll('header,nav,main,aside,footer,[role="banner"],[role="navigation"],[role="main"],[role="complementary"],[role="contentinfo"],[role="search"]')]
      .map((element) => element.getAttribute('role') || element.tagName.toLowerCase()),
    interactiveElementCount: document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])').length
  }));
  const warnings = [
    ...(input.transcript.length ? [] : ['No spoken phrases were captured; treat this run as inconclusive.']),
    ...(inventory.headings.length ? [] : ['The page exposes no native heading elements.']),
    ...(inventory.landmarks.length ? [] : ['The page exposes no native or explicit landmark elements.'])
  ];
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    targetUrl: input.targetUrl,
    screenReader: input.screenReader,
    status: input.transcript.length ? 'evidence-captured' : 'inconclusive',
    environment: {
      operatingSystem: `${platform()} ${release()} (${arch()})`,
      node: process.version,
      browser: input.testInfo.project.name,
      browserVersion: browser?.version() ?? 'unknown',
      guidepup: process.env.npm_package_devDependencies__guidepup_guidepup ?? 'pinned in package-lock.json'
    },
    journey: input.journey,
    transcript: input.transcript,
    pageInventory: inventory,
    warnings,
    conformanceNotice: 'This is repeatable assistive-technology evidence, not a WCAG conformance decision. A qualified human must review announcements, reading order, names, roles, states, instructions, and task completion.'
  };
  const outputDirectory = resolve(process.env.A11Y_SCREEN_READER_EVIDENCE_DIR ?? `screen-reader-evidence/${input.screenReader.toLowerCase()}`);
  await mkdir(outputDirectory, { recursive: true });
  const baseName = input.screenReader.toLowerCase();
  const jsonPath = resolve(outputDirectory, `${baseName}-evidence.json`);
  const markdownPath = resolve(outputDirectory, `${baseName}-report.md`);
  const htmlPath = resolve(outputDirectory, `${baseName}-report.html`);
  const markdown = `# ${input.screenReader} accessibility evidence\n\n- Target: ${input.targetUrl}\n- Status: ${evidence.status}\n- Environment: ${evidence.environment.operatingSystem}; ${evidence.environment.browser} ${evidence.environment.browserVersion}; Node ${evidence.environment.node}\n- Generated: ${evidence.generatedAt}\n\n## Deterministic journey\n\n${input.journey.map((step, index) => `${index + 1}. **${step.command}** — ${step.spokenPhrase || '_No phrase captured_'}`).join('\n')}\n\n## Complete spoken transcript\n\n${input.transcript.map((phrase, index) => `${index + 1}. ${phrase}`).join('\n') || '_No spoken phrases captured._'}\n\n## Human assessment required\n\n${evidence.conformanceNotice}\n${warnings.length ? `\n## Warnings\n\n${warnings.map((warning) => `- ${warning}`).join('\n')}\n` : ''}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.screenReader)} accessibility evidence</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#202124;background:#f8f9fa;margin:0}main{max-width:980px;margin:auto;padding:40px 24px}.card{background:#fff;border:1px solid #dadce0;border-radius:12px;padding:24px;margin:18px 0;box-shadow:0 1px 2px #3c40431a}h1,h2{color:#174ea6}dt{font-weight:700}dd{margin:0 0 10px}li{margin:.45rem 0}.notice{border-left:5px solid #f9ab00;background:#fef7e0}.phrase{font-family:ui-monospace,monospace;white-space:pre-wrap}</style></head><body><main><h1>${escapeHtml(input.screenReader)} accessibility evidence</h1><section class="card" aria-labelledby="run"><h2 id="run">Run details</h2><dl><dt>Target</dt><dd><a href="${escapeHtml(input.targetUrl)}">${escapeHtml(input.targetUrl)}</a></dd><dt>Status</dt><dd>${escapeHtml(evidence.status)}</dd><dt>Environment</dt><dd>${escapeHtml(evidence.environment.operatingSystem)}; ${escapeHtml(evidence.environment.browser)} ${escapeHtml(evidence.environment.browserVersion)}</dd><dt>Generated</dt><dd>${escapeHtml(evidence.generatedAt)}</dd></dl></section><section class="card" aria-labelledby="journey"><h2 id="journey">Deterministic journey</h2><ol>${input.journey.map((step) => `<li><strong>${escapeHtml(step.command)}</strong><div class="phrase">${escapeHtml(step.spokenPhrase || 'No phrase captured')}</div></li>`).join('')}</ol></section><section class="card" aria-labelledby="transcript"><h2 id="transcript">Complete spoken transcript</h2><ol>${input.transcript.map((phrase) => `<li class="phrase">${escapeHtml(phrase)}</li>`).join('') || '<li>No spoken phrases captured.</li>'}</ol></section><section class="card notice" aria-labelledby="human"><h2 id="human">Human assessment required</h2><p>${escapeHtml(evidence.conformanceNotice)}</p>${warnings.length ? `<ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : ''}</section></main></body></html>`;
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8'),
    writeFile(markdownPath, markdown, 'utf8'),
    writeFile(htmlPath, html, 'utf8')
  ]);
  await Promise.all([
    input.testInfo.attach(`${input.screenReader} evidence`, { path: jsonPath, contentType: 'application/json' }),
    input.testInfo.attach(`${input.screenReader} report`, { path: htmlPath, contentType: 'text/html' })
  ]);
}
