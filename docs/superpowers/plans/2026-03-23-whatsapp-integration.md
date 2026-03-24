# WhatsApp Notification Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send WhatsApp notifications to patients and psychologist on booking, cancellation, reschedule, and daily 24h reminders via the Kapso API.

**Architecture:** A `notifications.ts` lib module wraps the Kapso SDK and exposes four pure async functions. Route handlers call these via `c.executionCtx.waitUntil()` so notifications never block HTTP responses. A Cloudflare Workers cron trigger fires daily at 13:00 UTC to send reminders.

**Tech Stack:** Cloudflare Workers, Hono, TypeScript, `@kapso/whatsapp-cloud-api` SDK, Vitest (unit tests), Cloudflare D1

**Spec:** `docs/superpowers/specs/2026-03-23-whatsapp-integration-design.md`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `worker/src/lib/notifications.ts` | All Kapso WhatsApp logic — 4 exported functions |
| Create | `worker/src/lib/__tests__/notifications.test.ts` | Unit tests for notifications |
| Create | `worker/vitest.config.ts` | Vitest config for worker tests |
| Modify | `worker/package.json` | Add `@kapso/whatsapp-cloud-api` dep + vitest devDep + test script |
| Modify | `worker/src/types.ts` | Add optional `KAPSO_API_KEY` and `KAPSO_PHONE_NUMBER_ID` to `Env` |
| Modify | `wrangler.toml` | Add cron trigger + empty local dev vars |
| Modify | `worker/src/routes/bookings.ts` | Wire `waitUntil` into POST, DELETE, PATCH handlers |
| Modify | `worker/src/index.ts` | Replace `export default app` with object form + `scheduled` handler |

---

## Task 1: Install SDK and test infrastructure

**Files:**
- Modify: `worker/package.json`
- Create: `worker/vitest.config.ts`

- [ ] **Step 1: Install Kapso SDK**

```bash
cd worker && npm install @kapso/whatsapp-cloud-api
```

Expected: `@kapso/whatsapp-cloud-api` added to `dependencies` in `worker/package.json`.

- [ ] **Step 2: Install Vitest**

```bash
cd worker && npm install -D vitest
```

- [ ] **Step 3: Create vitest config**

Create `worker/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Add test script to package.json**

In `worker/package.json`, add to `scripts`:

```json
"test": "vitest run"
```

- [ ] **Step 5: Verify vitest runs (no tests yet)**

```bash
cd worker && npm test
```

Expected: "No test files found" or exit 0 with empty results.

- [ ] **Step 6: Commit**

```bash
git add worker/package.json worker/package-lock.json worker/vitest.config.ts
git commit -m "chore(worker): add @kapso/whatsapp-cloud-api and vitest"
```

---

## Task 2: Add env vars to types and wrangler.toml

**Files:**
- Modify: `worker/src/types.ts`
- Modify: `wrangler.toml`

- [ ] **Step 1: Add optional Kapso env vars to Env type**

In `worker/src/types.ts`, add the two optional fields:

```typescript
export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  ALLOWED_ORIGIN?: string;
  CACHE?: KVNamespace;
  KAPSO_API_KEY?: string;
  KAPSO_PHONE_NUMBER_ID?: string;
};
```

- [ ] **Step 2: Add cron trigger and local dev vars to wrangler.toml**

Append to `wrangler.toml`:

```toml
# WhatsApp notifications via Kapso (local dev only — set real values with `wrangler secret put`)
# KAPSO_API_KEY = ""
# KAPSO_PHONE_NUMBER_ID = ""

[triggers]
crons = ["0 13 * * *"]
```

Note: the correct TOML syntax is `[triggers]` (a section) with `crons` as an array. Do NOT use `[[triggers.crons]]` — that is array-of-tables syntax and will break Wrangler.

Note: keep the vars commented out in wrangler.toml. Real values go in as Cloudflare secrets:
```bash
wrangler secret put KAPSO_API_KEY
wrangler secret put KAPSO_PHONE_NUMBER_ID
```

- [ ] **Step 3: Verify TypeScript still compiles**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/types.ts wrangler.toml
git commit -m "feat(worker): add KAPSO env vars to Env type and cron trigger"
```

