import { voiceOverTest as test } from '@guidepup/playwright';
import { expect } from '@playwright/test';
import { navigationStepLimit, screenReaderTargetUrl, writeScreenReaderEvidence, type ScreenReaderJourneyStep } from './evidence.js';

test('captures a bounded VoiceOver journey and spoken transcript', async ({ page, voiceOver }, testInfo) => {
  const url = screenReaderTargetUrl();
  const journey: ScreenReaderJourneyStep[] = [];
  await page.goto(url, { waitUntil: 'load' });
  await voiceOver.navigateToWebContent();
  journey.push({ command: 'Navigate to web content', spokenPhrase: await voiceOver.lastSpokenPhrase() });
  for (const command of [
    ['Next heading', () => voiceOver.nextHeading()],
    ['Next landmark', () => voiceOver.nextLandmark()],
    ['Next link', () => voiceOver.nextLink()]
  ] as const) {
    await command[1]();
    journey.push({ command: command[0], spokenPhrase: await voiceOver.lastSpokenPhrase() });
  }
  for (let index = journey.length; index < navigationStepLimit(); index += 1) {
    await voiceOver.next();
    journey.push({ command: `Next item ${index - 2}`, spokenPhrase: await voiceOver.lastSpokenPhrase() });
  }
  const transcript = await voiceOver.spokenPhraseLog();
  await writeScreenReaderEvidence({ page, testInfo, targetUrl: url, screenReader: 'VoiceOver', journey, transcript });
  expect(transcript.length, 'VoiceOver must produce spoken evidence').toBeGreaterThan(0);
});
