import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { verifyJWT } from '../lib/jwt';
import type { Env, AppVariables } from '../types';

type SlotBookingRow = {
  id: number;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  disponible: number;
  booking_id: number | null;
  psicologo_id: number;
};

type BookingRow = {
  id: number;
  paciente_email: string;
  paciente_telefono: string;
  slot_id: number;
  fecha: string;
  hora_inicio: string;
  psicologo_id: number;
};

type PolicyRow = {
  cancel_min_hours: number;
  reschedule_min_hours: number;
  booking_min_hours: number;
  whatsapp_number: string | null;
  nombre: string;
  policy_unit: 'minutes' | 'hours' | 'days';
};

function toHours(value: number, unit: 'minutes' | 'hours' | 'days'): number {
  if (unit === 'minutes') return value / 60;
  if (unit === 'days') return value * 24;
  return value;
}

function hoursUntilSlot(fecha: string, horaInicio: string): number {
  const slotMs = new Date(`${fecha}T${horaInicio}:00-03:00`).getTime();
  return (slotMs - Date.now()) / (1000 * 60 * 60);
}

const PHONE_RE = /^\+549\d{8,10}$/;

export const bookingsRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// GET /api/bookings  — admin
bookingsRouter.get('/', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId');

  const result = await c.env.DB.prepare(
    `SELECT b.id, b.paciente_nombre as patient_name, b.paciente_email as patient_email, b.paciente_telefono as patient_phone, b.created_at,
            s.id as slot_id, s.fecha as date, s.hora_inicio as start_time, s.hora_fin as end_time
     FROM reservas b
     JOIN slots s ON b.slot_id = s.id
     WHERE s.psicologo_id = ?
     ORDER BY s.fecha, s.hora_inicio`,
  )
    .bind(psychologistId)
    .all();

  return c.json({ success: true, data: result.results });
});

// POST /api/bookings  — public
bookingsRouter.post('/', async (c) => {
  let body: {
    slot_id?: number;
    patient_name?: string;
    patient_email?: string;
    patient_phone?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
  }

  const { slot_id, patient_name, patient_email, patient_phone } = body;

  if (!slot_id || !patient_name || !patient_email || !patient_phone) {
    return c.json({ success: false, error: 'Todos los campos son requeridos' }, 400);
  }
  if (!PHONE_RE.test(patient_phone)) {
    return c.json(
      { success: false, error: 'Formato de teléfono inválido. Use +5491112345678' },
      400,
    );
  }

  // Fetch slot with booking status
  const slot = await c.env.DB.prepare(
    `SELECT s.id, s.fecha, s.hora_inicio, s.hora_fin, s.disponible, s.psicologo_id, b.id as booking_id
     FROM slots s
     LEFT JOIN reservas b ON b.slot_id = s.id
     WHERE s.id = ?`,
  )
    .bind(slot_id)
    .first<SlotBookingRow>();

  if (!slot) {
    return c.json({ success: false, error: 'Turno no encontrado' }, 404);
  }
  if (!slot.disponible || slot.booking_id !== null) {
    return c.json({ success: false, error: 'El turno no está disponible' }, 409);
  }

  let isPsychologist = false;
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (payload) {
      isPsychologist = true;
    }
  }

  // Check patient doesn't have an overlapping booking on the same date (unless admin)
  if (!isPsychologist) {
    const overlap = await c.env.DB.prepare(
      `SELECT b.id FROM reservas b
       JOIN slots s ON b.slot_id = s.id
       WHERE b.paciente_email = ? AND s.fecha = ?
       AND NOT (s.hora_fin <= ? OR s.hora_inicio >= ?)`
    )
      .bind(patient_email, slot.fecha, slot.hora_inicio, slot.hora_fin)
      .first();

    if (overlap) {
      return c.json({ success: false, error: 'Ya tenés una reserva en ese horario' }, 409);
    }
  }

  // Atomically set disponible=0 and insert booking using D1 batch
  const results = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE slots SET disponible = 0 WHERE id = ? AND disponible = 1').bind(slot_id),
    c.env.DB.prepare(
      'INSERT INTO reservas (slot_id, paciente_nombre, paciente_email, paciente_telefono) VALUES (?, ?, ?, ?)',
    ).bind(slot_id, patient_name, patient_email, patient_phone),
  ]);

  // If UPDATE affected 0 rows, someone else booked first (race condition)
  if (results[0].meta.changes === 0) {
    return c.json({ success: false, error: 'El turno ya no está disponible' }, 409);
  }

  const bookingId = results[1].meta.last_row_id;

  const bookingData = {
    id: bookingId,
    slot: { date: slot.fecha, start_time: slot.hora_inicio, end_time: slot.hora_fin },
    patient: { name: patient_name, email: patient_email, phone: patient_phone },
  };

  if (!isPsychologist) {
    const policy = await c.env.DB.prepare(
      'SELECT booking_min_hours, whatsapp_number, nombre, policy_unit FROM psicologos WHERE id = ?',
    ).bind(slot.psicologo_id).first<Pick<PolicyRow, 'booking_min_hours' | 'whatsapp_number' | 'nombre' | 'policy_unit'>>();

    const booking_min_hours = policy?.booking_min_hours ?? 24;
    const unit = policy?.policy_unit ?? 'hours';
    const thresholdHours = toHours(booking_min_hours, unit);
    const slotDatetime = new Date(`${slot.fecha}T${slot.hora_inicio}:00-03:00`);
    const diffHours = (slotDatetime.getTime() - Date.now()) / (1000 * 60 * 60);
    console.log('[policy]', { slotDatetime, now: new Date(), diffHours, policy: booking_min_hours, unit, thresholdHours });
    if (thresholdHours > 0 && diffHours < thresholdHours) {
      return c.json({ success: true, data: bookingData, warning: 'outside_policy', policy_hours: booking_min_hours, psychologist_name: policy?.nombre ?? '' }, 201);
    }
  }

  return c.json({ success: true, data: bookingData }, 201);
});