---

## Task 3: Create notifications.ts (TDD)

**Files:**
- Create: `worker/src/lib/__tests__/notifications.test.ts`
- Create: `worker/src/lib/notifications.ts`

### Step 1-4: Test and implement `getClient` guard

- [ ] **Step 1: Create test file and write first failing test**

Create `worker/src/lib/__tests__/notifications.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Kapso SDK before importing notifications
const mockSendText = vi.fn().mockResolvedValue(undefined);
vi.mock('@kapso/whatsapp-cloud-api', () => ({
  WhatsAppClient: vi.fn().mockImplementation(() => ({
    messages: { sendText: mockSendText },
  })),
}));

import { sendBookingConfirmation } from '../notifications';
import type { Env } from '../../types';

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    DB: {} as D1Database,
    JWT_SECRET: 'test',
    KAPSO_API_KEY: 'test-key',
    KAPSO_PHONE_NUMBER_ID: '123456',
    ...overrides,
  };
}

const booking = {
  patientName: 'Ana García',
  patientPhone: '+5491112345678',
  date: '2026-03-25',
  startTime: '10:00',
  psychologistName: 'Dr. López',
  psychologistPhone: '+5491187654321',
};

describe('sendBookingConfirmation', () => {
  beforeEach(() => {
    mockSendText.mockClear();
  });

  it('sends nothing when KAPSO_API_KEY is missing', async () => {
    await sendBookingConfirmation(makeEnv({ KAPSO_API_KEY: undefined }), booking);
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('sends nothing when KAPSO_PHONE_NUMBER_ID is missing', async () => {
    await sendBookingConfirmation(makeEnv({ KAPSO_PHONE_NUMBER_ID: undefined }), booking);
    expect(mockSendText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails (module not found)**

```bash
cd worker && npm test
```

Expected: FAIL — `Cannot find module '../notifications'`

- [ ] **Step 3: Create notifications.ts with getClient stub**

Create `worker/src/lib/notifications.ts`:

```typescript
import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import type { Env } from '../types';
import { getLocalISODate } from './date';

export type NotificationBooking = {
  patientName: string;
  patientPhone: string;
  date: string;
  startTime: string;
  psychologistName: string;
  psychologistPhone: string | null;
};

type KapsoClient = {
  client: WhatsAppClient;
  phoneNumberId: string;
};

