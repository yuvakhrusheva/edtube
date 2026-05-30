const STUDY_MODE_KEY = 'studyModeEnabled';
const SPA_NAVIGATE_DELAY_MS = 400;

let studyModeEnabled = false;
let lastVideoId = null;
let loadingVideoId = null;
let navigateTimer = null;
let transcriptChunks = [];
let questionBlocks = [];
let currentLanguage = 'ru';
const generatedChunks = new Set();

function isYouTubeWatchPage() {
  return location.pathname === '/watch' && new URLSearchParams(location.search).has('v');
}

function getVideoId() {
  return new URLSearchParams(location.search).get('v');
}

function resetQuizState() {
  transcriptChunks = [];
  questionBlocks = [];
  generatedChunks.clear();
  quizScheduler.reset();
}

function logGoogleUserId() {
  chrome.runtime.sendMessage({ type: 'GET_GOOGLE_USER_ID' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[Quize-Mode] Failed to get user ID:', chrome.runtime.lastError.message);
      return;
    }

    if (response?.error) {
      console.error('[Quize-Mode] Identity error:', response.error);
      return;
    }

    if (response.source === 'google') {
      console.log('[Quize-Mode] Google user ID:', response.userId);
      if (response.email) {
        console.log('[Quize-Mode] Google account email:', response.email);
      }
      return;
    }

    console.warn('[Quize-Mode] Google user ID unavailable:', response.reason);
    console.warn('[Quize-Mode] Using anonymous fallback ID:', response.userId);
  });
}

function logTranscriptResult(result) {
  switch (result.status) {
    case 'success':
      console.log('[Quize-Mode] Transcript loaded:', {
        videoId: result.videoId,
        segmentCount: result.segments.length,
        audioLanguage: result.audioLanguage,
        trackLanguage: result.track.languageCode,
        trackKind: result.track.kind || 'manual',
        transcriptSource: result.transcriptSource,
        transcriptFormat: result.transcriptFormat,
        bodyLength: result.bodyLength,
        preview: result.segments.slice(0, 3).map((segment) => ({
          time: formatTimestamp(segment.startMs),
          text: segment.text,
        })),
      });
      break;
    case 'no_captions':
      console.warn('[Quize-Mode] No caption tracks available for video:', result.videoId);
      break;
    case 'fetch_failed':
      console.error('[Quize-Mode] Failed to fetch transcript:', result.error);
      break;
    case 'player_data_unavailable':
      console.warn('[Quize-Mode] Player data unavailable for video:', result.videoId, result.reason || '');
      break;
    default:
      console.warn('[Quize-Mode] Unknown transcript status:', result);
  }
}

function normalizeQuestionBlock(response, videoId) {
  if (response.status !== 'success' || !Array.isArray(response.questions)) {
    return response;
  }

  return {
    status: 'success',
    videoId,
    chunkIndex: response.chunkIndex,
    pauseTimestampMs: response.pauseTimestampMs,
    questions: response.questions,
    quota: response.quota,
  };
}

async function generateQuestionForChunk(videoId, chunkIndex, language, { force = false } = {}) {
  if (!force && generatedChunks.has(chunkIndex)) {
    return null;
  }

  const chunk = transcriptChunks[chunkIndex];
  if (!chunk?.length) {
    return null;
  }

  generatedChunks.add(chunkIndex);

  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: 'GENERATE_QUESTION',
        videoId,
        chunkIndex,
        transcriptChunk: chunk,
        language,
      },
      resolve,
    );
  });

  if (chrome.runtime.lastError) {
    console.error('[Quize-Mode] Failed to generate question:', chrome.runtime.lastError.message);
    generatedChunks.delete(chunkIndex);
    return { error: chrome.runtime.lastError.message };
  }

  if (response?.error) {
    console.error('[Quize-Mode] Question generation error:', response.error, response.code || '');
    if (response.quota) {
      console.warn('[Quize-Mode] Quota:', response.quota);
    }
    generatedChunks.delete(chunkIndex);
    return response;
  }

  if (response.status === 'success') {
    const block = normalizeQuestionBlock(response, videoId);
    questionBlocks.push(block);
    console.log('[Quize-Mode] Question block:', {
      chunkIndex: block.chunkIndex,
      pauseTimestampMs: block.pauseTimestampMs,
      questionCount: block.questions.length,
    });
    return block;
  }

  if (response.status === 'skip') {
    console.log('[Quize-Mode] Chunk skipped (no educational content):', {
      videoId,
      chunkIndex,
    });
    generatedChunks.delete(chunkIndex);
  }

  return response;
}

