const PRELOAD_LEAD_MS = 30_000;
const PAUSE_TOLERANCE_MS = 500;

const quizScheduler = {
  pendingBlocks: new Map(),
  shownChunkIndices: new Set(),
  passedChunkIndices: new Set(),
  preloadedChunks: new Set(),
  quotaExhausted: false,
  watching: false,
  currentVideoId: null,
  generateChunk: null,
  regenerateChunk: null,

  init(generateChunkFn, regenerateChunkFn) {
    this.generateChunk = generateChunkFn;
    this.regenerateChunk = regenerateChunkFn;
  },

  reset() {
    this.pendingBlocks.clear();
    this.shownChunkIndices.clear();
    this.passedChunkIndices.clear();
    this.preloadedChunks.clear();
    this.quotaExhausted = false;
    this.watching = false;
    this.currentVideoId = null;
    stopTimeUpdate();
    hideOverlay();
  },

  stopWatching() {
    this.watching = false;
    stopTimeUpdate();
    hideOverlay();
  },

  registerBlock(block) {
    if (block.status !== 'success' || !Array.isArray(block.questions) || block.questions.length !== 3) {
      return;
    }

    this.pendingBlocks.set(block.chunkIndex, {
      chunkIndex: block.chunkIndex,
      pauseTimestampMs: block.pauseTimestampMs,
      questions: block.questions,
      videoId: block.videoId,
    });

    console.log('[Quize-Mode] Question block registered:', {
      chunkIndex: block.chunkIndex,
      pauseTimestampMs: block.pauseTimestampMs,
      questionCount: block.questions.length,
    });
  },

  replaceBlock(block) {
    this.pendingBlocks.set(block.chunkIndex, {
      chunkIndex: block.chunkIndex,
      pauseTimestampMs: block.pauseTimestampMs,
      questions: block.questions,
      videoId: block.videoId,
    });
    this.shownChunkIndices.delete(block.chunkIndex);
    this.passedChunkIndices.delete(block.chunkIndex);

    console.log('[Quize-Mode] Question block regenerated:', {
      chunkIndex: block.chunkIndex,
      pauseTimestampMs: block.pauseTimestampMs,
    });
  },

  startWatching(videoId) {
    this.currentVideoId = videoId;
    this.watching = true;
    onTimeUpdate(() => this.tick());
  },

  getSortedBlocks() {
    return Array.from(this.pendingBlocks.values()).sort(
      (a, b) => a.pauseTimestampMs - b.pauseTimestampMs,
    );
  },

  async tick() {
    if (!this.watching || isOverlayVisible()) {
      return;
    }

    const currentTimeMs = getCurrentTimeMs();

    for (const block of this.getSortedBlocks()) {
      if (
        this.passedChunkIndices.has(block.chunkIndex) ||
        this.shownChunkIndices.has(block.chunkIndex)
      ) {
        continue;
      }

      if (currentTimeMs >= block.pauseTimestampMs - PRELOAD_LEAD_MS) {
        await this.maybePreloadChunk(block.chunkIndex + 1);
      }
    }

    const dueBlock = this.getSortedBlocks().find(
      (block) =>
        !this.passedChunkIndices.has(block.chunkIndex) &&
        !this.shownChunkIndices.has(block.chunkIndex) &&
        currentTimeMs >= block.pauseTimestampMs - PAUSE_TOLERANCE_MS,
    );

    if (dueBlock) {
      this.showQuizBlock(dueBlock);
    }
  },

  showQuizBlock(block) {
    this.shownChunkIndices.add(block.chunkIndex);
    pauseVideo();

    const chunkStartMs = block.chunkIndex * CHUNK_DURATION_MS;

    showQuestionSeries(block.questions, {
      onComplete: () => {},
      onPassed: () => {
        hideOverlay();
        playVideo();
        this.passedChunkIndices.add(block.chunkIndex);
        this.maybePreloadChunk(block.chunkIndex + 1);
      },
      onRewind: () => {
        hideOverlay();
        seekToMs(chunkStartMs);
        playVideo();
        this.handleFailedBlock(block);
      },
    });
  },

  async handleFailedBlock(block) {
    this.shownChunkIndices.delete(block.chunkIndex);
    this.passedChunkIndices.delete(block.chunkIndex);

    if (typeof this.regenerateChunk !== 'function') {
      return;
    }

    const newBlock = await this.regenerateChunk(block.chunkIndex);
    if (newBlock?.status === 'success') {
      this.replaceBlock(newBlock);
      return;
    }

    console.warn('[Quize-Mode] Failed to regenerate questions for chunk:', block.chunkIndex);
  },

  async maybePreloadChunk(chunkIndex) {
    if (
      this.quotaExhausted ||
      this.preloadedChunks.has(chunkIndex) ||
      typeof this.generateChunk !== 'function'
    ) {
      return;
    }

    if (!transcriptChunks?.[chunkIndex]?.length) {
      return;
    }

    this.preloadedChunks.add(chunkIndex);

    const result = await this.generateChunk(chunkIndex);

    if (result?.code === 429) {
      this.quotaExhausted = true;
      this.preloadedChunks.delete(chunkIndex);
      console.warn('[Quize-Mode] Daily quota exceeded — preload stopped');
      return;
    }

    if (result?.status === 'skip') {
      console.log('[Quize-Mode] Preloaded chunk skipped:', chunkIndex);
      return;
    }

    if (result?.error) {
      this.preloadedChunks.delete(chunkIndex);
    }
  },
};
