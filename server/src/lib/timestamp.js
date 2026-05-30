const TIMESTAMP_PATTERN = /^(\d{1,2}):(\d{2})$/;

export function parseTimestampToMs(timestamp) {
  if (typeof timestamp !== 'string') {
    return null;
  }

  const match = timestamp.trim().match(TIMESTAMP_PATTERN);
  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);

  if (seconds >= 60) {
    return null;
  }

  return (minutes * 60 + seconds) * 1000;
}

export function formatSegmentTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function getNextMidnightIso() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}
