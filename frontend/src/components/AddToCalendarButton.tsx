import { buildGoogleCalendarUrl, buildIcsContent, downloadIcs } from '../lib/googleCalendar';
import type { CalendarEvent } from '../lib/googleCalendar';

interface Props {
  event: CalendarEvent;
  variant?: 'add' | 'cancel';
}

export function AddToCalendarButton({ event, variant = 'add' }: Props) {
  const isCancel = variant === 'cancel';

  const handleIcs = () => {
    const method = isCancel ? 'CANCEL' : 'REQUEST';
    const filename = `sesion-${event.date}.ics`;
    downloadIcs(filename, buildIcsContent(event, method));
  };

  if (isCancel) {
    return (
      <button
        type="button"
        onClick={handleIcs}
        className="w-full flex items-center justify-center gap-2 border border-slate-200 text-slate-600 py-3 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors"
      >
        <svg className="w-4 h-4 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Eliminar del calendario
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 mt-3">
      <a
        href={buildGoogleCalendarUrl(event)}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full flex items-center justify-center gap-2 bg-[#1a73e8] text-white py-3 rounded-xl text-sm font-semibold hover:bg-[#1557b0] transition-colors"
      >
        <svg className="w-4 h-4 flex-none" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12s4.477 10 10 10 10-4.477 10-10zm-11-1V7h2v4h4v2h-4v4h-2v-4H7v-2h4z" />
        </svg>
        Agregar a Google Calendar
      </a>
      <button
        type="button"
        onClick={handleIcs}
        className="w-full flex items-center justify-center gap-2 border border-slate-200 text-slate-600 py-3 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors"
      >
        <svg className="w-4 h-4 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Descargar .ics (Apple / Outlook)
      </button>
    </div>
  );
}
