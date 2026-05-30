const PAGE_BRIDGE_SOURCE = 'quize-mode-extension';
const PLAYER_DATA_RETRIES = 3;
const PLAYER_DATA_RETRY_DELAY_MS = 500;
const TRANSCRIPT_FETCH_RETRIES = 2;
const STALE_PLAYER_DATA_RETRIES = 3;
const STALE_PLAYER_DATA_DELAY_MS = 400;

function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function selectCaptionTrack(tracks, audioLanguage) {
  if (!tracks?.length) {
    return null;
  }

  if (audioLanguage) {
    const forLang = tracks.filter((track) => track.languageCode === audioLanguage);
    const manual = forLang.find((track) => track.kind !== 'asr');
    if (manual) {
      return manual;
    }

    const asr = forLang.find((track) => track.kind === 'asr');
    if (asr) {
      return asr;
    }
  }

  const anyManual = tracks.find((track) => track.kind !== 'asr');
  if (anyManual) {
    return anyManual;
  }

  return tracks.find((track) => track.kind === 'asr') || tracks[0];
}

function parseJson3(json) {
  const segments = [];

  for (const event of json?.events || []) {
    if (!event.segs) {
      continue;
    }

    const text = event.segs.map((segment) => segment.utf8 || '').join('').trim();
    if (!text) {
      continue;
    }

    segments.push({
      startMs: event.tStartMs || 0,
      durationMs: event.dDurationMs || 0,
      text,
    });
  }

  return segments;
}

function parseXmlTimedtext(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const segments = [];

  for (const node of doc.querySelectorAll('text')) {
    const text = node.textContent?.trim();
    if (!text) {
      continue;
    }

    const startSec = parseFloat(node.getAttribute('start') || '0');
    const durSec = parseFloat(node.getAttribute('dur') || '0');
    segments.push({
      startMs: Math.round(startSec * 1000),
      durationMs: Math.round(durSec * 1000),
      text,
    });
  }

  return segments;
}

function parseSrv3Timedtext(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const segments = [];

  for (const paragraph of doc.querySelectorAll('p')) {
    const startMs = parseInt(paragraph.getAttribute('t') || '0', 10);
    const durationMs = parseInt(paragraph.getAttribute('d') || '0', 10);
    let text = '';

    for (const word of paragraph.querySelectorAll('s')) {
      text += word.textContent || '';
    }

    if (!text.trim()) {
      text = paragraph.textContent || '';
    }

    text = text.trim();
    if (!text) {
      continue;
    }

    segments.push({
      startMs: Number.isNaN(startMs) ? 0 : startMs,
      durationMs: Number.isNaN(durationMs) ? 0 : durationMs,
      text,
    });
  }

  return segments;
}

function parseTimedtextXml(xmlText) {
  const srv3Segments = parseSrv3Timedtext(xmlText);
  if (srv3Segments.length) {
    return srv3Segments;
  }

  return parseXmlTimedtext(xmlText);
}

function extractSnippetText(snippet) {
  if (!snippet) {
    return '';
  }

  if (snippet.simpleText) {
    return snippet.simpleText;
  }

  return (snippet.runs || []).map((run) => run.text || '').join('');
}

function findTranscriptInitialSegments(data) {
  for (const action of data?.actions || []) {
    const segments =
      action?.updateEngagementPanelAction?.content?.transcriptRenderer?.content
        ?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;

    if (segments?.length) {
      return segments;
    }
  }

  return [];
}

function parseGetTranscriptResponse(data) {
  const segments = [];
  const initialSegments = findTranscriptInitialSegments(data);

  for (const segment of initialSegments) {
    const line = segment.transcriptSectionHeaderRenderer || segment.transcriptSegmentRenderer;
    if (!line) {
      continue;
    }

    const text = extractSnippetText(line.snippet).trim();
    if (!text) {
      continue;
    }

    const startMs = parseInt(line.startMs, 10);
    const endMs = parseInt(line.endMs, 10);

    segments.push({
      startMs: Number.isNaN(startMs) ? 0 : startMs,
      durationMs:
        Number.isNaN(endMs) || Number.isNaN(startMs) ? 0 : Math.max(endMs - startMs, 0),
      text,
    });
  }

  return segments;
}

function parseTranscriptPayload(payload) {
  if (payload.source === 'get_transcript') {
    return parseGetTranscriptResponse(payload.data);
  }

  if (payload.format === 'json3') {
    return parseJson3(JSON.parse(payload.body));
  }

  if (payload.format === 'xml' || payload.format === 'srv3') {
    return parseTimedtextXml(payload.body);
  }

  throw new Error(`Unsupported transcript format: ${payload.format}`);
}

