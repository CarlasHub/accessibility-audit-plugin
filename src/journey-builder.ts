import { resolveOptions } from './config.js';
import type { AuditJourneyCategory, AuditJourneyDefinition, AuditJourneyStep } from './types.js';

export type JourneyTemplateId = 'disclosure' | 'form-errors' | 'dialog' | 'tabs' | 'live-region';

export interface JourneyTemplate {
  id: JourneyTemplateId;
  label: string;
  description: string;
  categories: AuditJourneyCategory[];
}

export const JOURNEY_TEMPLATES: readonly JourneyTemplate[] = [
  {
    id: 'disclosure',
    label: 'ARIA disclosure or menu button',
    description: 'Open a button that exposes aria-expanded and confirm its controlled content is visible.',
    categories: ['keyboard', 'interaction']
  },
  {
    id: 'form-errors',
    label: 'Form validation with announced error',
    description: 'Submit a form and confirm its invalid field and ARIA live-region or alert update.',
    categories: ['keyboard', 'forms', 'dynamic-content']
  },
  {
    id: 'dialog',
    label: 'Dialog',
    description: 'Open and close a dialog while checking predictable focus movement.',
    categories: ['keyboard', 'interaction']
  },
  {
    id: 'tabs',
    label: 'Tabs',
    description: 'Move through horizontal or vertical tabs with automatic or manual activation.',
    categories: ['keyboard', 'interaction']
  },
  {
    id: 'live-region',
    label: 'Status message',
    description: 'Trigger a change and confirm a scoped live region updates.',
    categories: ['keyboard', 'dynamic-content']
  }
] as const;

export interface GuidedJourneyBuilderRequest {
  question: (prompt: string) => Promise<string>;
  write?: (message: string) => void;
}

export class JourneyBuilderInputError extends Error {
  override name = 'JourneyBuilderInputError';
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'user-journey';
}

async function boundedAnswer(
  request: GuidedJourneyBuilderRequest,
  prompt: string,
  field: string,
  maximum: number,
  optional = false
): Promise<string> {
  while (true) {
    const answer = (await request.question(prompt)).trim();
    if (!answer && optional) return '';
    if (!answer) {
      request.write?.(`Enter ${field}; it cannot be blank.\n`);
      continue;
    }
    if (answer.length > maximum) {
      request.write?.(`${field} must be ${maximum} characters or fewer.\n`);
      continue;
    }
    return answer;
  }
}

async function choice<T extends string>(
  request: GuidedJourneyBuilderRequest,
  prompt: string,
  choices: readonly T[],
  defaultValue: T
): Promise<T> {
  while (true) {
    const answer = (await request.question(prompt)).trim().toLowerCase() || defaultValue;
    const selected = choices.find((candidate) => candidate.toLowerCase() === answer);
    if (selected) return selected;
    request.write?.(`Choose ${choices.join(' or ')}.\n`);
  }
}

async function chooseTemplate(request: GuidedJourneyBuilderRequest): Promise<JourneyTemplate> {
  const menu = JOURNEY_TEMPLATES
    .map((template, index) => `  ${index + 1}. ${template.label} — ${template.description}`)
    .join('\n');
  request.write?.(`Choose the task pattern closest to the experience you want to test:\n${menu}\n`);
  while (true) {
    const answer = (await request.question('Task pattern [1]: ')).trim().toLowerCase() || '1';
    const numeric = Number(answer);
    const template = Number.isInteger(numeric)
      ? JOURNEY_TEMPLATES[numeric - 1]
      : JOURNEY_TEMPLATES.find((candidate) => (
        candidate.id === answer || candidate.label.toLowerCase() === answer
      ));
    if (template) return template;
    request.write?.(`Choose 1-${JOURNEY_TEMPLATES.length}, a pattern ID, or the full pattern name.\n`);
  }
}

async function commonFields(request: GuidedJourneyBuilderRequest): Promise<{
  title: string;
  id: string;
  urlIncludes?: string;
  viewports?: string[];
}> {
  const title = await boundedAnswer(request, 'Journey title: ', 'a journey title', 200);
  const defaultId = slug(title);
  let id = '';
  while (!id) {
    const answer = (await request.question(
      `Stable journey ID [${defaultId}] (start with a letter or number; then letters, numbers, _ or -; max 100): `
    )).trim() || defaultId;
    if (answer.length <= 100 && /^[a-z0-9][a-z0-9_-]*$/i.test(answer)) id = answer;
    else request.write?.('The stable journey ID must start with a letter or number, contain only letters, numbers, _ or -, and be 100 characters or fewer.\n');
  }
  const urlIncludes = await boundedAnswer(
    request,
    'Only run when the URL contains (optional): ',
    'the URL substring',
    2000,
    true
  );
  let viewports: string[] = [];
  while (true) {
    const viewportAnswer = (await request.question('Viewport names, comma-separated (optional; blank means all; max 20): ')).trim();
    viewports = viewportAnswer
      ? [...new Set(viewportAnswer.split(',').map((viewport) => viewport.trim()).filter(Boolean))]
      : [];
    if (viewports.length <= 20 && viewports.every((viewport) => viewport.length <= 100)) break;
    request.write?.('Enter at most 20 viewport names, each 100 characters or fewer.\n');
  }
  return {
    title,
    id,
    ...(urlIncludes ? { urlIncludes } : {}),
    ...(viewports.length ? { viewports } : {})
  };
}

