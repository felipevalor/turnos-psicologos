# WhatsApp Notification Integration — Design Spec

**Date:** 2026-03-23
**Status:** Approved
**Author:** CTO

---

## Overview

Integrate Kapso's WhatsApp API into the booking flow so that both the patient and the psychologist receive real-time notifications on every booking lifecycle event, plus a 24-hour session reminder.

---

## Goals

- Patient receives a WhatsApp confirmation, cancellation, reschedule notice, and 24h reminder.
- Psychologist receives the same four notification types for visibility.
- Notifications are fire-and-forget: they never block or delay the HTTP response to the caller.
- Failures are logged but never surface as errors to patients.

---

## Non-goals

- Two-way replies / conversation handling (out of scope for now).
- Rich media messages (images, templates). Plain text only for v1.
- Delivery receipts or read confirmations.

---

## Architecture

### New files

| File | Purpose |
|------|---------|
| `worker/src/lib/notifications.ts` | All Kapso WhatsApp logic. Exports four functions: `sendBookingConfirmation`, `sendBookingCancellation`, `sendBookingReschedule`, `sendReminders`. |

### Modified files

| File | Change |
|------|--------|
| `worker/src/types.ts` | Add `KAPSO_API_KEY?: string` and `KAPSO_PHONE_NUMBER_ID?: string` to `Env` (optional — see Environment Variables section). |
| `worker/src/routes/bookings.ts` | Call notification functions via `c.executionCtx.waitUntil()` after successful DB operations in POST (booking), DELETE (cancel), and PATCH (reschedule). |
| `worker/src/index.ts` | Replace `export default app` with an object that exports both `fetch` and `scheduled` handlers. |
| `wrangler.toml` | Add cron trigger `0 13 * * *` (13:00 UTC = 10:00 AM Buenos Aires). |

---

## Notification Functions

All functions in `notifications.ts` must guard for missing env vars:

```typescript
function getClient(env: Env): { client: WhatsAppClient; phoneNumberId: string } | null {
  if (!env.KAPSO_API_KEY || !env.KAPSO_PHONE_NUMBER_ID) {
    console.warn('[notifications] KAPSO_API_KEY or KAPSO_PHONE_NUMBER_ID not set — skipping');
    return null;
  }
  return {
    client: new WhatsAppClient({
      baseUrl: 'https://api.kapso.ai/meta/whatsapp',
      kapsoApiKey: env.KAPSO_API_KEY,
    }),
    phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
  };
}
```

`KAPSO_PHONE_NUMBER_ID` is passed per-send call (not in the constructor). Each `sendText` call uses it:

```typescript
const kapso = getClient(env);
if (!kapso) return;
await kapso.client.messages.sendText({
  phoneNumberId: kapso.phoneNumberId,
  to: patient_phone.replace(/^\+/, ''),
  body: '...',
});
```
```

If `getClient` returns `null`, the notification function returns early without throwing.

Phone numbers are stored as `+549XXXXXXXX`. Kapso expects the number without the `+` prefix. Strip with `phone.replace(/^\+/, '')`.

If the psychologist's `whatsapp_number` is `null`, skip their notification silently.

---

## Notification Parameter Shape

All notification functions receive a `booking` object of the following shape (the route handler is responsible for assembling this before calling `waitUntil`):

```typescript
type NotificationBooking = {
  patientName: string;
  patientPhone: string;       // stored format: +549XXXXXXXX
  date: string;               // YYYY-MM-DD — for reschedule, use the NEW slot's fecha
  startTime: string;          // HH:MM     — for reschedule, use the NEW slot's hora_inicio
  psychologistName: string;   // fetched from psicologos.nombre
  psychologistPhone: string | null; // fetched from psicologos.whatsapp_number
};
```

**Fetching psychologist fields:**

- **POST /api/bookings (patient path):** the policy query already fetches `nombre` and `whatsapp_number` — reuse that result.
- **POST /api/bookings (admin path, `isPsychologist === true`):** the policy block is skipped entirely, so a dedicated query is required: `SELECT nombre, whatsapp_number FROM psicologos WHERE id = ?` bound to `slot.psicologo_id`.
- **DELETE and PATCH routes:** same as the admin path — a dedicated query is needed regardless of `isPsychologist`, since the policy block (which fetches these fields) is only executed when `isPsychologist === false`.

**Reschedule date/time:** `NotificationBooking.date` and `startTime` must be populated from `newSlot.fecha` and `newSlot.hora_inicio` — not from `oldBooking`. The patient needs to know when their new appointment is.

---

### `sendBookingConfirmation(env, booking)`

Triggered after a successful `POST /api/bookings`.

**Patient message:**
```
¡Hola {patient_name}! Tu sesión fue confirmada para el {date} a las {start_time} hs. ¡Te esperamos!
```

**Psychologist message:**
```
Nueva sesión agendada: {patient_name} el {date} a las {start_time} hs. Tel: {patient_phone}
```

Both sends happen via `Promise.allSettled` — failure of one does not block the other.

---

### `sendBookingCancellation(env, booking, cancelledBy)`

Triggered after a successful `DELETE /api/bookings/:id`.

`cancelledBy`: `'patient' | 'admin'`

**Patient message:**
```
Hola {patient_name}, tu sesión del {date} a las {start_time} hs fue cancelada.
```

**Psychologist message (patient-initiated):**
```
{patient_name} canceló su sesión del {date} a las {start_time} hs.
```

**Psychologist message (admin-initiated):**
```
Cancelaste la sesión de {patient_name} del {date} a las {start_time} hs.
```

---

### `sendBookingReschedule(env, booking, rescheduledBy)`

Triggered after a successful `PATCH /api/bookings/:id`.

`rescheduledBy`: `'patient' | 'admin'`

**Patient message:**
```
¡Hola {patient_name}! Tu sesión fue reprogramada al {date} a las {start_time} hs.
```

**Psychologist message (patient-initiated):**
```
{patient_name} reprogramó su sesión al {date} a las {start_time} hs.
```

**Psychologist message (admin-initiated):**
```
Reprogramaste la sesión de {patient_name} al {date} a las {start_time} hs.
```

---

### `sendReminders(env)`

Triggered daily by the cron at 13:00 UTC (10:00 AM Buenos Aires, UTC-3, no DST).

**"Tomorrow" date calculation:**

```typescript
import { getLocalISODate } from './date';
const tomorrow = getLocalISODate(new Date(Date.now() + 86_400_000));
```

Using `getLocalISODate` (which applies UTC-3 offset) ensures the correct Buenos Aires date is used throughout the day, including in the 21:00–00:00 UTC window where a naive UTC date would be wrong.

**SQL query:**

```sql
SELECT b.paciente_nombre, b.paciente_telefono,
       s.fecha, s.hora_inicio,
       p.nombre, p.whatsapp_number
