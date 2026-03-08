import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

const dashboardRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Buenos Aires is UTC-3 year-round (no DST)
function baDateStr(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

function baTimeStr(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return d.toISOString().substring(11, 16); // HH:MM
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function getWeekRange(dateStr: string): { start: string; end: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0=Sun
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const mon = new Date(y, m - 1, d + mondayOffset);
  const sun = new Date(y, m - 1, d + mondayOffset + 6);
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { start: fmt(mon), end: fmt(sun) };
}

function getMonthRange(dateStr: string): { start: string; end: string } {
  const [y, m] = dateStr.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    start: `${y}-${String(m).padStart(2, '0')}-01`,
    end: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

function prevMonthStart(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  return m === 1
    ? `${y - 1}-12-01`
    : `${y}-${String(m - 1).padStart(2, '0')}-01`;
}

dashboardRouter.get('/', authMiddleware, async (c) => {
  const psychologistId = c.get('psychologistId') as number;
  const today = baDateStr();
  const nowTime = baTimeStr();

  const weekCur = getWeekRange(today);
  const weekPrev = { start: addDays(weekCur.start, -7), end: addDays(weekCur.end, -7) };

  const monthCur = getMonthRange(today);
  const monthPrev = getMonthRange(prevMonthStart(today));

  type CountRow = { cnt: number };
  type SessionRow = { id: number; hora_inicio: string; hora_fin: string; patient_name: string; patient_email: string };

  const [
    todaySessions,
    weekTotal, weekBooked,
    prevWeekTotal, prevWeekBooked,
    monthTotal, monthBooked,
    prevMonthTotal, prevMonthBooked,
    activePatients,
    newPatients,
  ] = await Promise.all([
    c.env.DB.prepare(`
      SELECT r.id, s.hora_inicio, s.hora_fin,
             r.paciente_nombre as patient_name, r.paciente_email as patient_email
      FROM reservas r JOIN slots s ON s.id = r.slot_id
      WHERE s.psicologo_id = ? AND s.fecha = ? AND s.hora_inicio >= ?
      ORDER BY s.hora_inicio
    `).bind(psychologistId, today, nowTime).all<SessionRow>(),

    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM slots WHERE psicologo_id = ? AND fecha >= ? AND fecha <= ?`)
      .bind(psychologistId, weekCur.start, weekCur.end).first<CountRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM slots s JOIN reservas r ON r.slot_id = s.id WHERE s.psicologo_id = ? AND s.fecha >= ? AND s.fecha <= ?`)
      .bind(psychologistId, weekCur.start, weekCur.end).first<CountRow>(),

    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM slots WHERE psicologo_id = ? AND fecha >= ? AND fecha <= ?`)
      .bind(psychologistId, weekPrev.start, weekPrev.end).first<CountRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM slots s JOIN reservas r ON r.slot_id = s.id WHERE s.psicologo_id = ? AND s.fecha >= ? AND s.fecha <= ?`)
      .bind(psychologistId, weekPrev.start, weekPrev.end).first<CountRow>(),

    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM slots WHERE psicologo_id = ? AND fecha >= ? AND fecha <= ?`)
      .bind(psychologistId, monthCur.start, monthCur.end).first<CountRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM slots s JOIN reservas r ON r.slot_id = s.id WHERE s.psicologo_id = ? AND s.fecha >= ? AND s.fecha <= ?`)
      .bind(psychologistId, monthCur.start, monthCur.end).first<CountRow>(),

    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM slots WHERE psicologo_id = ? AND fecha >= ? AND fecha <= ?`)
      .bind(psychologistId, monthPrev.start, monthPrev.end).first<CountRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM slots s JOIN reservas r ON r.slot_id = s.id WHERE s.psicologo_id = ? AND s.fecha >= ? AND s.fecha <= ?`)
      .bind(psychologistId, monthPrev.start, monthPrev.end).first<CountRow>(),

    c.env.DB.prepare(`
      SELECT COUNT(DISTINCT r.paciente_email) as cnt
      FROM reservas r JOIN slots s ON s.id = r.slot_id
      WHERE s.psicologo_id = ? AND s.fecha >= ?
    `).bind(psychologistId, today).first<CountRow>(),

    c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT r.paciente_email, MIN(s.fecha) as first_session
        FROM reservas r JOIN slots s ON s.id = r.slot_id
        WHERE s.psicologo_id = ?
        GROUP BY r.paciente_email
        HAVING first_session >= ? AND first_session <= ?
      )
    `).bind(psychologistId, monthCur.start, monthCur.end).first<CountRow>(),
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
        date: today,
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
        new_this_month: newPatients?.cnt ?? 0,
      },
    },
  });
});

export { dashboardRouter };
