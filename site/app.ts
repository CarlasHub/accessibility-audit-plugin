import {
  buildGitHubWorkflowEditorUrl,
  buildWorkflow,
  MAX_AUDIT_TARGETS,
  normalizeGitHubRepository,
  normalizeTargetUrl,
  normalizeTargetUrls,
  type AuditTarget
} from './workflow.js';
import {
  buildAuthorizationUrl,
  buildInstallationUrl,
  captureOAuthSession,
  hasConnectorSession,
  listAccessibleRepositories,
  readConnectorConfig,
  resolvePublicRepositoryDefaultBranch,
  saveAuditDraft,
  setUpAndRunAudit,
  takeAuditDraft,
  type GitHubRepositoryOption
} from './github-connector.js';

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
const copyError = requiredElement<HTMLParagraphElement>('#copy-error');
const progress = requiredElement<HTMLDivElement>('#setup-progress');
const progressStatus = requiredElement<HTMLOutputElement>('#quest-status');
const launchButton = requiredElement<HTMLButtonElement>('#launch-audit');
const buildWorkflowButton = requiredElement<HTMLButtonElement>('#build-workflow');
const launchStatus = requiredElement<HTMLParagraphElement>('#launch-status');
const launchError = requiredElement<HTMLParagraphElement>('#launch-error');
const destinationInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="destination"]')
);
const repositoryField = requiredElement<HTMLDivElement>('#repository-field');
const repositoryInput = requiredElement<HTMLInputElement>('#repository-name');
const repositoryError = requiredElement<HTMLParagraphElement>('#repository-error');
const chooseRepositoryButton = requiredElement<HTMLButtonElement>('#choose-repository');
const manageRepositoryAccess = requiredElement<HTMLAnchorElement>('#manage-repository-access');
const repositoryDialog = requiredElement<HTMLDialogElement>('#repository-dialog');
const closeRepositoryDialog = requiredElement<HTMLButtonElement>('#close-repository-dialog');
const repositorySearch = requiredElement<HTMLInputElement>('#repository-search');
const repositoryPickerStatus = requiredElement<HTMLParagraphElement>('#repository-picker-status');
const repositoryOptions = requiredElement<HTMLDivElement>('#repository-options');
const repositoryAccessHelp = requiredElement<HTMLDivElement>('#repository-access-help');
const installGitHubApp = requiredElement<HTMLAnchorElement>('#install-github-app');

if (destinationInputs.length !== 2) {
  throw new Error('Missing required repository destination options.');
}

const templateCreationUrl = new URL('https://github.com/new');
templateCreationUrl.search = new URLSearchParams({
  template_owner: 'CarlasHub',
  template_name: 'accessibility-audit-starter',
  name: 'accessibility-audit',
  description: 'My WCAG 2.2 accessibility audit',
  visibility: 'public'
}).toString();

let currentWorkflow = '';
const connectorConfig = readConnectorConfig();
const returnedFromGitHub = captureOAuthSession();
const pageUrl = new URL(window.location.href);
const returnedFromInstallation = pageUrl.searchParams.get('github') === 'installed'
  || ['install', 'update'].includes(pageUrl.searchParams.get('setup_action') ?? '');
if (returnedFromInstallation) {
  pageUrl.searchParams.delete('github');
  pageUrl.searchParams.delete('installation_id');
  pageUrl.searchParams.delete('setup_action');
  history.replaceState(null, '', `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`);
}
let availableRepositories: GitHubRepositoryOption[] = [];

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

function setProgress(stage: 1 | 2 | 3 | 4): void {
  const labels = {
    1: 'Stage 1 of 4: add pages',
    2: 'Stage 2 of 4: set up your repository',
    3: 'Stage 3 of 4: run your GitHub Action',
    4: 'Stage 4 of 4: download your report'
  } as const;
  const label = labels[stage];
  progress.setAttribute('aria-valuenow', String(stage));
  progress.setAttribute('aria-valuetext', label);
  progressStatus.value = label;

  progress.querySelectorAll<HTMLElement>('.pixel-block').forEach((block, index) => {
    block.classList.toggle('is-active', index < stage * 2);
  });
}

function clearFieldErrors(): void {
  errorMessage.textContent = '';
  errorMessage.hidden = true;
  getInputs().forEach((input) => {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-errormessage');
    input.setAttribute('aria-describedby', 'url-hint');
    input.setCustomValidity('');
  });
}

function showFieldError(input: HTMLInputElement, message: string): void {
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-errormessage', 'url-error');
  input.setAttribute('aria-describedby', 'url-hint url-error');
  input.setCustomValidity(message);
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  input.focus();
}

