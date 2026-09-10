import { nvdaTest as test } from '@guidepup/playwright';
import { expect } from '@playwright/test';
import { navigationStepLimit, screenReaderTargetUrl, writeScreenReaderEvidence, type ScreenReaderJourneyStep } from './evidence.js';

test('captures a bounded NVDA journey and spoken transcript', async ({ page, nvda }, testInfo) => {
  const url = screenReaderTargetUrl();
  const journey: ScreenReaderJourneyStep[] = [];
  await page.goto(url, { waitUntil: 'load' });
  await nvda.navigateToWebContent();
  journey.push({ command: 'Navigate to web content', spokenPhrase: await nvda.lastSpokenPhrase() });
  for (const command of [
    ['Next heading', () => nvda.nextHeading()],
    ['Next landmark', () => nvda.nextLandmark()],
    ['Next link', () => nvda.nextLink()]
  ] as const) {
    await command[1]();
    journey.push({ command: command[0], spokenPhrase: await nvda.lastSpokenPhrase() });
  }
  for (let index = journey.length; index < navigationStepLimit(); index += 1) {
    await nvda.next();
    journey.push({ command: `Next item ${index - 2}`, spokenPhrase: await nvda.lastSpokenPhrase() });
  }
  const transcript = await nvda.spokenPhraseLog();
  await writeScreenReaderEvidence({ page, testInfo, targetUrl: url, screenReader: 'NVDA', journey, transcript });
  expect(transcript.length, 'NVDA must produce spoken evidence').toBeGreaterThan(0);
});
