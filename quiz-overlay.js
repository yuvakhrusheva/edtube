let overlayRoot = null;
let optionButtons = [];
let continueButton = null;
let rewindButton = null;
let progressLabel = null;
let feedbackLabel = null;
let seriesState = null;

function ensureOverlay() {
  if (overlayRoot) {
    return overlayRoot;
  }

  overlayRoot = document.createElement('div');
  overlayRoot.id = 'quize-mode-overlay';
  overlayRoot.innerHTML = `
    <div class="qm-card" role="dialog" aria-modal="true">
      <p class="qm-title">Проверка понимания</p>
      <p class="qm-progress"></p>
      <p class="qm-question"></p>
      <p class="qm-feedback"></p>
      <div class="qm-options"></div>
      <div class="qm-actions">
        <button type="button" class="qm-action rewind hidden">Пересмотреть фрагмент</button>
        <button type="button" class="qm-action continue hidden">Далее</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlayRoot);

  progressLabel = overlayRoot.querySelector('.qm-progress');
  feedbackLabel = overlayRoot.querySelector('.qm-feedback');

  const optionsContainer = overlayRoot.querySelector('.qm-options');
  optionButtons = Array.from({ length: 4 }, (_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'qm-option';
    button.addEventListener('click', () => handleOptionClick(index));
    optionsContainer.appendChild(button);
    return button;
  });

  continueButton = overlayRoot.querySelector('.qm-action.continue');
  rewindButton = overlayRoot.querySelector('.qm-action.rewind');

  continueButton.addEventListener('click', () => {
    if (seriesState?.phase === 'step' && seriesState.waitingNext) {
      seriesState.waitingNext = false;
      continueButton.classList.add('hidden');
      showSeriesStep(seriesState.index + 1);
      return;
    }

    if (seriesState?.phase === 'passed') {
      seriesState.onPassed?.();
    }
  });

  rewindButton.addEventListener('click', () => {
    if (seriesState?.phase === 'failed') {
      seriesState.onRewind?.();
    }
  });

  return overlayRoot;
}

function shuffleOptions(options, correctIndex) {
  const indexed = options.map((text, index) => ({ text, isCorrect: index === correctIndex }));
  for (let i = indexed.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }
  return {
    options: indexed.map((item) => item.text),
    correctIndex: indexed.findIndex((item) => item.isCorrect),
  };
}

function resetStepUi() {
  optionButtons.forEach((button) => {
    button.disabled = false;
    button.className = 'qm-option';
  });
  continueButton.classList.add('hidden');
  rewindButton.classList.add('hidden');
  feedbackLabel.textContent = '';
  feedbackLabel.className = 'qm-feedback';
}

function handleOptionClick(selectedIndex) {
  if (!seriesState || seriesState.phase !== 'step' || seriesState.answered) {
    return;
  }

  const step = seriesState.steps[seriesState.index];
  const isCorrect = selectedIndex === step.correctIndex;
  seriesState.answered = true;

  optionButtons.forEach((button, index) => {
    button.disabled = true;
    if (index === selectedIndex) {
      button.classList.add(isCorrect ? 'selected-correct' : 'selected-incorrect');
    }
  });

  if (!isCorrect) {
    seriesState.wrongCount += 1;
  }

  feedbackLabel.textContent = isCorrect ? 'Верно!' : 'Неверно';
  feedbackLabel.className = `qm-feedback ${isCorrect ? 'correct' : 'incorrect'}`;

  const isLast = seriesState.index >= seriesState.steps.length - 1;

  if (isLast) {
    finishSeries();
    return;
  }

  seriesState.waitingNext = true;
  continueButton.textContent = 'Далее';
  continueButton.classList.remove('hidden');
}

function finishSeries() {
  const { wrongCount, total } = seriesState;

  optionButtons.forEach((button) => {
    button.disabled = true;
  });

  if (wrongCount <= 1) {
    seriesState.phase = 'passed';
    feedbackLabel.textContent = `Отлично! Ошибок: ${wrongCount} из ${total}`;
    feedbackLabel.className = 'qm-feedback correct';
    continueButton.textContent = 'Продолжить';
    continueButton.classList.remove('hidden');
    seriesState.onComplete?.({ wrongCount, total, passed: true });
    return;
  }

  seriesState.phase = 'failed';
  feedbackLabel.textContent = `Ошибок: ${wrongCount} из ${total}. Пересмотрите фрагмент и попробуйте снова.`;
  feedbackLabel.className = 'qm-feedback incorrect';
  rewindButton.classList.remove('hidden');
  seriesState.onComplete?.({ wrongCount, total, passed: false });
}

function showSeriesStep(stepIndex) {
  if (!seriesState || stepIndex >= seriesState.steps.length) {
    return;
  }

  resetStepUi();
  seriesState.index = stepIndex;
  seriesState.answered = false;

  const step = seriesState.steps[stepIndex];
  progressLabel.textContent = `Вопрос ${stepIndex + 1} из ${seriesState.steps.length}`;
  overlayRoot.querySelector('.qm-question').textContent = step.question;

  optionButtons.forEach((button, index) => {
    button.textContent = step.options[index] || '';
  });
}

function showQuestionSeries(questions, callbacks) {
  ensureOverlay();

  const steps = questions.map((item) => {
    const shuffled = shuffleOptions(item.options, item.correctIndex);
    return {
      question: item.question,
      options: shuffled.options,
      correctIndex: shuffled.correctIndex,
    };
  });

  seriesState = {
    phase: 'step',
    steps,
    index: 0,
    wrongCount: 0,
    answered: false,
    waitingNext: false,
    onComplete: callbacks.onComplete,
    onPassed: callbacks.onPassed,
    onRewind: callbacks.onRewind,
  };

  overlayRoot.classList.add('visible');
  showSeriesStep(0);
}

function hideOverlay() {
  if (!overlayRoot) {
    return;
  }

  overlayRoot.classList.remove('visible');
  seriesState = null;
  resetStepUi();
  progressLabel.textContent = '';
  overlayRoot.querySelector('.qm-question').textContent = '';
}

function isOverlayVisible() {
  return Boolean(overlayRoot?.classList.contains('visible'));
}
