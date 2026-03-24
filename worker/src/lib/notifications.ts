import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import type { Env } from '../types';
import { getLocalISODate } from './date';

export type NotificationBooking = {
  patientName: string;
  patientPhone: string;
  date: string;
  startTime: string;
  psychologistPhone: string | null;
};

type KapsoClient = {
  client: WhatsAppClient;
  phoneNumberId: string;
};

function getClient(env: Env): KapsoClient | null {
  if (!env.KAPSO_API_KEY || !env.KAPSO_PHONE_NUMBER_ID) {
    return null;
  }
  return {
    client: new WhatsAppClient({
      baseUrl: 'https://api.kapso.ai/meta/whatsapp',
      kapsoApiKey: env.KAPSO_API_KEY,
    }),
    phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
  };
}

function stripPlus(phone: string): string {
  return phone.replace(/^\+/, '');
}

async function send(
  client: WhatsAppClient,
  phoneNumberId: string,
  to: string,
  body: string,
): Promise<void> {
  try {
    await client.messages.sendText({ phoneNumberId, to: stripPlus(to), body });
  } catch (err) {
    console.error('[notifications] sendText failed:', err);
  }
}

export async function sendBookingConfirmation(env: Env, booking: NotificationBooking): Promise<void> {
  const kapso = getClient(env);
  if (!kapso) return;

  const { client, phoneNumberId } = kapso;
  const sends: Promise<void>[] = [
    send(client, phoneNumberId, booking.patientPhone,
      `¡Hola ${booking.patientName}! Tu sesión fue confirmada para el ${booking.date} a las ${booking.startTime} hs. ¡Te esperamos!`),
  ];
  if (booking.psychologistPhone) {
    sends.push(send(client, phoneNumberId, booking.psychologistPhone,
      `Nueva sesión agendada: ${booking.patientName} el ${booking.date} a las ${booking.startTime} hs. Tel: ${booking.patientPhone}`));
  }
  await Promise.allSettled(sends);
}

export async function sendBookingCancellation(
  env: Env,
  booking: NotificationBooking,
  cancelledBy: 'patient' | 'admin',
): Promise<void> {
  const kapso = getClient(env);
  if (!kapso) return;

  const { client, phoneNumberId } = kapso;
  const psychoMsg = cancelledBy === 'patient'
    ? `${booking.patientName} canceló su sesión del ${booking.date} a las ${booking.startTime} hs.`
    : `Cancelaste la sesión de ${booking.patientName} del ${booking.date} a las ${booking.startTime} hs.`;

  const sends: Promise<void>[] = [
    send(client, phoneNumberId, booking.patientPhone,
      `Hola ${booking.patientName}, tu sesión del ${booking.date} a las ${booking.startTime} hs fue cancelada.`),
  ];
  if (booking.psychologistPhone) {
    sends.push(send(client, phoneNumberId, booking.psychologistPhone, psychoMsg));
  }
  await Promise.allSettled(sends);
}

export async function sendBookingReschedule(
  env: Env,
  booking: NotificationBooking,
  rescheduledBy: 'patient' | 'admin',
): Promise<void> {
  const kapso = getClient(env);
  if (!kapso) return;

  const { client, phoneNumberId } = kapso;
  const psychoMsg = rescheduledBy === 'patient'
    ? `${booking.patientName} reprogramó su sesión al ${booking.date} a las ${booking.startTime} hs.`
    : `Reprogramaste la sesión de ${booking.patientName} al ${booking.date} a las ${booking.startTime} hs.`;

  const sends: Promise<void>[] = [
    send(client, phoneNumberId, booking.patientPhone,
      `¡Hola ${booking.patientName}! Tu sesión fue reprogramada al ${booking.date} a las ${booking.startTime} hs.`),
  ];
  if (booking.psychologistPhone) {
    sends.push(send(client, phoneNumberId, booking.psychologistPhone, psychoMsg));
  }
  await Promise.allSettled(sends);
}

type ReminderRow = {
  paciente_nombre: string;
  paciente_telefono: string;
  fecha: string;
  hora_inicio: string;
  nombre: string;
  whatsapp_number: string | null;
};

// sendReminders is not unit-tested because it requires a D1 database mock.
// It is tested via smoke test in Task 7.
export async function sendReminders(env: Env): Promise<void> {
  const kapso = getClient(env);
  if (!kapso) return;

  const tomorrow = getLocalISODate(new Date(Date.now() + 86_400_000));
  const rows = await env.DB.prepare(
    `SELECT b.paciente_nombre, b.paciente_telefono,
            s.fecha, s.hora_inicio,
            p.nombre, p.whatsapp_number
     FROM reservas b
     JOIN slots s ON b.slot_id = s.id
     JOIN psicologos p ON s.psicologo_id = p.id
     WHERE s.fecha = ?
     AND s.disponible = 0`,
  ).bind(tomorrow).all<ReminderRow>();

  const { client, phoneNumberId } = kapso;
  await Promise.allSettled(
    rows.results.flatMap((row) => {
      const sends: Promise<void>[] = [
        send(client, phoneNumberId, row.paciente_telefono,
          `¡Hola ${row.paciente_nombre}! Te recordamos que mañana tenés sesión a las ${row.hora_inicio} hs con ${row.nombre}. ¡Hasta mañana!`),
      ];
      if (row.whatsapp_number) {
        sends.push(send(client, phoneNumberId, row.whatsapp_number,
          `Recordatorio: sesión con ${row.paciente_nombre} mañana a las ${row.hora_inicio} hs.`));
      }
      return sends;
    }),
  );
}
