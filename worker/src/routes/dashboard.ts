import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

const dashboardRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Buenos Aires date (UTC-3)
function getBaDate() {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

dashboardRouter.get('/', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId') as number;
  const baDate = getBaDate(); // just for the daily display date, queries use SQLite datetime

  type CountRow = { cnt: number };
  type SessionRow = { id: number; hora_inicio: string; hora_fin: string; patient_name: string; patient_email: string };

  const [
    todaySessions,
    
    // Week queries
    weekTotal, weekBooked,
    prevWeekTotal, prevWeekBooked,
    
    // Month queries
    monthTotal, monthBooked,
    prevMonthTotal, prevMonthBooked,
    
    // Patient queries
    activePatients,
    newPatientsThisMonth,
  ] = await Promise.all([
    // Today's upcoming sessions
    c.env.DB.prepare(`
      SELECT r.id, s.hora_inicio, s.hora_fin, r.paciente_nombre as patient_name, r.paciente_email
      FROM reservas r
      JOIN slots s ON s.id = r.slot_id
      WHERE s.psicologo_id = ? AND s.fecha = date('now', '-3 hours')
      AND s.hora_inicio >= time('now', '-3 hours')
      ORDER BY s.hora_inicio
    `).bind(psychologistId).all<SessionRow>(),

    // Current week total slots
    c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM slots 
      WHERE psicologo_id = ? AND disponible >= 0
      AND fecha >= date('now', '-3 hours', 'weekday 1', '-7 days') 
      AND fecha <= date('now', '-3 hours', 'weekday 0')
    `).bind(psychologistId).first<CountRow>(),

    // Current week booked slots
    c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM slots 
      WHERE psicologo_id = ? AND disponible = 0
      AND fecha >= date('now', '-3 hours', 'weekday 1', '-7 days') 
      AND fecha <= date('now', '-3 hours', 'weekday 0')
    `).bind(psychologistId).first<CountRow>(),

    // Previous week total slots
    c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM slots 
      WHERE psicologo_id = ? AND disponible >= 0
      AND fecha >= date('now', '-3 hours', 'weekday 1', '-14 days') 
      AND fecha <= date('now', '-3 hours', 'weekday 0', '-7 days')
    `).bind(psychologistId).first<CountRow>(),

    // Previous week booked slots
    c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM slots 
      WHERE psicologo_id = ? AND disponible = 0
      AND fecha >= date('now', '-3 hours', 'weekday 1', '-14 days') 
      AND fecha <= date('now', '-3 hours', 'weekday 0', '-7 days')
    `).bind(psychologistId).first<CountRow>(),

    // Current month total slots
    c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM slots 
      WHERE psicologo_id = ? AND disponible >= 0
      AND strftime('%Y-%m', fecha) = strftime('%Y-%m', date('now', '-3 hours'))
    `).bind(psychologistId).first<CountRow>(),

    // Current month booked slots
    c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM slots 
      WHERE psicologo_id = ? AND disponible = 0
      AND strftime('%Y-%m', fecha) = strftime('%Y-%m', date('now', '-3 hours'))
    `).bind(psychologistId).first<CountRow>(),

    // Previous month total slots
    c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM slots 
      WHERE psicologo_id = ? AND disponible >= 0
      AND strftime('%Y-%m', fecha) = strftime('%Y-%m', date('now', '-3 hours', '-1 month'))
    `).bind(psychologistId).first<CountRow>(),

    // Previous month booked slots
    c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM slots 
      WHERE psicologo_id = ? AND disponible = 0
      AND strftime('%Y-%m', fecha) = strftime('%Y-%m', date('now', '-3 hours', '-1 month'))
    `).bind(psychologistId).first<CountRow>(),

    // Active patients (at least 1 future session)
    c.env.DB.prepare(`
      SELECT COUNT(DISTINCT r.paciente_email) as cnt
      FROM reservas r JOIN slots s ON s.id = r.slot_id
      WHERE s.psicologo_id = ? AND s.fecha >= date('now', '-3 hours')
    `).bind(psychologistId).first<CountRow>(),

    // New patients this month
    c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT r.paciente_email, MIN(s.fecha) as first_session
        FROM reservas r JOIN slots s ON s.id = r.slot_id
        WHERE s.psicologo_id = ?
        GROUP BY r.paciente_email
        HAVING strftime('%Y-%m', first_session) = strftime('%Y-%m', date('now', '-3 hours'))
      )
    `).bind(psychologistId).first<CountRow>(),
  ]);

  const wT = weekTotal?.cnt ?? 0;
  const wB = weekBooked?.cnt ?? 0;
  const pwT = prevWeekTotal?.cnt ?? 0;
  const pwB = prevWeekBooked?.cnt ?? 0;
  const mT = monthTotal?.cnt ?? 0;
  const mB = monthBooked?.cnt ?? 0;
  const pmT = prevMonthTotal?.cnt ?? 0;
  const pmB = prevMonthBooked?.cnt ?? 0;

  return c.json({
    success: true,
    data: {
      today: {
        date: baDate,
        upcoming_sessions: todaySessions.results,
      },
      week: {
        total_slots: wT,
        booked_slots: wB,
        occupancy_pct: wT > 0 ? Math.round((wB / wT) * 100) : 0,
        cancelled: 0, // TODO: add cancellation tracking table
        prev_total_slots: pwT,
        prev_booked_slots: pwB,
        prev_occupancy_pct: pwT > 0 ? Math.round((pwB / pwT) * 100) : 0,
      },
      month: {
        total_slots: mT,
        booked_slots: mB,
        occupancy_pct: mT > 0 ? Math.round((mB / mT) * 100) : 0,
        new_sessions: mB,
        cancelled: 0, // TODO: add cancellation tracking table
        cancellation_rate_pct: 0, // TODO: add cancellation tracking table
        prev_total_slots: pmT,
        prev_booked_slots: pmB,
        prev_occupancy_pct: pmT > 0 ? Math.round((pmB / pmT) * 100) : 0,
        prev_cancelled: 0, // TODO: add cancellation tracking table
      },
      patients: {
        active: activePatients?.cnt ?? 0,
        new_this_month: newPatientsThisMonth?.cnt ?? 0,
      },
    },
  });
});

export { dashboardRouter };

