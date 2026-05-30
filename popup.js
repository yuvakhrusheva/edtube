const STUDY_MODE_KEY = 'studyModeEnabled';

const toggle = document.getElementById('study-mode-toggle');
const status = document.getElementById('study-mode-status');

function updateStatus(enabled) {
  status.textContent = enabled ? 'Включено' : 'Выключено';
}

chrome.storage.local.get(STUDY_MODE_KEY, (result) => {
  const enabled = Boolean(result[STUDY_MODE_KEY]);
  toggle.checked = enabled;
  updateStatus(enabled);
});

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.storage.local.set({ [STUDY_MODE_KEY]: enabled }, () => {
    if (chrome.runtime.lastError) {
      console.error('[Quize-Mode] Failed to save study mode:', chrome.runtime.lastError.message);
      toggle.checked = !enabled;
      return;
    }
    updateStatus(enabled);
  });
});
