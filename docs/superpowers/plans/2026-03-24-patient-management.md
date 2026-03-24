# Patient Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full patient CRUD, bulk import (CSV/XLSX), and export to the psychologist admin dashboard.

**Architecture:** A new `patients` table stores manually-added patients. The existing `GET /api/patients` query is extended with a CTE that unions the `patients` table as a fourth source, giving it priority when the same email appears in booking tables. All other routes (POST/PUT/DELETE/import/export) are added to the existing `patients.ts` router. File parsing (CSV/XLSX) and file generation (CSV/XLSX) happen entirely on the frontend using SheetJS — the worker only sees/returns JSON.

**Tech Stack:** Cloudflare Workers, Hono, D1 (SQLite), React, TypeScript, Vitest, SheetJS (`xlsx`)

---

## File Map

**Create:**
- `worker/src/db/migrations/migration_patients.sql` — migration SQL
- `frontend/src/lib/patients.ts` — pure functions: CSV parser, conflict splitter, CSV builder
- `frontend/src/test/patients.test.ts` — unit tests for the above pure functions
- `frontend/src/components/PatientFormModal.tsx` — add/edit patient modal
- `frontend/src/components/ImportPatientsModal.tsx` — 3-step import modal

**Modify:**
- `worker/src/db/schema.sql` — add `patients` table definition
- `worker/src/routes/patients.ts` — rewrite GET /, add POST / PUT /:email DELETE /:email /import /import/confirm /export
- `frontend/src/lib/types.ts` — add `source` to `Patient`, add `ConflictRow`, `ExportRow`
- `frontend/src/lib/api.ts` — add patient CRUD + import/export API functions
- `frontend/src/pages/PatientsPage.tsx` — add header buttons, row action icons, wire modals

---

## Task 1: Database migration

**Files:**
- Create: `worker/src/db/migrations/migration_patients.sql`
- Modify: `worker/src/db/schema.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- worker/src/db/migrations/migration_patients.sql
CREATE TABLE IF NOT EXISTS patients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  psicologo_id INTEGER NOT NULL REFERENCES psicologos(id),
  nombre       TEXT NOT NULL,
  email        TEXT NOT NULL,
  telefono     TEXT DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(psicologo_id, email)
);
```

- [ ] **Step 2: Apply to production D1**

```bash
npx wrangler d1 execute psi-db --file=worker/src/db/migrations/migration_patients.sql
```

Expected: `✅ Executed SQL` with no errors.

- [ ] **Step 3: Add the table to schema.sql**

Append to `worker/src/db/schema.sql` after the `paciente_notas` index block:

```sql
CREATE TABLE patients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  psicologo_id INTEGER NOT NULL REFERENCES psicologos(id),
  nombre       TEXT NOT NULL,
  email        TEXT NOT NULL,
  telefono     TEXT DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(psicologo_id, email)
);
```

- [ ] **Step 4: Commit**

```bash
git add worker/src/db/migrations/migration_patients.sql worker/src/db/schema.sql
git commit -m "feat(db): add patients table migration"
```

---

## Task 2: Rewrite GET /api/patients

Extend the existing list query to include the `patients` table as a fourth source, add `source` to each row, and give manual records priority on name/phone.

**Files:**
- Modify: `worker/src/routes/patients.ts:14-67`

- [ ] **Step 1: Replace the query in the GET / handler**

Replace lines 14–67 (the `const query = ...` and `.bind(...)` call) with:

```ts
  const query = `
    WITH all_patients AS (
      SELECT nombre, email, telefono, 'manual' AS source
      FROM patients WHERE psicologo_id = ?

      UNION ALL

      SELECT paciente_nombre, paciente_email, paciente_telefono, 'booking' AS source
      FROM reservas r
      JOIN slots s ON s.id = r.slot_id
      WHERE s.psicologo_id = ?

      UNION ALL

      SELECT patient_name, patient_email, patient_phone, 'booking' AS source
      FROM recurring_bookings WHERE psychologist_id = ?

      UNION ALL

      SELECT paciente_nombre, paciente_email, paciente_telefono, 'booking' AS source
      FROM cancellations WHERE psicologo_id = ?
    ),
    deduped AS (
      SELECT
        MAX(CASE WHEN source = 'manual' THEN nombre ELSE NULL END)
          OVER (PARTITION BY email) AS nombre_manual,
        MAX(CASE WHEN source = 'manual' THEN telefono ELSE NULL END)
          OVER (PARTITION BY email) AS telefono_manual,
        nombre,
        email,
        telefono,
        source,
        ROW_NUMBER() OVER (
          PARTITION BY email
          ORDER BY CASE source WHEN 'manual' THEN 0 ELSE 1 END
        ) AS rn
      FROM all_patients
    ),
    base AS (
      SELECT
        COALESCE(nombre_manual, nombre) AS nombre,
        email,
        COALESCE(telefono_manual, telefono) AS telefono,
        source
      FROM deduped
      WHERE rn = 1
    )
    SELECT
      b.email,
      b.nombre,
      b.telefono,
      b.source,
      (
        SELECT COUNT(*)
        FROM reservas r
        JOIN slots s ON s.id = r.slot_id
        WHERE r.paciente_email = b.email
          AND s.psicologo_id = ?
          AND (s.fecha < date('now', '-3 hours') OR (s.fecha = date('now', '-3 hours') AND s.hora_inicio < time('now', '-3 hours')))
      ) AS total_sesiones,
      (
        SELECT MAX(s.fecha)
        FROM reservas r
        JOIN slots s ON s.id = r.slot_id
        WHERE r.paciente_email = b.email
          AND s.psicologo_id = ?
          AND (s.fecha < date('now', '-3 hours') OR (s.fecha = date('now', '-3 hours') AND s.hora_inicio < time('now', '-3 hours')))
      ) AS ultima_sesion,
      (
        SELECT MIN(s.fecha)
        FROM reservas r
        JOIN slots s ON s.id = r.slot_id
        WHERE r.paciente_email = b.email
          AND s.psicologo_id = ?
          AND (s.fecha > date('now', '-3 hours') OR (s.fecha = date('now', '-3 hours') AND s.hora_inicio >= time('now', '-3 hours')))
      ) AS proxima_sesion
    FROM base b
    ORDER BY b.nombre ASC
  `;

  const result = await c.env.DB.prepare(query)
    .bind(
      psychologistId, // patients UNION source
      psychologistId, // reservas UNION source
      psychologistId, // recurring_bookings UNION source
      psychologistId, // cancellations UNION source
      psychologistId, // total_sesiones subquery
      psychologistId, // ultima_sesion subquery
      psychologistId, // proxima_sesion subquery
    )
    .all();
```

