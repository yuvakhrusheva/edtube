const CHUNK_DURATION_MS = 5 * 60 * 1000;

function chunkSegments(segments, chunkDurationMs = CHUNK_DURATION_MS) {
  if (!segments?.length) {
    return [];
  }

  const chunks = [];

  for (const segment of segments) {
    const index = Math.floor(segment.startMs / chunkDurationMs);
    if (!chunks[index]) {
      chunks[index] = [];
    }
    chunks[index].push(segment);
  }

  return chunks.filter(Boolean);
}
