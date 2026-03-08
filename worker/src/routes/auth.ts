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

  if (session_duration_minutes !== undefined) {
    if (![30, 45, 50, 60].includes(session_duration_minutes)) {
      return c.json({ success: false, error: 'La duración debe ser 30, 45, 50 o 60 minutos' }, 400);
    }
    await c.env.DB.prepare('UPDATE psicologos SET session_duration_minutes = ? WHERE id = ?')
      .bind(session_duration_minutes, psychologistId).run();
  }

  if (cancel_min_hours !== undefined) {
    if (typeof cancel_min_hours !== 'number' || cancel_min_hours < 0 || cancel_min_hours > 168) {
      return c.json({ success: false, error: 'cancel_min_hours debe ser entre 0 y 168' }, 400);
    }
    await c.env.DB.prepare('UPDATE psicologos SET cancel_min_hours = ? WHERE id = ?')
      .bind(cancel_min_hours, psychologistId).run();
  }

  if (reschedule_min_hours !== undefined) {
    if (typeof reschedule_min_hours !== 'number' || reschedule_min_hours < 0 || reschedule_min_hours > 168) {
      return c.json({ success: false, error: 'reschedule_min_hours debe ser entre 0 y 168' }, 400);
    }
    await c.env.DB.prepare('UPDATE psicologos SET reschedule_min_hours = ? WHERE id = ?')
      .bind(reschedule_min_hours, psychologistId).run();
  }

  if (booking_min_hours !== undefined) {
    if (typeof booking_min_hours !== 'number' || booking_min_hours < 0 || booking_min_hours > 168) {
      return c.json({ success: false, error: 'booking_min_hours debe ser entre 0 y 168' }, 400);
    }
    await c.env.DB.prepare('UPDATE psicologos SET booking_min_hours = ? WHERE id = ?')
      .bind(booking_min_hours, psychologistId).run();
  }

  if (whatsapp_number !== undefined) {
    await c.env.DB.prepare('UPDATE psicologos SET whatsapp_number = ? WHERE id = ?')
      .bind(whatsapp_number, psychologistId).run();
  }

  if (policy_unit !== undefined) {
    if (!['minutes', 'hours', 'days'].includes(policy_unit)) {
      return c.json({ success: false, error: 'policy_unit debe ser minutes, hours o days' }, 400);
    }
    await c.env.DB.prepare('UPDATE psicologos SET policy_unit = ? WHERE id = ?')
      .bind(policy_unit, psychologistId).run();
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

authRouter.post('/login', async (c) => {
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
    return c.json({ success: false, error: 'Credenciales inválidas' }, 401);
  }

  const valid = await verifyPassword(password, psych.password_hash);
  if (!valid) {
    return c.json({ success: false, error: 'Credenciales inválidas' }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signJWT(
    { sub: psych.id, email: psych.email, iat: now, exp: now + 8 * 3600 },
    c.env.JWT_SECRET,
  );

  return c.json({
    success: true,
    data: {
      token,
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

authRouter.post('/logout', (c) => {
  return c.json({ success: true });
});
