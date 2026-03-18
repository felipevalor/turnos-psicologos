import { describe, it, expect } from 'vitest';
import { getLocalISODate, addDaysToLocal } from '../lib/date';

describe('getLocalISODate', () => {
  it('converts UTC midnight to Buenos Aires date (UTC-3)', () => {
    // 2026-03-19T00:00:00Z = 2026-03-18T21:00:00-03 → should return 2026-03-18
    const date = new Date('2026-03-19T00:00:00Z');
    expect(getLocalISODate(date)).toBe('2026-03-18');
  });

  it('converts UTC noon to same date in BA', () => {
    const date = new Date('2026-03-18T12:00:00Z');
    expect(getLocalISODate(date)).toBe('2026-03-18');
  });

  it('handles end of year correctly', () => {
    // 2026-01-01T01:00:00Z = 2025-12-31T22:00:00-03
    const date = new Date('2026-01-01T01:00:00Z');
    expect(getLocalISODate(date)).toBe('2025-12-31');
  });
});

describe('addDaysToLocal', () => {
  it('adds positive days', () => {
    const date = new Date('2026-03-18T12:00:00Z');
    expect(addDaysToLocal(date, 3)).toBe('2026-03-21');
  });

  it('adds zero days returns same date', () => {
    const date = new Date('2026-03-18T12:00:00Z');
    expect(addDaysToLocal(date, 0)).toBe('2026-03-18');
  });

  it('handles month boundary', () => {
    const date = new Date('2026-03-30T12:00:00Z');
    expect(addDaysToLocal(date, 3)).toBe('2026-04-02');
  });
});
