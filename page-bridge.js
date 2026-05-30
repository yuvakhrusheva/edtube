(function () {
  const SOURCE = 'quize-mode-extension';
  const DEFAULT_CLIENT_VERSION = '2.20240826.01.00';
  const ANDROID_CLIENT_VERSION = '20.10.38';
  const TRANSCRIPT_PANEL_ID = 'engagement-panel-searchable-transcript';

  function installFetchInterceptor() {
    if (window.__quizeModeFetchPatched) {
      return;
    }
    window.__quizeModeFetchPatched = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async function quizeModeFetch(input, init) {
      const response = await originalFetch(input, init);
      const url = typeof input === 'string' ? input : input?.url;

      if (url?.includes('/youtubei/v1/get_transcript')) {
        try {
          const requestBody = init?.body ? JSON.parse(init.body) : null;
          if (requestBody?.params) {
            window.__quizeModeCachedTranscriptParams = requestBody.params;
          }

          const data = await response.clone().json();
          window.__quizeModeCachedTranscript = {
            data,
            capturedAt: Date.now(),
          };
        } catch {
          // Ignore parse errors from non-JSON responses.
        }
      }

      return response;
    };
  }

  installFetchInterceptor();

  function getYtcfgValue(key) {
    if (window.ytcfg?.get) {
      return window.ytcfg.get(key);
    }
    return window.ytcfg?.data_?.[key];
  }

  function getInnertubeRequestConfig() {
    const apiKey = getYtcfgValue('INNERTUBE_API_KEY');
    const clientVersion = getYtcfgValue('INNERTUBE_CLIENT_VERSION') || DEFAULT_CLIENT_VERSION;
    const clientName = String(getYtcfgValue('INNERTUBE_CLIENT_NAME') ?? '1');
    let context = getYtcfgValue('INNERTUBE_CONTEXT');

    if (context) {
      context = JSON.parse(JSON.stringify(context));
    } else {
      context = {
        client: {
          clientName: 'WEB',
          clientVersion,
          hl: getYtcfgValue('HL') || navigator.language?.split('-')[0] || 'en',
          gl: getYtcfgValue('GL') || 'US',
          visitorData: getYtcfgValue('VISITOR_DATA') || undefined,
        },
      };
    }

    return { apiKey, clientVersion, clientName, context };
  }

  function getAndroidContext() {
    const hl = getYtcfgValue('HL') || navigator.language?.split('-')[0] || 'en';
    const gl = getYtcfgValue('GL') || 'US';
    return {
      client: {
        clientName: 'ANDROID',
        clientVersion: ANDROID_CLIENT_VERSION,
        hl,
        gl,
        androidSdkVersion: 30,
      },
    };
  }

  async function innertubePost(endpoint, body, options = {}) {
    const config = getInnertubeRequestConfig();
    const apiKey = config.apiKey;
    const clientName = options.android ? '3' : config.clientName;
    const clientVersion = options.android ? ANDROID_CLIENT_VERSION : config.clientVersion;
    const context = options.android ? getAndroidContext() : config.context;

    if (!apiKey) {
      throw new Error('INNERTUBE_API_KEY unavailable');
    }

    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/${endpoint}?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Referer: window.location.href,
          'X-Origin': 'https://www.youtube.com',
          'X-YouTube-Client-Name': clientName,
          'X-YouTube-Client-Version': clientVersion,
        },
        body: JSON.stringify({
          context,
          ...body,
        }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${endpoint} HTTP ${response.status}: ${text.slice(0, 400)}`);
    }

    return JSON.parse(text);
  }

  function postPlayerData(requestId) {
    const playerResponse = window.ytInitialPlayerResponse;

    if (!playerResponse) {
      window.postMessage(
        {
          source: SOURCE,
          type: 'PLAYER_DATA',
          requestId,
          error: 'player_data_unavailable',
        },
        '*',
      );
      return;
    }

    const captionsRenderer = playerResponse.captions?.playerCaptionsTracklistRenderer;
    const captionTracks = captionsRenderer?.captionTracks || [];
    const audioLanguage =
      playerResponse.microformat?.playerMicroformatRenderer?.defaultLanguage ||
      playerResponse.videoDetails?.defaultLanguage ||
      captionTracks.find((track) => track.kind !== 'asr')?.languageCode ||
      null;

    window.postMessage(
      {
        source: SOURCE,
        type: 'PLAYER_DATA',
        requestId,
        data: {
          captionTracks: captionTracks.map((track) => ({
            baseUrl: track.baseUrl,
            languageCode: track.languageCode,
            kind: track.kind || null,
            name: track.name?.simpleText || null,
          })),
          audioLanguage,
          videoId: playerResponse.videoDetails?.videoId || null,
          getTranscriptParams:
            captionsRenderer?.getTranscriptEndpoint?.getTranscriptEndpoint?.params || null,
        },
      },
      '*',
    );
  }

  function extractTranscriptParamsFromPanels(engagementPanels) {
    for (const panel of engagementPanels || []) {
      const section = panel.engagementPanelSectionListRenderer;
      if (section?.panelIdentifier !== TRANSCRIPT_PANEL_ID) {
        continue;
      }

      return (
        section.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint
          ?.params || null
      );
    }

    return null;
  }

  async function fetchNextTranscriptParams(videoId) {
    const urlParams = new URLSearchParams(window.location.search);
    const playlistId = urlParams.get('list') || undefined;
    const indexRaw = urlParams.get('index');
    const playlistIndex = indexRaw ? Number.parseInt(indexRaw, 10) : undefined;

    const body = {
      videoId,
      racyCheckOk: false,
      contentCheckOk: false,
    };

    if (playlistId) {
      body.playlistId = playlistId;
    }

    if (!Number.isNaN(playlistIndex)) {
      body.playlistIndex = playlistIndex;
    }

    const data = await innertubePost('next', body);
    return extractTranscriptParamsFromPanels(data.engagementPanels);
  }

  function encodeVarint(value) {
    const bytes = [];
    let current = value;

    do {
      let byte = current & 0x7f;
      current >>>= 7;
      if (current !== 0) {
        byte |= 0x80;
      }
      bytes.push(byte);
    } while (current !== 0);

    return bytes;
  }

  function encodeStringField(fieldNumber, value) {
    if (value == null || value === '') {
      return [];
    }

    const stringBytes = Array.from(new TextEncoder().encode(value));
    const tag = (fieldNumber << 3) | 2;

    return [...encodeVarint(tag), ...encodeVarint(stringBytes.length), ...stringBytes];
  }

  function encodeProtobufMessage(message) {
    return new Uint8Array([
      ...encodeStringField(1, message.param1),
      ...encodeStringField(2, message.param2),
    ]);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  function buildGetTranscriptParams(videoId, languageCode, kind) {
    const innerMessage = { param2: languageCode };
    if (kind === 'asr') {
      innerMessage.param1 = 'asr';
    }

    const innerParams = bytesToBase64(encodeProtobufMessage(innerMessage));
    return bytesToBase64(
      encodeProtobufMessage({
        param1: videoId,
        param2: innerParams,
      }),
    );
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

  function transcriptHasSegments(data) {
    return findTranscriptInitialSegments(data).some(
      (segment) =>
        segment.transcriptSegmentRenderer || segment.transcriptSectionHeaderRenderer,
    );
  }

  async function collectTranscriptParams(payload) {
    const seen = new Set();
    const paramsList = [];

    function add(label, params) {
      if (!params || seen.has(params)) {
        return;
      }
      seen.add(params);
      paramsList.push({ label, params });
    }

    add('cached', window.__quizeModeCachedTranscriptParams);

    try {
      add('next', await fetchNextTranscriptParams(payload.videoId));
    } catch (error) {
      paramsList.push({ label: 'next', error: error.message });
    }

    add('ytInitialData', extractTranscriptParamsFromPanels(window.ytInitialData?.engagementPanels));
    add('player', payload.getTranscriptParams);

    if (payload.videoId && payload.languageCode) {
      add(
        'protobuf',
        buildGetTranscriptParams(payload.videoId, payload.languageCode, payload.kind),
      );
    }

    return paramsList;
  }

  function buildGetTranscriptResult(data) {
    if (!transcriptHasSegments(data)) {
      throw new Error('empty transcript segments');
    }

    return {
      source: 'get_transcript',
      format: 'get_transcript',
      data,
      bodyLength: JSON.stringify(data).length,
    };
  }

  async function fetchGetTranscriptBody(params) {
    const data = await innertubePost('get_transcript', { params });
    return buildGetTranscriptResult(data);
  }

  function getCachedTranscriptResult() {
    const cached = window.__quizeModeCachedTranscript?.data;
    if (!cached) {
      return null;
    }

    if (!transcriptHasSegments(cached)) {
      return null;
    }

    return buildGetTranscriptResult(cached);
  }

  async function fetchUrlBody(url) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        Referer: window.location.href,
      },
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  }

  function detectTimedtextFormat(body) {
    const trimmed = body.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return 'json3';
    }
    if (trimmed.includes('<p') && (trimmed.includes(' t="') || trimmed.includes(" t='"))) {
      return 'srv3';
    }
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<transcript') || trimmed.includes('<text')) {
      return 'xml';
    }
    return null;
  }

  function appendFmt(url, fmt) {
    const parsed = new URL(url, 'https://www.youtube.com');
    parsed.searchParams.delete('fmt');
    parsed.searchParams.set('fmt', fmt);
    return parsed.toString();
  }

  async function fetchTimedtextFromUrl(baseUrl) {
    if (!baseUrl) {
      return { error: 'timedtext URL missing' };
    }

    const requiresPoToken = baseUrl.includes('exp=xpe');
    const errors = [];
    const candidates = [];

    if (!requiresPoToken) {
      candidates.push({ label: 'raw', url: baseUrl });
      candidates.push({ label: 'json3', url: appendFmt(baseUrl, 'json3') });
      candidates.push({ label: 'xml', url: appendFmt(baseUrl, 'xml') });
    }

    candidates.push({ label: 'srv3', url: appendFmt(baseUrl, 'srv3') });

    for (const candidate of candidates) {
      try {
        const { ok, status, body } = await fetchUrlBody(candidate.url);

        if (!ok) {
          errors.push(`${candidate.label}: HTTP ${status}`);
          continue;
        }

        if (!body.trim()) {
          errors.push(`${candidate.label}: empty body`);
          continue;
        }

        const format =
          candidate.label === 'raw' ? detectTimedtextFormat(body) : candidate.label;

        if (!format) {
          errors.push(`${candidate.label}: unknown format`);
          continue;
        }

        if (format === 'json3') {
          try {
            JSON.parse(body);
          } catch {
            errors.push(`${candidate.label}: invalid JSON`);
            continue;
          }
        }

        return {
          source: 'timedtext',
          format,
          body,
          bodyLength: body.length,
        };
      } catch (error) {
        errors.push(`${candidate.label}: ${error.message}`);
      }
    }

    if (requiresPoToken) {
      errors.unshift('timedtext skipped raw/json3/xml (PoToken required)');
    }

    return { error: errors.join('; ') || 'timedtext fetch failed' };
  }

  function selectCaptionTrack(tracks, audioLanguage, languageCode, kind) {
    if (!tracks?.length) {
      return null;
    }

    const preferredLanguage = languageCode || audioLanguage;
    if (preferredLanguage) {
      const forLang = tracks.filter((track) => track.languageCode === preferredLanguage);
      if (kind === 'asr') {
        return forLang.find((track) => track.kind === 'asr') || forLang[0];
      }
      const manual = forLang.find((track) => track.kind !== 'asr');
      if (manual) {
        return manual;
      }
      return forLang.find((track) => track.kind === 'asr') || forLang[0];
    }

    const manual = tracks.find((track) => track.kind !== 'asr');
    return manual || tracks.find((track) => track.kind === 'asr') || tracks[0];
  }

  async function fetchAndroidTimedtext(payload) {
    const playerData = await innertubePost(
      'player',
      {
        videoId: payload.videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      },
      { android: true },
    );

    const tracks =
      playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const track = selectCaptionTrack(
      tracks,
      payload.audioLanguage,
      payload.languageCode,
      payload.kind,
    );

    if (!track?.baseUrl) {
      throw new Error('android player returned no caption track');
    }

    const timedtextResult = await fetchTimedtextFromUrl(track.baseUrl);
    if (timedtextResult.error) {
      throw new Error(timedtextResult.error);
    }

    return timedtextResult;
  }

  async function fetchTranscriptBody(payload) {
    const errors = [];

    const cached = getCachedTranscriptResult();
    if (cached) {
      return cached;
    }

    const paramsList = await collectTranscriptParams(payload);

    for (const entry of paramsList) {
      if (entry.error) {
        errors.push(`${entry.label}: ${entry.error}`);
        continue;
      }

      try {
        return await fetchGetTranscriptBody(entry.params);
      } catch (error) {
        errors.push(`${entry.label}: ${error.message}`);
      }
    }

    const timedtextResult = await fetchTimedtextFromUrl(payload.baseUrl);
    if (!timedtextResult.error) {
      return timedtextResult;
    }
    errors.push(`timedtext: ${timedtextResult.error}`);

    try {
      return await fetchAndroidTimedtext(payload);
    } catch (error) {
      errors.push(`android: ${error.message}`);
    }

    throw new Error(errors.join('; ') || 'transcript fetch failed');
  }

  function onBridgeMessage(event) {
    if (event.source !== window) {
      return;
    }

    if (event.data?.source !== SOURCE) {
      return;
    }

    const { type, requestId } = event.data;

    if (type === 'REQUEST_PLAYER_DATA') {
      postPlayerData(requestId);
      return;
    }

    if (type === 'REQUEST_TRANSCRIPT') {
      fetchTranscriptBody(event.data.payload)
        .then((data) => {
          window.postMessage(
            {
              source: SOURCE,
              type: 'TRANSCRIPT_DATA',
              requestId,
              data,
            },
            '*',
          );
        })
        .catch((error) => {
          window.postMessage(
            {
              source: SOURCE,
              type: 'TRANSCRIPT_DATA',
              requestId,
              error: error.message,
            },
            '*',
          );
        });
    }
  }

  if (window.__quizeModeBridgeHandler) {
    window.removeEventListener('message', window.__quizeModeBridgeHandler);
  }

  window.addEventListener('message', onBridgeMessage);
  window.__quizeModeBridgeHandler = onBridgeMessage;
})();
