import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

export const notesRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

notesRouter.use('*', authMiddleware);

// GET /api/notes/:email - List notes for a patient
notesRouter.get('/:email', async (c) => {
  const psychologistId = c.get('psychologistId');
  const email = c.req.param('email');

  const result = await c.env.DB.prepare(
    `SELECT n.id, n.contenido, n.slot_id, n.created_at, n.updated_at,
            s.fecha as slot_fecha, s.hora_inicio as slot_hora
     FROM paciente_notas n
     LEFT JOIN slots s ON s.id = n.slot_id
     WHERE n.psicologo_id = ? AND n.paciente_email = ?
     ORDER BY n.created_at DESC`
  )
    .bind(psychologistId, email)
    .all();

  return c.json({ success: true, data: result.results });
});

// POST /api/notes - Create a new note
notesRouter.post('/', async (c) => {
  const psychologistId = c.get('psychologistId');
  const { patient_email, contenido, slot_id } = await c.req.json();

  if (!patient_email || !contenido) {
    return c.json({ success: false, error: 'Email y contenido são requeridos' }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO paciente_notas (psicologo_id, paciente_email, contenido, slot_id)
     VALUES (?, ?, ?, ?) RETURNING id, created_at, updated_at`
  )
    .bind(psychologistId, patient_email, contenido, slot_id || null)
    .first();

  return c.json({ success: true, data: { ...result, contenido, patient_email, slot_id } });
});

// PUT /api/notes/:id - Update a note
notesRouter.put('/:id', async (c) => {
  const psychologistId = c.get('psychologistId');
  const id = c.req.param('id');
  const { contenido } = await c.req.json();

  if (!contenido) {
    return c.json({ success: false, error: 'Contenido es requerido' }, 400);
  }

  const result = await c.env.DB.prepare(
    `UPDATE paciente_notas
     SET contenido = ?, updated_at = datetime('now')
     WHERE id = ? AND psicologo_id = ?`
  )
    .bind(contenido, id, psychologistId)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ success: false, error: 'Nota no encontrada' }, 404);
  }

  return c.json({ success: true });
});

// DELETE /api/notes/:id - Delete a note
notesRouter.delete('/:id', async (c) => {
  const psychologistId = c.get('psychologistId');
  const id = c.req.param('id');

  const result = await c.env.DB.prepare(
    `DELETE FROM paciente_notas
     WHERE id = ? AND psicologo_id = ?`
  )
    .bind(id, psychologistId)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ success: false, error: 'Nota no encontrada' }, 404);
  }

  return c.json({ success: true });
});
