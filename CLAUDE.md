# Turnos Psico — Context for Claude Code

## Product
Appointment scheduling system for a single psychologist.
Patients self-manage their sessions (book, cancel, reschedule) via a public view.
The psychologist manages availability, recurring bookings, and schedule via an admin dashboard.

## Credentials
email: admin@turnospsi.com
password: admin123

## Repo structure
```
turnos-psicologos-1/
├── frontend/        # React + Vite + TypeScript
├── worker/          # Cloudflare Worker (Hono) + TypeScript
│   └── src/
│       ├── routes/  # API route handlers
│       ├── lib/     # jwt.ts, password.ts, notifications.ts, date.ts, etc.
│       └── db/      # schema.sql
└── wrangler.toml
```

## Stack
- **Frontend**: React, Vite, TypeScript
- **Backend**: Cloudflare Workers, Hono
- **Database**: Cloudflare D1 (SQLite)
- **Auth**: JWT stored in localStorage as `psi_token`
- **Notifications**: WhatsApp via Kapso (`@kapso/whatsapp-cloud-api`) — fire-and-forget via `c.executionCtx.waitUntil()`
- **Deployment**: `wrangler deploy` from root (requires `nodejs_compat` flag — already set in `wrangler.toml`)

## Local development
- Worker: `npx wrangler dev --remote` → localhost:8787
- Frontend: `npm run dev` inside /frontend → localhost:5173
- Vite proxies `/api/*` to `localhost:8787`
- If 401 errors after starting locally: clear `psi_token` from localStorage and log in again

## Database schema (production — Cloudflare D1)
These are the EXACT table and column names. Never reference any other names.
**NOTE: `worker/src/db/schema.sql` is now exactly synchronized with production. Any future schema changes MUST be applied to both `schema.sql` and production D1 simultaneously.**
**Last migration applied: `migration_patients.sql` (2026-03-24)**

```sql
-- Main auth table
psicologos: id, nombre, email, password_hash, session_duration_minutes,
            cancel_min_hours (default 48), reschedule_min_hours (default 48),
            booking_min_hours (default 24), whatsapp_number (nullable TEXT),
            policy_unit TEXT DEFAULT 'hours'  -- 'minutes' | 'hours' | 'days'

-- Availability slots
slots: id, psicologo_id, fecha, hora_inicio, hora_fin, disponible

-- Patient bookings
reservas: id, slot_id, paciente_nombre, paciente_email, paciente_telefono, created_at

-- Weekly availability template (uses English column names; psychologist_id references psicologos(id))
weekly_schedule: id, psychologist_id, day_of_week, start_time, end_time, active

-- Holiday exceptions (uses English column names; psychologist_id references psicologos(id))
holiday_overrides: id, psychologist_id, date

-- Recurring patient sessions (uses English column names; psychologist_id references psicologos(id))
recurring_bookings: id, psychologist_id, patient_name, patient_email, patient_phone,
                    frequency_weeks, start_date, time, active, created_at

-- Cancellation audit log (inserted on cancel and reschedule, never deleted)
cancellations: id, psicologo_id, slot_id, slot_fecha, slot_hora_inicio,
               paciente_nombre, paciente_email, paciente_telefono,
               reason TEXT ('patient_cancel'|'admin_cancel'|'reschedule'),
               cancelled_at TEXT DEFAULT (datetime('now'))

-- Manual patient directory
patients: id, psicologo_id, nombre, email, telefono DEFAULT '', created_at NOT NULL
          UNIQUE(psicologo_id, email)
```

### Critical naming rules
- `psicologos` uses `nombre` (not `name`), `psicologo_id` in foreign keys
- `slots` has NO `created_at`, NO `recurring_booking_id`
- `reservas` has NO `recurring_booking_id`
- `weekly_schedule`, `holiday_overrides`, `recurring_bookings` use `psychologist_id` (English), which references `psicologos(id)`
- `cancellations` uses `psicologo_id` (Spanish, like `slots`); `slot_fecha` and `slot_hora_inicio` are denormalized from the slot at cancel time — do NOT join back to `slots` for historical reporting
- `patients` uses `psicologo_id` (like `slots`); `email` is UNIQUE per psychologist; manually-added patients only
- `time` and `date` are SQLite reserved words — always quote them: `"time"`, `"date"`
- Never assume a column exists — check this schema first

## Timezone
- Buenos Aires (America/Buenos_Aires, UTC-3, no DST)
- Store all datetimes in UTC internally
- Convert to America/Buenos_Aires only for display

## WhatsApp notifications (`worker/src/lib/notifications.ts`)
- Triggered via `c.executionCtx.waitUntil()` in bookings routes — never blocks the HTTP response
- Four exported functions: `sendBookingConfirmation`, `sendBookingCancellation`, `sendBookingReschedule`, `sendReminders`
- `sendReminders` runs daily via cron at `0 13 * * *` (13:00 UTC = 10:00 AM Buenos Aires)
- Env vars `KAPSO_API_KEY` and `KAPSO_PHONE_NUMBER_ID` are optional — if missing, notifications are silently skipped
- Set production secrets with `wrangler secret put KAPSO_API_KEY` / `wrangler secret put KAPSO_PHONE_NUMBER_ID`
- Phone numbers stored as `+549XXXXXXXX`; Kapso expects without `+` (stripped internally)
- `globalThis.fetch = globalThis.fetch.bind(globalThis)` is required at module level — Kapso SDK loses fetch binding in Workers runtime without it

## Code conventions
- Strict TypeScript everywhere — no `any`
- No comments unless logic is non-obvious
- No `console.log` in production — use Wrangler's logger
- Variable and function names in English
- User-facing strings in Spanish
- Keep route handlers thin — business logic in /lib

## UI terminology (Spanish)
- "sesión" not "reserva" or "turno" for patient-facing text
- "Agendá tu sesión" as the main CTA
- "Mis sesiones" for patient session list
- Admin dashboard can use "turno" internally
