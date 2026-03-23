# UX Conversion Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 UX/conversion issues identified in the patient booking view — broken first-load state, missing psychologist identity, noisy admin CTA, no guidance copy, poor form hints, and missing confirmation feedback.

**Architecture:** All changes are confined to frontend components. No backend changes needed. The `getContact()` API and `getSlots()` API already return everything required — changes are purely presentational and client-side logic.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest

---

## Files

| File | Changes |
|------|---------|
| `frontend/src/pages/PatientView.tsx` | Auto-skip logic, psychologist banner, demote admin link, success banner copy, localStorage pre-fill, slot section micro-copy |
| `frontend/src/components/WeekStrip.tsx` | Add `availableDates` prop + green dot indicator |
| `frontend/src/components/BookingModal.tsx` | Phone hint improvement + confirmation message in success flow |
| `frontend/src/test/patient-view-autoskip.test.ts` | Unit tests for auto-skip logic |

---

## Task 1: Auto-skip to first available date on load

**Problem:** The page defaults to today. If today has no slots (e.g., Sunday), the first thing the patient sees is "Sin turnos disponibles". The fix: on initial mount, scan dates sequentially until finding one with slots.

**Files:**
- Modify: `frontend/src/pages/PatientView.tsx`
- Create: `frontend/src/test/patient-view-autoskip.test.ts`

- [ ] **Step 1: Extract the auto-skip logic into a pure, testable function**

Add this function near the top of `PatientView.tsx` (below the imports, before the component):

```typescript
export async function findFirstAvailableDate(
  dates: string[],
  fetchSlots: (date: string) => Promise<{ success: boolean; data?: { id: number }[] }>,
  todayStr: string,
): Promise<string> {
  for (const date of dates) {
    const res = await fetchSlots(date);
    if (res.success && res.data && res.data.length > 0) {
      // For today, check if any slots are still in the future (BA timezone)
      if (date === todayStr) {
        const baMs = Date.now() - 3 * 3600 * 1000;
        const ba = new Date(baMs);
        const currentTime = `${String(ba.getUTCHours()).padStart(2, '0')}:${String(ba.getUTCMinutes()).padStart(2, '0')}`;
        const future = res.data.filter((s: { id: number; start_time?: string }) =>
          !s.start_time || s.start_time > currentTime,
        );
        if (future.length > 0) return date;
      } else {
        return date;
      }
    }
  }
  return dates[0]; // fallback: show first date even if empty
}
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/test/patient-view-autoskip.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { findFirstAvailableDate } from '../pages/PatientView';

const DATES = ['2026-03-22', '2026-03-23', '2026-03-24', '2026-03-25'];
const TODAY = '2026-03-22';

describe('findFirstAvailableDate', () => {
  it('skips empty days and returns first date with slots', async () => {
    const fetchSlots = vi.fn()
      .mockResolvedValueOnce({ success: true, data: [] })          // 22 → empty
      .mockResolvedValueOnce({ success: true, data: [] })          // 23 → empty
      .mockResolvedValueOnce({ success: true, data: [{ id: 1 }] }); // 24 → has slot

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
      .mockResolvedValueOnce({ success: true, data: [{ id: 5 }] }); // first date has slots

    const result = await findFirstAvailableDate(DATES, fetchSlots, TODAY);
    expect(result).toBe(DATES[0]);
    expect(fetchSlots).toHaveBeenCalledTimes(1);
  });

  it('handles API errors gracefully by continuing to next date', async () => {
    const fetchSlots = vi.fn()
      .mockResolvedValueOnce({ success: false })                    // error → skip
      .mockResolvedValueOnce({ success: true, data: [{ id: 2 }] }); // 23 → has slot

    const result = await findFirstAvailableDate(DATES, fetchSlots, TODAY);
    expect(result).toBe(DATES[1]);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
cd /Users/felipevalor/Downloads/turnos-psicologos/frontend && npx vitest run src/test/patient-view-autoskip.test.ts
```

Expected: FAIL — `findFirstAvailableDate` is not exported yet.

- [ ] **Step 4: Add the `findFirstAvailableDate` export and wire it into `PatientView`**

In `PatientView.tsx`:

