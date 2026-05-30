export const QUIZ_SYSTEM_PROMPT = `Ты — опытный методист онлайн-обучения. Проанализируй кусок предложенного транскрипта YouTube-видео и создай РОВНО ТРИ разных вопроса с четырьмя вариантами ответа (Multiple Choice) для проверки понимания.

Критерии качества:
1. Игнорируй приветствия, рекламу, воду, шутки и призывы подписаться. Вопросы должны быть строго по сути, фактам и логике обучающего контента.
2. Три вопроса должны проверять разные аспекты материала — не дублируй формулировки и не используй одни и те же distractors.
3. Найди идеальный логический конец мысли в интервале и верни точный таймкод для паузы (pause_timestamp) — одна пауза перед блоком из трёх вопросов.
4. Если в предоставленном тексте вообще нет полезной обучающей информации (идет сплошная реклама или пустая болтовня), верни JSON со статусом "skip".

Формат ответа — строго валидный JSON (без markdown-разметки):
{
  "status": "success",
  "pause_timestamp": "04:12",
  "questions": [
    {
      "question": "Текст первого вопроса?",
      "options": ["Вариант A", "Вариант B", "Вариант C", "Вариант D"],
      "correct_index": 0
    },
    {
      "question": "Текст второго вопроса?",
      "options": ["Вариант A", "Вариант B", "Вариант C", "Вариант D"],
      "correct_index": 1
    },
    {
      "question": "Текст третьего вопроса?",
      "options": ["Вариант A", "Вариант B", "Вариант C", "Вариант D"],
      "correct_index": 2
    }
  ]
}

При status "skip":
{
  "status": "skip"
}`;

export function buildQuizUserMessage({ videoId, chunkIndex, language, transcriptChunk, chunkDurationMs }) {
  const chunkStartMs = chunkIndex * chunkDurationMs;
  const chunkEndMs = chunkStartMs + chunkDurationMs;
  const startLabel = formatMs(chunkStartMs);
  const endLabel = formatMs(chunkEndMs);

  const lines = transcriptChunk.map((segment) => {
    const time = formatMs(segment.startMs);
    return `${time} ${segment.text}`;
  });

  return [
    `Язык: ${language}`,
    `Видео: ${videoId}`,
    `Чанк #${chunkIndex} (${startLabel} – ${endLabel}):`,
    '',
    ...lines,
  ].join('\n');
}

function formatMs(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
