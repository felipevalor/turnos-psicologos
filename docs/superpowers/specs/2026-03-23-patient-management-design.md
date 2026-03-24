# Patient Management — Design Spec
Date: 2026-03-23

## Problem

The current patient directory is read-only and derived dynamically from `reservas`, `recurring_bookings`, and `cancellations`. There is no way for the psychologist to manually add, edit, or delete patients, nor to import or export patient data.

## Goals

- Allow the psychologist to manually add patients before they book a session
- Allow editing and deletion of manually-added patients (not booking-derived ones)
- Allow bulk import from CSV and XLSX with conflict resolution
- Allow full export of patient data + session history in CSV and XLSX

## Out of scope

- Adding extra fields beyond nombre, email, teléfono
- Patient-facing access to their own record
- Merging patients (deduplication tool)

---

## Database

New table in Cloudflare D1:

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

`telefono` defaults to empty string (not NOT NULL) for consistency with booking-derived patients where phone can be absent. The frontend already handles this with `p.telefono || 'Sin teléfono'`.

The `UNIQUE(psicologo_id, email)` constraint prevents duplicates per psychologist. Email is the canonical patient identifier, consistent with the rest of the system.

**Email normalization:** All email values must be lowercased before insert and before any lookup (in the worker, before `INSERT`, `SELECT WHERE email = ?`, `PUT /:email`, `DELETE /:email`, and conflict detection). This prevents split identity between `Alice@example.com` and `alice@example.com` which would defeat the `UNIQUE` constraint and the `PARTITION BY email` deduplication in the UNION query.

Migration file: `worker/src/db/migrations/migration_patients.sql`

---

## Backend

### Modified route: `GET /api/patients`

The existing UNION query is rewritten as a CTE that unions all four sources and selects the manual record's data when an email collision exists:

```sql
WITH all_patients AS (
  SELECT nombre, email, telefono, 'manual' AS source
  FROM patients WHERE psicologo_id = ?

  UNION ALL

  SELECT paciente_nombre, paciente_email, paciente_telefono, 'booking' AS source
  FROM reservas r
  JOIN slots s ON r.slot_id = s.id
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
)
SELECT
  COALESCE(nombre_manual, nombre) AS nombre,
  email,
  COALESCE(telefono_manual, telefono) AS telefono,
  source
FROM deduped
WHERE rn = 1
```

This ensures:
- Each email appears exactly once
- If a manual patient record exists for that email, its `nombre`/`telefono` are used
- `source` is `'manual'` only when the patient exists in the `patients` table (editable/deletable)
- Patients derived solely from bookings remain `source = 'booking'` (read-only in the UI)

The session aggregation (total_sesiones, ultima_sesion, proxima_sesion) joins on top of this deduplicated base using the same subquery pattern as the existing implementation. The full query will require 7 bind parameters: 4 for the four UNION ALL sources (psicologoId × 4) plus 3 for the session aggregation subqueries (psicologoId × 3). The implementer should retain the existing aggregation subqueries unchanged and wrap them around the new CTE.

Each row in the response includes `source: 'manual' | 'booking'`.

**Implementation note:** Register static routes (`/import`, `/import/confirm`, `/export`) before parameterized routes (`/:email`) in Hono to prevent the static paths from being consumed by the `:email` parameter matcher.

### New routes in `worker/src/routes/patients.ts`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/patients` | Create a manual patient. 409 if email already exists. |
| `POST` | `/api/patients/import` | Parse uploaded CSV or XLSX. Returns `{ clean: Patient[], conflicts: ConflictRow[] }`. Does not persist. |
| `POST` | `/api/patients/import/confirm` | Receives resolved conflict decisions and persists all rows. |
| `GET` | `/api/patients/export` | Returns all patients with full session history. `?format=xlsx` for Excel, default CSV. |
| `PUT` | `/api/patients/:email` | Update `nombre` and/or `telefono` of a manual patient. 404 if not in `patients` table. |
| `DELETE` | `/api/patients/:email` | Delete a manual patient. 409 if the patient has any history. |

Static routes are listed first to ensure correct Hono matching order.

The frontend must `encodeURIComponent(email)` when constructing URLs for `PUT` and `DELETE` to handle emails containing `+` or other special characters. Hono decodes path parameters automatically.

