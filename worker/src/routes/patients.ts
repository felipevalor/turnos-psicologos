import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

export const patientsRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

patientsRouter.use('*', authMiddleware);

// GET /api/patients - List all patients for the psychologist
patientsRouter.get('/', async (c) => {
  const psychologistId = c.get('psychologistId');

  const query = `
    WITH all_patients AS (
      SELECT nombre, email, telefono, 'manual' AS source
      FROM patients WHERE psicologo_id = ?

      UNION ALL

      SELECT paciente_nombre, paciente_email, paciente_telefono, 'booking' AS source
      FROM reservas r
      JOIN slots s ON s.id = r.slot_id
      WHERE s.psicologo_id = ?

      UNION ALL

      SELECT patient_name, patient_email, patient_phone, 'booking' AS source
      FROM recurring_bookings WHERE psychologist_id = ?

      UNION ALL

      SELECT paciente_nombre, paciente_email, paciente_telefono, 'booking' AS source
      FROM cancellations WHERE psicologo_id = ?
    ),
    deduped AS (
      SELECT
        MAX(CASE WHEN source = 'manual' THEN nombre ELSE NULL END)
          OVER (PARTITION BY email) AS nombre_manual,
        MAX(CASE WHEN source = 'manual' THEN telefono ELSE NULL END)
          OVER (PARTITION BY email) AS telefono_manual,
        nombre,
        email,
        telefono,
        source,
        ROW_NUMBER() OVER (
          PARTITION BY email
          ORDER BY CASE source WHEN 'manual' THEN 0 ELSE 1 END
        ) AS rn
      FROM all_patients
    ),
    base AS (
      SELECT
        COALESCE(nombre_manual, nombre) AS nombre,
        email,
        COALESCE(telefono_manual, telefono) AS telefono,
        source
      FROM deduped
      WHERE rn = 1
    )
    SELECT
      b.email,
      b.nombre,
      b.telefono,
      b.source,
      (
        SELECT COUNT(*)
        FROM reservas r
        JOIN slots s ON s.id = r.slot_id
        WHERE r.paciente_email = b.email
          AND s.psicologo_id = ?
          AND (s.fecha < date('now', '-3 hours') OR (s.fecha = date('now', '-3 hours') AND s.hora_inicio < time('now', '-3 hours')))
      ) AS total_sesiones,
      (
        SELECT MAX(s.fecha)
        FROM reservas r
        JOIN slots s ON s.id = r.slot_id
        WHERE r.paciente_email = b.email
          AND s.psicologo_id = ?
          AND (s.fecha < date('now', '-3 hours') OR (s.fecha = date('now', '-3 hours') AND s.hora_inicio < time('now', '-3 hours')))
      ) AS ultima_sesion,
      (
        SELECT MIN(s.fecha)
        FROM reservas r
        JOIN slots s ON s.id = r.slot_id
        WHERE r.paciente_email = b.email
          AND s.psicologo_id = ?
          AND (s.fecha > date('now', '-3 hours') OR (s.fecha = date('now', '-3 hours') AND s.hora_inicio >= time('now', '-3 hours')))
      ) AS proxima_sesion
    FROM base b
    ORDER BY b.nombre ASC
  `;

  const result = await c.env.DB.prepare(query)
    .bind(
      psychologistId, // patients UNION source
      psychologistId, // reservas UNION source
      psychologistId, // recurring_bookings UNION source
      psychologistId, // cancellations UNION source
      psychologistId, // total_sesiones subquery
      psychologistId, // ultima_sesion subquery
      psychologistId, // proxima_sesion subquery
    )
    .all();

  return c.json({ success: true, data: result.results });
});

// POST /api/patients - Create a manual patient
patientsRouter.post('/', async (c) => {
  const psychologistId = c.get('psychologistId');
  const body = await c.req.json<{ nombre: string; email: string; telefono?: string }>();

  if (!body.nombre?.trim() || !body.email?.trim()) {
    return c.json({ error: 'nombre y email son requeridos' }, 400);
  }

  const email = body.email.toLowerCase().trim();

  const existing = await c.env.DB.prepare(
    'SELECT id FROM patients WHERE psicologo_id = ? AND email = ?'
  ).bind(psychologistId, email).first();

  if (existing) {
    return c.json({ error: 'Ya existe un paciente con ese email' }, 409);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO patients (psicologo_id, nombre, email, telefono) VALUES (?, ?, ?, ?)'
    ).bind(psychologistId, body.nombre.trim(), email, (body.telefono ?? '').trim()).run();
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Ya existe un paciente con ese email' }, 409);
    }
    throw e;
  }

  return c.json({ success: true }, 201);
});

