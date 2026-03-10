export function getLocalISODate(date: Date): string {
    const utcMs = date.getTime();
    // America/Buenos_Aires is UTC-3
    const baMs = utcMs - (3 * 3600 * 1000);
    return new Date(baMs).toISOString().split('T')[0];
}

export function getTodayDateString(): string {
    return getLocalISODate(new Date());
}
