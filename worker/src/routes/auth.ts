import { Hono } from 'hono';
import { verifyPassword } from '../lib/password';
import { signJWT } from '../lib/jwt';
import { authMiddleware } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

type PsychologistRow = {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  session_duration_minutes: number;
  cancel_min_hours: number;
  reschedule_min_hours: number;
  booking_min_hours: number;
  whatsapp_number: string | null;
  policy_unit: 'minutes' | 'hours' | 'days';
};

// In-memory fallback rate limiter (per-isolate; KV used when available for cross-isolate persistence)
const loginAttempts = new Map<string, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

async function isRateLimited(env: Env, ip: string): Promise<boolean> {
  const key = `rate:login:${ip}`;
  const now = Date.now();

  if (env.CACHE) {
    const raw = await env.CACHE.get(key);
    if (!raw) return false;
    const entry = JSON.parse(raw) as { count: number; windowStart: number };
    if (now - entry.windowStart > RATE_WINDOW_MS) return false;
    return entry.count >= MAX_ATTEMPTS;
  }

  // Fallback: in-memory
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (now - entry.windowStart > RATE_WINDOW_MS) return false;
  return entry.count >= MAX_ATTEMPTS;
}

async function recordFailedAttempt(env: Env, ip: string): Promise<void> {
  const key = `rate:login:${ip}`;
  const now = Date.now();

  if (env.CACHE) {
    const raw = await env.CACHE.get(key);
    const entry = raw
      ? (JSON.parse(raw) as { count: number; windowStart: number })
      : { count: 0, windowStart: now };
    if (now - entry.windowStart > RATE_WINDOW_MS) {
      entry.count = 0;
      entry.windowStart = now;
    }
    entry.count++;
    await env.CACHE.put(key, JSON.stringify(entry), { expirationTtl: RATE_WINDOW_MS / 1000 });
    return;
  }

  // Fallback: in-memory
  const entry = loginAttempts.get(ip) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count++;
  loginAttempts.set(ip, entry);
}

async function clearRateLimit(env: Env, ip: string): Promise<void> {
  if (env.CACHE) {
    await env.CACHE.delete(`rate:login:${ip}`);
    return;
  }
  loginAttempts.delete(ip);
}

function buildSessionCookie(token: string, isSecure: boolean): string {
  const base = `psi_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`;
  return isSecure ? `${base}; Secure` : base;
}

export const authRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// GET /api/auth/me
authRouter.get('/me', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId');

  const psych = await c.env.DB.prepare(
    `SELECT id, nombre as name, email, session_duration_minutes,
            cancel_min_hours, reschedule_min_hours, booking_min_hours, whatsapp_number, policy_unit
     FROM psicologos WHERE id = ?`,
  )
    .bind(psychologistId)
    .first<Omit<PsychologistRow, 'password_hash'>>();

  if (!psych) {
    return c.json({ success: false, error: 'Psicólogo no encontrado' }, 404);
  }

  return c.json({ success: true, data: psych });
});