- [ ] **Step 2: Verify manually**

Start the worker: `npx wrangler dev --remote` (from repo root)

```bash
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@turnospsi.com","password":"admin123"}' | jq -r '.token')

curl -s http://localhost:8787/api/patients \
  -H "Authorization: Bearer $TOKEN" | jq '.data[0]'
```

Expected: each patient object has `source: "manual"` or `source: "booking"`.

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/patients.ts
git commit -m "feat(patients): extend GET /api/patients with manual source and priority merge"
```

---

## Task 3: POST /api/patients — create manual patient

**Files:**
- Modify: `worker/src/routes/patients.ts`

- [ ] **Step 1: Add the create route**

After the `GET /:email/history` handler (line 114), add these new routes. **Important:** static path routes (`/import`, `/import/confirm`, `/export`) must be registered before parameterized routes (`/:email`). Add all new routes in this order.

First, add the create route after the `GET /` handler close (`});` at line ~70), before the `GET /:email/history`:

```ts
// POST /api/patients - Create a manual patient
patientsRouter.post('/', async (c) => {
  const psychologistId = c.get('psychologistId');
  const body = await c.req.json<{ nombre: string; email: string; telefono?: string }>();

  if (!body.nombre?.trim() || !body.email?.trim()) {
    return c.json({ error: 'nombre y email son requeridos' }, 400);
  }

  const email = body.email.toLowerCase().trim();

  const existing = await c.env.DB.prepare(
    'SELECT id FROM patients WHERE psicologo_id = ? AND email = ?'
  ).bind(psychologistId, email).first();

  if (existing) {
    return c.json({ error: 'Ya existe un paciente con ese email' }, 409);
  }

  await c.env.DB.prepare(
    'INSERT INTO patients (psicologo_id, nombre, email, telefono) VALUES (?, ?, ?, ?)'
  ).bind(psychologistId, body.nombre.trim(), email, (body.telefono ?? '').trim()).run();

  return c.json({ success: true }, 201);
});
```

- [ ] **Step 2: Verify manually**

```bash
curl -s -X POST http://localhost:8787/api/patients \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nombre":"Test Paciente","email":"test@ejemplo.com","telefono":"1122334455"}' | jq

# Should return: { "success": true }

# Duplicate should 409:
curl -s -X POST http://localhost:8787/api/patients \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nombre":"Test Paciente","email":"test@ejemplo.com"}' | jq
# Should return: { "error": "Ya existe un paciente con ese email" } + 409
```

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/patients.ts
git commit -m "feat(patients): add POST /api/patients create route"
```

---

## Task 4: PUT and DELETE /api/patients/:email

**Files:**
- Modify: `worker/src/routes/patients.ts`

- [ ] **Step 1: Add PUT route (after the POST / route)**

```ts
// PUT /api/patients/:email - Edit a manual patient's name or phone
patientsRouter.put('/:email', async (c) => {
  const psychologistId = c.get('psychologistId');
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();
  const body = await c.req.json<{ nombre?: string; telefono?: string }>();

  if (!body.nombre?.trim() && body.telefono === undefined) {
    return c.json({ error: 'Debe enviar al menos un campo para actualizar' }, 400);
  }

  const patient = await c.env.DB.prepare(
    'SELECT id FROM patients WHERE psicologo_id = ? AND email = ?'
  ).bind(psychologistId, email).first();

  if (!patient) {
    return c.json({ error: 'Paciente no encontrado en el directorio manual' }, 404);
  }

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (body.nombre?.trim()) {
    updates.push('nombre = ?');
    values.push(body.nombre.trim());
  }
  if (body.telefono !== undefined) {
    updates.push('telefono = ?');
    values.push(body.telefono.trim());
  }

  values.push(psychologistId, email);
  await c.env.DB.prepare(
    `UPDATE patients SET ${updates.join(', ')} WHERE psicologo_id = ? AND email = ?`
  ).bind(...values).run();

  return c.json({ success: true });
});
```

- [ ] **Step 2: Add DELETE route (after PUT)**

```ts
// DELETE /api/patients/:email - Delete a manual patient (only if no session history)
patientsRouter.delete('/:email', async (c) => {
  const psychologistId = c.get('psychologistId');
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();

  const patient = await c.env.DB.prepare(
    'SELECT id FROM patients WHERE psicologo_id = ? AND email = ?'
  ).bind(psychologistId, email).first();

  if (!patient) {
    return c.json({ error: 'Paciente no encontrado en el directorio manual' }, 404);
  }

  const [inReservas, inCancellations, inRecurring] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM reservas r
       JOIN slots s ON s.id = r.slot_id
       WHERE s.psicologo_id = ? AND r.paciente_email = ?`
    ).bind(psychologistId, email).first<{ n: number }>(),

    c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM cancellations WHERE psicologo_id = ? AND paciente_email = ?'
    ).bind(psychologistId, email).first<{ n: number }>(),

    c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM recurring_bookings WHERE psychologist_id = ? AND patient_email = ?'
    ).bind(psychologistId, email).first<{ n: number }>(),
  ]);

  const total = (inReservas?.n ?? 0) + (inCancellations?.n ?? 0) + (inRecurring?.n ?? 0);
  if (total > 0) {
    return c.json({ error: 'No se puede eliminar un paciente con historial de sesiones' }, 409);
  }

  await c.env.DB.prepare(
    'DELETE FROM patients WHERE psicologo_id = ? AND email = ?'
  ).bind(psychologistId, email).run();

  return c.json({ success: true });
});
```

- [ ] **Step 3: Verify manually**

```bash
# Edit the patient we created in Task 3
curl -s -X PUT "http://localhost:8787/api/patients/test%40ejemplo.com" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nombre":"Test Editado"}' | jq
# Expected: { "success": true }

