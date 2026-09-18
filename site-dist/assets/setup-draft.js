const STORAGE_KEY = 'carlashub-a11y-audit-setup-v2';
const MAX_URLS = 20;

function readDraft() {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!value || !Array.isArray(value.urls) || value.urls.length === 0) return null;
    if (!value.urls.every((url) => typeof url === 'string')) return null;
    return {
      urls: value.urls.slice(0, MAX_URLS),
      destination: value.destination === 'existing' ? 'existing' : 'new',
      repository: typeof value.repository === 'string' ? value.repository : '',
    };
  } catch {
    return null;
  }
}

function initialiseDraftPersistence() {
  const form = document.querySelector('#workflow-form');
  const urlList = document.querySelector('#url-list');
  const addUrl = document.querySelector('#add-url');
  const repository = document.querySelector('#repository-name');
  const clearSetup = document.querySelector('#clear-saved-setup');
  const savedSetupStatus = document.querySelector('#saved-setup-status');
  const launchStatus = document.querySelector('#launch-status');

  if (!(form instanceof HTMLFormElement)
    || !(urlList instanceof HTMLElement)
    || !(addUrl instanceof HTMLButtonElement)
    || !(repository instanceof HTMLInputElement)) return;

  let restoring = true;
  let persistencePaused = false;

  const urlInputs = () => Array.from(urlList.querySelectorAll('input[name="urls"]'));
  const selectedDestination = () => form.querySelector('input[name="destination"]:checked')?.value === 'existing'
    ? 'existing'
    : 'new';

  const saveDraft = () => {
    if (restoring || persistencePaused) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        urls: urlInputs().map((input) => input.value),
        destination: selectedDestination(),
        repository: repository.value,
      }));
    } catch {
      // The setup still works when browser storage is unavailable.
    }
  };

  const resumeAndSave = (event) => {
    if (persistencePaused && !event.isTrusted) return;
    persistencePaused = false;
    saveDraft();
  };

  const draft = readDraft();
  if (draft) {
    while (urlInputs().length < draft.urls.length) addUrl.click();
    urlInputs().forEach((input, index) => {
      input.value = draft.urls[index] ?? '';
    });

    const destination = form.querySelector(`input[name="destination"][value="${draft.destination}"]`);
    if (destination instanceof HTMLInputElement) {
      destination.checked = true;
      destination.dispatchEvent(new Event('change', { bubbles: true }));
    }
    repository.value = draft.repository;
    repository.dispatchEvent(new Event('input', { bubbles: true }));
    if (savedSetupStatus) savedSetupStatus.textContent = `${draft.urls.length} saved ${draft.urls.length === 1 ? 'page' : 'pages'} restored.`;
  }
  restoring = false;

  form.addEventListener('input', resumeAndSave);
  form.addEventListener('change', resumeAndSave);
  form.addEventListener('submit', saveDraft, { capture: true });
  addUrl.addEventListener('click', saveDraft);
  urlList.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('.remove-url')) saveDraft();
  });
  window.addEventListener('pagehide', saveDraft);

  form.addEventListener('submit', () => {
    if (selectedDestination() !== 'new' || !launchStatus) return;
    const observer = new MutationObserver(() => {
      if (!launchStatus.textContent?.startsWith('Configured workflow copied.')) return;
      launchStatus.textContent = 'Configured workflow copied. Create the repository in the GitHub tab, then return here, choose “Use an existing repository”, enter owner/repository, and add the workflow. Your pages are saved in this browser.';
      observer.disconnect();
    });
    observer.observe(launchStatus, { childList: true, subtree: true, characterData: true });
    window.setTimeout(() => observer.disconnect(), 10000);
  });

  clearSetup?.addEventListener('click', () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing else is required when browser storage is unavailable.
    }
    persistencePaused = true;
    if (savedSetupStatus) savedSetupStatus.textContent = 'Saved setup cleared. Current form values remain until you edit or leave this page.';
  });
}

window.addEventListener('DOMContentLoaded', initialiseDraftPersistence, { once: true });
