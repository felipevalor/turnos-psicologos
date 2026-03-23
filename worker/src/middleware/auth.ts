import { createMiddleware } from 'hono/factory';
import { verifyJWT } from '../lib/jwt';
import type { Env, AppVariables } from '../types';

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  // Accept token from HttpOnly cookie (preferred) or Authorization header (fallback)
  let token: string | null = null;

  const cookieHeader = c.req.header('Cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)psi_session=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) {
    const authorization = c.req.header('Authorization');
    if (authorization?.startsWith('Bearer ')) {
      token = authorization.slice(7);
    }
  }

  if (!token) {
    return c.json({ success: false, error: 'No autorizado' }, 401);
  }

  const payload = await verifyJWT(token, c.env.JWT_SECRET);

  if (!payload) {
    return c.json({ success: false, error: 'Token inválido o expirado' }, 401);
  }

  c.set('psychologistId', payload.sub);
  c.set('psychologistEmail', payload.email);

  await next();
});