# Delete it
curl -s -X DELETE "http://localhost:8787/api/patients/test%40ejemplo.com" \
  -H "Authorization: Bearer $TOKEN" | jq
# Expected: { "success": true }

# Delete a patient who has reservas — should 409:
# Use an email that exists in reservas to verify the guard
```

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/patients.ts
git commit -m "feat(patients): add PUT and DELETE routes with session history guard"
```

---

## Task 5: Import routes

**Files:**
- Modify: `worker/src/routes/patients.ts`

These two routes must be registered **before** `PUT /:email` and `DELETE /:email` in the file. The ordering constraint applies only to single-segment routes: `/import`, `/import/confirm`, and `/export` (single segment) would match `/:email` if placed after it. The existing `GET /:email/history` (two segments) cannot conflict with single-segment statics, so its position is not a concern.

- [ ] **Step 1: Add POST /import before the /:email routes**

Add these two routes right after the `POST /` create route:

```ts
// POST /api/patients/import - Preview import (no persist)
patientsRouter.post('/import', async (c) => {
  const psychologistId = c.get('psychologistId');
  const body = await c.req.json<{ rows: Array<{ nombre: string; email: string; telefono: string }> }>();

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return c.json({ error: 'El archivo no contiene filas válidas' }, 400);
  }
  if (body.rows.length > 500) {
    return c.json({ error: 'La importación no puede superar 500 pacientes a la vez' }, 400);
  }

  // Fetch all existing emails across patients, reservas, and recurring_bookings
  const existingResult = await c.env.DB.prepare(`
    SELECT email, nombre, telefono, 'manual' AS source FROM patients WHERE psicologo_id = ?
    UNION
    SELECT paciente_email, paciente_nombre, COALESCE(paciente_telefono,'') AS telefono, 'booking' AS source
    FROM reservas r JOIN slots s ON s.id = r.slot_id WHERE s.psicologo_id = ?
    UNION
    SELECT patient_email, patient_name, patient_phone, 'booking' AS source
    FROM recurring_bookings WHERE psychologist_id = ?
  `).bind(psychologistId, psychologistId, psychologistId).all<{
    email: string; nombre: string; telefono: string; source: string;
  }>();

  const existingMap = new Map(existingResult.results.map(r => [r.email.toLowerCase(), r]));

  const clean: typeof body.rows = [];
  const conflicts: Array<{
    incoming: { nombre: string; email: string; telefono: string };
    existing: { nombre: string; email: string; telefono: string };
    existingSource: string;
  }> = [];

  for (const row of body.rows) {
    const emailKey = row.email.toLowerCase().trim();
    const existing = existingMap.get(emailKey);
    if (existing) {
      conflicts.push({
        incoming: { nombre: row.nombre, email: emailKey, telefono: row.telefono ?? '' },
        existing: { nombre: existing.nombre, email: existing.email, telefono: existing.telefono },
        existingSource: existing.source,
      });
    } else {
      clean.push({ nombre: row.nombre, email: emailKey, telefono: row.telefono ?? '' });
    }
  }

  return c.json({ success: true, data: { clean, conflicts } });
});

// POST /api/patients/import/confirm - Persist resolved rows
patientsRouter.post('/import/confirm', async (c) => {
  const psychologistId = c.get('psychologistId');
  const body = await c.req.json<{
    rows: Array<{ nombre: string; email: string; telefono: string }>;
  }>();

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return c.json({ error: 'No hay filas para importar' }, 400);
  }
  if (body.rows.length > 500) {
    return c.json({ error: 'La importación no puede superar 500 pacientes a la vez' }, 400);
  }

  const stmts = body.rows.map(row =>
    c.env.DB.prepare(`
      INSERT INTO patients (psicologo_id, nombre, email, telefono)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(psicologo_id, email)
      DO UPDATE SET nombre = excluded.nombre, telefono = excluded.telefono
    `).bind(psychologistId, row.nombre.trim(), row.email.toLowerCase().trim(), (row.telefono ?? '').trim())
  );

  await c.env.DB.batch(stmts);

  return c.json({ success: true, data: { imported: body.rows.length } });
});
```

- [ ] **Step 2: Verify manually**