// POST /api/patients/import - Preview import (no persist)
patientsRouter.post('/import', async (c) => {
  const psychologistId = c.get('psychologistId');
  const body = await c.req.json<{ rows: Array<{ nombre: string; email: string; telefono: string }> }>();

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return c.json({ error: 'El archivo no contiene filas válidas' }, 400);
  }
  if (body.rows.length > 500) {
    return c.json({ error: 'La importación no puede superar 500 pacientes a la vez' }, 400);
  }

  const existingResult = await c.env.DB.prepare(`
    SELECT email, nombre, telefono, 'manual' AS source FROM patients WHERE psicologo_id = ?
    UNION
    SELECT paciente_email, paciente_nombre, COALESCE(paciente_telefono,'') AS telefono, 'booking' AS source
    FROM reservas r JOIN slots s ON s.id = r.slot_id WHERE s.psicologo_id = ?
    UNION
    SELECT patient_email, patient_name, patient_phone, 'booking' AS source
    FROM recurring_bookings WHERE psychologist_id = ?
  `).bind(psychologistId, psychologistId, psychologistId).all<{
    email: string; nombre: string; telefono: string; source: string;
  }>();

  const existingMap = new Map(existingResult.results.map(r => [r.email.toLowerCase(), r]));

  const clean: Array<{ nombre: string; email: string; telefono: string }> = [];
  const conflicts: Array<{
    incoming: { nombre: string; email: string; telefono: string };
    existing: { nombre: string; email: string; telefono: string };
    existingSource: string;
  }> = [];

  for (const row of body.rows) {
    const emailKey = row.email.toLowerCase().trim();
    const existing = existingMap.get(emailKey);
    if (existing) {
      conflicts.push({
        incoming: { nombre: row.nombre, email: emailKey, telefono: row.telefono ?? '' },
        existing: { nombre: existing.nombre, email: existing.email, telefono: existing.telefono },
        existingSource: existing.source,
      });
    } else {
      clean.push({ nombre: row.nombre, email: emailKey, telefono: row.telefono ?? '' });
    }
  }

  return c.json({ success: true, data: { clean, conflicts } });
});

// POST /api/patients/import/confirm - Persist resolved rows
patientsRouter.post('/import/confirm', async (c) => {
  const psychologistId = c.get('psychologistId');
  const body = await c.req.json<{
    rows: Array<{ nombre: string; email: string; telefono: string }>;
  }>();

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return c.json({ error: 'No hay filas para importar' }, 400);
  }
  if (body.rows.length > 500) {
    return c.json({ error: 'La importación no puede superar 500 pacientes a la vez' }, 400);
  }

  const stmts = body.rows.map(row =>
    c.env.DB.prepare(`
      INSERT INTO patients (psicologo_id, nombre, email, telefono)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(psicologo_id, email)
      DO UPDATE SET nombre = excluded.nombre, telefono = excluded.telefono
    `).bind(psychologistId, row.nombre.trim(), row.email.toLowerCase().trim(), (row.telefono ?? '').trim())
  );

  await c.env.DB.batch(stmts);

  return c.json({ success: true, data: { imported: body.rows.length } });
});