// POST /api/bookings/search  — public (find patient's own bookings)
bookingsRouter.post('/search', async (c) => {
  let body: { email?: string; phone?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
  }

  const { email, phone } = body;
  console.log('[search] body:', JSON.stringify(body));
  if (!email && !phone) {
    return c.json({ success: false, error: 'Ingresá tu email o teléfono' }, 400);
  }

  try {
    const conditions: string[] = [];
    const params: string[] = [];
    if (email) { conditions.push('b.paciente_email = ?'); params.push(email); }
    if (phone) { conditions.push('b.paciente_telefono = ?'); params.push(phone); }

    const result = await c.env.DB.prepare(
      `SELECT b.id, b.paciente_nombre as patient_name, b.paciente_email as patient_email, b.paciente_telefono as patient_phone, b.created_at,
              s.id as slot_id, s.fecha as "date", s.hora_inicio as start_time, s.hora_fin as end_time,
              rb.id as recurring_booking_id
       FROM reservas b
       JOIN slots s ON b.slot_id = s.id
       LEFT JOIN recurring_bookings rb
         ON rb.patient_email = b.paciente_email
         AND rb.patient_phone = b.paciente_telefono
         AND rb."time" = s.hora_inicio
         AND rb.psychologist_id = s.psicologo_id
         AND rb.active = 1
       WHERE (${conditions.join(' OR ')})
       AND s.fecha >= date('now')
       ORDER BY s.fecha, s.hora_inicio`,
    )
      .bind(...params)
      .all();

    return c.json({ success: true, data: result.results });
  } catch (error) {
    console.error('[/bookings/search] D1 query failed:', error);
    return c.json({ success: false, error: 'Error al buscar sesiones' }, 500);
  }
});

