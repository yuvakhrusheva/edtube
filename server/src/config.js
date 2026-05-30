import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../.env');

dotenv.config({ path: envPath });

function requireEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3001),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiSessionSecret: requireEnv('API_SESSION_SECRET', 'change-me-to-random-string'),
  llmProvider: process.env.LLM_PROVIDER || 'openrouter',
  llmModel: process.env.LLM_MODEL || 'google/gemini-2.5-flash',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  openrouterHttpReferer: process.env.OPENROUTER_HTTP_REFERER || '',
  openrouterAppTitle: process.env.OPENROUTER_APP_TITLE || '',
  freeDailyQuestionLimit: Number(process.env.FREE_DAILY_QUESTION_LIMIT || 5),
  sessionTtlDays: 7,
};

if (!config.openrouterApiKey) {
  console.warn('[server] OPENROUTER_API_KEY is not set — quiz generation will fail');
}
