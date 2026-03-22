import { describe, it, expect, vi } from 'vitest';
import { findFirstAvailableDate } from '../pages/PatientView';

const DATES = ['2026-03-22', '2026-03-23', '2026-03-24', '2026-03-25'];
const TODAY = '2026-03-22';

describe('findFirstAvailableDate', () => {
  it('skips empty days and returns first date with slots', async () => {
    const fetchSlots = vi.fn()
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [{ id: 1, start_time: '10:00' }] });

    const result = await findFirstAvailableDate(DATES, fetchSlots, TODAY);
    expect(result).toBe('2026-03-24');
    expect(fetchSlots).toHaveBeenCalledTimes(3);
  });

  it('returns first date as fallback when all days are empty', async () => {
    const fetchSlots = vi.fn().mockResolvedValue({ success: true, data: [] });
    const result = await findFirstAvailableDate(DATES, fetchSlots, TODAY);
    expect(result).toBe(DATES[0]);
  });

  it('stops scanning as soon as it finds a date with slots', async () => {
    const fetchSlots = vi.fn()
      .mockResolvedValueOnce({ success: true, data: [{ id: 5, start_time: '09:00' }] });

    const result = await findFirstAvailableDate(DATES, fetchSlots, TODAY);
    expect(result).toBe(DATES[0]);
    expect(fetchSlots).toHaveBeenCalledTimes(1);
  });

  it('handles API errors gracefully by continuing to next date', async () => {
    const fetchSlots = vi.fn()
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true, data: [{ id: 2, start_time: '11:00' }] });

    const result = await findFirstAvailableDate(DATES, fetchSlots, TODAY);
    expect(result).toBe(DATES[1]);
  });

  it('calls onScanned for each date checked', async () => {
    const fetchSlots = vi.fn()
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [{ id: 1, start_time: '10:00' }] });

    const onScanned = vi.fn();
    await findFirstAvailableDate(DATES, fetchSlots, TODAY, onScanned);
    expect(onScanned).toHaveBeenCalledWith('2026-03-22', false);
    expect(onScanned).toHaveBeenCalledWith('2026-03-23', true);
    expect(onScanned).toHaveBeenCalledTimes(2);
  });
});
