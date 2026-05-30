import OpenAI from 'openai';
import { config } from '../config.js';
import { QUIZ_SYSTEM_PROMPT } from '../prompts/quiz.js';
import { parseQuizLlmResponse } from '../lib/parseLlmJson.js';

const openrouterHeaders = {};
if (config.openrouterHttpReferer) {
  openrouterHeaders['HTTP-Referer'] = config.openrouterHttpReferer;
}
if (config.openrouterAppTitle) {
  openrouterHeaders['X-Title'] = config.openrouterAppTitle;
}

const client = new OpenAI({
  apiKey: config.openrouterApiKey,
  baseURL: config.openrouterBaseUrl,
  defaultHeaders: openrouterHeaders,
});

const RETRY_USER_MESSAGE = 'Верни только валидный JSON без markdown-разметки, строго по формату из инструкции.';

export async function generateQuizFromChunk(userMessage) {
  if (!config.openrouterApiKey) {
    const error = new Error('OPENROUTER_API_KEY is not configured');
    error.statusCode = 502;
    throw error;
  }

  const messages = [
    { role: 'system', content: QUIZ_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model: config.llmModel,
        messages,
        temperature: 0.4,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty LLM response');
      }

      return parseQuizLlmResponse(content);
    } catch (error) {
      lastError = error;
      messages.push({ role: 'user', content: RETRY_USER_MESSAGE });
    }
  }

  const error = new Error(lastError?.message || 'Failed to parse LLM response');
  error.statusCode = 502;
  throw error;
}
