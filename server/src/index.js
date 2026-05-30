import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import authRouter from './routes/auth.js';
import quizRouter from './routes/quiz.js';

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
    openrouterConfigured: Boolean(config.openrouterApiKey),
  });
});

app.use('/v1/auth', authRouter);
app.use('/v1/quiz', quizRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(config.port, () => {
  console.log(`[server] Listening on http://localhost:${config.port}`);
});