// PATCH /api/bookings/:id — reschedule one-off or single recurring instance
bookingsRouter.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  let body: { email?: string; phone?: string; new_slot_id?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
  }

  const { email, phone, new_slot_id } = body;
  if ((!email && !phone) || !new_slot_id) {
    return c.json({ success: false, error: 'Ingresá tu email o teléfono, y seleccioná un nuevo turno' }, 400);
  }

  // 1. Validate old booking (JOIN slots to get fecha/hora_inicio for policy check)
  const oldBooking = await c.env.DB.prepare(
    `SELECT b.id, b.paciente_email, b.paciente_telefono, b.paciente_nombre, b.slot_id,
            s.fecha, s.hora_inicio, s.psicologo_id
     FROM reservas b
     JOIN slots s ON s.id = b.slot_id
     WHERE b.id = ?`,
  )
    .bind(id)
    .first<BookingRow & { paciente_nombre: string }>();

  if (!oldBooking) {
    return c.json({ success: false, error: 'Reserva no encontrada' }, 404);
  }
  const emailMatch = email && oldBooking.paciente_email === email;
  const phoneMatch = phone && oldBooking.paciente_telefono === phone;
  if (!emailMatch && !phoneMatch) {
    return c.json({ success: false, error: 'Datos de verificación incorrectos' }, 403);
  }

  // 2. Validate new slot
  const newSlot = await c.env.DB.prepare(
    `SELECT s.id, s.fecha, s.hora_inicio, s.hora_fin, s.disponible, s.psicologo_id, b.id as booking_id
     FROM slots s
     LEFT JOIN reservas b ON b.slot_id = s.id
     WHERE s.id = ?`,
  )
    .bind(new_slot_id)
    .first<SlotBookingRow>();

  if (!newSlot) {
    return c.json({ success: false, error: 'El nuevo turno no existe' }, 404);
  }
  if (!newSlot.disponible || newSlot.booking_id !== null) {
    return c.json({ success: false, error: 'Este turno ya no está disponible, por favor elegí otro' }, 409);
  }

  // 2b. Check reschedule policy against the ORIGINAL slot's datetime
  const reschPolicy = await c.env.DB.prepare(
    'SELECT reschedule_min_hours, whatsapp_number, nombre, policy_unit FROM psicologos WHERE id = ?',
  ).bind(oldBooking.psicologo_id).first<Pick<PolicyRow, 'reschedule_min_hours' | 'whatsapp_number' | 'nombre' | 'policy_unit'>>();

  const reschedule_min_hours = reschPolicy?.reschedule_min_hours ?? 48;
  const reschUnit = reschPolicy?.policy_unit ?? 'hours';
  const reschThresholdHours = toHours(reschedule_min_hours, reschUnit);
  const reschHours = hoursUntilSlot(oldBooking.fecha, oldBooking.hora_inicio);
  console.log('[policy]', { action: 'reschedule', reschHours, policy: reschedule_min_hours, unit: reschUnit, thresholdHours: reschThresholdHours });
  if (reschThresholdHours > 0 && reschHours < reschThresholdHours) {
    return c.json({
      success: false,
      error: 'outside_policy',
      policy_hours: reschedule_min_hours,
      whatsapp_number: reschPolicy?.whatsapp_number ?? null,
      psychologist_name: reschPolicy?.nombre ?? '',
    }, 403);
  }

  // 3. Check for conflicts with patient's other bookings (excluding the one being rescheduled)
  const conflict = await c.env.DB.prepare(
    `SELECT b.id FROM reservas b
     JOIN slots s ON b.slot_id = s.id
     WHERE b.paciente_email = ? AND s.fecha = ? AND b.id != ?
     AND NOT (s.hora_fin <= ? OR s.hora_inicio >= ?)`,
  )
    .bind(oldBooking.paciente_email, newSlot.fecha, id, newSlot.hora_inicio, newSlot.hora_fin)
    .first();

  if (conflict) {
    return c.json({ success: false, error: 'Ya tenés una reserva en ese horario' }, 409);
  }

  // 4. Atomic swap in D1 batch — preserve original patient data in new booking
  try {
    const results = await c.env.DB.batch([
      // Free old slot
      c.env.DB.prepare('UPDATE slots SET disponible = 1 WHERE id = ?').bind(oldBooking.slot_id),
      // Delete old booking
      c.env.DB.prepare('DELETE FROM reservas WHERE id = ?').bind(id),
      // Book new slot (with race condition check)
      c.env.DB.prepare('UPDATE slots SET disponible = 0 WHERE id = ? AND disponible = 1').bind(new_slot_id),
      c.env.DB.prepare(
        'INSERT INTO reservas (slot_id, paciente_nombre, paciente_email, paciente_telefono) VALUES (?, ?, ?, ?)',
      ).bind(new_slot_id, oldBooking.paciente_nombre, oldBooking.paciente_email, oldBooking.paciente_telefono),
    ]);

    if (results[2].meta.changes === 0) {
      return c.json({ success: false, error: 'Este turno ya no está disponible, por favor elegí otro' }, 409);
    }

    const newBookingId = results[3].meta.last_row_id;
    return c.json({
      success: true,
      data: {
        id: newBookingId,
        slot: { date: newSlot.fecha, start_time: newSlot.hora_inicio, end_time: newSlot.hora_fin },
      }
    });
  } catch (e) {
    return c.json({ success: false, error: 'Error al reprogramar el turno' }, 500);
  }
});

