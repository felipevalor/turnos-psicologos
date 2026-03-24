import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

export const patientsRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

patientsRouter.use('*', authMiddleware);

// GET /api/patients - List all patients for the psychologist
patientsRouter.get('/', async (c) => {
  const psychologistId = c.get('psychologistId');

  // Query to aggregate patients from all relevant tables
  const query = `
    SELECT 
      p.email, 
      p.nombre, 
      p.telefono,
      (
        SELECT COUNT(*) 
        FROM reservas r 
        JOIN slots s ON s.id = r.slot_id 
        WHERE r.paciente_email = p.email 
          AND s.psicologo_id = ?
          AND (s.fecha < date('now', '-3 hours') OR (s.fecha = date('now', '-3 hours') AND s.hora_inicio < time('now', '-3 hours')))
      ) as total_sesiones,
      (
        SELECT MAX(s.fecha) 
        FROM reservas r 
        JOIN slots s ON s.id = r.slot_id 
        WHERE r.paciente_email = p.email 
          AND s.psicologo_id = ?
          AND (s.fecha < date('now', '-3 hours') OR (s.fecha = date('now', '-3 hours') AND s.hora_inicio < time('now', '-3 hours')))
      ) as ultima_sesion,
      (
        SELECT MIN(s.fecha) 
        FROM reservas r 
        JOIN slots s ON s.id = r.slot_id 
        WHERE r.paciente_email = p.email 
          AND s.psicologo_id = ?
          AND (s.fecha > date('now', '-3 hours') OR (s.fecha = date('now', '-3 hours') AND s.hora_inicio >= time('now', '-3 hours')))
      ) as proxima_sesion
    FROM (
      SELECT r.paciente_email as email, r.paciente_nombre as nombre, r.paciente_telefono as telefono 
      FROM reservas r
      JOIN slots s ON s.id = r.slot_id
      WHERE s.psicologo_id = ?
      
      UNION
      
      SELECT patient_email, patient_name, patient_phone 
      FROM recurring_bookings
      WHERE psychologist_id = ?
      
      UNION
      
      SELECT paciente_email, paciente_nombre, paciente_telefono 
      FROM cancellations
      WHERE psicologo_id = ?
    ) p
    GROUP BY p.email
    ORDER BY p.nombre ASC
  `;

  const result = await c.env.DB.prepare(query)
    .bind(psychologistId, psychologistId, psychologistId, psychologistId, psychologistId, psychologistId)
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