1. Add the `export async function findFirstAvailableDate(...)` as defined in Step 1 (make sure it's exported).

2. Replace the `useState(today)` for `selectedDate` and add an initialization effect:

```typescript
const [selectedDate, setSelectedDate] = useState(today);
const [initializing, setInitializing] = useState(true);

useEffect(() => {
  findFirstAvailableDate(stripDates, getSlots, today).then(date => {
    setSelectedDate(date);
    setInitializing(false);
  });
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

3. Suppress slot loading while `initializing` is true (prevents double-fetch race):

In the `loadSlots` useEffect, add a guard:
```typescript
useEffect(() => {
  if (initializing) return;
  setBookingSuccess(null);
  loadSlots();
}, [loadSlots, initializing]);
```

- [ ] **Step 5: Run the test again to confirm it passes**

```bash
cd /Users/felipevalor/Downloads/turnos-psicologos/frontend && npx vitest run src/test/patient-view-autoskip.test.ts
```

Expected: PASS (all 4 tests)

- [ ] **Step 6: Commit**

```bash
cd /Users/felipevalor/Downloads/turnos-psicologos
git add frontend/src/pages/PatientView.tsx frontend/src/test/patient-view-autoskip.test.ts
git commit -m "feat(ux): auto-skip to first available date on initial load"
```

---

## Task 2: Add availability dots to week strip

**Problem:** The week strip shows all 14 days identically — no visual cue about which days have slots. Patients click empty days needlessly.

**Strategy:** Populate a `Set<string>` of dates with slots progressively:
- The auto-skip scan in Task 1 naturally reveals which dates were scanned (empty or not).
- Each time a date is selected and slots are loaded, we update the set.
- Dates with known slots get a green dot; dates known to be empty get a subtle dim style.

**Files:**
- Modify: `frontend/src/components/WeekStrip.tsx`
- Modify: `frontend/src/pages/PatientView.tsx`

- [ ] **Step 1: Update `WeekStrip` to accept and render availability state**

Replace the `WeekStrip` props interface and button rendering:

```typescript
interface Props {
  dates: string[];
  selectedDate: string;
  onSelect: (date: string) => void;
  availableDates?: Set<string>;   // dates known to have slots
  emptyDates?: Set<string>;       // dates known to be empty
}

export function WeekStrip({ dates, selectedDate, onSelect, availableDates, emptyDates }: Props) {
```

Inside the `return` block, update the button to include a dot indicator. Replace the inner button content with:

```tsx
<button
  key={dateStr}
  onClick={() => onSelect(dateStr)}
  className={`flex-none flex flex-col items-center gap-0.5 min-w-[52px] px-2 py-2.5 rounded-xl transition-all ${
    isSelected
      ? 'bg-white text-[#1a2e4a] shadow-md'
      : isToday
        ? 'bg-white/20 text-white'
        : emptyDates?.has(dateStr)
          ? 'bg-white/5 text-white/35'
          : 'bg-white/10 text-white/70 hover:bg-white/20'
  }`}
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
  {/* Availability dot */}
  <span className={`w-1 h-1 rounded-full mt-0.5 ${
    availableDates?.has(dateStr)
      ? isSelected ? 'bg-[#4caf7d]' : 'bg-[#4caf7d]/80'
      : 'bg-transparent'
  }`} />
</button>
```

- [ ] **Step 2: Add availability tracking state to `PatientView`**

Add two new state variables after the `selectedDate` state:

```typescript
const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
const [emptyDates, setEmptyDates] = useState<Set<string>>(new Set());
```

- [ ] **Step 3: Update `loadSlots` to populate the sets**

After `setSlots(fetched)` inside `loadSlots`:

```typescript
if (res.success && res.data) {
  let fetched = res.data;
  // ... existing time filter for today ...
  setSlots(fetched);
  // Track availability for week strip dots
  if (fetched.length > 0) {
    setAvailableDates(prev => new Set([...prev, selectedDate]));
    setEmptyDates(prev => { const s = new Set(prev); s.delete(selectedDate); return s; });
  } else {
    setEmptyDates(prev => new Set([...prev, selectedDate]));
    setAvailableDates(prev => { const s = new Set(prev); s.delete(selectedDate); return s; });
  }
}
```

- [ ] **Step 4: Also populate sets during auto-skip scan**

Update `findFirstAvailableDate` to accept optional callbacks for tracking:

```typescript
export async function findFirstAvailableDate(
  dates: string[],
  fetchSlots: (date: string) => Promise<{ success: boolean; data?: { id: number }[] }>,
  todayStr: string,
  onScanned?: (date: string, hasSlots: boolean) => void,
): Promise<string> {
  for (const date of dates) {
    const res = await fetchSlots(date);
    let effectiveHasSlots = res.success && !!res.data && res.data.length > 0;
    if (effectiveHasSlots && date === todayStr) {
      // For today, only count slots still in the future (BA timezone = UTC-3)
      const baMs = Date.now() - 3 * 3600 * 1000;
      const ba = new Date(baMs);
      const currentTime = `${String(ba.getUTCHours()).padStart(2, '0')}:${String(ba.getUTCMinutes()).padStart(2, '0')}`;
      const future = (res.data ?? []).filter((s: { id: number; start_time: string }) => s.start_time > currentTime);
      effectiveHasSlots = future.length > 0;
    }
    onScanned?.(date, effectiveHasSlots);
    if (effectiveHasSlots) return date;
  }
  return dates[0];
}
```

Pass the callback in the useEffect:

```typescript
findFirstAvailableDate(stripDates, getSlots, today, (date, hasSlots) => {
  if (hasSlots) setAvailableDates(prev => new Set([...prev, date]));
  else setEmptyDates(prev => new Set([...prev, date]));
}).then(date => {
  setSelectedDate(date);
  setInitializing(false);
});
```

- [ ] **Step 5: Pass the sets to `WeekStrip` in the JSX**

```tsx
<WeekStrip
  dates={stripDates}
  selectedDate={selectedDate}
  onSelect={setSelectedDate}
  availableDates={availableDates}
  emptyDates={emptyDates}
/>
```

- [ ] **Step 6: Update the test for `findFirstAvailableDate`** to cover the new `onScanned` parameter

Add one test to `patient-view-autoskip.test.ts`:

```typescript
it('calls onScanned for each date checked', async () => {
  const fetchSlots = vi.fn()
    .mockResolvedValueOnce({ success: true, data: [] })
    .mockResolvedValueOnce({ success: true, data: [{ id: 1 }] });

  const onScanned = vi.fn();
  await findFirstAvailableDate(DATES, fetchSlots, TODAY, onScanned);
  expect(onScanned).toHaveBeenCalledWith('2026-03-22', false);
  expect(onScanned).toHaveBeenCalledWith('2026-03-23', true);
  expect(onScanned).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 7: Run all tests**

```bash
cd /Users/felipevalor/Downloads/turnos-psicologos/frontend && npx vitest run src/test/patient-view-autoskip.test.ts
```

Expected: PASS (all 5 tests)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/WeekStrip.tsx frontend/src/pages/PatientView.tsx frontend/src/test/patient-view-autoskip.test.ts
git commit -m "feat(ux): add availability dots to week strip"
```

---

## Task 3: Show psychologist identity above the slot card

**Problem:** There is zero context about who the psychologist is on the patient booking page. The `psychologistContact` state is already fetched (via `getContact()`) but only used for WhatsApp in policy modals. Adding name + session duration creates trust and answers the patient's first question.

**Files:**
- Modify: `frontend/src/pages/PatientView.tsx`

**Note:** `getContact()` returns `{ nombre: string; whatsapp_number: string | null }`. Session duration comes from `Psychologist` type but isn't in the contact API. We'll show what we have: name only. If you want duration, the admin API would need extending — skip for now (YAGNI).

- [ ] **Step 1: Add the identity banner between `<main>` and the booking success banner**

In `PatientView.tsx`, after `<main className="max-w-2xl mx-auto px-4 py-5 space-y-4">` and before `{bookingSuccess && ...}`, insert:

```tsx
{/* Psychologist identity */}
{psychologistContact && (
  <div className="flex items-center gap-3 px-1">
    <div className="w-10 h-10 rounded-full bg-[#1a2e4a]/10 flex items-center justify-center flex-none">
      <svg className="w-5 h-5 text-[#1a2e4a]/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    </div>
    <div>
      <p className="text-sm font-bold text-[#1a2e4a]">{psychologistContact.nombre}</p>
      <p className="text-xs text-slate-400">Psicólogo/a · Agendá tu sesión</p>
    </div>
  </div>
)}
```

- [ ] **Step 2: Verify visually**

```bash
# Dev server should already be running. Check http://localhost:5173
```

Screenshot and confirm the banner appears below the header with name visible.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PatientView.tsx
git commit -m "feat(ux): show psychologist identity above slot card"
```

---

## Task 4: Demote "Soy Psicólogo" — stop stealing patient attention

**Problem:** The "Soy Psicólogo" button has `border border-white/40` styling — it looks like a primary CTA for the page. It's a utility link for the psychologist, not the patient. It should recede.

**Files:**
- Modify: `frontend/src/pages/PatientView.tsx`

- [ ] **Step 1: Change the admin link styling from bordered button to subtle text link**

Find this element in `PatientView.tsx`:

```tsx
<a href="/admin" className="text-white border border-white/40 hover:border-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors">
  Soy Psicólogo
</a>
```

Replace with:

```tsx
<a href="/admin" className="text-white/40 hover:text-white/70 text-xs transition-colors">
  Soy Psicólogo
</a>
```

- [ ] **Step 2: Verify the header — confirm the link is still accessible but no longer button-like**

```bash
# Visual check at http://localhost:5173
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PatientView.tsx
git commit -m "feat(ux): demote 'Soy Psicólogo' link — reduce visual competition with patient CTA"
```

---

## Task 5: Copy improvements — micro-copy, phone hint, confirmation message

Three small copy changes grouped together since they're all single-line edits:

### 5a: Add micro-copy orientation above the slot grid

**Files:** `frontend/src/pages/PatientView.tsx`

- [ ] **Step 1: Add instruction subtitle inside the slot section header**

Find this in `PatientView.tsx`:

```tsx
<div className="px-5 pt-5 pb-3 border-b border-slate-50">
  <h2 className="text-base font-bold text-[#1a2e4a] capitalize">
    {selectedDate === today ? 'Hoy' : formatDateShort(selectedDate)}
  </h2>
  <p className="text-xs text-slate-400 mt-0.5 capitalize">{formatDate(selectedDate)}</p>
</div>
```

Replace with:

```tsx
<div className="px-5 pt-5 pb-3 border-b border-slate-50">
  <div className="flex items-baseline justify-between gap-2">
    <h2 className="text-base font-bold text-[#1a2e4a] capitalize">
      {selectedDate === today ? 'Hoy' : formatDateShort(selectedDate)}
    </h2>
    {slots.length > 0 && (
      <span className="text-xs text-slate-400 font-medium">{slots.length} horario{slots.length !== 1 ? 's' : ''}</span>
    )}
  </div>
  <p className="text-xs text-slate-400 mt-0.5 capitalize">{formatDate(selectedDate)}</p>
</div>
```

### 5b: Improve phone field hint in BookingModal

**Files:** `frontend/src/components/BookingModal.tsx`

- [ ] **Step 2: Replace the confusing phone hint**

Find:

```tsx
<p className="text-xs text-slate-400 mt-1">Formato: +5491112345678</p>
```

Replace with:

```tsx
<p className="text-xs text-slate-400 mt-1">Ej: +5491156781234 (código de país + área + número)</p>
```

### 5c: Add email confirmation line to booking success banner

**Files:** `frontend/src/pages/PatientView.tsx`

- [ ] **Step 3: Add confirmation note to the success banner**

Find inside the success banner:

```tsx
<p className="text-xs text-[#1e6e44]/70 mt-0.5">A nombre de {bookingSuccess.patient.name}</p>
```

Replace with:

```tsx
<p className="text-xs text-[#1e6e44]/70 mt-0.5">A nombre de {bookingSuccess.patient.name}</p>
<p className="text-xs text-[#1e6e44]/60 mt-1">Guardá este número de sesión o buscala desde "Mis sesiones" con tu email.</p>
```

- [ ] **Step 4: Commit all copy changes together**

```bash
git add frontend/src/pages/PatientView.tsx frontend/src/components/BookingModal.tsx
git commit -m "feat(ux): add slot count, improve phone hint, add post-booking guidance"
```

---

## Task 6: Pre-fill "Mis sesiones" from localStorage after booking

**Problem:** After a patient books, they have to re-enter their email in "Mis sesiones" to manage their bookings. We already have their email from the booking form — store it in localStorage and pre-fill.

**Files:**
- Modify: `frontend/src/pages/PatientView.tsx`

- [ ] **Step 1: Persist email to localStorage on booking success**

In `PatientView.tsx`, update `handleBookingSuccess`:

```typescript
const handleBookingSuccess = (result: BookingResult, warning?: string, policyHours?: number) => {
  setSelectedSlot(null);
  setBookingSuccess(result);
  setBookingWarning(warning === 'outside_policy' ? { policyHours: policyHours ?? 24 } : null);
  // Remember patient email for "Mis sesiones"
  localStorage.setItem('psi_patient_email', result.patient.email);
  setCancelEmail(result.patient.email);
  loadSlots();
};
```

- [ ] **Step 2: Read from localStorage on mount**

Add to the component initialization (after the existing state declarations):

```typescript
useEffect(() => {
  const saved = localStorage.getItem('psi_patient_email');
  if (saved) setCancelEmail(saved);
}, []);
```

- [ ] **Step 3: Verify — book a session, then open "Mis sesiones" — email should be pre-filled**

Manual verification at `http://localhost:5173` (requires dev server + backend running).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/PatientView.tsx
git commit -m "feat(ux): pre-fill Mis sesiones email from localStorage after booking"
```

---

## Final: Run full test suite

- [ ] **Run all tests**

```bash
cd /Users/felipevalor/Downloads/turnos-psicologos/frontend && npx vitest run
```

Expected: All tests pass including the existing regression tests.

- [ ] **Visual QA — take screenshots at mobile and desktop**

```bash
# With dev server running at localhost:5173
```

Check:
- [ ] Landing on the page → jumps to a day with slots (not "Sin turnos disponibles")
- [ ] Week strip shows green dots on available days, dimmed empty days
- [ ] Psychologist name visible above the slot card
- [ ] "Soy Psicólogo" is tiny/subtle
- [ ] Slot count shown next to date header
- [ ] After booking: success banner shows guidance text; "Mis sesiones" email is pre-filled
