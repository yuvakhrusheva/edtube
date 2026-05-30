const STUDY_MODE_KEY = 'studyModeEnabled';

let studyModeEnabled = false;
let lastVideoId = null;
let loadingVideoId = null;

function isYouTubeWatchPage() {
  return location.pathname === '/watch' && new URLSearchParams(location.search).has('v');
}

function getVideoId() {
  return new URLSearchParams(location.search).get('v');
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
  } finally {
    if (loadingVideoId === videoId) {
      loadingVideoId = null;
    }
  }
}

function initStudyModeState() {
  chrome.storage.local.get(STUDY_MODE_KEY, (result) => {
    studyModeEnabled = Boolean(result[STUDY_MODE_KEY]);
    if (studyModeEnabled) {
      lastVideoId = null;
      loadTranscriptIfNeeded();
    }
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STUDY_MODE_KEY]) {
    return;
  }

  studyModeEnabled = Boolean(changes[STUDY_MODE_KEY].newValue);
  if (studyModeEnabled) {
    lastVideoId = null;
    loadTranscriptIfNeeded();
  } else {
    lastVideoId = null;
  }
});

document.addEventListener('yt-navigate-finish', () => {
  if (!isYouTubeWatchPage()) {
    lastVideoId = null;
    return;
  }

  if (studyModeEnabled) {
    loadTranscriptIfNeeded();
  }
});

if (isYouTubeWatchPage()) {
  logGoogleUserId();
}

initStudyModeState();