function clearActionFeedback(): void {
  copyStatus.textContent = '';
  copyError.textContent = '';
  copyError.hidden = true;
}

function clearLaunchFeedback(): void {
  launchStatus.textContent = '';
  launchError.textContent = '';
  launchError.hidden = true;
}

function selectedDestination(): 'new' | 'existing' {
  return destinationInputs.find((input) => input.checked)?.value === 'existing' ? 'existing' : 'new';
}

function clearRepositoryError(): void {
  repositoryError.textContent = '';
  repositoryError.hidden = true;
  repositoryInput.removeAttribute('aria-invalid');
  repositoryInput.removeAttribute('aria-errormessage');
  repositoryInput.setAttribute('aria-describedby', 'repository-hint');
  repositoryInput.setCustomValidity('');
}

function showRepositoryError(message: string): void {
  repositoryInput.setAttribute('aria-invalid', 'true');
  repositoryInput.setAttribute('aria-errormessage', 'repository-error');
  repositoryInput.setAttribute('aria-describedby', 'repository-hint repository-error');
  repositoryInput.setCustomValidity(message);
  repositoryError.textContent = message;
  repositoryError.hidden = false;
  repositoryInput.focus();
}

function refreshDestination(): void {
  const usesExistingRepository = selectedDestination() === 'existing';
  repositoryField.hidden = !usesExistingRepository;
  repositoryInput.disabled = !usesExistingRepository;
  repositoryInput.required = usesExistingRepository;
  chooseRepositoryButton.hidden = !usesExistingRepository || connectorConfig === null;
  manageRepositoryAccess.hidden = !usesExistingRepository || connectorConfig === null || !hasConnectorSession();
  if (!usesExistingRepository) {
    launchButton.innerHTML = 'Create my audit repository <span aria-hidden="true">→</span>';
  } else if (connectorConfig && !hasConnectorSession()) {
    launchButton.innerHTML = 'Connect GitHub and choose a repository <span aria-hidden="true">→</span>';
  } else if (connectorConfig && !repositoryInput.value.trim()) {
    launchButton.innerHTML = 'Choose a repository <span aria-hidden="true">→</span>';
  } else {
    launchButton.innerHTML = 'Add workflow and run audit <span aria-hidden="true">→</span>';
  }
}

function renderRepositoryOptions(filter = ''): void {
  repositoryOptions.replaceChildren();
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const matches = availableRepositories.filter((repository) =>
    repository.fullName.toLocaleLowerCase().includes(normalizedFilter)
  );

  for (const repository of matches) {
    const button = document.createElement('button');
    const name = document.createElement('strong');
    const detail = document.createElement('span');
    button.type = 'button';
    button.className = 'repository-option';
    name.textContent = repository.fullName;
    detail.textContent = `${repository.private ? 'Private' : 'Public'} · default branch ${repository.defaultBranch}`;
    button.append(name, detail);
    button.addEventListener('click', () => {
      repositoryInput.value = repository.fullName;
      clearRepositoryError();
      clearLaunchFeedback();
      repositoryDialog.close();
      launchStatus.textContent = `${repository.fullName} selected. Submit to add the workflow and start the audit.`;
      refreshDestination();
      launchButton.focus();
    });
    repositoryOptions.append(button);
  }

  repositoryPickerStatus.textContent = matches.length === 0 && availableRepositories.length > 0
    ? 'No repositories match that filter.'
    : `${matches.length} ${matches.length === 1 ? 'repository' : 'repositories'} available.`;
}

async function openRepositoryPicker(): Promise<void> {
  if (!connectorConfig) return;
  const targets = readTargets();
  if (!targets) return;

  if (!hasConnectorSession()) {
    saveAuditDraft(targets.map((target) => target.url));
    window.location.assign(buildAuthorizationUrl(connectorConfig));
    return;
  }

  repositorySearch.value = '';
  repositoryOptions.replaceChildren();
  repositoryAccessHelp.hidden = true;
  repositoryPickerStatus.textContent = 'Loading your allowed repositories…';
  repositoryDialog.showModal();

  try {
    availableRepositories = await listAccessibleRepositories(connectorConfig);
    repositoryAccessHelp.hidden = availableRepositories.length > 0;
    renderRepositoryOptions();
    if (availableRepositories.length > 0) repositorySearch.focus();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Your repositories could not be loaded.';
    repositoryPickerStatus.textContent = message;
    repositoryAccessHelp.hidden = false;
  }
}

