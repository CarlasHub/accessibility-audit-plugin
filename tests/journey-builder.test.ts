import { describe, expect, it } from 'vitest';
import { buildGuidedJourney, formatJourneyJson, JOURNEY_TEMPLATES } from '../src/journey-builder.js';

function answers(values: string[]): (prompt: string) => Promise<string> {
  const remaining = [...values];
  return async () => remaining.shift() ?? '';
}

describe('guided journey builder', () => {
  it('offers common task patterns instead of requiring users to author steps', () => {
    expect(JOURNEY_TEMPLATES.map((template) => template.id)).toEqual([
      'disclosure',
      'form-errors',
      'dialog',
      'tabs',
      'live-region'
    ]);
    expect(JOURNEY_TEMPLATES[0]).toMatchObject({
      label: 'ARIA disclosure or menu button',
      description: expect.stringContaining('aria-expanded')
    });
    expect(JOURNEY_TEMPLATES[1]).toMatchObject({
      label: 'Form validation with announced error',
      description: expect.stringContaining('live-region')
    });
  });

  it('builds a schema-valid disclosure journey with safe defaults', async () => {
    const guidance: string[] = [];
    const journey = await buildGuidedJourney({
      question: answers([
        '',
        'Open the primary menu',
        '',
        '/account',
        'desktop, mobile, desktop',
        '#menu-button',
        '#primary-menu'
      ]),
      write: (message) => guidance.push(message)
    });

    expect(journey).toEqual({
      id: 'open-the-primary-menu',
      title: 'Open the primary menu',
      categories: ['keyboard', 'interaction'],
      steps: [
        { action: 'focus', selector: '#menu-button' },
        { action: 'press', key: 'Enter' },
        { action: 'assert', expectation: 'expanded', selector: '#menu-button' },
        { action: 'assert', expectation: 'visible', selector: '#primary-menu' }
      ],
      urlIncludes: '/account',
      viewports: ['desktop', 'mobile']
    });
    expect(guidance.join('')).toContain('ARIA disclosure or menu button');
    expect(JSON.parse(formatJourneyJson(journey))).toEqual([journey]);
  });

  it('builds dialog focus-return checks without changing the execution schema', async () => {
    const journey = await buildGuidedJourney({
      question: answers([
        'dialog',
        'Open help dialog',
        'help-dialog',
        '',
        '',
        '#help',
        '[role="dialog"]',
        '#close-help'
      ])
    });

    expect(journey.categories).toEqual(['keyboard', 'interaction']);
    expect(journey.steps).toEqual(expect.arrayContaining([
      { action: 'assert', expectation: 'focused', selector: '#close-help' },
      { action: 'press', key: 'Escape' },
      { action: 'assert', expectation: 'hidden', selector: '[role="dialog"]' },
      { action: 'assert', expectation: 'focused', selector: '#help' }
    ]));
  });

  it('reprompts for an unknown pattern and missing required values', async () => {
    const guidance: string[] = [];
    const journey = await buildGuidedJourney({
      question: answers([
        'unknown',
        '5',
        '',
        'Announce saved status',
        '',
        '',
        '',
        '',
        '#save',
        '#status',
        'Saved'
      ]),
      write: (message) => guidance.push(message)
    });

    expect(guidance.join('')).toContain('Choose 1-5');
    expect(journey.id).toBe('announce-saved-status');
    expect(journey.steps.at(-1)).toEqual({
      action: 'assert',
      expectation: 'live-region-updated',
      selector: '#status',
      value: 'Saved'
    });
  });

  it('validates bounded answers at entry and explains the supported ARIA semantics', async () => {
    const prompts: string[] = [];
    const guidance: string[] = [];
    const values = [
      'disclosure',
      'Open settings',
      'settings menu',
      'settings_menu',
      'x'.repeat(2001),
      '/settings',
      '',
      '#settings',
      '#settings-panel'
    ];
    const journey = await buildGuidedJourney({
      question: async (prompt) => {
        prompts.push(prompt);
        return values.shift() ?? '';
      },
      write: (message) => guidance.push(message)
    });

    expect(journey.id).toBe('settings_menu');
    expect(journey.urlIncludes).toBe('/settings');
    expect(prompts.join('')).toContain('start with a letter or number');
    expect(prompts.join('')).toContain('must expose aria-expanded');
    expect(guidance.join('')).toContain('contain only letters, numbers, _ or -');
    expect(guidance.join('')).toContain('URL substring must be 2000 characters or fewer');
  });

  it('builds horizontal automatically activated tabs by default', async () => {
    const journey = await buildGuidedJourney({
      question: answers([
        'tabs', 'Account tabs', '', '', '',
        '', '', '#profile-tab', '#security-tab', '#security-panel'
      ])
    });

    expect(journey.steps).toEqual([
      { action: 'focus', selector: '#profile-tab' },
      { action: 'press', key: 'ArrowRight' },
      { action: 'assert', expectation: 'focused', selector: '#security-tab' },
      { action: 'assert', expectation: 'selected', selector: '#security-tab' },
      { action: 'assert', expectation: 'visible', selector: '#security-panel' }
    ]);
  });

  it('builds vertical manually activated tabs with a chosen activation key', async () => {
    const journey = await buildGuidedJourney({
      question: answers([
        'tabs', 'Settings tabs', '', '', '',
        'vertical', 'manual', 'Space', '#general-tab', '#privacy-tab', '#privacy-panel'
      ])
    });

    expect(journey.steps).toEqual([
      { action: 'focus', selector: '#general-tab' },
      { action: 'press', key: 'ArrowDown' },
      { action: 'assert', expectation: 'focused', selector: '#privacy-tab' },
      { action: 'press', key: 'Space' },
      { action: 'assert', expectation: 'selected', selector: '#privacy-tab' },
      { action: 'assert', expectation: 'visible', selector: '#privacy-panel' }
    ]);
  });

  it('requires form error targets to have announcement semantics', async () => {
    const prompts: string[] = [];
    const values = ['form-errors', 'Submit contact form', '', '', '', '#submit', '#email', '#errors', 'Required'];
    await buildGuidedJourney({
      question: async (prompt) => {
        prompts.push(prompt);
        return values.shift() ?? '';
      }
    });

    expect(prompts.join('')).toContain('ARIA live-region or role=alert/status/log selector');
  });
});
