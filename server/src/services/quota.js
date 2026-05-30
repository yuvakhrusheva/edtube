import { config } from '../config.js';
import { getNextMidnightIso } from '../lib/timestamp.js';

/** @type {Map<string, { used: number, date: string }>} */
const quotaByUser = new Map();

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function getEntry(userId) {
  const today = todayUtc();
  const existing = quotaByUser.get(userId);

  if (!existing || existing.date !== today) {
    const entry = { used: 0, date: today };
    quotaByUser.set(userId, entry);
    return entry;
  }

  return existing;
}

export function getQuotaStatus(userId) {
  const entry = getEntry(userId);
  return {
    used: entry.used,
    limit: config.freeDailyQuestionLimit,
    resetsAt: getNextMidnightIso(),
  };
}

export function checkQuota(userId) {
  const quota = getQuotaStatus(userId);
  if (quota.used >= quota.limit) {
    const error = new Error('Daily question limit exceeded');
    error.statusCode = 429;
    error.quota = quota;
    throw error;
  }
  return quota;
}

export function consumeQuota(userId) {
  const entry = getEntry(userId);
  entry.used += 1;
  return getQuotaStatus(userId);
}
