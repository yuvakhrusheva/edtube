import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, config.apiSessionSecret);
    req.user = {
      userId: payload.sub,
      userSource: payload.userSource,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session token' });
  }
}
