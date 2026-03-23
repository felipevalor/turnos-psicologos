import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import { fetchArgentineHolidays } from './holidays';
import { getTodayDateString, addMinutes, isValidDate, isValidTime } from '../lib/date';

type SlotRow = {
  id: number;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  disponible: number;
  booking_id: number | null;
};

type OverlapRow = { count: number };
type ConfigRow = { session_duration_minutes: number };

function dateFromUTC(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

function formatUTC(date: Date): string {
  return date.toISOString().split('T')[0];
}

export async function generateSlotsForDate(db: D1Database, date: string, psychologistId: number, kv?: KVNamespace) {
  const year = parseInt(date.substring(0, 4), 10);
  const externalHolidays = await fetchArgentineHolidays(year, kv);
  const isHoliday = externalHolidays.some(h => h.date === date);

  let generate = true;
  if (isHoliday) {
    const override = await db.prepare(
      'SELECT id FROM holiday_overrides WHERE psychologist_id = ? AND date = ?'
    ).bind(psychologistId, date).first();
    if (!override) {
      generate = false;
    }
  }

  const d = dateFromUTC(date);
  const dayOfWeek = d.getUTCDay();

  let scheduleWindow = null;
  if (generate) {
    scheduleWindow = await db.prepare(
      'SELECT start_time, end_time, active FROM weekly_schedule WHERE psychologist_id = ? AND day_of_week = ?'
    ).bind(psychologistId, dayOfWeek).first<{ start_time: string, end_time: string, active: number }>();

    if (!scheduleWindow || scheduleWindow.active === 0) {
      generate = false;
    }
  }

  if (!generate || !scheduleWindow) {
    return;
  }

  const psych = await db.prepare('SELECT session_duration_minutes FROM psicologos WHERE id = ?').bind(psychologistId).first<{ session_duration_minutes: number }>();
  const sessionDuration = psych?.session_duration_minutes || 45;

  const existingSlotsResult = await db.prepare(
    'SELECT id, fecha, hora_inicio, hora_fin, disponible FROM slots WHERE psicologo_id = ? AND fecha = ? ORDER BY hora_inicio'
  ).bind(psychologistId, date).all<SlotRow>();

  const existingSlots = existingSlotsResult.results;
  const existingTimes = new Set(existingSlots.map(s => s.hora_inicio));

  const toInsert: { start: string, end: string }[] = [];

  let current = scheduleWindow.start_time;
  while (true) {
    const next = addMinutes(current, sessionDuration);
    if (next > scheduleWindow.end_time) break;
    if (!existingTimes.has(current)) {
      toInsert.push({ start: current, end: next });
    }
    current = next;
  }

  for (const slot of toInsert) {
    try {
      await db.prepare(
        'INSERT INTO slots (psicologo_id, fecha, hora_inicio, hora_fin, disponible) VALUES (?, ?, ?, ?, 1)'
      ).bind(psychologistId, date, slot.start, slot.end).run();
    } catch {
      // Ignore unique constraint failures for concurrent requests
    }
  }
}

export const slotsRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// GET /api/slots?date=YYYY-MM-DD  — public
slotsRouter.get('/', async (c) => {
  const date = c.req.query('date');
  if (!date || !isValidDate(date)) {
    return c.json({ success: false, error: 'Fecha inválida. Use formato YYYY-MM-DD' }, 400);
  }

  const psych = await c.env.DB.prepare(
    'SELECT id, session_duration_minutes, booking_min_hours, policy_unit FROM psicologos LIMIT 1'
  ).first<{ id: number; session_duration_minutes: number; booking_min_hours: number; policy_unit: string }>();
  if (!psych) {
    return c.json({ success: true, data: [] });
  }
  const psychologistId = psych.id;

  await generateSlotsForDate(c.env.DB, date, psychologistId, c.env.CACHE);

  const existingSlotsResult = await c.env.DB.prepare(
    'SELECT id, fecha, hora_inicio, hora_fin, disponible FROM slots WHERE psicologo_id = ? AND fecha = ? ORDER BY hora_inicio'
  ).bind(psychologistId, date).all<SlotRow>();

  const nowUtcMs = Date.now();
  const BA_OFFSET_MS = -3 * 60 * 60 * 1000;
  const nowBaMs = nowUtcMs + BA_OFFSET_MS;

  const policyMinHours = psych.booking_min_hours ?? 24;
  const policyUnit = psych.policy_unit ?? 'hours';
  let thresholdMinutes: number;
  if (policyUnit === 'minutes') {
    thresholdMinutes = policyMinHours;
  } else if (policyUnit === 'days') {
    thresholdMinutes = policyMinHours * 24 * 60;
  } else {
    thresholdMinutes = policyMinHours * 60;
  }

  const cutoffUtcMs = nowUtcMs + thresholdMinutes * 60 * 1000;
  const cutoffBaDt = new Date(cutoffUtcMs + BA_OFFSET_MS);
  const cutoffDateStr = `${cutoffBaDt.getUTCFullYear()}-${String(cutoffBaDt.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoffBaDt.getUTCDate()).padStart(2, '0')}`;
  const cutoffTimeStr = `${String(cutoffBaDt.getUTCHours()).padStart(2, '0')}:${String(cutoffBaDt.getUTCMinutes()).padStart(2, '0')}`;

  // Suppress unused variable warning — nowBaMs is kept for potential future use in cutoff logic
  void nowBaMs;

  const availableSlots = existingSlotsResult.results
    .filter(s => {
      if (Number(s.disponible) !== 1) return false;
      if (s.fecha < cutoffDateStr) return false;
      if (s.fecha === cutoffDateStr && s.hora_inicio <= cutoffTimeStr) return false;
      return true;
    })
    .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));

  return c.json({
    success: true,
    data: availableSlots.map(s => ({
      id: s.id,
      date: s.fecha,
      start_time: s.hora_inicio,
      end_time: s.hora_fin
    }))
  });
});

