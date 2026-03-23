import { buildGoogleCalendarUrl } from '../lib/googleCalendar';
import type { CalendarEvent } from '../lib/googleCalendar';

interface Props {
  event: CalendarEvent;
}

export function AddToCalendarButton({ event }: Props) {
  return (
    <div className="mt-3">
      <a
        href={buildGoogleCalendarUrl(event)}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full flex items-center justify-center gap-2 bg-[#1a73e8] text-white py-3 rounded-xl text-sm font-semibold hover:bg-[#1557b0] transition-colors shadow-sm"
      >
        <svg className="w-4 h-4 flex-none" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12s4.477 10 10 10 10-4.477 10-10zm-11-1V7h2v4h4v2h-4v4h-2v-4H7v-2h4z" />
        </svg>
        Agregar a Google Calendar
      </a>
    </div>
  );
}
