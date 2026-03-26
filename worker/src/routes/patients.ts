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

// GET /api/patients/:email/history - Detailed history for a patient
patientsRouter.get('/:email/history', async (c) => {
  const psychologistId = c.get('psychologistId');
  const email = c.req.param('email');

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
