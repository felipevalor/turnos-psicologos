---
trigger: always_on
---

# Turnos Psico — Context for Claude Code

## Product
Appointment scheduling system for a single psychologist.
Patients self-manage their sessions (book, cancel, reschedule) via a public view.
The psychologist manages availability, recurring bookings, and schedule via an admin dashboard.

## Repo structure
```
turnos-psicologos-1/
├── frontend/        # React + Vite + TypeScript
├── worker/          # Cloudflare Worker (Hono) + TypeScript
│   └── src/
│       ├── routes/  # API route handlers
│       ├── lib/     # jwt.ts, password.ts, etc.
│       └── db/      # schema.sql
└── wrangler.toml
```

## Stack
- **Frontend**: React, Vite, TypeScript
- **Backend**: Cloudflare Workers, Hono
- **Database**: Cloudflare D1 (SQLite)
- **Auth**: JWT stored in localStorage as `psi_token`
- **Deployment**: `npx wrangler deploy` from root

## Local development
- Worker: `npx wrangler dev --remote` → localhost:8787
- Frontend: `npm run dev` inside /frontend → localhost:5173
- Vite proxies `/api/*` to `localhost:8787`
- If 401 errors after starting locally: clear `psi_token` from localStorage and log in again

## Database schema (production — Cloudflare D1)
These are the EXACT table and column names. Never reference any other names.

```sql
-- Main auth table (NOT "psychologists" — that table was dropped)
psicologos: id, nombre, email, password_hash, session_duration_minutes,
            cancel_min_hours (default 48), reschedule_min_hours (default 48),
            booking_min_hours (default 24), whatsapp_number (nullable TEXT),
            policy_unit TEXT DEFAULT 'hours'  -- 'minutes' | 'hours' | 'days'

-- Availability slots
slots: id, psicologo_id, fecha, hora_inicio, hora_fin, disponible

-- Patient bookings (NOT "bookings" — that table was dropped)
reservas: id, slot_id, paciente_nombre, paciente_email, paciente_telefono, created_at

-- Weekly availability template (uses English column names)
weekly_schedule: id, psychologist_id, day_of_week, start_time, end_time, active

-- Holiday exceptions (uses English column names)
holiday_overrides: id, psychologist_id, date

-- Recurring patient sessions (uses English column names)
recurring_bookings: id, psychologist_id, patient_name, patient_email, patient_phone,
                    frequency_weeks, start_date, time, active, created_at
```

### Critical naming rules
- `psicologos` uses `nombre` (not `name`), `psicologo_id` in foreign keys
- `slots` has NO `created_at`, NO `recurring_booking_id`
- `reservas` has NO `recurring_booking_id`
- `weekly_schedule`, `holiday_overrides`, `recurring_bookings` use `psychologist_id` (English)
- `time` and `date` are SQLite reserved words — always quote them: `"time"`, `"date"`
- Never assume a column exists — check this schema first

## Timezone
- Buenos Aires (America/Buenos_Aires, UTC-3, no DST)
- Store all datetimes in UTC internally
- Convert to America/Buenos_Aires only for display

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
