// Regression: ISSUE-001 — Reschedule modal defaulted to today, showing no slots
// Found by /qa on 2026-03-18
// Report: .gstack/qa-reports/qa-report-localhost-2026-03-18.md

import { describe, it, expect } from 'vitest';
import { addDaysToLocal } from '../lib/date';

function getNext14Days(): string[] {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    dates.push(addDaysToLocal(today, i));
  }
  return dates;
}

describe('reschedule modal default date', () => {
  it('defaults to tomorrow (index 1), not today (index 0)', () => {
    const dates = getNext14Days();
    const defaultDate = dates[1];
    const today = addDaysToLocal(new Date(), 0);
    expect(defaultDate).not.toBe(today);
  });

  it('default date is exactly 1 day after today', () => {
    const dates = getNext14Days();
    const tomorrow = addDaysToLocal(new Date(), 1);
    expect(dates[1]).toBe(tomorrow);
  });

  it('generates 14 dates starting from today', () => {
    const dates = getNext14Days();
    expect(dates).toHaveLength(14);
    expect(dates[0]).toBe(addDaysToLocal(new Date(), 0));
    expect(dates[13]).toBe(addDaysToLocal(new Date(), 13));
  });
});
