import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRouter } from './routes/auth';
import { slotsRouter } from './routes/slots';
import { bookingsRouter } from './routes/bookings';
import { recurringRouter } from './routes/recurring';
import { scheduleRouter } from './routes/schedule';
import { holidaysRouter } from './routes/holidays';
import { dashboardRouter } from './routes/dashboard';
import { notesRouter } from './routes/notes';
import { patientsRouter } from './routes/patients';
import type { Env, AppVariables } from './types';
import { sendReminders } from './lib/notifications';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use('*', (c, next) => {
  const allowedOrigin = c.env.ALLOWED_ORIGIN;
  return cors({
    origin: allowedOrigin ?? '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: !!allowedOrigin,
    maxAge: 86400,
  })(c, next);
});

app.route('/api/auth', authRouter);
app.route('/api/dashboard', dashboardRouter);
app.route('/api/slots', slotsRouter);
app.route('/api/bookings', bookingsRouter);
app.route('/api/recurring', recurringRouter);
app.route('/api/schedule', scheduleRouter);
app.route('/api/holidays', holidaysRouter);
app.route('/api/notes', notesRouter);
app.route('/api/patients', patientsRouter);

// GET /api/contact — public psychologist contact info
app.get('/api/contact', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT nombre, whatsapp_number FROM psicologos LIMIT 1',
  ).first<{ nombre: string; whatsapp_number: string | null }>();
  return c.json({ success: true, data: { nombre: row?.nombre ?? '', whatsapp_number: row?.whatsapp_number ?? null } });
});

app.notFound((c) => c.json({ success: false, error: 'Ruta no encontrada' }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, error: 'Error interno del servidor' }, 500);
});

export default {
  fetch: app.fetch.bind(app),
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await sendReminders(env);
  },
};