### Delete guard

Two separate scalar queries to avoid the ambiguity of a multi-row UNION result:

```ts
const inReservas = await db
  .prepare(`SELECT COUNT(*) as n FROM reservas r
            JOIN slots s ON r.slot_id = s.id
            WHERE s.psicologo_id = ? AND r.paciente_email = ?`)
  .bind(psicologoId, email).first<{ n: number }>();

const inCancellations = await db
  .prepare(`SELECT COUNT(*) as n FROM cancellations
            WHERE psicologo_id = ? AND paciente_email = ?`)
  .bind(psicologoId, email).first<{ n: number }>();

const inRecurring = await db
  .prepare(`SELECT COUNT(*) as n FROM recurring_bookings
            WHERE psychologist_id = ? AND patient_email = ?`)
  .bind(psicologoId, email).first<{ n: number }>();

const total = (inReservas?.n ?? 0) + (inCancellations?.n ?? 0) + (inRecurring?.n ?? 0);
if (total > 0) {
  return c.json({ error: 'No se puede eliminar un paciente con historial de sesiones' }, 409);
}
```

### Import endpoint

Accepts `application/json` with the body `{ rows: Array<{ nombre: string; email: string; telefono: string }> }`. Max 500 rows per import.

The frontend is responsible for parsing the file before sending:
- **CSV**: parsed in the browser with a simple split/trim (no library needed for this simple 3-column format)
- **XLSX**: parsed in the browser using SheetJS (`xlsx`) — the same dependency used for export

The worker import endpoint never sees the raw file and has no dependency on a parsing library. This resolves the bundle size concern completely.

Expected columns (header row required): `nombre`, `email`, `telefono`.

Conflict detection checks against both `patients` AND `reservas` AND `recurring_bookings` (a patient who only exists in `recurring_bookings` would appear in the directory and must be treated as a conflict):

```ts
const existingEmails = await db
  .prepare(`
    SELECT email, nombre, telefono, 'manual' AS source FROM patients WHERE psicologo_id = ?
    UNION
    SELECT paciente_email, paciente_nombre, paciente_telefono, 'booking' FROM reservas r
    JOIN slots s ON r.slot_id = s.id WHERE s.psicologo_id = ?
    UNION
    SELECT patient_email, patient_name, patient_phone, 'booking' FROM recurring_bookings
    WHERE psychologist_id = ?
  `)
  .bind(psicologoId, psicologoId, psicologoId).all();
```

Returns:
```ts
{
  clean: Array<{ nombre: string; email: string; telefono: string }>,
  conflicts: ConflictRow[]
}
```

### Import confirm endpoint

Persists rows using SQLite upsert syntax (not `INSERT OR REPLACE`, which silently deletes and re-inserts changing `id` and `created_at`). All rows are executed as a single `db.batch()` call for atomicity — if any row fails, no rows are committed:

```ts
const stmts = rows.map(row =>
  db.prepare(`
    INSERT INTO patients (psicologo_id, nombre, email, telefono)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(psicologo_id, email)
    DO UPDATE SET nombre = excluded.nombre, telefono = excluded.telefono
  `).bind(psicologoId, row.nombre, row.email.toLowerCase(), row.telefono)
);
await db.batch(stmts);
```

### Export endpoint

Builds a flat dataset with one row per session per patient.

Columns: `nombre`, `email`, `telefono`, `total_sesiones`, `ultima_sesion`, `proxima_sesion`, `sesion_fecha`, `sesion_hora_inicio`, `sesion_estado`.

`sesion_estado` values:
- `realizada` — slot `fecha < date('now', '-3 hours')` (same UTC-3 offset used throughout the codebase)
- `proxima` — slot `fecha >= date('now', '-3 hours')`
- `cancelada` — row from `cancellations`

For patients with no sessions, `sesion_fecha` and `sesion_hora_inicio` are empty strings and `sesion_estado` is `null`.

**XLSX generation:** XLSX is generated on the **frontend** (not the worker). The export endpoint always returns JSON. The frontend uses SheetJS (`xlsx`) client-side to convert to `.xlsx` when the user selects "Excel". CSV is built directly from the JSON array on the frontend. SheetJS is installed as a frontend dependency only — the worker has no dependency on it.