function getClient(env: Env): KapsoClient | null {
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

function stripPlus(phone: string): string {
  return phone.replace(/^\+/, '');
}

async function send(
  client: WhatsAppClient,
  phoneNumberId: string,
  to: string,
  body: string,
): Promise<void> {
  try {
    await client.messages.sendText({ phoneNumberId, to: stripPlus(to), body });
  } catch (err) {
    console.error('[notifications] sendText failed:', err);
  }
}

export async function sendBookingConfirmation(env: Env, booking: NotificationBooking): Promise<void> {
  const kapso = getClient(env);
  if (!kapso) return;

  const { client, phoneNumberId } = kapso;
  const sends: Promise<void>[] = [
    send(client, phoneNumberId, booking.patientPhone,
      `¡Hola ${booking.patientName}! Tu sesión fue confirmada para el ${booking.date} a las ${booking.startTime} hs. ¡Te esperamos!`),
  ];
  if (booking.psychologistPhone) {
    sends.push(send(client, phoneNumberId, booking.psychologistPhone,
      `Nueva sesión agendada: ${booking.patientName} el ${booking.date} a las ${booking.startTime} hs. Tel: ${booking.patientPhone}`));
  }
  await Promise.allSettled(sends);
}

export async function sendBookingCancellation(
  env: Env,
  booking: NotificationBooking,
  cancelledBy: 'patient' | 'admin',
): Promise<void> {
  const kapso = getClient(env);
  if (!kapso) return;

  const { client, phoneNumberId } = kapso;
  const psychoMsg = cancelledBy === 'patient'
    ? `${booking.patientName} canceló su sesión del ${booking.date} a las ${booking.startTime} hs.`
    : `Cancelaste la sesión de ${booking.patientName} del ${booking.date} a las ${booking.startTime} hs.`;

  const sends: Promise<void>[] = [
    send(client, phoneNumberId, booking.patientPhone,
      `Hola ${booking.patientName}, tu sesión del ${booking.date} a las ${booking.startTime} hs fue cancelada.`),
  ];
  if (booking.psychologistPhone) {
    sends.push(send(client, phoneNumberId, booking.psychologistPhone, psychoMsg));
  }
  await Promise.allSettled(sends);
}

export async function sendBookingReschedule(
  env: Env,
  booking: NotificationBooking,
  rescheduledBy: 'patient' | 'admin',
): Promise<void> {
  const kapso = getClient(env);
  if (!kapso) return;

  const { client, phoneNumberId } = kapso;
  const psychoMsg = rescheduledBy === 'patient'
    ? `${booking.patientName} reprogramó su sesión al ${booking.date} a las ${booking.startTime} hs.`
    : `Reprogramaste la sesión de ${booking.patientName} al ${booking.date} a las ${booking.startTime} hs.`;

  const sends: Promise<void>[] = [
    send(client, phoneNumberId, booking.patientPhone,
      `¡Hola ${booking.patientName}! Tu sesión fue reprogramada al ${booking.date} a las ${booking.startTime} hs.`),
  ];
  if (booking.psychologistPhone) {
    sends.push(send(client, phoneNumberId, booking.psychologistPhone, psychoMsg));
  }
  await Promise.allSettled(sends);
}

type ReminderRow = {
  paciente_nombre: string;
  paciente_telefono: string;
  fecha: string;
  hora_inicio: string;
  nombre: string;
  whatsapp_number: string | null;
};

export async function sendReminders(env: Env): Promise<void> {
  const kapso = getClient(env);
  if (!kapso) return;

  const tomorrow = getLocalISODate(new Date(Date.now() + 86_400_000));
  const rows = await env.DB.prepare(
    `SELECT b.paciente_nombre, b.paciente_telefono,
            s.fecha, s.hora_inicio,
            p.nombre, p.whatsapp_number
     FROM reservas b
     JOIN slots s ON b.slot_id = s.id
     JOIN psicologos p ON s.psicologo_id = p.id
     WHERE s.fecha = ?
     AND s.disponible = 0`,
  ).bind(tomorrow).all<ReminderRow>();

  const { client, phoneNumberId } = kapso;
  await Promise.allSettled(
    rows.results.flatMap((row) => {
      const sends: Promise<void>[] = [
        send(client, phoneNumberId, row.paciente_telefono,
          `¡Hola ${row.paciente_nombre}! Te recordamos que mañana tenés sesión a las ${row.hora_inicio} hs con ${row.nombre}. ¡Hasta mañana!`),
      ];
      if (row.whatsapp_number) {
        sends.push(send(client, phoneNumberId, row.whatsapp_number,
          `Recordatorio: sesión con ${row.paciente_nombre} mañana a las ${row.hora_inicio} hs.`));
      }
      return sends;
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify getClient guard tests pass**

```bash
cd worker && npm test
```

Expected: 2 tests PASS.

### Step 5-8: Test and verify sendBookingConfirmation sends correct messages

- [ ] **Step 5: Add message content tests to the test file**

Append to `worker/src/lib/__tests__/notifications.test.ts`:

```typescript
  it('sends patient confirmation with correct message', async () => {
    await sendBookingConfirmation(makeEnv(), booking);
    expect(mockSendText).toHaveBeenCalledWith({
      phoneNumberId: '123456',
      to: '5491112345678',
      body: '¡Hola Ana García! Tu sesión fue confirmada para el 2026-03-25 a las 10:00 hs. ¡Te esperamos!',
    });
  });

  it('sends psychologist confirmation with phone stripped of +', async () => {
    await sendBookingConfirmation(makeEnv(), booking);
    expect(mockSendText).toHaveBeenCalledWith({
      phoneNumberId: '123456',
      to: '5491187654321',
      body: 'Nueva sesión agendada: Ana García el 2026-03-25 a las 10:00 hs. Tel: +5491112345678',
    });
  });

  it('skips psychologist message when psychologistPhone is null', async () => {
    await sendBookingConfirmation(makeEnv(), { ...booking, psychologistPhone: null });
    expect(mockSendText).toHaveBeenCalledTimes(1);
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: '5491112345678' }),
    );
  });
```

- [ ] **Step 6: Run tests — verify they pass**

```bash
cd worker && npm test
```

Expected: 5 tests PASS.

### Step 9-12: Test sendBookingCancellation

- [ ] **Step 7: Add cancellation tests**

Append to the test file:

```typescript
import { sendBookingCancellation } from '../notifications';

describe('sendBookingCancellation', () => {
  beforeEach(() => mockSendText.mockClear());

  it('sends patient cancellation message', async () => {
    await sendBookingCancellation(makeEnv(), booking, 'patient');
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '5491112345678',
        body: 'Hola Ana García, tu sesión del 2026-03-25 a las 10:00 hs fue cancelada.',
      }),
    );
  });

  it('sends psychologist message with patient name when patient cancels', async () => {
    await sendBookingCancellation(makeEnv(), booking, 'patient');
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '5491187654321',
        body: 'Ana García canceló su sesión del 2026-03-25 a las 10:00 hs.',
      }),
    );
  });

  it('sends admin-specific psychologist message when admin cancels', async () => {
    await sendBookingCancellation(makeEnv(), booking, 'admin');
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '5491187654321',
        body: 'Cancelaste la sesión de Ana García del 2026-03-25 a las 10:00 hs.',
      }),
    );
  });
});
```

- [ ] **Step 8: Run tests — verify they pass**

```bash
cd worker && npm test
```

Expected: 8 tests PASS.

### Step 9-10: Test sendBookingReschedule

- [ ] **Step 9: Add reschedule tests**

Append to the test file:

```typescript
import { sendBookingReschedule } from '../notifications';

describe('sendBookingReschedule', () => {
  beforeEach(() => mockSendText.mockClear());

  it('sends patient reschedule message', async () => {
    await sendBookingReschedule(makeEnv(), booking, 'patient');
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '5491112345678',
        body: '¡Hola Ana García! Tu sesión fue reprogramada al 2026-03-25 a las 10:00 hs.',
      }),
    );
  });

  it('sends patient-initiated message to psychologist', async () => {
    await sendBookingReschedule(makeEnv(), booking, 'patient');
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Ana García reprogramó su sesión al 2026-03-25 a las 10:00 hs.',
      }),
    );
  });

  it('sends admin-initiated message to psychologist', async () => {
    await sendBookingReschedule(makeEnv(), booking, 'admin');
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Reprogramaste la sesión de Ana García al 2026-03-25 a las 10:00 hs.',
      }),
    );
  });
});
```

- [ ] **Step 10: Run all tests**

```bash
cd worker && npm test
```

Expected: 11 tests PASS.

- [ ] **Step 11: Verify TypeScript compiles**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors. If `@kapso/whatsapp-cloud-api` types are missing, add `skipLibCheck: true` is already in tsconfig — should be fine.

- [ ] **Step 12: Commit**

```bash
git add worker/src/lib/notifications.ts worker/src/lib/__tests__/notifications.test.ts
git commit -m "feat(worker): add notifications lib with Kapso WhatsApp integration"
```

---

## Task 4: Wire notifications into POST /api/bookings

**Files:**
- Modify: `worker/src/routes/bookings.ts`

The `POST /api/bookings` handler has two success paths (both return 201):
1. Normal booking — line ~191
2. `outside_policy` booking — line ~187 (patient booked but outside the time window)

Both paths represent a completed booking and must send the notification. The `waitUntil` call must happen before both returns.

**When to fetch psychologist fields:**
- Patient path (`isPsychologist === false`): reuse `policy` query result (already fetches `nombre` and `whatsapp_number`)
- Admin path (`isPsychologist === true`): `policy` is never queried — must do a dedicated `SELECT nombre, whatsapp_number FROM psicologos WHERE id = ?`

- [ ] **Step 1: Add the import**

At the top of `worker/src/routes/bookings.ts`, add:

```typescript
import { sendBookingConfirmation } from '../lib/notifications';
import type { NotificationBooking } from '../lib/notifications';
```

- [ ] **Step 2: Add psychologist fetch helper query inside the POST handler**

After the D1 batch succeeds and `bookingId` is set, add this block (replace the existing policy fetch block logic):

```typescript
// Fetch psychologist fields for notification (and policy check for patient path)
const psyRow = await c.env.DB.prepare(
  'SELECT nombre, whatsapp_number, booking_min_hours, policy_unit FROM psicologos WHERE id = ?',
).bind(slot.psicologo_id).first<PolicyRow>();

const notifBooking: NotificationBooking = {
  patientName: patient_name,
  patientPhone: patient_phone,
  date: slot.fecha,
  startTime: slot.hora_inicio,
  psychologistName: psyRow?.nombre ?? '',
  psychologistPhone: psyRow?.whatsapp_number ?? null,
};

c.executionCtx.waitUntil(sendBookingConfirmation(c.env, notifBooking));
```

Then apply the policy check using `psyRow` (replacing the previous `policy` variable):

```typescript
if (!isPsychologist) {
  const booking_min_hours = psyRow?.booking_min_hours ?? 24;
  const unit = psyRow?.policy_unit ?? 'hours';
  const thresholdHours = toHours(booking_min_hours, unit);
  const slotDatetime = new Date(`${slot.fecha}T${slot.hora_inicio}:00-03:00`);
  const diffHours = (slotDatetime.getTime() - Date.now()) / (1000 * 60 * 60);
  if (thresholdHours > 0 && diffHours < thresholdHours) {
    return c.json({ success: true, data: bookingData, warning: 'outside_policy', policy_hours: booking_min_hours, psychologist_name: psyRow?.nombre ?? '' }, 201);
  }
}

return c.json({ success: true, data: bookingData }, 201);
```

Note: the `waitUntil` call before both returns ensures the notification fires on the `outside_policy` path too.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/bookings.ts
git commit -m "feat(bookings): send WhatsApp confirmation on booking created"
```

---

## Task 5: Wire notifications into DELETE /api/bookings/:id

**Files:**
- Modify: `worker/src/routes/bookings.ts`

The `DELETE` handler's policy block (which fetches `nombre`/`whatsapp_number`) only runs when `!isPsychologist`. For both patient and admin paths, a dedicated psychologist fetch is needed before sending the notification.

- [ ] **Step 1: Add the import for sendBookingCancellation**

Add to the existing notifications import line at the top of `bookings.ts`:

```typescript
import { sendBookingConfirmation, sendBookingCancellation } from '../lib/notifications';
```

- [ ] **Step 2: Add notification call after the D1 batch in DELETE handler**

After the `await c.env.DB.batch([...])` that deletes the booking, add:

```typescript
// Fetch psychologist fields for notification
const psyForNotif = await c.env.DB.prepare(
  'SELECT nombre, whatsapp_number FROM psicologos WHERE id = ?',
).bind(booking.psicologo_id).first<{ nombre: string; whatsapp_number: string | null }>();

const cancelNotif: NotificationBooking = {
  patientName: booking.paciente_nombre ?? '',
  patientPhone: booking.paciente_telefono,
  date: booking.fecha,
  startTime: booking.hora_inicio,
  psychologistName: psyForNotif?.nombre ?? '',
  psychologistPhone: psyForNotif?.whatsapp_number ?? null,
};
c.executionCtx.waitUntil(
  sendBookingCancellation(c.env, cancelNotif, isPsychologist ? 'admin' : 'patient'),
);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/bookings.ts
git commit -m "feat(bookings): send WhatsApp notification on booking cancelled"
```

---

## Task 6: Wire notifications into PATCH /api/bookings/:id

**Files:**
- Modify: `worker/src/routes/bookings.ts`

For reschedule, `NotificationBooking.date` and `startTime` must use `newSlot.fecha` and `newSlot.hora_inicio` (the appointment the patient is being moved to).

- [ ] **Step 1: Update import to include sendBookingReschedule**

```typescript
import { sendBookingConfirmation, sendBookingCancellation, sendBookingReschedule } from '../lib/notifications';
```

- [ ] **Step 2: Add notification call after the D1 batch in PATCH handler**

After the successful batch (after `const newBookingId = results[4].meta.last_row_id`), before the `return c.json(...)`:

```typescript
// Fetch psychologist fields for notification
const psyForReschedNotif = await c.env.DB.prepare(
  'SELECT nombre, whatsapp_number FROM psicologos WHERE id = ?',
).bind(oldBooking.psicologo_id).first<{ nombre: string; whatsapp_number: string | null }>();

const reschedNotif: NotificationBooking = {
  patientName: oldBooking.paciente_nombre,
  patientPhone: oldBooking.paciente_telefono,
  date: newSlot.fecha,          // NEW slot — not oldBooking
  startTime: newSlot.hora_inicio, // NEW slot — not oldBooking
  psychologistName: psyForReschedNotif?.nombre ?? '',
  psychologistPhone: psyForReschedNotif?.whatsapp_number ?? null,
};
c.executionCtx.waitUntil(
  sendBookingReschedule(c.env, reschedNotif, isPsychologist ? 'admin' : 'patient'),
);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/bookings.ts
git commit -m "feat(bookings): send WhatsApp notification on booking rescheduled"
```

---

## Task 7: Update index.ts export + scheduled handler

**Files:**
- Modify: `worker/src/index.ts`

Currently `worker/src/index.ts` ends with `export default app`. This must be replaced with an object form that includes both the `fetch` handler and the `scheduled` cron handler. **`app.fetch` must be bound** — omitting `.bind(app)` will cause a `this` context error at runtime.

- [ ] **Step 1: Add sendReminders import**

At the top of `worker/src/index.ts`, add:

```typescript
import { sendReminders } from './lib/notifications';
```

- [ ] **Step 2: Replace the export**

Replace:

```typescript
export default app;
```

With:

```typescript
export default {
  fetch: app.fetch.bind(app),
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await sendReminders(env);
  },
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors. If `ScheduledEvent` is not found, it is part of `@cloudflare/workers-types` — already in tsconfig types.

- [ ] **Step 4: Run all tests one final time**

```bash
cd worker && npm test
```

Expected: 11 tests PASS.

- [ ] **Step 5: Smoke test locally**

```bash
# From project root
npx wrangler dev --remote
```

Make a test booking at http://localhost:5173. If KAPSO env vars are empty, expect the warning log `[notifications] KAPSO_API_KEY or KAPSO_PHONE_NUMBER_ID not set — skipping` in Wrangler output — this is correct behavior for local dev without credentials.

- [ ] **Step 6: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): add scheduled cron handler for 24h WhatsApp reminders"
```

---

## Task 8: Set production secrets

This task is manual — run in your terminal after deploying.

- [ ] **Step 1: Set Kapso API key as a Cloudflare secret**

```bash
wrangler secret put KAPSO_API_KEY
# Paste your key from the Kapso dashboard when prompted
```

- [ ] **Step 2: Set phone number ID**

```bash
wrangler secret put KAPSO_PHONE_NUMBER_ID
# Paste your WhatsApp Business phone number ID from Kapso
```

- [ ] **Step 3: Deploy**

```bash
npx wrangler deploy
```

- [ ] **Step 4: Verify cron is registered**

```bash
npx wrangler triggers list
```

Expected: `0 13 * * *` listed under cron triggers.

- [ ] **Step 5: Test a live booking**

Book a test session through the public URL. Verify:
- Patient receives WhatsApp confirmation
- Psychologist receives WhatsApp alert

---

## Done

The integration is complete when:
- [ ] All 11 unit tests pass
- [ ] TypeScript compiles with no errors
- [ ] Booking, cancellation, and reschedule each fire notifications via `waitUntil`
- [ ] Cron trigger registered in Cloudflare
- [ ] Production secrets set via `wrangler secret put`
