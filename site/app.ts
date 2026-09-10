import {
  buildWorkflow,
  MAX_AUDIT_TARGETS,
  normalizeTargetUrl,
  normalizeTargetUrls,
  type AuditTarget
} from './workflow.js';

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required page element: ${selector}`);
  return element;
}

const form = requiredElement<HTMLFormElement>('#workflow-form');
const urlList = requiredElement<HTMLDivElement>('#url-list');
const addUrlButton = requiredElement<HTMLButtonElement>('#add-url');
const urlCount = requiredElement<HTMLSpanElement>('#url-count');
const errorMessage = requiredElement<HTMLParagraphElement>('#url-error');
const result = requiredElement<HTMLElement>('#workflow-result');
const resultTitle = requiredElement<HTMLHeadingElement>('#workflow-result-title');
const resultDescription = requiredElement<HTMLParagraphElement>('#result-description');
const workflowCode = requiredElement<HTMLElement>('#workflow-code');
const copyButton = requiredElement<HTMLButtonElement>('#copy-workflow');
const downloadButton = requiredElement<HTMLButtonElement>('#download-again');
const copyStatus = requiredElement<HTMLParagraphElement>('#copy-status');
const progress = requiredElement<HTMLDivElement>('#setup-progress');
const progressStatus = requiredElement<HTMLOutputElement>('#quest-status');

let currentWorkflow = '';

function getRows(): HTMLDivElement[] {
  return Array.from(urlList.querySelectorAll<HTMLDivElement>('.url-field'));
}

function getInputs(): HTMLInputElement[] {
  return getRows().map((row) => requiredElementInRow<HTMLInputElement>(row, 'input[name="urls"]'));
}

function requiredElementInRow<T extends HTMLElement>(row: HTMLElement, selector: string): T {
  const element = row.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required URL field element: ${selector}`);
  return element;
}

function setProgress(stage: 1 | 2): void {
  const label = stage === 1 ? 'Stage 1 of 4: add pages' : 'Stage 2 of 4: workflow ready';
  progress.setAttribute('aria-valuenow', String(stage));
  progress.setAttribute('aria-valuetext', label);
  progressStatus.value = label;

  progress.querySelectorAll<HTMLElement>('.pixel-block').forEach((block, index) => {
    block.classList.toggle('is-active', index < stage * 2);
  });
}

function clearFieldErrors(): void {
  errorMessage.textContent = '';
  getInputs().forEach((input) => {
    input.removeAttribute('aria-invalid');
    input.setCustomValidity('');
  });
}

function showFieldError(input: HTMLInputElement, message: string): void {
  input.setAttribute('aria-invalid', 'true');
  input.setCustomValidity(message);
  errorMessage.textContent = message;
  input.focus();
}

function invalidatePreparedWorkflow(): void {
  if (!currentWorkflow) return;
  currentWorkflow = '';
  workflowCode.textContent = '';
  copyStatus.textContent = '';
  result.hidden = true;
  setProgress(1);
}

function refreshRows(): void {
  const rows = getRows();

  rows.forEach((row, index) => {
    const pageNumber = index + 1;
    const label = requiredElementInRow<HTMLLabelElement>(row, 'label');
    const input = requiredElementInRow<HTMLInputElement>(row, 'input[name="urls"]');
    const removeButton = requiredElementInRow<HTMLButtonElement>(row, '.remove-url');

    input.id = `target-url-${pageNumber}`;
    label.htmlFor = input.id;
    label.textContent = `Page ${pageNumber} URL`;
    removeButton.hidden = rows.length === 1;
    removeButton.setAttribute('aria-label', `Remove page ${pageNumber} URL`);
  });

  addUrlButton.disabled = rows.length >= MAX_AUDIT_TARGETS;
  urlCount.textContent = `${rows.length} of ${MAX_AUDIT_TARGETS} pages`;
}

