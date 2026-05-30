function stripMarkdownFences(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function isValidOptions(options) {
  return (
    Array.isArray(options) &&
    options.length === 4 &&
    options.every((option) => typeof option === 'string' && option.trim().length > 0)
  );
}

function parseQuestionItem(item, index) {
  if (typeof item.question !== 'string' || !item.question.trim()) {
    throw new Error(`LLM question #${index + 1} missing question text`);
  }

  if (!isValidOptions(item.options)) {
    throw new Error(`LLM question #${index + 1} must include exactly 4 non-empty options`);
  }

  const correctIndex = item.correct_index ?? item.correctIndex;
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    throw new Error(`LLM question #${index + 1} correct_index must be 0–3`);
  }

  return {
    question: item.question.trim(),
    options: item.options.map((option) => option.trim()),
    correctIndex,
  };
}

export function parseQuizLlmResponse(rawText) {
  const cleaned = stripMarkdownFences(rawText);

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('LLM response is not valid JSON');
  }

  if (parsed.status === 'skip') {
    return { status: 'skip' };
  }

  if (parsed.status !== 'success') {
    throw new Error('LLM response missing valid status');
  }

  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 3) {
    throw new Error('LLM response must include exactly 3 questions');
  }

  const questions = parsed.questions.map((item, index) => parseQuestionItem(item, index));

  return {
    status: 'success',
    pauseTimestamp: typeof parsed.pause_timestamp === 'string' ? parsed.pause_timestamp : null,
    questions,
  };
}
