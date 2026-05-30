import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { buildQuizUserMessage } from '../prompts/quiz.js';
import { generateQuizFromChunk } from '../services/llm.js';
import { checkQuota, consumeQuota } from '../services/quota.js';
import { parseTimestampToMs } from '../lib/timestamp.js';

const router = Router();
const CHUNK_DURATION_MS = 5 * 60 * 1000;

function validateTranscriptChunk(transcriptChunk) {
  if (!Array.isArray(transcriptChunk) || transcriptChunk.length === 0) {
    return false;
  }

  return transcriptChunk.every(
    (segment) =>
      typeof segment.startMs === 'number' &&
      typeof segment.text === 'string' &&
      segment.text.trim().length > 0,
  );
}

function getFallbackPauseTimestampMs(transcriptChunk) {
  const lastSegment = transcriptChunk[transcriptChunk.length - 1];
  return lastSegment.startMs;
}

router.post('/generate', requireAuth, async (req, res) => {
  const { videoId, chunkIndex, transcriptChunk, language } = req.body ?? {};

  if (!videoId || typeof videoId !== 'string') {
    res.status(400).json({ error: 'videoId is required' });
    return;
  }

  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    res.status(400).json({ error: 'chunkIndex must be a non-negative integer' });
    return;
  }

  if (!language || typeof language !== 'string') {
    res.status(400).json({ error: 'language is required' });
    return;
  }

  if (!validateTranscriptChunk(transcriptChunk)) {
    res.status(400).json({ error: 'transcriptChunk must be a non-empty array of segments' });
    return;
  }

  try {
    checkQuota(req.user.userId);

    const userMessage = buildQuizUserMessage({
      videoId,
      chunkIndex,
      language,
      transcriptChunk,
      chunkDurationMs: CHUNK_DURATION_MS,
    });

    const llmResult = await generateQuizFromChunk(userMessage);
    const quota = consumeQuota(req.user.userId);

    if (llmResult.status === 'skip') {
      res.json({
        status: 'skip',
        chunkIndex,
        quota,
      });
      return;
    }

    let pauseTimestampMs = parseTimestampToMs(llmResult.pauseTimestamp);
    if (pauseTimestampMs === null) {
      pauseTimestampMs = getFallbackPauseTimestampMs(transcriptChunk);
    }

    res.json({
      status: 'success',
      chunkIndex,
      pauseTimestampMs,
      questions: llmResult.questions,
      quota,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const body = { error: error.message };

    if (error.quota) {
      body.quota = error.quota;
    }

    res.status(statusCode).json(body);
  }
});

export default router;
