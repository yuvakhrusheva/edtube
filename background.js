importScripts('api-client.js');

const ANONYMOUS_USER_ID_KEY = 'anonymousUserId';

function getOrCreateAnonymousUserId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(ANONYMOUS_USER_ID_KEY, (result) => {
      if (chrome.runtime.lastError) {
        resolve(crypto.randomUUID());
        return;
      }

      if (result[ANONYMOUS_USER_ID_KEY]) {
        resolve(result[ANONYMOUS_USER_ID_KEY]);
        return;
      }

      const anonymousUserId = crypto.randomUUID();
      chrome.storage.local.set({ [ANONYMOUS_USER_ID_KEY]: anonymousUserId }, () => {
        resolve(anonymousUserId);
      });
    });
  });
}

async function resolveUserId() {
  const userInfo = await new Promise((resolve) => {
    chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(info);
    });
  });

  if (userInfo.error) {
    const anonymousUserId = await getOrCreateAnonymousUserId();
    return {
      userId: anonymousUserId,
      source: 'anonymous',
      reason: userInfo.error,
    };
  }

  if (userInfo.id) {
    return {
      userId: userInfo.id,
      source: 'google',
      email: userInfo.email || null,
    };
  }

  const anonymousUserId = await getOrCreateAnonymousUserId();
  const reason = userInfo.email
    ? 'Google profile ID is empty despite signed-in account'
    : 'Not signed into Chrome with a Google account';

  return {
    userId: anonymousUserId,
    source: 'anonymous',
    reason,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_GOOGLE_USER_ID') {
    resolveUserId().then(sendResponse);
    return true;
  }

  if (message.type === 'GENERATE_QUESTION') {
    const { videoId, chunkIndex, transcriptChunk, language } = message;

    generateQuestion(
      { videoId, chunkIndex, transcriptChunk, language },
      resolveUserId,
    )
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          error: error.message || 'Failed to generate question',
          code: 500,
        });
      });

    return true;
  }

  return false;
});