// GET /api/patients/export - Export all patients with session history as JSON
patientsRouter.get('/export', async (c) => {
  const psychologistId = c.get('psychologistId');

  const patientsResult = await c.env.DB.prepare(`
    WITH all_p AS (
      SELECT nombre, email, telefono, 'manual' AS source FROM patients WHERE psicologo_id = ?
      UNION ALL
      SELECT paciente_nombre, paciente_email, COALESCE(paciente_telefono,''), 'booking'
      FROM reservas r JOIN slots s ON s.id = r.slot_id WHERE s.psicologo_id = ?
      UNION ALL
      SELECT patient_name, patient_email, patient_phone, 'booking'
      FROM recurring_bookings WHERE psychologist_id = ?
      UNION ALL
      SELECT paciente_nombre, paciente_email, COALESCE(paciente_telefono,''), 'booking'
      FROM cancellations WHERE psicologo_id = ?
    ),
    deduped AS (
      SELECT
        MAX(CASE WHEN source='manual' THEN nombre END) OVER (PARTITION BY email) AS nombre_manual,
        MAX(CASE WHEN source='manual' THEN telefono END) OVER (PARTITION BY email) AS telefono_manual,
        nombre, email, telefono,
        ROW_NUMBER() OVER (PARTITION BY email ORDER BY CASE source WHEN 'manual' THEN 0 ELSE 1 END) AS rn
      FROM all_p
    )
    SELECT
      COALESCE(nombre_manual, nombre) AS nombre,
      email,
      COALESCE(telefono_manual, telefono) AS telefono
    FROM deduped WHERE rn = 1
    ORDER BY nombre ASC
  `).bind(psychologistId, psychologistId, psychologistId, psychologistId)
    .all<{ nombre: string; email: string; telefono: string }>();

  const sessionsResult = await c.env.DB.prepare(`
    SELECT
      r.paciente_email AS email,
      s.fecha AS sesion_fecha,
      s.hora_inicio AS sesion_hora_inicio,
      CASE
        WHEN s.fecha < date('now', '-3 hours')
          OR (s.fecha = date('now', '-3 hours') AND s.hora_inicio < time('now', '-3 hours'))
        THEN 'realizada'
        ELSE 'proxima'
      END AS sesion_estado
    FROM reservas r
    JOIN slots s ON s.id = r.slot_id
    WHERE s.psicologo_id = ?

    UNION ALL

    SELECT
      paciente_email AS email,
      slot_fecha AS sesion_fecha,
      slot_hora_inicio AS sesion_hora_inicio,
      'cancelada' AS sesion_estado
    FROM cancellations
    WHERE psicologo_id = ?
    ORDER BY email, sesion_fecha
  `).bind(psychologistId, psychologistId)
    .all<{ email: string; sesion_fecha: string; sesion_hora_inicio: string; sesion_estado: string }>();

  const sessionsByEmail = new Map<string, typeof sessionsResult.results>();
  for (const s of sessionsResult.results) {
    const key = s.email.toLowerCase();
    if (!sessionsByEmail.has(key)) sessionsByEmail.set(key, []);
    sessionsByEmail.get(key)!.push(s);
  }

  const rows: Array<{
    nombre: string; email: string; telefono: string;
    total_sesiones: number; ultima_sesion: string; proxima_sesion: string;
    sesion_fecha: string; sesion_hora_inicio: string;
    sesion_estado: 'realizada' | 'proxima' | 'cancelada' | null;
  }> = [];

  for (const patient of patientsResult.results) {
    const sessions = sessionsByEmail.get(patient.email.toLowerCase()) ?? [];
    const past = sessions.filter(s => s.sesion_estado === 'realizada');
    const totalSesiones = past.length;
    const ultimaSesion = past.length
      ? past.reduce((a, b) => a.sesion_fecha > b.sesion_fecha ? a : b).sesion_fecha
      : '';
    const proximas = sessions.filter(s => s.sesion_estado === 'proxima');
    const proximaSesion = proximas.length
      ? proximas.reduce((a, b) => a.sesion_fecha < b.sesion_fecha ? a : b).sesion_fecha
      : '';

    if (sessions.length === 0) {
      rows.push({
        nombre: patient.nombre, email: patient.email, telefono: patient.telefono,
        total_sesiones: 0, ultima_sesion: '', proxima_sesion: '',
        sesion_fecha: '', sesion_hora_inicio: '', sesion_estado: null,
      });
    } else {
      for (const s of sessions) {
        rows.push({
          nombre: patient.nombre, email: patient.email, telefono: patient.telefono,
          total_sesiones: totalSesiones, ultima_sesion: ultimaSesion, proxima_sesion: proximaSesion,
          sesion_fecha: s.sesion_fecha, sesion_hora_inicio: s.sesion_hora_inicio,
          sesion_estado: s.sesion_estado as 'realizada' | 'proxima' | 'cancelada',
        });
      }
    }
  }

  return c.json({ success: true, data: rows });
});

