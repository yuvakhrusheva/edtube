import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const router = Router();

router.post('/bootstrap', (req, res) => {
  const { userId, userSource } = req.body ?? {};

  if (!userId || typeof userId !== 'string') {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  if (userSource !== 'google' && userSource !== 'anonymous') {
    res.status(400).json({ error: 'userSource must be "google" or "anonymous"' });
    return;
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.sessionTtlDays);

  const sessionToken = jwt.sign(
    { userSource },
    config.apiSessionSecret,
    {
      subject: userId,
      expiresIn: `${config.sessionTtlDays}d`,
    },
  );

  res.json({
    sessionToken,
    expiresAt: expiresAt.toISOString(),
  });
});

export default router;
