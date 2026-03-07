import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

type OverlapRow = { count: number };
type RecurringRow = {
  id: number;
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  frequency_weeks: number;
  start_date: string;
  time: string;
  active: number;
  created_at: string;
  psychologist_id: number;
  next_appointment: string | null;
};
type MaxDateRow = { max_date: string | null };
type SlotIdRow = { id: number };
type ConfigRow = { session_duration_minutes: number };

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().split('T')[0];
}

function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(new Date(dateStr).getTime());
}

function isValidTime(timeStr: string): boolean {
  return /^\d{2}:\d{2}$/.test(timeStr);
}

async function generateSlots(
  db: D1Database,
  params: {
    recurringId: number;
    psychologistId: number;
    fromDate: string;
    toDate: string;
    time: string;
    frequencyWeeks: number;
    patientName: string;
    patientEmail: string;
    patientPhone: string;
    sessionDuration: number;
  },
): Promise<{ created: number; skipped: number }> {
  const {
    recurringId,
    psychologistId,
    fromDate,
    toDate,
    time,
    frequencyWeeks,
    patientName,
    patientEmail,
    patientPhone,
    sessionDuration,
  } = params;

  const end_time = addMinutes(time, sessionDuration);
  let created = 0;
  let skipped = 0;
  let current = fromDate;

  console.error(`[generateSlots] recurringId=${recurringId} range=${fromDate}→${toDate} time=${time} end=${end_time} freq=${frequencyWeeks}w psychologist=${psychologistId}`);

  while (current <= toDate) {
    const overlap = await db
      .prepare(
        `SELECT COUNT(*) as count FROM slots
         WHERE psicologo_id = ? AND fecha = ?
         AND NOT (hora_fin <= ? OR hora_inicio >= ?)`,
      )
      .bind(psychologistId, current, time, end_time)
      .first<OverlapRow>();

    if (!overlap || overlap.count === 0) {
      try {
        const slotResult = await db
          .prepare(
            `INSERT INTO slots (psicologo_id, fecha, hora_inicio, hora_fin, disponible)
             VALUES (?, ?, ?, ?, 0)`,
          )
          .bind(psychologistId, current, time, end_time)
          .run();

        const slotId = slotResult.meta.last_row_id;
        console.error(`[generateSlots] ${current}: slot created id=${slotId}`);

        await db
          .prepare(
            `INSERT INTO reservas (slot_id, paciente_nombre, paciente_email, paciente_telefono)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(slotId, patientName, patientEmail, patientPhone)
          .run();

        created++;
      } catch (err) {
        console.error(`[generateSlots] ${current}: INSERT failed —`, err);
        skipped++;
      }
    } else {
      console.error(`[generateSlots] ${current}: skipped — overlap.count=${overlap?.count}`);
      skipped++;
    }

    current = addDays(current, frequencyWeeks * 7);
  }

  console.error(`[generateSlots] done: created=${created} skipped=${skipped}`);
  return { created, skipped };
}

export const recurringRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// POST /api/recurring — create recurring booking (admin)
recurringRouter.post('/', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId');

  let body: {
    patient_name?: string;
    patient_email?: string;
    patient_phone?: string;
    start_date?: string;
    time?: string;
    frequency_weeks?: number;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
  }

  const { patient_name, patient_email, patient_phone, start_date, time, frequency_weeks } = body;

  if (!patient_name || !patient_email || !patient_phone || !start_date || !time || !frequency_weeks) {
    return c.json(
      {
        success: false,
        error:
          'Campos requeridos: patient_name, patient_email, patient_phone, start_date, time, frequency_weeks',
      },
      400,
    );
  }
  if (!isValidDate(start_date)) {
    return c.json({ success: false, error: 'Formato de fecha inválido (YYYY-MM-DD)' }, 400);
  }
  if (!isValidTime(time)) {
    return c.json({ success: false, error: 'Formato de hora inválido (HH:MM)' }, 400);
  }
  if (![1, 2, 3, 4].includes(frequency_weeks)) {
    return c.json({ success: false, error: 'frequency_weeks debe ser 1, 2, 3 o 4' }, 400);
  }

  const recurringResult = await c.env.DB.prepare(
    `INSERT INTO recurring_bookings
       (psychologist_id, patient_name, patient_email, patient_phone, frequency_weeks, start_date, time)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(psychologistId, patient_name, patient_email, patient_phone, frequency_weeks, start_date, time)
    .run();

  const recurringId = recurringResult.meta.last_row_id;
  const toDate = addMonths(todayStr(), 3);

  const config = await c.env.DB.prepare('SELECT session_duration_minutes FROM psicologos WHERE id = ?')
    .bind(psychologistId)
    .first<ConfigRow>();
  const sessionDuration = config?.session_duration_minutes ?? 45;

  const { created, skipped } = await generateSlots(c.env.DB, {
    recurringId,
    psychologistId,
    fromDate: start_date,
    toDate,
    time,
    frequencyWeeks: frequency_weeks,
    patientName: patient_name,
    patientEmail: patient_email,
    patientPhone: patient_phone,
    sessionDuration,
  });

  const record = await c.env.DB.prepare('SELECT * FROM recurring_bookings WHERE id = ?')
    .bind(recurringId)
    .first();

  return c.json({ success: true, data: { recurring_booking: record, slots_created: created, slots_skipped: skipped } }, 201);
});

// GET /api/recurring — list active recurring bookings (admin)
recurringRouter.get('/', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId');

  try {
    const result = await c.env.DB.prepare(
      `SELECT rb.id, rb.patient_name, rb.patient_email, rb.patient_phone,
              rb.frequency_weeks, rb.start_date, rb."time", rb.active, rb.created_at,
              (
                SELECT MIN(s.fecha)
                FROM slots s
                JOIN reservas r ON r.slot_id = s.id
                WHERE r.paciente_email = rb.patient_email
                  AND r.paciente_telefono = rb.patient_phone
                  AND s.hora_inicio = rb."time"
                  AND s.fecha >= date('now')
              ) as next_appointment
       FROM recurring_bookings rb
       WHERE rb.psychologist_id = ? AND rb.active = 1
       ORDER BY rb.start_date`,
    )
      .bind(psychologistId)
      .all<RecurringRow>();

    return c.json({ success: true, data: result.results });
  } catch (error) {
    console.error('[GET /recurring] D1 query failed:', error);
    return c.json({ success: false, error: 'Error al obtener recurrencias' }, 500);
  }
});

// DELETE /api/recurring/:id — cancel entire recurrence (admin or patient)
recurringRouter.delete('/:id', async (c) => {
  const authHeader = c.req.header('Authorization');
  const isPsychologist = authHeader?.startsWith('Bearer ') ?? false;

  const id = Number(c.req.param('id'));
  let email: string | undefined;
  let phone: string | undefined;

  if (!isPsychologist) {
    let body: { email?: string; phone?: string };
    try {
      body = await c.req.json();
      email = body.email;
      phone = body.phone;
    } catch {
      return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
    }
    if (!email && !phone) {
      return c.json({ success: false, error: 'Ingresá tu email o teléfono para cancelar' }, 400);
    }
  }

  try {
    const recurring = await c.env.DB.prepare(
      `SELECT id, psychologist_id, patient_email, patient_phone, "time"
       FROM recurring_bookings WHERE id = ? AND active = 1`,
    )
      .bind(id)
      .first<{ id: number; psychologist_id: number; patient_email: string; patient_phone: string; time: string }>();

    if (!recurring) {
      return c.json({ success: false, error: 'Recurrencia no encontrada' }, 404);
    }

    if (!isPsychologist) {
      const emailMatch = email && recurring.patient_email === email;
      const phoneMatch = phone && recurring.patient_phone === phone;
      if (!emailMatch && !phoneMatch) {
        return c.json({ success: false, error: 'Datos de verificación incorrectos' }, 403);
      }
    }

    const today = todayStr();

    // Find future slots for this recurrence via reservas (slots has no recurring_booking_id column)
    const futureSlots = await c.env.DB.prepare(
      `SELECT s.id FROM slots s
       JOIN reservas r ON r.slot_id = s.id
       WHERE r.paciente_email = ?
         AND r.paciente_telefono = ?
         AND s.hora_inicio = ?
         AND s.fecha > ?
         AND s.psicologo_id = ?`,
    )
      .bind(recurring.patient_email, recurring.patient_phone, recurring.time, today, recurring.psychologist_id)
      .all<SlotIdRow>();

    const slotIds = futureSlots.results.map((s) => s.id);

    if (slotIds.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < slotIds.length; i += batchSize) {
        const chunk = slotIds.slice(i, i + batchSize);
        const placeholders = chunk.map(() => '?').join(', ');
        await c.env.DB.prepare(`DELETE FROM reservas WHERE slot_id IN (${placeholders})`)
          .bind(...chunk)
          .run();
        await c.env.DB.prepare(`DELETE FROM slots WHERE id IN (${placeholders})`)
          .bind(...chunk)
          .run();
      }
    }

    await c.env.DB.prepare('UPDATE recurring_bookings SET active = 0 WHERE id = ?').bind(id).run();

    return c.json({ success: true, data: { slots_deleted: slotIds.length } });
  } catch (error) {
    console.error('[DELETE /recurring/:id] D1 query failed:', error);
    return c.json({ success: false, error: 'Error al cancelar la recurrencia' }, 500);
  }
});

// PATCH /api/recurring/:id/reschedule-from — reschedule this and all future recurring instances
recurringRouter.patch('/:id/reschedule-from', async (c) => {
  const id = Number(c.req.param('id'));
  let body: { email?: string; phone?: string; from_date?: string; new_time?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
  }

  const { email, phone, from_date, new_time } = body;
  if ((!email && !phone) || !from_date || !new_time) {
    return c.json({ success: false, error: 'Ingresá tu email o teléfono, fecha de inicio y nueva hora son requeridos' }, 400);
  }

  // 1. Fetch recurrence and verify patient identity (email OR phone)
  const recurring = await c.env.DB.prepare(
    `SELECT * FROM recurring_bookings WHERE id = ? AND active = 1`
  )
    .bind(id)
    .first<RecurringRow>();

  if (!recurring) {
    return c.json({ success: false, error: 'Recurrencia no encontrada' }, 404);
  }

  const emailMatch = email && recurring.patient_email === email;
  const phoneMatch = phone && recurring.patient_phone === phone;
  if (!emailMatch && !phoneMatch) {
    return c.json({ success: false, error: 'Datos de verificación incorrectos' }, 403);
  }

  // 2. Get session duration to calculate new end_time
  const config = await c.env.DB.prepare('SELECT session_duration_minutes FROM psicologos WHERE id = ?')
    .bind(recurring.psychologist_id)
    .first<ConfigRow>();
  const sessionDuration = config?.session_duration_minutes ?? 45;
  const newEndTime = addMinutes(new_time, sessionDuration);

  // 3. Find all future slots in the series via reservas (slots has no recurring_booking_id column)
  const futureSlots = await c.env.DB.prepare(
    `SELECT s.id, s.fecha as date FROM slots s
     JOIN reservas r ON r.slot_id = s.id
     WHERE r.paciente_email = ?
       AND r.paciente_telefono = ?
       AND s.hora_inicio = ?
       AND s.fecha >= ?
       AND s.psicologo_id = ?
     ORDER BY s.fecha`,
  )
    .bind(recurring.patient_email, recurring.patient_phone, recurring.time, from_date, recurring.psychologist_id)
    .all<{ id: number; date: string }>();

  if (futureSlots.results.length === 0) {
    return c.json({ success: false, error: 'No se encontraron turnos futuros para reprogramar' }, 404);
  }

  let rescheduledCount = 0;
  const finalBatch = [];

  for (const slot of futureSlots.results) {
    const conflict = await c.env.DB.prepare(
      `SELECT id FROM slots
       WHERE psicologo_id = ? AND fecha = ? AND id != ?
       AND NOT (hora_fin <= ? OR hora_inicio >= ?)`,
    )
      .bind(recurring.psychologist_id, slot.date, slot.id, new_time, newEndTime)
      .first();

    if (conflict) continue;

    finalBatch.push(
      c.env.DB.prepare('UPDATE slots SET hora_inicio = ?, hora_fin = ? WHERE id = ?').bind(new_time, newEndTime, slot.id),
    );
    rescheduledCount++;
  }

  finalBatch.push(
    c.env.DB.prepare('UPDATE recurring_bookings SET "time" = ? WHERE id = ?').bind(new_time, id),
  );

  if (finalBatch.length > 0) {
    await c.env.DB.batch(finalBatch);
  }

  return c.json({ success: true, data: { rescheduled_count: rescheduledCount } });
});

// POST /api/recurring/extend — generate missing future slots for all active recurrences (admin)
recurringRouter.post('/extend', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId');
  const horizon = addMonths(todayStr(), 3);

  const recurrences = await c.env.DB.prepare(
    `SELECT rb.id, rb.patient_name, rb.patient_email, rb.patient_phone,
            rb.frequency_weeks, rb.start_date, rb."time",
            (
              SELECT MAX(s.fecha)
              FROM slots s
              JOIN reservas r ON r.slot_id = s.id
              WHERE r.paciente_email = rb.patient_email
                AND r.paciente_telefono = rb.patient_phone
                AND s.hora_inicio = rb."time"
                AND s.psicologo_id = rb.psychologist_id
            ) as last_generated
     FROM recurring_bookings rb
     WHERE rb.psychologist_id = ? AND rb.active = 1`,
  )
    .bind(psychologistId)
    .all<RecurringRow & { last_generated: string | null }>();

  const config = await c.env.DB.prepare('SELECT session_duration_minutes FROM psicologos WHERE id = ?')
    .bind(psychologistId)
    .first<ConfigRow>();
  const sessionDuration = config?.session_duration_minutes ?? 45;

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const rec of recurrences.results) {
    const lastDate = rec.last_generated ?? rec.start_date;
    const fromDate = addDays(lastDate, rec.frequency_weeks * 7);

    if (fromDate > horizon) continue;

    const { created, skipped } = await generateSlots(c.env.DB, {
      recurringId: rec.id,
      psychologistId,
      fromDate,
      toDate: horizon,
      time: rec.time,
      frequencyWeeks: rec.frequency_weeks,
      patientName: rec.patient_name,
      patientEmail: rec.patient_email,
      patientPhone: rec.patient_phone,
      sessionDuration,
    });

    totalCreated += created;
    totalSkipped += skipped;
  }

  return c.json({ success: true, data: { slots_created: totalCreated, slots_skipped: totalSkipped } });
});