// GET /api/slots/all  — admin, with optional filters
slotsRouter.get('/all', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId');
  const date = c.req.query('date');
  const status = c.req.query('status');

  if (date && isValidDate(date)) {
    await generateSlotsForDate(c.env.DB, date, psychologistId as number, c.env.CACHE);
  }

  let query = `
    SELECT s.id, s.fecha as "date", s.hora_inicio as start_time, s.hora_fin as end_time, s.disponible as available,
           b.id as booking_id, b.paciente_nombre as patient_name, b.paciente_email as patient_email, b.paciente_telefono as patient_phone,
           rb.id as recurring_booking_id
    FROM slots s
    LEFT JOIN reservas b ON b.slot_id = s.id
    LEFT JOIN recurring_bookings rb
      ON rb.patient_email = b.paciente_email
      AND rb.patient_phone = b.paciente_telefono
      AND rb."time" = s.hora_inicio
      AND rb.psychologist_id = s.psicologo_id
      AND rb.active = 1
    WHERE s.psicologo_id = ? AND s.disponible >= 0
  `;
  const params: (string | number)[] = [psychologistId];

  if (date) {
    query += ' AND s.fecha = ?';
    params.push(date);
  }

  if (status === 'available') {
    query += ' AND s.disponible = 1 AND b.id IS NULL';
  } else if (status === 'booked') {
    query += ' AND b.id IS NOT NULL';
  } else if (status === 'blocked') {
    query += ' AND s.disponible = 0 AND b.id IS NULL';
  }

  query += ' ORDER BY s.fecha, s.hora_inicio';

  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// POST /api/slots  — admin, single slot
slotsRouter.post('/', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId');

  let body: { date?: string; start_time?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
  }

  const { date, start_time } = body;

  if (!date || !start_time) {
    return c.json({ success: false, error: 'date y start_time son requeridos' }, 400);
  }
  if (!isValidDate(date)) {
    return c.json({ success: false, error: 'Formato de fecha inválido (YYYY-MM-DD)' }, 400);
  }
  if (!isValidTime(start_time)) {
    return c.json({ success: false, error: 'Formato de hora inválido (HH:MM)' }, 400);
  }
  if (date < getTodayDateString()) {
    return c.json({ success: false, error: 'No se puede crear un turno en una fecha pasada' }, 400);
  }

  const config = await c.env.DB.prepare('SELECT session_duration_minutes FROM psicologos WHERE id = ?')
    .bind(psychologistId)
    .first<ConfigRow>();
  const duration = config?.session_duration_minutes ?? 45;

  const end_time = addMinutes(start_time, duration);

  const overlap = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM slots
     WHERE psicologo_id = ? AND fecha = ?
     AND NOT (hora_fin <= ? OR hora_inicio >= ?)`,
  )
    .bind(psychologistId, date, start_time, end_time)
    .first<OverlapRow>();

  if (overlap && overlap.count > 0) {
    return c.json({ success: false, error: 'El turno se superpone con uno existente' }, 409);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO slots (psicologo_id, fecha, hora_inicio, hora_fin) VALUES (?, ?, ?, ?)',
  )
    .bind(psychologistId, date, start_time, end_time)
    .run();

  return c.json(
    { success: true, data: { id: result.meta.last_row_id, date, start_time, end_time, available: 1 } },
    201,
  );
});

// POST /api/slots/batch  — admin, bulk creation
slotsRouter.post('/batch', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId');

  let body: { start_date?: string; end_date?: string; start_time?: string; days_of_week?: number[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
  }

  const { start_date, end_date, start_time, days_of_week } = body;

  if (!start_date || !end_date || !start_time || !Array.isArray(days_of_week) || days_of_week.length === 0) {
    return c.json(
      { success: false, error: 'Campos requeridos: start_date, end_date, start_time, days_of_week' },
      400,
    );
  }
  if (!isValidDate(start_date) || !isValidDate(end_date)) {
    return c.json({ success: false, error: 'Formato de fecha inválido' }, 400);
  }
  if (!isValidTime(start_time)) {
    return c.json({ success: false, error: 'Formato de hora inválido (HH:MM)' }, 400);
  }
  if (start_date < getTodayDateString()) {
    return c.json({ success: false, error: 'La fecha de inicio no puede ser pasada' }, 400);
  }
  if (end_date < start_date) {
    return c.json({ success: false, error: 'end_date debe ser posterior a start_date' }, 400);
  }

  const config = await c.env.DB.prepare('SELECT session_duration_minutes FROM psicologos WHERE id = ?')
    .bind(psychologistId)
    .first<ConfigRow>();
  const duration = config?.session_duration_minutes ?? 45;

  const end_time = addMinutes(start_time, duration);
  const created: string[] = [];
  const skipped: string[] = [];

  const current = dateFromUTC(start_date);
  const endDate = dateFromUTC(end_date);

  while (current <= endDate) {
    const dayOfWeek = current.getUTCDay();
    const dateStr = formatUTC(current);

    if (days_of_week.includes(dayOfWeek)) {
      const overlap = await c.env.DB.prepare(
        `SELECT COUNT(*) as count FROM slots
         WHERE psicologo_id = ? AND fecha = ?
         AND NOT (hora_fin <= ? OR hora_inicio >= ?)`,
      )
        .bind(psychologistId, dateStr, start_time, end_time)
        .first<OverlapRow>();

      if (!overlap || overlap.count === 0) {
        try {
          await c.env.DB.prepare(
            'INSERT INTO slots (psicologo_id, fecha, hora_inicio, hora_fin) VALUES (?, ?, ?, ?)',
          )
            .bind(psychologistId, dateStr, start_time, end_time)
            .run();
          created.push(dateStr);
        } catch {
          skipped.push(dateStr);
        }
      } else {
        skipped.push(dateStr);
      }
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return c.json(
    { success: true, data: { created: created.length, skipped: skipped.length, dates: created } },
    201,
  );
});

// PATCH /api/slots/:id  — admin, block/unblock
slotsRouter.patch('/:id', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId');
  const id = Number(c.req.param('id'));

  let body: { available?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
  }

  const { available } = body;
  if (available !== 0 && available !== 1) {
    return c.json({ success: false, error: 'available debe ser 0 o 1' }, 400);
  }

  const slot = await c.env.DB.prepare(
    `SELECT s.id, s.disponible as available, b.id as booking_id
     FROM slots s
     LEFT JOIN reservas b ON b.slot_id = s.id
     WHERE s.id = ? AND s.psicologo_id = ? AND s.disponible >= 0`,
  )
    .bind(id, psychologistId)
    .first<SlotRow & { available: number }>();

  if (!slot) {
    return c.json({ success: false, error: 'Turno no encontrado' }, 404);
  }
  if (available === 0 && slot.booking_id !== null) {
    return c.json({ success: false, error: 'No se puede bloquear un turno con reserva activa' }, 409);
  }

  await c.env.DB.prepare('UPDATE slots SET disponible = ? WHERE id = ?').bind(available, id).run();

  return c.json({ success: true });
});

// DELETE /api/slots/:id  — admin
slotsRouter.delete('/:id', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId');
  const id = Number(c.req.param('id'));

  const slot = await c.env.DB.prepare(
    `SELECT s.id, b.id as booking_id
     FROM slots s
     LEFT JOIN reservas b ON b.slot_id = s.id
     WHERE s.id = ? AND s.psicologo_id = ?`,
  )
    .bind(id, psychologistId)
    .first<SlotRow>();

  if (!slot) {
    return c.json({ success: false, error: 'Turno no encontrado' }, 404);
  }
  if (slot.booking_id !== null) {
    return c.json({ success: false, error: 'No se puede eliminar un turno con reserva activa' }, 409);
  }

  await c.env.DB.prepare('UPDATE slots SET disponible = -1 WHERE id = ?').bind(id).run();

  return c.json({ success: true });
});
