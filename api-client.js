const API_BASE_URL = 'http://localhost:3001';
const SESSION_TOKEN_KEY = 'sessionToken';
const SESSION_EXPIRES_AT_KEY = 'sessionExpiresAt';
const QUOTA_CACHE_KEY = 'quotaCache';

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function storageSet(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });
}

async function ensureSession(resolveUserId) {
  const stored = await storageGet([SESSION_TOKEN_KEY, SESSION_EXPIRES_AT_KEY]);
  const token = stored[SESSION_TOKEN_KEY];
  const expiresAt = stored[SESSION_EXPIRES_AT_KEY];

  if (token && expiresAt && new Date(expiresAt) > new Date()) {
    return token;
  }

  const user = await resolveUserId();
  const response = await fetch(`${API_BASE_URL}/v1/auth/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: user.userId,
      userSource: user.source,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Bootstrap failed (${response.status})`);
  }

  await storageSet({
    [SESSION_TOKEN_KEY]: data.sessionToken,
    [SESSION_EXPIRES_AT_KEY]: data.expiresAt,
  });

  return data.sessionToken;
}

async function generateQuestion(payload, resolveUserId) {
  await ensureSession(resolveUserId);

  const stored = await storageGet([SESSION_TOKEN_KEY]);
  const sessionToken = stored[SESSION_TOKEN_KEY];

  const response = await fetch(`${API_BASE_URL}/v1/quiz/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: data.error || `Generate failed (${response.status})`,
      code: response.status,
      quota: data.quota || null,
    };
  }

  if (data.quota) {
    await storageSet({ [QUOTA_CACHE_KEY]: data.quota });
  }

  return data;
}