FROM reservas b
JOIN slots s ON b.slot_id = s.id
JOIN psicologos p ON s.psicologo_id = p.id
WHERE s.fecha = ?
AND s.disponible = 0
```

Bind with `tomorrow`. The `disponible = 0` filter is a safety net for data inconsistencies — in normal operation all rows in `reservas` correspond to booked (unavailable) slots, but the filter prevents ghost reminders if data ever gets into an inconsistent state.

**Processing:** results are processed with `Promise.allSettled` so a failure on one patient/psychologist pair does not prevent the others from being sent.

**Patient message:**
```
¡Hola {patient_name}! Te recordamos que mañana tenés sesión a las {start_time} hs con {psychologist_name}. ¡Hasta mañana!
```

**Psychologist message:**
```
Recordatorio: sesión con {patient_name} mañana a las {start_time} hs.
```

---

## `index.ts` Export Change

The current `export default app` must be replaced with an object form. Because `app.fetch` is an instance method, it must be bound:

```typescript
export default {
  fetch: app.fetch.bind(app),
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await sendReminders(env);
  },
};
```

Omitting `.bind(app)` will cause all HTTP routes to fail at runtime with a `this` binding error.

---

## `ctx.waitUntil` in Route Handlers

Inside Hono route handlers, the execution context is accessed via `c.executionCtx`, not a `ctx` variable. The correct pattern:

```typescript
c.executionCtx.waitUntil(sendBookingConfirmation(c.env, bookingData));
```

This must be called after the DB operation succeeds and before **each** `return c.json(...)` call.

**Important for `POST /api/bookings`:** there are two success return paths — the normal 201 and the `outside_policy` 201 warning. Both represent a completed booking and both must call `waitUntil`. The notification must fire on both paths:

```typescript
c.executionCtx.waitUntil(sendBookingConfirmation(c.env, notificationBooking));
if (outsidePolicy) {
  return c.json({ success: true, ..., warning: 'outside_policy' }, 201);
}
return c.json({ success: true, ... }, 201);
```

The Worker runtime flushes pending `waitUntil` promises after the response is sent.

---

## Cron Trigger

In `wrangler.toml`:

```toml
[[triggers.crons]]
crons = ["0 13 * * *"]
```

---

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `KAPSO_API_KEY` | `string \| undefined` | API key from Kapso dashboard |
| `KAPSO_PHONE_NUMBER_ID` | `string \| undefined` | WhatsApp Business phone number ID from Kapso |

**Important:** These are optional in `Env` so the app works locally without Kapso credentials — notifications are simply skipped with a warning log.

For production: set via `wrangler secret put KAPSO_API_KEY` — never commit real values to `wrangler.toml`.

For local dev only (no real key needed to test booking flow): add a placeholder in `wrangler.toml` `[vars]`:

```toml
# local dev only — never use real keys here
KAPSO_API_KEY = ""
KAPSO_PHONE_NUMBER_ID = ""
```

---

## Error Handling

- All Kapso calls are wrapped in `try/catch`. Errors are logged via `console.error` and silently swallowed.
- `c.executionCtx.waitUntil()` is used in route handlers so notifications run after the HTTP response is sent, adding zero latency to the patient experience.
- `Promise.allSettled` is used throughout so a failure on one send does not prevent the other.
- Missing env vars cause an early return with a warning log, not a thrown error.

---

## SDK

```
npm install @kapso/whatsapp-cloud-api
```

Install from the `worker/` directory (or root, depending on project structure).

---

## Out of scope (future)

- Reminder opt-out (patient unsubscribes from reminders).
- WhatsApp message templates (for higher delivery rates with Meta-approved templates).
- Multi-psychologist support (currently single-psychologist app).