```bash
# Preview import with a conflict (use an existing patient email)
curl -s -X POST http://localhost:8787/api/patients/import \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"rows":[{"nombre":"Nuevo","email":"NUEVO@test.com","telefono":"111"},{"nombre":"Existente","email":"existing@patient.com","telefono":"222"}]}' | jq
# Expected: { "success": true, "data": { "clean": [...], "conflicts": [...] } }
# Note: email should be lowercased in response

# Confirm import
curl -s -X POST http://localhost:8787/api/patients/import/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"rows":[{"nombre":"Nuevo","email":"nuevo@test.com","telefono":"111"}]}' | jq
# Expected: { "success": true, "data": { "imported": 1 } }
```

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/patients.ts
git commit -m "feat(patients): add import preview and confirm routes"
```

---

## Task 6: GET /api/patients/export

**Files:**
- Modify: `worker/src/routes/patients.ts`

This route must also be registered **before** `/:email` parameterized routes.

- [ ] **Step 1: Add export route**

Add after the `/import/confirm` route:

```ts
// GET /api/patients/export - Export all patients with session history as JSON
patientsRouter.get('/export', async (c) => {
  const psychologistId = c.get('psychologistId');

  // Get all unique patients (same deduplication as GET /)
  const patientsResult = await c.env.DB.prepare(`
    WITH all_p AS (
      SELECT nombre, email, telefono, 'manual' AS source FROM patients WHERE psicologo_id = ?
      UNION ALL
      SELECT paciente_nombre, paciente_email, COALESCE(paciente_telefono,''), 'booking'
      FROM reservas r JOIN slots s ON s.id = r.slot_id WHERE s.psicologo_id = ?
      UNION ALL
      SELECT patient_name, patient_email, patient_phone, 'booking'
      FROM recurring_bookings WHERE psychologist_id = ?
      UNION ALL
      SELECT paciente_nombre, paciente_email, COALESCE(paciente_telefono,''), 'booking'
      FROM cancellations WHERE psicologo_id = ?
    ),
    deduped AS (
      SELECT
        MAX(CASE WHEN source='manual' THEN nombre END) OVER (PARTITION BY email) AS nombre_manual,
        MAX(CASE WHEN source='manual' THEN telefono END) OVER (PARTITION BY email) AS telefono_manual,
        nombre, email, telefono,
        ROW_NUMBER() OVER (PARTITION BY email ORDER BY CASE source WHEN 'manual' THEN 0 ELSE 1 END) AS rn
      FROM all_p
    )
    SELECT
      COALESCE(nombre_manual, nombre) AS nombre,
      email,
      COALESCE(telefono_manual, telefono) AS telefono
    FROM deduped WHERE rn = 1
    ORDER BY nombre ASC
  `).bind(psychologistId, psychologistId, psychologistId, psychologistId)
    .all<{ nombre: string; email: string; telefono: string }>();

  // Get all sessions (bookings + cancellations)
  const sessionsResult = await c.env.DB.prepare(`
    SELECT
      r.paciente_email AS email,
      s.fecha AS sesion_fecha,
      s.hora_inicio AS sesion_hora_inicio,
      CASE
        WHEN s.fecha < date('now', '-3 hours') THEN 'realizada'
        ELSE 'proxima'
      END AS sesion_estado
    FROM reservas r
    JOIN slots s ON s.id = r.slot_id
    WHERE s.psicologo_id = ?

    UNION ALL

    SELECT
      paciente_email AS email,
      slot_fecha AS sesion_fecha,
      slot_hora_inicio AS sesion_hora_inicio,
      'cancelada' AS sesion_estado
    FROM cancellations
    WHERE psicologo_id = ?
    ORDER BY email, sesion_fecha
  `).bind(psychologistId, psychologistId)
    .all<{ email: string; sesion_fecha: string; sesion_hora_inicio: string; sesion_estado: string }>();

  // Group sessions by email
  const sessionsByEmail = new Map<string, typeof sessionsResult.results>();
  for (const s of sessionsResult.results) {
    const key = s.email.toLowerCase();
    if (!sessionsByEmail.has(key)) sessionsByEmail.set(key, []);
    sessionsByEmail.get(key)!.push(s);
  }

  // Build export rows
  const rows: Array<{
    nombre: string; email: string; telefono: string;
    total_sesiones: number; ultima_sesion: string; proxima_sesion: string;
    sesion_fecha: string; sesion_hora_inicio: string;
    sesion_estado: 'realizada' | 'proxima' | 'cancelada' | null;
  }> = [];

  for (const patient of patientsResult.results) {
    const sessions = sessionsByEmail.get(patient.email.toLowerCase()) ?? [];
    const past = sessions.filter(s => s.sesion_estado === 'realizada');
    const totalSesiones = past.length;
    const ultimaSesion = past.length ? past.reduce((a, b) => a.sesion_fecha > b.sesion_fecha ? a : b).sesion_fecha : '';
    const proximas = sessions.filter(s => s.sesion_estado === 'proxima');
    const proximaSesion = proximas.length ? proximas.reduce((a, b) => a.sesion_fecha < b.sesion_fecha ? a : b).sesion_fecha : '';

    if (sessions.length === 0) {
      rows.push({
        nombre: patient.nombre, email: patient.email, telefono: patient.telefono,
        total_sesiones: 0, ultima_sesion: '', proxima_sesion: '',
        sesion_fecha: '', sesion_hora_inicio: '', sesion_estado: null,
      });
    } else {
      for (const s of sessions) {
        rows.push({
          nombre: patient.nombre, email: patient.email, telefono: patient.telefono,
          total_sesiones: totalSesiones, ultima_sesion: ultimaSesion, proxima_sesion: proximaSesion,
          sesion_fecha: s.sesion_fecha, sesion_hora_inicio: s.sesion_hora_inicio,
          sesion_estado: s.sesion_estado as 'realizada' | 'proxima' | 'cancelada',
        });
      }
    }
  }

  return c.json({ success: true, data: rows });
});
```

- [ ] **Step 2: Verify manually**

```bash
curl -s "http://localhost:8787/api/patients/export" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'
# Expected: a number > 0 (total session rows)

curl -s "http://localhost:8787/api/patients/export" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[0]'
# Expected: object with nombre, email, telefono, total_sesiones, ultima_sesion, proxima_sesion, sesion_fecha, sesion_hora_inicio, sesion_estado
```

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/patients.ts
git commit -m "feat(patients): add GET /api/patients/export route"
```

---

## Task 7: Frontend — pure functions + tests + types + api.ts

**Files:**
- Create: `frontend/src/lib/patients.ts`
- Create: `frontend/src/test/patients.test.ts`
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Install SheetJS in frontend**

```bash
cd frontend && npm install xlsx && cd ..
```

- [ ] **Step 2: Write failing tests first**

