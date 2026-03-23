const TIMEZONE = 'America/Buenos_Aires';

export interface CalendarEvent {
  title: string;
  date: string;       // "YYYY-MM-DD"
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
  description?: string;
}

function toGoogleDateTime(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toGoogleDateTime(event.date, event.startTime)}/${toGoogleDateTime(event.date, event.endTime)}`,
    ctz: TIMEZONE,
    details: event.description ?? '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildSessionEvent(
  slot: { date: string; start_time: string; end_time: string },
  patientName: string,
  psychologistName?: string,
): CalendarEvent {
  return {
    title: psychologistName ? `Sesión con ${psychologistName}` : 'Sesión de psicología',
    date: slot.date,
    startTime: slot.start_time,
    endTime: slot.end_time,
    description: `Sesión agendada para ${patientName}. Turno confirmado en Turnos Psico.`,
  };
}