// DELETE /api/bookings/:id  — public, requires email+phone verification
bookingsRouter.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));

  let body: { email?: string; phone?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Cuerpo JSON inválido' }, 400);
  }

  const { email, phone } = body;
  if (!email && !phone) {
    return c.json({ success: false, error: 'Ingresá tu email o teléfono para cancelar' }, 400);
  }

  const booking = await c.env.DB.prepare(
    `SELECT b.id, b.paciente_email, b.paciente_telefono, b.slot_id, s.fecha, s.hora_inicio, s.psicologo_id
     FROM reservas b
     JOIN slots s ON b.slot_id = s.id
     WHERE b.id = ?`,
  )
    .bind(id)
    .first<BookingRow>();

  if (!booking) {
    return c.json({ success: false, error: 'Reserva no encontrada' }, 404);
  }
  const emailMatch = email && booking.paciente_email === email;
  const phoneMatch = phone && booking.paciente_telefono === phone;
  if (!emailMatch && !phoneMatch) {
    return c.json({ success: false, error: 'Datos de verificación incorrectos' }, 403);
  }

  // Check cancel policy
  const policy = await c.env.DB.prepare(
    'SELECT cancel_min_hours, whatsapp_number, nombre, policy_unit FROM psicologos WHERE id = ?',
  ).bind(booking.psicologo_id).first<Pick<PolicyRow, 'cancel_min_hours' | 'whatsapp_number' | 'nombre' | 'policy_unit'>>();

  const cancel_min_hours = policy?.cancel_min_hours ?? 48;
  const cancelUnit = policy?.policy_unit ?? 'hours';
  const cancelThresholdHours = toHours(cancel_min_hours, cancelUnit);
  const cancelHours = hoursUntilSlot(booking.fecha, booking.hora_inicio);
  console.log('[policy]', { action: 'cancel', cancelHours, policy: cancel_min_hours, unit: cancelUnit, thresholdHours: cancelThresholdHours });
  if (cancelThresholdHours > 0 && cancelHours < cancelThresholdHours) {
    return c.json({
      success: false,
      error: 'outside_policy',
      policy_hours: cancel_min_hours,
      whatsapp_number: policy?.whatsapp_number ?? null,
      psychologist_name: policy?.nombre ?? '',
    }, 403);
  }

  // Delete booking and restore slot
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM reservas WHERE id = ?').bind(id),
    c.env.DB.prepare('UPDATE slots SET disponible = 1 WHERE id = ?').bind(booking.slot_id),
  ]);

  return c.json({ success: true });
});