Create `frontend/src/test/patients.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCSV, buildCSV } from '../lib/patients';

describe('parseCSV', () => {
  it('parses a valid 3-column CSV with header', () => {
    const csv = 'nombre,email,telefono\nAna García,ana@mail.com,1122\nJuan,juan@mail.com,3344';
    const result = parseCSV(csv);
    expect(result).toEqual([
      { nombre: 'Ana García', email: 'ana@mail.com', telefono: '1122' },
      { nombre: 'Juan', email: 'juan@mail.com', telefono: '3344' },
    ]);
  });

  it('trims whitespace from values', () => {
    const csv = 'nombre,email,telefono\n  Ana ,  ANA@mail.com , 1122 ';
    const result = parseCSV(csv);
    expect(result[0].email).toBe('ana@mail.com');
    expect(result[0].nombre).toBe('Ana');
  });

  it('returns empty array for CSV with only header', () => {
    expect(parseCSV('nombre,email,telefono\n')).toEqual([]);
  });

  it('throws if required columns are missing', () => {
    expect(() => parseCSV('name,mail,phone\nAna,ana@m.com,111')).toThrow();
  });

  it('handles missing telefono column gracefully (empty string)', () => {
    const csv = 'nombre,email,telefono\nAna,ana@mail.com,';
    const result = parseCSV(csv);
    expect(result[0].telefono).toBe('');
  });

  it('handles RFC 4180 quoted values containing commas', () => {
    const csv = 'nombre,email,telefono\n"García, Ana",ana@mail.com,1122';
    const result = parseCSV(csv);
    expect(result[0].nombre).toBe('García, Ana');
  });
});

describe('buildCSV', () => {
  it('builds a CSV string from export rows', () => {
    const rows = [
      {
        nombre: 'Ana', email: 'ana@mail.com', telefono: '111',
        total_sesiones: 2, ultima_sesion: '2026-03-01', proxima_sesion: '2026-04-01',
        sesion_fecha: '2026-03-01', sesion_hora_inicio: '10:00', sesion_estado: 'realizada' as const,
      },
    ];
    const csv = buildCSV(rows);
    expect(csv).toContain('nombre,email,telefono');
    expect(csv).toContain('Ana,ana@mail.com');
    expect(csv).toContain('2026-03-01');
  });

  it('wraps values containing commas in quotes', () => {
    const rows = [
      {
        nombre: 'García, Ana', email: 'ana@mail.com', telefono: '',
        total_sesiones: 0, ultima_sesion: '', proxima_sesion: '',
        sesion_fecha: '', sesion_hora_inicio: '', sesion_estado: null,
      },
    ];
    const csv = buildCSV(rows);
    expect(csv).toContain('"García, Ana"');
  });
});
```

- [ ] **Step 3: Run tests — they must fail**

```bash
cd frontend && npm test -- patients.test.ts
```

Expected: FAIL — `Cannot find module '../lib/patients'`

- [ ] **Step 4: Create `frontend/src/lib/patients.ts`**

```ts
export interface PatientRow {
  nombre: string;
  email: string;
  telefono: string;
}

export interface ExportRow {
  nombre: string;
  email: string;
  telefono: string;
  total_sesiones: number;
  ultima_sesion: string;
  proxima_sesion: string;
  sesion_fecha: string;
  sesion_hora_inicio: string;
  sesion_estado: 'realizada' | 'proxima' | 'cancelada' | null;
}

const REQUIRED_COLUMNS = ['nombre', 'email', 'telefono'] as const;

// Parses a single CSV line respecting RFC 4180 double-quote escaping.
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      // Quoted field
      let field = '';
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      if (line[i] === ',') i++; // skip comma separator
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}

export function parseCSV(csv: string): PatientRow[] {
  const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  for (const col of REQUIRED_COLUMNS) {
    if (!headers.includes(col)) {
      throw new Error(`El archivo debe tener columnas: nombre, email, teléfono`);
    }
  }

  const idx = {
    nombre: headers.indexOf('nombre'),
    email: headers.indexOf('email'),
    telefono: headers.indexOf('telefono'),
  };

  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    return {
      nombre: (cols[idx.nombre] ?? '').trim(),
      email: (cols[idx.email] ?? '').trim().toLowerCase(),
      telefono: (cols[idx.telefono] ?? '').trim(),
    };
  }).filter(r => r.nombre && r.email);
}

function escapeCSVValue(value: string | number | null): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const EXPORT_HEADERS = [
  'nombre', 'email', 'telefono', 'total_sesiones',
  'ultima_sesion', 'proxima_sesion', 'sesion_fecha',
  'sesion_hora_inicio', 'sesion_estado',
] as const;

export function buildCSV(rows: ExportRow[]): string {
  const lines = [EXPORT_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(EXPORT_HEADERS.map(h => escapeCSVValue(row[h])).join(','));
  }
  return lines.join('\n');
}

export function downloadFile(content: string | Blob, filename: string, mime: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 5: Run tests — must pass**

```bash
cd frontend && npm test -- patients.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Update `frontend/src/lib/types.ts`**

Add `source` to `Patient` and add two new interfaces after the `Patient` block (after line 115):

```ts
export interface Patient {
  email: string;
  nombre: string;
  telefono: string;
  total_sesiones: number;
  ultima_sesion: string | null;
  proxima_sesion: string | null;
  source: 'manual' | 'booking';  // NEW
}

export interface ConflictRow {
  incoming: Pick<Patient, 'nombre' | 'email' | 'telefono'>;
  existing: Pick<Patient, 'nombre' | 'email' | 'telefono'>;
  existingSource: 'manual' | 'booking';
}
```

- [ ] **Step 7: Add new API functions to `frontend/src/lib/api.ts`**

After the `getPatientHistory` line (line 214), add:

```ts
export const createPatient = (data: { nombre: string; email: string; telefono?: string }) =>
  request<void>('/patients', { method: 'POST', body: JSON.stringify(data) });

export const updatePatient = (email: string, data: { nombre?: string; telefono?: string }) =>
  request<void>(`/patients/${encodeURIComponent(email)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deletePatient = (email: string) =>
  request<void>(`/patients/${encodeURIComponent(email)}`, { method: 'DELETE' });

export const previewImport = (rows: Array<{ nombre: string; email: string; telefono: string }>) =>
  request<{
    clean: Array<{ nombre: string; email: string; telefono: string }>;
    conflicts: import('./types').ConflictRow[];
  }>('/patients/import', { method: 'POST', body: JSON.stringify({ rows }) });

export const confirmImport = (rows: Array<{ nombre: string; email: string; telefono: string }>) =>
  request<{ imported: number }>('/patients/import/confirm', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });

