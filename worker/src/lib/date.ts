export function getLocalISODate(date: Date): string {
    const utcMs = date.getTime();
    // America/Buenos_Aires is UTC-3
    const baMs = utcMs - (3 * 3600 * 1000);
    return new Date(baMs).toISOString().split('T')[0];
}

export function getTodayDateString(): string {
    return getLocalISODate(new Date());
}

export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(new Date(dateStr).getTime());
}

export function isValidTime(timeStr: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(timeStr)) return false;
  const [h, m] = timeStr.split(':').map(Number);
  return h <= 23 && m <= 59;
}