// PUT /api/patients/:email - Edit a manual patient's name or phone
patientsRouter.put('/:email', async (c) => {
  const psychologistId = c.get('psychologistId');
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();
  const body = await c.req.json<{ nombre?: string; telefono?: string }>();

  if (!body.nombre?.trim() && body.telefono === undefined) {
    return c.json({ error: 'Debe enviar al menos un campo para actualizar' }, 400);
  }

  const nombre = body.nombre?.trim();
  const telefono = (body.telefono ?? '').trim();

  if (!nombre) {
    return c.json({ error: 'Debe enviar al menos un campo para actualizar' }, 400);
  }

  await c.env.DB.prepare(`
    INSERT INTO patients (psicologo_id, nombre, email, telefono)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(psicologo_id, email)
    DO UPDATE SET nombre = excluded.nombre, telefono = excluded.telefono
  `).bind(psychologistId, nombre, email, telefono).run();

  return c.json({ success: true });
});

// DELETE /api/patients/:email - Delete a manual patient (only if no session history)
patientsRouter.delete('/:email', async (c) => {
  const psychologistId = c.get('psychologistId');
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();

  const patient = await c.env.DB.prepare(
    'SELECT id FROM patients WHERE psicologo_id = ? AND email = ?'
  ).bind(psychologistId, email).first();

  if (!patient) {
    return c.json({ error: 'Paciente no encontrado en el directorio manual' }, 404);
  }

  const [inReservas, inRecurring] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM reservas r
       JOIN slots s ON s.id = r.slot_id
       WHERE s.psicologo_id = ? AND r.paciente_email = ?`
    ).bind(psychologistId, email).first<{ n: number }>(),

    c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM recurring_bookings WHERE psychologist_id = ? AND patient_email = ?'
    ).bind(psychologistId, email).first<{ n: number }>(),
  ]);

  const total = (inReservas?.n ?? 0) + (inRecurring?.n ?? 0);
  if (total > 0) {
    return c.json({ error: 'No se puede eliminar un paciente con historial de sesiones' }, 409);
  }

  await c.env.DB.prepare(
    'DELETE FROM patients WHERE psicologo_id = ? AND email = ?'
  ).bind(psychologistId, email).run();

  return c.json({ success: true });
});

// GET /api/patients/:email/history - Detailed history for a patient
patientsRouter.get('/:email/history', async (c) => {
  const psychologistId = c.get('psychologistId');
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();

  const [reservas, cancellations, notes] = await Promise.all([
    // past and future bookings
    c.env.DB.prepare(`
      SELECT r.id as reserva_id, s.id as slot_id, s.fecha, s.hora_inicio, s.hora_fin, 'booked' as status
      FROM reservas r
      JOIN slots s ON s.id = r.slot_id
      WHERE r.paciente_email = ? AND s.psicologo_id = ?
      ORDER BY s.fecha DESC, s.hora_inicio DESC
    `).bind(email, psychologistId).all(),

    // cancellations
    c.env.DB.prepare(`
      SELECT id, slot_fecha as fecha, slot_hora_inicio as hora_inicio, reason, cancelled_at, 'cancelled' as status
      FROM cancellations
      WHERE paciente_email = ? AND psicologo_id = ?
      ORDER BY slot_fecha DESC, slot_hora_inicio DESC
    `).bind(email, psychologistId).all(),

    // notes
    c.env.DB.prepare(`
      SELECT n.id, n.contenido, n.slot_id, n.created_at, n.updated_at,
             s.fecha as slot_fecha, s.hora_inicio as slot_hora
      FROM paciente_notas n
      LEFT JOIN slots s ON s.id = n.slot_id
      WHERE n.paciente_email = ? AND n.psicologo_id = ?
      ORDER BY n.created_at DESC
    `).bind(email, psychologistId).all()
  ]);

  return c.json({
    success: true,
    data: {
      bookings: reservas.results,
      cancellations: cancellations.results,
      notes: notes.results
    }
  });
});
