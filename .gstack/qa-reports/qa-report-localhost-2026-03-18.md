# QA Report — Turnos Psico
**URL:** http://localhost:5175  
**Date:** 2026-03-18  
**Branch:** main  
**Tester:** /qa (Standard tier)  
**Duration:** ~40 min  
**Pages tested:** 12  
**Screenshots:** 32  
**Framework:** React + Vite (SPA, React Router v6)

---

## Summary

| Severity | Found | Fixed | Deferred |
|----------|-------|-------|----------|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 2 | 0 | 2 |
| Low | 3 | 0 | 3 |
| **Total** | **5** | **0** | **5** |

**Health Score: 78/100**  
**Ship-readiness:** CONDITIONALLY READY — 0 critical/high blockers; 2 medium issues should be fixed before wide release.

---

## Health Score Breakdown

| Category | Score | Weight | Weighted |
|----------|-------|--------|---------|
| Console | 70 | 15% | 10.5 |
| Links | 100 | 10% | 10.0 |
| Visual | 92 | 10% | 9.2 |
| Functional | 88 | 20% | 17.6 |
| UX | 76 | 15% | 11.4 |
| Performance | 90 | 10% | 9.0 |
| Content | 90 | 5% | 4.5 |
| Accessibility | 75 | 15% | 11.25 |
| **Total** | | | **83.5 → 78** |

*Rounded down due to mobile layout penalty.*

---

## Top 3 Things to Fix

1. **ISSUE-001** — Reschedule modal defaults to today, making all slots appear unavailable (patients see empty calendar and can't reschedule)
2. **ISSUE-002** — Time inputs show 12h AM/PM format in "Crear Sobreturno" and Configuración → Horario semanal; psychologist expects 24h
3. **ISSUE-004** — Mobile day-view slot cards have 3 buttons + status label cramped at 375px, causing layout overflow

---

## Issues

### ISSUE-001 — Reschedule modal defaults to today with no available slots
**Severity:** Medium  
**Category:** UX  
**Status:** Deferred  

**Description:** When a patient clicks "Reprogramar" on an existing session, the reschedule modal opens with the date set to today. Because the booking policy requires ≥24h advance booking, today's slots never appear. Patients see an empty slot list and cannot complete the reschedule flow without manually picking a future date.

**Repro:**
1. Book a session as a patient
2. Go to "Mis sesiones", find the booking
3. Click "Reprogramar"
4. Modal opens showing today's date → "Sin turnos disponibles"

**Fix:** Default the reschedule modal date to tomorrow (today + 1 day), or to the first day that has available slots.

---

### ISSUE-002 — Time inputs use 12h AM/PM format
**Severity:** Medium  
**Category:** UX / Content  
**Status:** Deferred  

**Description:** All `<input type="time">` fields render in macOS/Safari 12-hour AM/PM format ("10:00 AM"). This affects:
- "Crear Sobreturno" → Hora de inicio
- Configuración → Horario semanal → Hora inicio / Hora fin

The psychologist works with a 24h schedule. Inputting "7:00 PM" instead of "19:00" is error-prone.

**Repro:**
1. Admin → Crear Sobreturno → observe "Hora de inicio" field shows "--:-- --"
2. Admin → Configuración → Horario semanal → observe time fields

**Fix:** Add `step="1"` and ensure consistent display, or use a custom time picker. Alternatively, accept both formats and normalize on submit.

---

### ISSUE-003 — Error message leaks backend field names
**Severity:** Low  
**Category:** Content  
**Status:** Deferred  

**Description:** Submitting "Crear Sobreturno" with empty fields shows: `"date y start_time son requeridos"`. The field names `date` and `start_time` are internal backend names, not user-facing labels. Message mixes English identifiers with Spanish sentence.

**Repro:**
1. Admin → Crear Sobreturno → click "Crear turno" without filling fields
2. See error: "date y start_time son requeridos"

**Fix:** Map backend field names to Spanish labels in the error handler. E.g.: `"Fecha y Hora de inicio son requeridos"`.

---

### ISSUE-004 — Mobile day-view slot cards layout overflow
**Severity:** Low  
**Category:** Visual / UX  
**Status:** Deferred  

**Description:** On 375px width (iPhone SE), admin day-view slot cards show 3 action buttons (+ Agregar, Bloquear, Borrar) that wrap awkwardly. The "Oculto al paciente" orange label overlaps with button positioning.

**Repro:**
1. Open admin on 375px viewport
2. Navigate to Agenda → click any weekday → Day view
3. Observe slot card button layout

**Fix:** On mobile, use a compact slot card design — perhaps an overflow menu (⋯) or show only the most important action per slot.

---

### ISSUE-005 — React Router v7 future flag warnings
**Severity:** Low  
**Category:** Console  
**Status:** Deferred  

**Description:** Console shows 2 React Router v6→v7 migration warnings on every page load:
- `v7_startTransition`
- `v7_relativeSplatPath`

Not user-visible but pollutes console and will become errors when upgrading.

**Fix:** Add `future` flags to `<BrowserRouter>` or `createBrowserRouter` config:
```jsx
future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
```

---

## Console Health

| Page | Errors | Warnings |
|------|--------|----------|
| Patient view | 0 | 2 (React Router) |
| Admin Dashboard | 0 | 2 (React Router) |
| Admin Agenda | 0 | 2 (React Router) |
| Crear Sobreturno | 1 (400 Bad Request on empty submit) | 2 (React Router) |
| Configuración | 0 | 2 (React Router) |

The 400 error on empty sobreturno submit is expected behavior (server validation), not a bug.

---

## Pages Tested

| Page | Status | Notes |
|------|--------|-------|
| Patient home / slot picker | ✅ | Date nav, slot selection, booking flow all work |
| Patient booking confirmation | ✅ | Confirmation message correct |
| Patient "Mis sesiones" | ✅ | Email search, session list, cancel/reschedule buttons visible |
| Patient reschedule modal | ⚠️ | ISSUE-001: defaults to today |
| Admin login | ✅ | JWT stored, redirect to dashboard |
| Admin Dashboard | ✅ | Metrics load correctly |
| Admin Agenda (week view) | ✅ | Week grid, slot counts, legend |
| Admin Agenda (day view) | ✅ | Slot list with + Agregar/Bloquear/Borrar |
| Admin Crear Sobreturno | ✅ | Individual slot creation works; overlap detection works |
| Admin Sesiones Agendadas | ✅ | Booking list loads |
| Admin Pacientes Recurrentes | ✅ | Recurring patient form visible |
| Admin Configuración | ✅ | Schedule config, booking policies load |
| Mobile patient view (375px) | ✅ | Responsive, clean layout |
| Mobile admin (375px) | ⚠️ | ISSUE-004: day-view button overflow |

---

## PR Summary
> QA found 5 issues (0 critical, 0 high, 2 medium, 3 low). No blockers. Health score: 78/100. App is conditionally ready for beta users — fix ISSUE-001 (reschedule default date) and ISSUE-002 (AM/PM time format) before wide release.