async function regenerateQuestionForChunk(videoId, chunkIndex, language) {
  generatedChunks.delete(chunkIndex);
  return generateQuestionForChunk(videoId, chunkIndex, language, { force: true });
}

async function startQuizGeneration(result) {
  resetQuizState();
  currentLanguage = result.track.languageCode;
  transcriptChunks = chunkSegments(result.segments);

  console.log('[Quize-Mode] Transcript chunked:', {
    videoId: result.videoId,
    chunkCount: transcriptChunks.length,
    chunkSizes: transcriptChunks.map((chunk) => chunk.length),
  });

  if (transcriptChunks.length === 0) {
    return;
  }

  const firstBlock = await generateQuestionForChunk(result.videoId, 0, currentLanguage);
  if (firstBlock?.status === 'success') {
    quizScheduler.registerBlock(firstBlock);
  }

  quizScheduler.startWatching(result.videoId);
}

async function loadTranscriptIfNeeded() {
  if (!studyModeEnabled || !isYouTubeWatchPage()) {
    return;
  }

  const videoId = getVideoId();
  if (!videoId || videoId === lastVideoId || videoId === loadingVideoId) {
    return;
  }

  loadingVideoId = videoId;

  try {
    const result = await fetchTranscript(videoId);

    if (getVideoId() !== videoId) {
      return;
    }

    if (result.status === 'success') {
      lastVideoId = videoId;
    } else if (result.status !== 'player_data_unavailable') {
      lastVideoId = videoId;
    }

    logTranscriptResult(result);

    if (result.status === 'success') {
      await startQuizGeneration(result);
    }
  } finally {
    if (loadingVideoId === videoId) {
      loadingVideoId = null;
    }
  }
}

function scheduleTranscriptLoad() {
  if (navigateTimer) {
    clearTimeout(navigateTimer);
  }

  navigateTimer = setTimeout(() => {
    navigateTimer = null;
    loadTranscriptIfNeeded();
  }, SPA_NAVIGATE_DELAY_MS);
}

function initStudyModeState() {
  chrome.storage.local.get(STUDY_MODE_KEY, (result) => {
    studyModeEnabled = Boolean(result[STUDY_MODE_KEY]);
    if (studyModeEnabled) {
      lastVideoId = null;
      resetQuizState();
      loadTranscriptIfNeeded();
    }
  });
}

quizScheduler.init(
  async (chunkIndex) => {
    const videoId = getVideoId();
    if (!videoId || !studyModeEnabled) {
      return null;
    }

    const block = await generateQuestionForChunk(videoId, chunkIndex, currentLanguage);
    if (block?.status === 'success') {
      quizScheduler.registerBlock(block);
    }
    return block;
  },
  async (chunkIndex) => {
    const videoId = getVideoId();
    if (!videoId || !studyModeEnabled) {
      return null;
    }

    return regenerateQuestionForChunk(videoId, chunkIndex, currentLanguage);
  },
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STUDY_MODE_KEY]) {
    return;
  }

  studyModeEnabled = Boolean(changes[STUDY_MODE_KEY].newValue);
  if (studyModeEnabled) {
    lastVideoId = null;
    resetQuizState();
    loadTranscriptIfNeeded();
  } else {
    lastVideoId = null;
    quizScheduler.stopWatching();
    resetQuizState();
  }
});

document.addEventListener('yt-navigate-finish', () => {
  if (!isYouTubeWatchPage()) {
    lastVideoId = null;
    quizScheduler.stopWatching();
    resetQuizState();
    return;
  }

  if (studyModeEnabled) {
    lastVideoId = null;
    quizScheduler.stopWatching();
    resetQuizState();
    scheduleTranscriptLoad();
  }
});

if (isYouTubeWatchPage()) {
  logGoogleUserId();
}

initStudyModeState();
