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

function toIcsDateTime(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

export function buildIcsContent(event: CalendarEvent, method: 'REQUEST' | 'CANCEL'): string {
  const uid = `turnos-psico-${event.date}-${event.startTime.replace(':', '')}@turnospsi.com`;
  const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Turnos Psico//ES',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=${TIMEZONE}:${toIcsDateTime(event.date, event.startTime)}`,
    `DTEND;TZID=${TIMEZONE}:${toIcsDateTime(event.date, event.endTime)}`,
    `SUMMARY:${event.title}`,
    ...(event.description ? [`DESCRIPTION:${event.description}`] : []),
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