function createUrlRow(): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'url-field';

  const label = document.createElement('label');
  const inputRow = document.createElement('div');
  const input = document.createElement('input');
  const removeButton = document.createElement('button');

  inputRow.className = 'url-input-row';
  input.name = 'urls';
  input.type = 'url';
  input.inputMode = 'url';
  input.setAttribute('autocomplete', 'url');
  input.spellcheck = false;
  input.required = true;
  input.placeholder = 'https://example.com/page';
  input.setAttribute('aria-describedby', 'url-hint url-error');

  removeButton.className = 'remove-url';
  removeButton.type = 'button';
  removeButton.textContent = 'Remove';

  inputRow.append(input, removeButton);
  row.append(label, inputRow);
  return row;
}

function locateInvalidInput(message: string): HTMLInputElement {
  const inputs = getInputs();
  const seen = new Map<string, HTMLInputElement>();

  for (const input of inputs) {
    try {
      const target = normalizeTargetUrl(input.value);
      const earlierInput = seen.get(target.url);
      if (earlierInput) return input;
      seen.set(target.url, input);
    } catch {
      return input;
    }
  }

  const matchingInput = inputs.find((input) => message.includes(input.value.trim()));
  const fallbackInput = inputs[0];
  if (!fallbackInput) throw new Error('At least one URL field is required.');
  return matchingInput ?? fallbackInput;
}

function downloadWorkflow(): void {
  if (!currentWorkflow) return;
  const blob = new Blob([currentWorkflow], { type: 'text/yaml;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = 'accessibility-audit.yml';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function prepareWorkflow(): void {
  clearFieldErrors();
  const inputs = getInputs();
  const blankInput = inputs.find((input) => input.value.trim() === '');
  if (blankInput) {
    showFieldError(blankInput, 'Enter a complete URL for every page, or remove the empty row.');
    return;
  }

  let targets: AuditTarget[];
  try {
    targets = normalizeTargetUrls(inputs.map((input) => input.value));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Check the page URLs and try again.';
    showFieldError(locateInvalidInput(message), message);
    return;
  }

  currentWorkflow = buildWorkflow(targets);
  workflowCode.textContent = currentWorkflow;
  copyStatus.textContent = '';
  const hostCount = new Set(targets.map((target) => target.hostname)).size;
  resultDescription.textContent = `Configured for ${targets.length} ${targets.length === 1 ? 'page' : 'pages'} across ${hostCount} ${hostCount === 1 ? 'host' : 'hosts'}, with one combined report.`;
  result.hidden = false;
  setProgress(2);
  result.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  resultTitle.focus({ preventScroll: true });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  prepareWorkflow();
});

addUrlButton.addEventListener('click', () => {
  if (getRows().length >= MAX_AUDIT_TARGETS) return;
  clearFieldErrors();
  invalidatePreparedWorkflow();
  const row = createUrlRow();
  urlList.append(row);
  refreshRows();
  requiredElementInRow<HTMLInputElement>(row, 'input').focus();
});

urlList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const removeButton = target.closest<HTMLButtonElement>('.remove-url');
  if (!removeButton) return;

  const row = removeButton.closest<HTMLDivElement>('.url-field');
  if (!row || getRows().length === 1) return;
  const rows = getRows();
  const removedIndex = rows.indexOf(row);
  row.remove();
  clearFieldErrors();
  invalidatePreparedWorkflow();
  refreshRows();

  const remainingInputs = getInputs();
  const focusTarget = remainingInputs[Math.min(removedIndex, remainingInputs.length - 1)] ?? addUrlButton;
  focusTarget.focus();
});

urlList.addEventListener('input', () => {
  clearFieldErrors();
  invalidatePreparedWorkflow();
});

copyButton.addEventListener('click', async () => {
  if (!currentWorkflow) return;
  try {
    await navigator.clipboard.writeText(currentWorkflow);
    copyStatus.textContent = 'Workflow copied. Create the file in your repository and paste it there.';
    copyButton.textContent = 'Copied';
    window.setTimeout(() => {
      copyButton.textContent = 'Copy workflow code';
    }, 1800);
  } catch {
    copyStatus.textContent = 'Copy was blocked by your browser. Open the workflow preview and copy the code manually.';
  }
});

downloadButton.addEventListener('click', downloadWorkflow);
refreshRows();