function restoreAuditDraft(urls: string[]): void {
  const limitedUrls = urls.slice(0, MAX_AUDIT_TARGETS);
  if (limitedUrls.length === 0) return;
  while (getRows().length < limitedUrls.length) urlList.append(createUrlRow());
  while (getRows().length > limitedUrls.length && getRows().length > 1) getRows().at(-1)?.remove();
  getInputs().forEach((input, index) => {
    input.value = limitedUrls[index] ?? '';
  });
  refreshRows();
}

function showActionError(message: string): void {
  copyStatus.textContent = '';
  copyError.textContent = message;
  copyError.hidden = false;
}

function invalidatePreparedWorkflow(): void {
  if (!currentWorkflow) return;
  currentWorkflow = '';
  workflowCode.textContent = '';
  clearActionFeedback();
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
  input.setAttribute('aria-describedby', 'url-hint');

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
  clearActionFeedback();
  const blob = new Blob([currentWorkflow], { type: 'text/yaml;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = 'accessibility-audit.yml';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
  copyStatus.textContent = 'Workflow download started.';
}

function readTargets(): AuditTarget[] | null {
  clearFieldErrors();
  const inputs = getInputs();
  const blankInput = inputs.find((input) => input.value.trim() === '');
  if (blankInput) {
    showFieldError(blankInput, 'Enter a complete URL for every page, or remove the empty row.');
    return null;
  }

  try {
    return normalizeTargetUrls(inputs.map((input) => input.value));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Check the page URLs and try again.';
    showFieldError(locateInvalidInput(message), message);
    return null;
  }
}

function prepareWorkflow(): void {
  clearLaunchFeedback();
  const targets = readTargets();
  if (!targets) return;

  currentWorkflow = buildWorkflow(targets);
  workflowCode.textContent = currentWorkflow;
  clearActionFeedback();
  const hostCount = new Set(targets.map((target) => target.hostname)).size;
  resultDescription.textContent = `Configured for ${targets.length} ${targets.length === 1 ? 'page' : 'pages'} across ${hostCount} ${hostCount === 1 ? 'host' : 'hosts'}, with one combined report.`;
  result.hidden = false;
  setProgress(2);
  result.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  resultTitle.focus({ preventScroll: true });
}

async function openRepositorySetup(): Promise<void> {
  clearLaunchFeedback();
  clearRepositoryError();
  const targets = readTargets();
  if (!targets) return;

  const insecureTarget = targets.find((target) => !target.url.startsWith('https://'));
  if (insecureTarget) {
    const input = getInputs().find((candidate) => candidate.value.trim() === insecureTarget.url) ?? getInputs()[0];
    if (input) showFieldError(input, 'The ready-to-run repository requires a public address beginning with https://.');
    return;
  }

  const destination = selectedDestination();
  let destinationUrl = templateCreationUrl.href;
  let clipboardValue = targets.map((target) => target.url).join('\n');

  if (destination === 'existing') {
    if (connectorConfig && !hasConnectorSession()) {
      saveAuditDraft(targets.map((target) => target.url));
      window.location.assign(buildAuthorizationUrl(connectorConfig));
      return;
    }

    if (connectorConfig && !repositoryInput.value.trim()) {
      await openRepositoryPicker();
      return;
    }

    try {
      const repository = normalizeGitHubRepository(repositoryInput.value);
      currentWorkflow = buildWorkflow(targets);
      clipboardValue = currentWorkflow;
      if (!connectorConfig) {
        launchButton.disabled = true;
        launchButton.setAttribute('aria-busy', 'true');
        launchButton.textContent = 'Checking repository…';
        form.setAttribute('aria-busy', 'true');
        launchStatus.textContent = 'Finding the repository’s default branch on GitHub.';
        const defaultBranch = await resolvePublicRepositoryDefaultBranch(repository);
        destinationUrl = buildGitHubWorkflowEditorUrl(repository, currentWorkflow, defaultBranch);
      }
    } catch (error) {
      launchButton.disabled = false;
      launchButton.removeAttribute('aria-busy');
      form.removeAttribute('aria-busy');
      refreshDestination();
      launchStatus.textContent = '';
      showRepositoryError(
        error instanceof Error ? error.message : 'Check the GitHub repository and try again.'
      );
      return;
    }

    if (connectorConfig) {
      setProgress(2);
      launchButton.disabled = true;
      launchButton.setAttribute('aria-busy', 'true');
      launchButton.textContent = 'Starting your audit…';
      form.setAttribute('aria-busy', 'true');
      launchStatus.textContent = 'Adding the workflow to your repository and asking GitHub Actions to run it.';
      try {
        const setup = await setUpAndRunAudit(
          connectorConfig,
          normalizeGitHubRepository(repositoryInput.value).slug,
          targets.map((target) => target.url)
        );
        setProgress(3);
        launchStatus.textContent = `Audit started in ${setup.repository}. Opening its GitHub Actions page…`;
        window.location.assign(setup.actionsUrl);
      } catch (error) {
        setProgress(1);
        launchStatus.textContent = '';
        launchError.textContent = error instanceof Error
          ? `${error.message} Nothing was overwritten; preview the workflow below for manual setup.`
          : 'The audit could not be started. Nothing was overwritten; use the manual workflow preview below.';
        launchError.hidden = false;
        launchError.focus();
      } finally {
        launchButton.disabled = false;
        launchButton.removeAttribute('aria-busy');
        form.removeAttribute('aria-busy');
        refreshDestination();
      }
      return;
    }
  }

  setProgress(2);
  launchButton.disabled = true;
  launchButton.setAttribute('aria-busy', 'true');
  launchButton.textContent = 'Opening GitHub…';
  form.setAttribute('aria-busy', 'true');
  launchStatus.textContent = `${targets.length} ${targets.length === 1 ? 'page' : 'pages'} checked. Preparing your GitHub setup.`;

  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
    await navigator.clipboard.writeText(clipboardValue);
    launchStatus.textContent = destination === 'existing'
      ? 'Workflow copied. GitHub will ask you to review and commit it.'
      : 'Page list copied. GitHub will ask you to confirm your new repository.';
    window.location.assign(destinationUrl);
  } catch {
    if (destination === 'existing') {
      launchStatus.textContent = 'GitHub will open the prepared workflow. If it is not prefilled, return here and use “Preview or download the workflow”.';
      window.location.assign(destinationUrl);
    } else {
      setProgress(1);
      launchStatus.textContent = '';
      launchError.textContent = 'Your browser blocked copying the page list. Use “Preview or download the workflow” below, or allow clipboard access and try again.';
      launchError.hidden = false;
      launchError.focus();
    }
  } finally {
    launchButton.disabled = false;
    launchButton.removeAttribute('aria-busy');
    refreshDestination();
    form.removeAttribute('aria-busy');
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void openRepositorySetup();
});

buildWorkflowButton.addEventListener('click', prepareWorkflow);

destinationInputs.forEach((input) => {
  input.addEventListener('change', () => {
    clearLaunchFeedback();
    clearRepositoryError();
    refreshDestination();
  });
});

repositoryInput.addEventListener('input', () => {
  clearRepositoryError();
  clearLaunchFeedback();
});

chooseRepositoryButton.addEventListener('click', () => {
  void openRepositoryPicker();
});

closeRepositoryDialog.addEventListener('click', () => repositoryDialog.close());
repositorySearch.addEventListener('input', () => renderRepositoryOptions(repositorySearch.value));
installGitHubApp.addEventListener('click', () => {
  const targets = readTargets();
  if (targets) saveAuditDraft(targets.map((target) => target.url));
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
  clearLaunchFeedback();
  invalidatePreparedWorkflow();
});

copyButton.addEventListener('click', async () => {
  if (!currentWorkflow) return;
  clearActionFeedback();
  try {
    await navigator.clipboard.writeText(currentWorkflow);
    copyStatus.textContent = 'Workflow copied. Create the file in your repository and paste it there.';
    copyButton.textContent = 'Copied';
    window.setTimeout(() => {
      copyButton.textContent = 'Copy workflow code';
    }, 1800);
  } catch {
    showActionError('Copy was blocked by your browser. Open the workflow preview and copy the code manually.');
  }
});

downloadButton.addEventListener('click', downloadWorkflow);
if (connectorConfig) installGitHubApp.href = buildInstallationUrl(connectorConfig);
if (returnedFromGitHub || returnedFromInstallation) {
  const draft = takeAuditDraft();
  if (draft) restoreAuditDraft(draft);
  const existingDestination = destinationInputs.find((input) => input.value === 'existing');
  if (existingDestination) existingDestination.checked = true;
  launchStatus.textContent = returnedFromInstallation
    ? 'Repository access updated. Choose where this audit should run.'
    : 'GitHub connected. Choose the repository where this audit should run.';
  if (hasConnectorSession()) {
    window.setTimeout(() => void openRepositoryPicker(), 0);
  } else if (returnedFromInstallation && connectorConfig) {
    const targets = readTargets();
    if (targets) saveAuditDraft(targets.map((target) => target.url));
    window.setTimeout(() => window.location.assign(buildAuthorizationUrl(connectorConfig)), 0);
  }
}
refreshDestination();
refreshRows();