export const exportPatients = () =>
  request<import('../lib/patients').ExportRow[]>('/patients/export');
```

- [ ] **Step 8: Run all frontend tests**

```bash
cd frontend && npm test
```

Expected: all existing tests still pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/patients.ts frontend/src/test/patients.test.ts \
        frontend/src/lib/types.ts frontend/src/lib/api.ts frontend/package.json \
        frontend/package-lock.json
git commit -m "feat(patients): add pure functions, types, and api client functions"
```

---

## Task 8: PatientFormModal component

**Files:**
- Create: `frontend/src/components/PatientFormModal.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { createPatient, updatePatient } from '../lib/api';
import { useNotifications } from '../lib/NotificationContext';
import type { Patient } from '../lib/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  patient?: Pick<Patient, 'nombre' | 'email' | 'telefono'>;
  onSuccess: () => void;
}

export function PatientFormModal({ isOpen, onClose, patient, onSuccess }: Props) {
  const { showToast } = useNotifications();
  const isEdit = Boolean(patient);

  const [nombre, setNombre] = useState(patient?.nombre ?? '');
  const [email, setEmail] = useState(patient?.email ?? '');
  const [telefono, setTelefono] = useState(patient?.telefono ?? '');
  const [loading, setLoading] = useState(false);

  // Reset form when patient changes
  const handleOpen = () => {
    setNombre(patient?.nombre ?? '');
    setEmail(patient?.email ?? '');
    setTelefono(patient?.telefono ?? '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim() || !email.trim()) return;

    setLoading(true);
    const res = isEdit
      ? await updatePatient(patient!.email, { nombre, telefono })
      : await createPatient({ nombre, email, telefono });
    setLoading(false);

    if (!res.success) {
      showToast(res.error ?? 'Error al guardar paciente', 'error');
      return;
    }

    showToast(isEdit ? 'Paciente actualizado' : 'Paciente agregado', 'success');
    onSuccess();
    onClose();
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Editar paciente' : 'Agregar paciente'}
    >
      <form onSubmit={handleSubmit} className="space-y-4" onFocus={handleOpen}>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Nombre completo *</label>
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            required
            className="w-full px-3 py-2.5 bg-slate-50 rounded-xl text-sm border-none focus:ring-2 focus:ring-[#1a2e4a]/20"
            placeholder="Ana García"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Email *</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            disabled={isEdit}
            className="w-full px-3 py-2.5 bg-slate-50 rounded-xl text-sm border-none focus:ring-2 focus:ring-[#1a2e4a]/20 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="ana@mail.com"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Teléfono</label>
          <input
            type="tel"
            value={telefono}
            onChange={e => setTelefono(e.target.value)}
            className="w-full px-3 py-2.5 bg-slate-50 rounded-xl text-sm border-none focus:ring-2 focus:ring-[#1a2e4a]/20"
            placeholder="1122334455"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || !nombre.trim() || !email.trim()}
            className="flex-1 py-2.5 rounded-xl bg-[#1a2e4a] text-white text-sm font-semibold hover:bg-[#243d61] transition-colors disabled:opacity-50"
          >
            {loading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Agregar paciente'}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/PatientFormModal.tsx
git commit -m "feat(patients): add PatientFormModal component"
```

---

## Task 9: Update PatientsPage — header buttons + row actions

**Files:**
- Modify: `frontend/src/pages/PatientsPage.tsx`

- [ ] **Step 1: Rewrite PatientsPage.tsx**

Replace the entire file with:

```tsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { getPatients, deletePatient } from '../lib/api';
import { useNotifications } from '../lib/NotificationContext';
import { PatientFormModal } from '../components/PatientFormModal';
import { ImportPatientsModal } from '../components/ImportPatientsModal';
import { exportPatients } from '../lib/api';
import { buildCSV, downloadFile } from '../lib/patients';
import type { Patient } from '../lib/types';
import type { ExportRow } from '../lib/patients';

interface Props {
  onViewDetail: (email: string) => void;
}

export function PatientsPage({ onViewDetail }: Props) {
  const { showToast, confirm } = useNotifications();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [formModal, setFormModal] = useState<{ open: boolean; patient?: Patient }>({ open: false });
  const [importOpen, setImportOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPatients();
  }, []);

  // Close export dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadPatients = async () => {
    setLoading(true);
    const res = await getPatients();
    if (res.success && res.data) setPatients(res.data);
    setLoading(false);
  };

  const filteredPatients = useMemo(() => {
    const s = search.toLowerCase();
    return patients.filter(p =>
      p.nombre.toLowerCase().includes(s) ||
      p.email.toLowerCase().includes(s) ||
      p.telefono.includes(s)
    );
  }, [patients, search]);

  const handleDelete = async (patient: Patient) => {
    const ok = await confirm({
      title: `¿Eliminar a ${patient.nombre}?`,
      message: 'Esta acción no se puede deshacer.',
      confirmText: 'Eliminar',
      type: 'danger',
    });
    if (!ok) return;
    const res = await deletePatient(patient.email);
    if (!res.success) {
      showToast(res.error ?? 'Error al eliminar paciente', 'error');
      return;
    }
    showToast('Paciente eliminado', 'success');
    loadPatients();
  };

  const handleExport = async (format: 'csv' | 'xlsx') => {
    setExportMenuOpen(false);
    setExportLoading(true);
    const res = await exportPatients();
    setExportLoading(false);
    if (!res.success || !res.data) {
      showToast('Error al exportar pacientes', 'error');
      return;
    }
    const rows = res.data as ExportRow[];
    if (format === 'csv') {
      const csv = buildCSV(rows);
      downloadFile(csv, 'pacientes.csv', 'text/csv;charset=utf-8;');
    } else {
      const { utils, writeFile } = await import('xlsx');
      const ws = utils.json_to_sheet(rows);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'Pacientes');
      writeFile(wb, 'pacientes.xlsx');
    }
    showToast('Exportación lista', 'success');
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', {
      day: 'numeric', month: 'short', year: '2-digit',
    });
  };

  if (loading && patients.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-[#1a2e4a] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search + Actions header */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar por nombre, email o teléfono..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-[#1a2e4a]/20 transition-all"
            />
          </div>

          {/* Import button */}
          <button
            onClick={() => setImportOpen(true)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            Importar
          </button>

          {/* Export dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setExportMenuOpen(v => !v)}
              disabled={exportLoading}
              className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {exportLoading ? 'Exportando...' : 'Exportar ▾'}
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-slate-100 rounded-xl shadow-lg z-10 min-w-[120px] overflow-hidden">
                <button
                  onClick={() => handleExport('csv')}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors"
                >
                  CSV
                </button>
                <button
                  onClick={() => handleExport('xlsx')}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors"
                >
                  Excel
                </button>
              </div>
            )}
          </div>

          {/* Add patient button */}
          <button
            onClick={() => setFormModal({ open: true })}
            className="px-4 py-2.5 rounded-xl bg-[#1a2e4a] text-white text-sm font-semibold hover:bg-[#243d61] transition-colors whitespace-nowrap"
          >
            + Agregar paciente
          </button>
        </div>
      </div>

      {/* Patients table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-50">
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Paciente</th>
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Contacto</th>
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider text-center">Sesiones</th>
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Última / Próxima</th>
                <th className="px-6 py-4 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredPatients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 font-medium">
                    No se encontraron pacientes
                  </td>
                </tr>
              ) : (
                filteredPatients.map(p => (
                  <tr key={p.email} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-[#1a2e4a]">{p.nombre}</p>
                      <button
                        onClick={() => onViewDetail(p.email)}
                        className="text-[11px] text-[#1a2e4a] font-semibold hover:underline mt-0.5"
                      >
                        Ver historial completo
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-slate-600">{p.email}</p>
                      <p className="text-xs text-slate-400">{p.telefono || 'Sin teléfono'}</p>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-600 text-sm font-bold">
                        {p.total_sesiones}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-400 w-12 lowercase">Última:</span>
                          <span className="text-xs font-semibold text-slate-600">{formatDate(p.ultima_sesion)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-blue-400 w-12 lowercase">Prox:</span>
                          <span className="text-xs font-bold text-[#1a2e4a]">{formatDate(p.proxima_sesion)}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {p.source === 'manual' && (
                          <>
                            <button
                              onClick={() => setFormModal({ open: true, patient: p })}
                              className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-[#1a2e4a] transition-all"
                              title="Editar paciente"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDelete(p)}
                              className="p-2 rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500 transition-all"
                              title="Eliminar paciente"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => onViewDetail(p.email)}
                          className="p-2 rounded-xl bg-slate-100 text-slate-400 group-hover:bg-[#1a2e4a] group-hover:text-white transition-all shadow-sm"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PatientFormModal
        isOpen={formModal.open}
        onClose={() => setFormModal({ open: false })}
        patient={formModal.patient}
        onSuccess={loadPatients}
      />

      <ImportPatientsModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={loadPatients}
      />
    </div>
  );
}
```

- [ ] **Step 2: Run frontend tests**

```bash
cd frontend && npm test
```

Expected: all pass (PatientsPage has no unit tests — just verify no compilation errors).

- [ ] **Step 3: Smoke test in browser**

Start both servers:
```bash
# Terminal 1
npx wrangler dev --remote

# Terminal 2
cd frontend && npm run dev
```

Open http://localhost:5173, log in, go to Pacientes tab. Verify:
- Header shows "Importar", "Exportar ▾", "+ Agregar paciente" buttons
- Clicking "+ Agregar paciente" opens the form modal
- Booking-derived patients have no edit/delete icons
- Manually added patients (from Task 3 testing) show edit/delete icons

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/PatientsPage.tsx
git commit -m "feat(patients): update PatientsPage with CRUD actions and export button"
```

---

## Task 10: ImportPatientsModal component

**Files:**
- Create: `frontend/src/components/ImportPatientsModal.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState, useRef } from 'react';
import { BottomSheet } from './BottomSheet';
import { previewImport, confirmImport } from '../lib/api';
import { parseCSV } from '../lib/patients';
import { useNotifications } from '../lib/NotificationContext';
import type { ConflictRow } from '../lib/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'upload' | 'review' | 'done';

interface ParsedRow { nombre: string; email: string; telefono: string; }