async function templateSteps(
  template: JourneyTemplateId,
  request: GuidedJourneyBuilderRequest
): Promise<AuditJourneyStep[]> {
  if (template === 'disclosure') {
    const trigger = await boundedAnswer(request, 'ARIA disclosure/menu button selector (must expose aria-expanded): ', 'the trigger selector', 1000);
    const content = await boundedAnswer(request, 'Controlled content selector shown after opening: ', 'the content selector', 1000);
    return [
      { action: 'focus', selector: trigger },
      { action: 'press', key: 'Enter' },
      { action: 'assert', expectation: 'expanded', selector: trigger },
      { action: 'assert', expectation: 'visible', selector: content }
    ];
  }
  if (template === 'form-errors') {
    const submit = await boundedAnswer(request, 'Submit control selector: ', 'the submit control selector', 1000);
    const invalid = await boundedAnswer(request, 'Field expected to become invalid: ', 'the invalid field selector', 1000);
    const errors = await boundedAnswer(request, 'ARIA live-region or role=alert/status/log selector: ', 'the announced error selector', 1000);
    const message = await boundedAnswer(request, 'Expected announced error text (optional): ', 'the expected error text', 10_000, true);
    return [
      { action: 'focus', selector: submit },
      { action: 'press', key: 'Enter' },
      { action: 'assert', expectation: 'invalid', selector: invalid },
      {
        action: 'assert',
        expectation: 'live-region-updated',
        selector: errors,
        ...(message ? { value: message } : {})
      }
    ];
  }
  if (template === 'dialog') {
    const opener = await boundedAnswer(request, 'Dialog opener selector: ', 'the dialog opener selector', 1000);
    const dialog = await boundedAnswer(request, 'Dialog selector: ', 'the dialog selector', 1000);
    const initialFocus = await boundedAnswer(request, 'Element that should receive focus in the dialog: ', 'the initial-focus selector', 1000);
    return [
      { action: 'focus', selector: opener },
      { action: 'press', key: 'Enter' },
      { action: 'assert', expectation: 'visible', selector: dialog },
      { action: 'assert', expectation: 'focused', selector: initialFocus },
      { action: 'press', key: 'Escape' },
      { action: 'assert', expectation: 'hidden', selector: dialog },
      { action: 'assert', expectation: 'focused', selector: opener }
    ];
  }
  if (template === 'tabs') {
    const orientation = await choice(request, 'Tablist orientation [horizontal] (horizontal/vertical): ', ['horizontal', 'vertical'], 'horizontal');
    const activation = await choice(request, 'Tab activation [automatic] (automatic/manual): ', ['automatic', 'manual'], 'automatic');
    const activationKey = activation === 'manual'
      ? await choice(request, 'Manual activation key [Enter] (Enter/Space): ', ['Enter', 'Space'], 'Enter')
      : undefined;
    const startingTab = await boundedAnswer(request, 'Starting tab selector: ', 'the starting tab selector', 1000);
    const nextTab = await boundedAnswer(request, 'Next tab selector: ', 'the next tab selector', 1000);
    const panel = await boundedAnswer(request, 'Panel controlled by the next tab: ', 'the controlled panel selector', 1000);
    return [
      { action: 'focus', selector: startingTab },
      { action: 'press', key: orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight' },
      { action: 'assert', expectation: 'focused', selector: nextTab },
      ...(activationKey ? [{ action: 'press', key: activationKey } satisfies AuditJourneyStep] : []),
      { action: 'assert', expectation: 'selected', selector: nextTab },
      { action: 'assert', expectation: 'visible', selector: panel }
    ];
  }
  const trigger = await boundedAnswer(request, 'Control that triggers the status update: ', 'the trigger selector', 1000);
  const region = await boundedAnswer(request, 'Live-region selector: ', 'the live-region selector', 1000);
  const message = await boundedAnswer(request, 'Expected status text (optional): ', 'the expected status text', 10_000, true);
  return [
    { action: 'focus', selector: trigger },
    { action: 'press', key: 'Enter' },
    {
      action: 'assert',
      expectation: 'live-region-updated',
      selector: region,
      ...(message ? { value: message } : {})
    }
  ];
}

/** Build one schema-valid journey without visiting a page or starting an audit. */
export async function buildGuidedJourney(request: GuidedJourneyBuilderRequest): Promise<AuditJourneyDefinition> {
  const template = await chooseTemplate(request);
  const common = await commonFields(request);
  const journey = {
    ...common,
    categories: [...template.categories],
    steps: await templateSteps(template.id, request)
  } satisfies AuditJourneyDefinition;
  let validated: AuditJourneyDefinition | undefined;
  try {
    validated = resolveOptions({ journeys: [journey] }).journeys[0];
  } catch (error) {
    const issues = error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)
      ? error.issues as Array<{ path?: Array<string | number>; message?: string }>
      : [];
    const first = issues[0];
    const field = first?.path?.join('.') || 'journey';
    const detail = first?.message || (error instanceof Error ? error.message : 'the generated values do not match the journey schema');
    throw new JourneyBuilderInputError(`Journey field "${field}" is invalid: ${detail}. Correct that answer and try again.`);
  }
  if (!validated) throw new Error('The journey builder did not produce a journey.');
  return validated;
}

export function formatJourneyJson(journey: AuditJourneyDefinition): string {
  return `${JSON.stringify([journey], null, 2)}\n`;
}
