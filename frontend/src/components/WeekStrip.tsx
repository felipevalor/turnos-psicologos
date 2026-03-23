const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface Props {
  dates: string[];
  selectedDate: string;
  onSelect: (date: string) => void;
  availableDates?: Set<string>;
  emptyDates?: Set<string>;
}

import { getTodayDateString } from '../lib/date';

export function WeekStrip({ dates, selectedDate, onSelect, availableDates, emptyDates }: Props) {
  const today = getTodayDateString();

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 px-0.5">
      {dates.map(dateStr => {
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        const isToday = dateStr === today;
        const isSelected = dateStr === selectedDate;
        const isDimmed = emptyDates?.has(dateStr) && !isSelected && !isToday;

        return (
          <button
            key={dateStr}
            onClick={() => onSelect(dateStr)}
            className={`flex-none flex flex-col items-center gap-0.5 min-w-[52px] px-2 py-2.5 rounded-xl transition-all ${isSelected
                ? 'bg-white text-[#1a2e4a] shadow-md'
                : isToday
                  ? 'bg-white/20 text-white'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              } ${isDimmed ? 'opacity-40' : ''}`}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide">
              {DAY_LABELS[date.getDay()]}
            </span>
            <span className={`text-lg font-bold leading-tight ${isSelected ? 'text-[#1a2e4a]' : ''}`}>
              {d}
            </span>
            <span className={`text-[10px] ${isSelected ? 'text-[#1a2e4a]/50' : 'text-white/50'}`}>
              {MONTH_LABELS[m - 1]}
            </span>
            <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${
              availableDates?.has(dateStr)
                ? (isSelected ? 'bg-[#4caf7d]' : 'bg-[#4caf7d]/80')
                : 'bg-transparent'
            }`} />
          </button>
        );
      })}
    </div>
  );
}