export function ImportPatientsModal({ isOpen, onClose, onSuccess }: Props) {
  const { showToast } = useNotifications();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [loading, setLoading] = useState(false);
  const [cleanRows, setCleanRows] = useState<ParsedRow[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [decisions, setDecisions] = useState<Map<string, 'keep' | 'replace'>>(new Map());
  const [importedCount, setImportedCount] = useState(0);

  const reset = () => {
    setStep('upload');
    setCleanRows([]);
    setConflicts([]);
    setDecisions(new Map());
    setImportedCount(0);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => { reset(); onClose(); };

  const parseFile = async (file: File): Promise<ParsedRow[]> => {
    if (file.name.endsWith('.csv')) {
      const text = await file.text();
      return parseCSV(text);
    }
    // XLSX: use SheetJS
    const { read, utils } = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const wb = read(buffer);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
    if (!raw.length || !('nombre' in raw[0]) || !('email' in raw[0])) {
      throw new Error('El archivo debe tener columnas: nombre, email, teléfono');
    }
    return raw.map(r => ({
      nombre: String(r.nombre ?? '').trim(),
      email: String(r.email ?? '').trim().toLowerCase(),
      telefono: String(r.telefono ?? '').trim(),
    })).filter(r => r.nombre && r.email);
  };

  const handleFile = async (file: File) => {
    setLoading(true);
    try {
      const rows = await parseFile(file);
      if (rows.length === 0) {
        showToast('El archivo no tiene filas válidas', 'error');
        setLoading(false);
        return;
      }
      if (rows.length > 500) {
        showToast('La importación no puede superar 500 pacientes a la vez', 'error');
        setLoading(false);
        return;
      }

      const res = await previewImport(rows);
      if (!res.success || !res.data) {
        showToast(res.error ?? 'Error al previsualizar importación', 'error');
        setLoading(false);
        return;
      }

      setCleanRows(res.data.clean);
      setConflicts(res.data.conflicts);
      const initial = new Map<string, 'keep' | 'replace'>();
      for (const c of res.data.conflicts) initial.set(c.incoming.email, 'keep');
      setDecisions(initial);
      setStep('review');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al leer el archivo', 'error');
    }
    setLoading(false);
  };

  const handleConfirm = async () => {
    const toImport: ParsedRow[] = [
      ...cleanRows,
      ...conflicts
        .filter(c => decisions.get(c.incoming.email) === 'replace')
        .map(c => c.incoming),
    ];

    if (toImport.length === 0) {
      showToast('No hay pacientes para importar', 'error');
      return;
    }

    setLoading(true);
    const res = await confirmImport(toImport);
    setLoading(false);

    if (!res.success || !res.data) {
      showToast(res.error ?? 'Error al importar', 'error');
      return;
    }

    setImportedCount(res.data.imported);
    setStep('done');
    onSuccess();
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose} title="Importar pacientes">
      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Subí un archivo CSV o Excel con columnas: <strong>nombre</strong>, <strong>email</strong>, <strong>telefono</strong>.
          </p>

          <label
            className="block border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-[#1a2e4a]/30 transition-colors"
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            {loading ? (
              <div className="flex justify-center">
                <div className="w-6 h-6 border-2 border-[#1a2e4a] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <svg className="w-8 h-8 text-slate-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-slate-500">Arrastrá un archivo o <span className="text-[#1a2e4a] font-semibold">hacé clic para seleccionar</span></p>
                <p className="text-xs text-slate-400 mt-1">CSV o Excel (.xlsx)</p>
              </>
            )}
          </label>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          {cleanRows.length > 0 && (
            <div className="bg-green-50 rounded-xl px-4 py-3 text-sm text-green-700">
              <strong>{cleanRows.length}</strong> paciente{cleanRows.length !== 1 ? 's' : ''} sin conflictos se importará{cleanRows.length !== 1 ? 'n' : ''} automáticamente.
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-600">
                {conflicts.length} conflicto{conflicts.length !== 1 ? 's' : ''} — decidí qué hacer con cada uno:
              </p>
              {conflicts.map(conflict => (
                <div key={conflict.incoming.email} className="border border-slate-100 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-slate-500 uppercase">{conflict.incoming.email}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="font-semibold text-slate-400 mb-1">Existente ({conflict.existingSource === 'manual' ? 'manual' : 'de reservas'})</p>
                      <p className="text-slate-600">{conflict.existing.nombre}</p>
                      <p className="text-slate-400">{conflict.existing.telefono || 'Sin teléfono'}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-400 mb-1">Nuevo (archivo)</p>
                      <p className="text-slate-600">{conflict.incoming.nombre}</p>
                      <p className="text-slate-400">{conflict.incoming.telefono || 'Sin teléfono'}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {(['keep', 'replace'] as const).map(option => (
                      <button
                        key={option}
                        onClick={() => setDecisions(prev => new Map(prev).set(conflict.incoming.email, option))}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          decisions.get(conflict.incoming.email) === option
                            ? 'bg-[#1a2e4a] text-white'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {option === 'keep' ? 'Mantener existente' : 'Reemplazar con nuevo'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => { reset(); }}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Atrás
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-[#1a2e4a] text-white text-sm font-semibold hover:bg-[#243d61] transition-colors disabled:opacity-50"
            >
              {loading ? 'Importando...' : `Importar ${cleanRows.length + conflicts.filter(c => decisions.get(c.incoming.email) === 'replace').length} pacientes`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-4 space-y-4">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-slate-700">
            Se importaron <strong>{importedCount}</strong> paciente{importedCount !== 1 ? 's' : ''} correctamente.
          </p>
          <button
            onClick={handleClose}
            className="w-full py-2.5 rounded-xl bg-[#1a2e4a] text-white text-sm font-semibold hover:bg-[#243d61] transition-colors"
          >
            Cerrar
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Smoke test in browser**

1. Click "Importar" in the Pacientes tab
2. Upload a CSV with content:
   ```
   nombre,email,telefono
   Nuevo Paciente,nuevo@test.com,1122334455
   ```
3. Verify Step 2 shows "1 paciente sin conflictos se importará automáticamente"
4. Click "Importar 1 pacientes" → Step 3 shows success
5. Verify new patient appears in the table with edit/delete icons

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ImportPatientsModal.tsx
git commit -m "feat(patients): add ImportPatientsModal with 3-step CSV/XLSX import flow"
```

---

## Task 11: Final verification + CLAUDE.md schema update

- [ ] **Step 1: Run all tests**

```bash
cd frontend && npm test
```

Expected: all pass.

- [ ] **Step 2: End-to-end smoke test**

With both servers running (`npx wrangler dev --remote` + `cd frontend && npm run dev`):

1. **Add** a patient manually — verify they appear with ✏️ 🗑️ icons
2. **Edit** the patient's name — verify the table updates
3. **Try to delete a patient with reservas** — verify 409 error notification appears
4. **Delete a patient with no history** — verify they disappear
5. **Import CSV** — upload file, resolve a conflict if any, confirm import
6. **Export CSV** — download file, open in a text editor, verify columns
7. **Export Excel** — download `.xlsx`, open in Excel/LibreOffice, verify data

- [ ] **Step 3: Update CLAUDE.md schema comment**

In `CLAUDE.md`, add `patients` to the database schema section:

```sql
-- Manual patient directory
patients: id, psicologo_id, nombre, email, telefono DEFAULT '', created_at
          UNIQUE(psicologo_id, email)
```

- [ ] **Step 4: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: add patients table to CLAUDE.md schema reference"
```