// PATCH /api/auth/me
authRouter.patch('/me', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId');

  let body: {
    session_duration_minutes?: number;
    cancel_min_hours?: number;
    reschedule_min_hours?: number;
    booking_min_hours?: number;
    whatsapp_number?: string | null;
    policy_unit?: 'minutes' | 'hours' | 'days';
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
  }

  const { session_duration_minutes, cancel_min_hours, reschedule_min_hours, booking_min_hours, whatsapp_number, policy_unit } = body;

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (session_duration_minutes !== undefined) {
    if (![30, 45, 50, 60].includes(session_duration_minutes)) {
      return c.json({ success: false, error: 'La duración debe ser 30, 45, 50 o 60 minutos' }, 400);
    }
    updates.push('session_duration_minutes = ?');
    values.push(session_duration_minutes);
  }

  if (cancel_min_hours !== undefined) {
    if (typeof cancel_min_hours !== 'number' || cancel_min_hours < 0 || cancel_min_hours > 168) {
      return c.json({ success: false, error: 'cancel_min_hours debe ser entre 0 y 168' }, 400);
    }
    updates.push('cancel_min_hours = ?');
    values.push(cancel_min_hours);
  }

  if (reschedule_min_hours !== undefined) {
    if (typeof reschedule_min_hours !== 'number' || reschedule_min_hours < 0 || reschedule_min_hours > 168) {
      return c.json({ success: false, error: 'reschedule_min_hours debe ser entre 0 y 168' }, 400);
    }
    updates.push('reschedule_min_hours = ?');
    values.push(reschedule_min_hours);
  }

  if (booking_min_hours !== undefined) {
    if (typeof booking_min_hours !== 'number' || booking_min_hours < 0 || booking_min_hours > 168) {
      return c.json({ success: false, error: 'booking_min_hours debe ser entre 0 y 168' }, 400);
    }
    updates.push('booking_min_hours = ?');
    values.push(booking_min_hours);
  }

  if (whatsapp_number !== undefined) {
    if (whatsapp_number !== null && !/^\+\d{7,15}$/.test(whatsapp_number)) {
      return c.json({ success: false, error: 'Formato de WhatsApp inválido. Use formato internacional: +549xxxxxxxxxx' }, 400);
    }
    updates.push('whatsapp_number = ?');
    values.push(whatsapp_number);
  }

  if (policy_unit !== undefined) {
    if (!['minutes', 'hours', 'days'].includes(policy_unit)) {
      return c.json({ success: false, error: 'policy_unit debe ser minutes, hours o days' }, 400);
    }
    updates.push('policy_unit = ?');
    values.push(policy_unit);
  }

  if (updates.length > 0) {
    values.push(psychologistId);
    await c.env.DB.prepare(`UPDATE psicologos SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values).run();
  }

  const psych = await c.env.DB.prepare(
    `SELECT id, nombre as name, email, session_duration_minutes,
            cancel_min_hours, reschedule_min_hours, booking_min_hours, whatsapp_number, policy_unit
     FROM psicologos WHERE id = ?`,
  )
    .bind(psychologistId)
    .first<Omit<PsychologistRow, 'password_hash'>>();

  return c.json({ success: true, data: psych });
});

// POST /api/auth/login
authRouter.post('/login', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';

  if (await isRateLimited(c.env, ip)) {
    return c.json(
      { success: false, error: 'Demasiados intentos fallidos. Esperá 15 minutos.' },
      429,
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
  }

  const { email, password } = body;

  if (!email || !password) {
    return c.json({ success: false, error: 'Email y contraseña requeridos' }, 400);
  }

  const psych = await c.env.DB.prepare(
    `SELECT id, nombre as name, email, password_hash, session_duration_minutes,
            cancel_min_hours, reschedule_min_hours, booking_min_hours, whatsapp_number, policy_unit
     FROM psicologos WHERE email = ?`,
  )
    .bind(email)
    .first<PsychologistRow>();

  if (!psych) {
    await recordFailedAttempt(c.env, ip);
    return c.json({ success: false, error: 'Credenciales inválidas' }, 401);
  }

  const valid = await verifyPassword(password, psych.password_hash);
  if (!valid) {
    await recordFailedAttempt(c.env, ip);
    return c.json({ success: false, error: 'Credenciales inválidas' }, 401);
  }

  await clearRateLimit(c.env, ip);

  const now = Math.floor(Date.now() / 1000);
  const token = await signJWT(
    { sub: psych.id, email: psych.email, iat: now, exp: now + 8 * 3600 },
    c.env.JWT_SECRET,
  );

  const isSecure = new URL(c.req.url).protocol === 'https:';
  c.header('Set-Cookie', buildSessionCookie(token, isSecure));

  return c.json({
    success: true,
    data: {
      psychologist: {
        id: psych.id,
        name: psych.name,
        email: psych.email,
        session_duration_minutes: psych.session_duration_minutes,
        cancel_min_hours: psych.cancel_min_hours,
        reschedule_min_hours: psych.reschedule_min_hours,
        booking_min_hours: psych.booking_min_hours,
        whatsapp_number: psych.whatsapp_number,
        policy_unit: psych.policy_unit ?? 'hours',
      },
    },
  });
});

// POST /api/auth/logout
authRouter.post('/logout', (c) => {
  c.header('Set-Cookie', 'psi_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  return c.json({ success: true });
});