**Note:** The export is unbounded (no pagination). Acceptable given a single-psychologist system, but worth noting as a known limit if the dataset grows significantly over years.

---

## Frontend

### `PatientsPage.tsx` changes

**Header area:**
- Add three buttons right-aligned: `+ Agregar paciente`, `Importar`, `Exportar`

**Table:**
- Add `source` field to each row's data (from API response)
- Show ✏️ and 🗑️ action icons only when `source === 'manual'`
- Clicking ✏️ opens `PatientFormModal` pre-filled with patient data
- Clicking 🗑️ shows confirmation; on confirm calls `DELETE /api/patients/${encodeURIComponent(email)}`
- If DELETE returns 409, show an error notification: "No se puede eliminar un paciente con historial de sesiones" (do not close the modal silently)

### New component: `PatientFormModal`

Single modal for both create and edit. Props: `patient?: Patient` (undefined = create mode).

Fields: nombre (text, required), email (text, required, disabled in edit mode), teléfono (text, optional).

On submit: calls `POST /api/patients` or `PUT /api/patients/${encodeURIComponent(email)}` depending on mode.

### New component: `ImportPatientsModal`

Step 1 — File upload: drag-and-drop or file picker, accepts `.csv` and `.xlsx`. The frontend parses the file immediately in the browser (CSV with native string ops; XLSX with SheetJS), validates that the required columns exist, then calls `POST /api/patients/import` with the parsed JSON rows and advances to Step 2.

Step 2 — Conflict review: shows a table with conflicting rows. Each row displays incoming vs. existing data with a toggle `Mantener existente` / `Reemplazar con nuevo`. Clean rows shown as a count ("X pacientes sin conflictos se importarán automáticamente"). Confirm button calls `POST /api/patients/import/confirm`.

Step 3 — Result: shows count of imported rows and any errors.

### Export button

Clicking `Exportar` opens a small dropdown: `CSV` / `Excel`.

Both options call `GET /api/patients/export` (JSON). The frontend then:
- **CSV**: builds the CSV string from the JSON array and triggers a download
- **Excel**: uses SheetJS (`xlsx`, installed as a frontend dev dependency) to generate an `.xlsx` blob client-side and triggers a download

---

## Error handling

| Scenario | Response |
|----------|----------|
| Create patient with existing email | 409 + "Ya existe un paciente con ese email" |
| Delete patient with session history | 409 + "No se puede eliminar un paciente con historial de sesiones" |
| Edit non-manual patient via API | 404 + "Paciente no encontrado en el directorio manual" |
| Import file with wrong columns | Validated client-side before API call: "El archivo debe tener columnas: nombre, email, teléfono" |
| Import more than 500 rows | 400 + "La importación no puede superar 500 pacientes a la vez" |
| PUT with empty/no updatable fields | 400 + "Debe enviar al menos un campo para actualizar" |

---

## Data model additions

```ts
interface Patient {
  email: string
  nombre: string
  telefono: string
  total_sesiones: number
  ultima_sesion: string | null
  proxima_sesion: string | null
  source: 'manual' | 'booking'  // NEW
}

interface ConflictRow {
  incoming: Pick<Patient, 'nombre' | 'email' | 'telefono'>
  existing: Pick<Patient, 'nombre' | 'email' | 'telefono'>
  existingSource: 'manual' | 'booking'
}

interface ExportRow {
  nombre: string
  email: string
  telefono: string
  total_sesiones: number
  ultima_sesion: string
  proxima_sesion: string
  sesion_fecha: string
  sesion_hora_inicio: string
  sesion_estado: 'realizada' | 'proxima' | 'cancelada' | null
}
```

---

## Migration

File: `worker/src/db/migrations/migration_patients.sql`

```sql
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

Apply with:
```bash
npx wrangler d1 execute psi-db --file=worker/src/db/migrations/migration_patients.sql
```

Also add the table to `worker/src/db/schema.sql` using `CREATE TABLE` (without `IF NOT EXISTS`) to stay consistent with the rest of that file, which defines the authoritative schema for reference only.
