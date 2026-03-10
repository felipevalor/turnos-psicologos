export function getLocalISODate(date: Date): string {
    // getTime() gives ms since epoch (UTC)
    const utcMs = date.getTime();
    // America/Buenos_Aires is UTC-3
    const baMs = utcMs - (3 * 3600 * 1000);
    // Shift by -3 hours and format as UTC to get the local date
    return new Date(baMs).toISOString().split('T')[0];
}

export function getTodayDateString(): string {
    return getLocalISODate(new Date());
}

export function addDaysToLocal(date: Date, days: number): string {
    // Safe math with ms, ignoring local timezone boundaries
    const futureMs = date.getTime() + (days * 86400000);
    return getLocalISODate(new Date(futureMs));
}