function injectPageBridge() {
  return new Promise((resolve, reject) => {
    if (document.getElementById('quize-mode-page-bridge')) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.id = 'quize-mode-page-bridge';
    script.src = `${chrome.runtime.getURL('page-bridge.js')}?v=5`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to inject page bridge'));
    (document.head || document.documentElement).appendChild(script);
  });
}

function waitForBridgeMessage(type, requestId) {
  return new Promise((resolve) => {
    function onMessage(event) {
      if (event.source !== window) {
        return;
      }

      if (event.data?.source !== PAGE_BRIDGE_SOURCE) {
        return;
      }

      if (event.data?.type !== type || event.data.requestId !== requestId) {
        return;
      }

      window.removeEventListener('message', onMessage);
      resolve(event.data);
    }

    window.addEventListener('message', onMessage);
  });
}

function requestPlayerData() {
  const requestId = crypto.randomUUID();

  const responsePromise = waitForBridgeMessage('PLAYER_DATA', requestId);
  window.postMessage(
    {
      source: PAGE_BRIDGE_SOURCE,
      type: 'REQUEST_PLAYER_DATA',
      requestId,
    },
    '*',
  );

  return responsePromise;
}

function requestTranscript(payload) {
  const requestId = crypto.randomUUID();

  const responsePromise = waitForBridgeMessage('TRANSCRIPT_DATA', requestId);
  window.postMessage(
    {
      source: PAGE_BRIDGE_SOURCE,
      type: 'REQUEST_TRANSCRIPT',
      requestId,
      payload,
    },
    '*',
  );

  return responsePromise;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getPlayerDataWithRetry() {
  await injectPageBridge();

  for (let attempt = 1; attempt <= PLAYER_DATA_RETRIES; attempt += 1) {
    const result = await requestPlayerData();
    if (!result.error && result.data) {
      return result.data;
    }

    if (attempt < PLAYER_DATA_RETRIES) {
      await delay(PLAYER_DATA_RETRY_DELAY_MS);
    }
  }

  return null;
}

async function fetchTranscriptViaPage(payload) {
  await injectPageBridge();
  const result = await requestTranscript(payload);

  if (result.error) {
    throw new Error(result.error);
  }

  const segments = parseTranscriptPayload(result.data);
  if (!segments.length) {
    throw new Error(
      `parsed empty segments (${result.data.source}/${result.data.format}, bodyLength=${result.data.bodyLength || 0})`,
    );
  }

  return {
    segments,
    transcriptSource: result.data.source,
    transcriptFormat: result.data.format,
    bodyLength: result.data.bodyLength,
  };
}

async function loadTranscriptForVideo(videoId) {
  const playerData = await getPlayerDataWithRetry();

  if (!playerData) {
    return { status: 'player_data_unavailable', videoId };
  }

  if (playerData.videoId && playerData.videoId !== videoId) {
    return { status: 'player_data_unavailable', videoId, reason: 'stale_player_data' };
  }

  const tracks = playerData.captionTracks || [];
  if (!tracks.length) {
    return { status: 'no_captions', videoId };
  }

  const track = selectCaptionTrack(tracks, playerData.audioLanguage);
  if (!track) {
    return { status: 'no_captions', videoId };
  }

  try {
    const { segments, transcriptSource, transcriptFormat, bodyLength } =
      await fetchTranscriptViaPage({
        videoId,
        baseUrl: track.baseUrl,
        languageCode: track.languageCode,
        kind: track.kind,
        audioLanguage: playerData.audioLanguage,
        getTranscriptParams: playerData.getTranscriptParams,
      });

    return {
      status: 'success',
      videoId,
      audioLanguage: playerData.audioLanguage,
      transcriptSource,
      transcriptFormat,
      bodyLength,
      track: {
        languageCode: track.languageCode,
        kind: track.kind,
        name: track.name,
      },
      segments,
    };
  } catch (error) {
    return {
      status: 'fetch_failed',
      videoId,
      error: error.message,
    };
  }
}

async function fetchTranscript(videoId) {
  let lastResult = null;
  const maxAttempts = TRANSCRIPT_FETCH_RETRIES + STALE_PLAYER_DATA_RETRIES;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await loadTranscriptForVideo(videoId);

    if (lastResult.status === 'success' || lastResult.status === 'no_captions') {
      return lastResult;
    }

    const isStale = lastResult.reason === 'stale_player_data';
    const canRetry =
      attempt < maxAttempts &&
      (isStale || lastResult.status === 'fetch_failed' || lastResult.status === 'player_data_unavailable');

    if (canRetry) {
      await delay(isStale ? STALE_PLAYER_DATA_DELAY_MS : PLAYER_DATA_RETRY_DELAY_MS);
      continue;
    }

    return lastResult;
  }

  return lastResult;
}
