import { buildWorkflow, normalizeTargetUrl, type AuditTarget } from './workflow.js';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`The workflow generator is missing ${selector}.`);
  return element;
}

const form = requiredElement<HTMLFormElement>('#workflow-form');
const input = requiredElement<HTMLInputElement>('#target-url');
const error = requiredElement<HTMLElement>('#url-error');
const result = requiredElement<HTMLElement>('#workflow-result');
const resultDescription = requiredElement<HTMLElement>('#result-description');
const workflowCode = requiredElement<HTMLElement>('#workflow-code');
const copyButton = requiredElement<HTMLButtonElement>('#copy-workflow');
const downloadAgainButton = requiredElement<HTMLButtonElement>('#download-again');
const copyStatus = requiredElement<HTMLElement>('#copy-status');

let currentWorkflow = '';
let currentTarget: AuditTarget | undefined;

function downloadWorkflow(workflow: string): void {
  const blob = new Blob([workflow], { type: 'text/yaml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'accessibility-audit.yml';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function prepareWorkflow(): void {
  try {
    currentTarget = normalizeTargetUrl(input.value);
    currentWorkflow = buildWorkflow(currentTarget);
    input.removeAttribute('aria-invalid');
    error.textContent = '';
    copyStatus.textContent = '';
    workflowCode.textContent = currentWorkflow;
    resultDescription.textContent = `The workflow is securely limited to ${currentTarget.hostname}.`;
    result.hidden = false;
    result.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    document.querySelector<HTMLElement>('#workflow-result-title')?.focus({ preventScroll: true });
  } catch (caught) {
    input.setAttribute('aria-invalid', 'true');
    error.textContent = caught instanceof Error ? caught.message : 'Enter a valid public website URL.';
    input.focus();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  prepareWorkflow();
});

downloadAgainButton.addEventListener('click', () => {
  if (currentWorkflow) downloadWorkflow(currentWorkflow);
});

copyButton.addEventListener('click', async () => {
  if (!currentWorkflow) return;

  try {
    await navigator.clipboard.writeText(currentWorkflow);
    copyStatus.textContent = 'Workflow code copied.';
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(workflowCode);
    selection?.removeAllRanges();
    selection?.addRange(range);
    copyStatus.textContent = 'The workflow code is selected. Press Ctrl+C or Command+C to copy it.';
  }
});

input.addEventListener('input', () => {
  input.removeAttribute('aria-invalid');
  error.textContent = '';
});
