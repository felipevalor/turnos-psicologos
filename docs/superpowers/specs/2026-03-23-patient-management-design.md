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
  telefono     TEXT NOT NULL,
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(psicologo_id, email)
);
```

The `UNIQUE(psicologo_id, email)` constraint prevents duplicates per psychologist. Email is the canonical patient identifier, consistent with the rest of the system.

Migration file: `worker/src/db/migrations/migration_patients.sql`

---

## Backend

### Modified route: `GET /api/patients`

The existing UNION query gains a fourth source:

```sql
SELECT nombre, email, telefono, 'manual' AS source FROM patients
WHERE psicologo_id = ?
```

When the same email appears in both `patients` and booking tables, the manual record's `nombre` and `telefono` take priority. Each row in the response includes a `source` field (`'manual'` or `'booking'`) so the frontend knows which rows are editable.

### New routes in `worker/src/routes/patients.ts`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/patients` | Create a manual patient. 409 if email already exists. |
| `PUT` | `/api/patients/:email` | Update `nombre` and/or `telefono` of a manual patient. 404 if not in `patients` table. |
| `DELETE` | `/api/patients/:email` | Delete a manual patient. 409 if the patient has any rows in `reservas` or `cancellations`. |
| `POST` | `/api/patients/import` | Parse uploaded CSV or XLSX. Returns `{ clean: Patient[], conflicts: ConflictRow[] }`. Does not persist. |
| `POST` | `/api/patients/import/confirm` | Receives resolved conflict decisions and persists all rows via `INSERT OR REPLACE`. |
| `GET` | `/api/patients/export` | Returns all patients with full session history. `?format=xlsx` for Excel, default CSV. |

### Delete guard

Before deleting, the route checks:
```sql
SELECT COUNT(*) FROM reservas r
JOIN slots s ON r.slot_id = s.id
WHERE s.psicologo_id = ? AND r.paciente_email = ?
UNION ALL
SELECT COUNT(*) FROM cancellations
WHERE psicologo_id = ? AND paciente_email = ?
```

If count > 0, returns `409 Conflict` with message `"No se puede eliminar un paciente con historial de sesiones"`.

### Import endpoint

Accepts `multipart/form-data` with a single `file` field (`.csv` or `.xlsx`).

Expected columns (header row required): `nombre`, `email`, `telefono`.

Returns:
```ts
{
  clean: Patient[],          // rows with no existing email in patients/reservas
  conflicts: {
    incoming: Patient,
    existing: Patient,
    existingSource: 'manual' | 'booking'
  }[]
}
```

### Export endpoint

Builds a flat dataset with one row per session per patient:

Columns: `nombre`, `email`, `telefono`, `total_sesiones`, `ultima_sesion`, `proxima_sesion`, `sesion_fecha`, `sesion_hora_inicio`, `sesion_estado` (`realizada` | `cancelada` | `proxima`).

For patients with no sessions, session columns are empty.

Uses SheetJS (`xlsx`) for XLSX generation — compatible with Cloudflare Workers.

---

## Frontend

### `PatientsPage.tsx` changes

**Header area:**
- Add three buttons right-aligned: `+ Agregar paciente`, `Importar`, `Exportar`

**Table:**
- Add a `source` column (hidden) to each row's data
- Show ✏️ and 🗑️ action icons only when `source === 'manual'`
- Clicking ✏️ opens `PatientFormModal` pre-filled with patient data
- Clicking 🗑️ shows confirmation toast; on confirm calls `DELETE /api/patients/:email`

### New component: `PatientFormModal`

Single modal for both create and edit. Props: `patient?: Patient` (undefined = create mode).

Fields: nombre (text, required), email (text, required, disabled in edit mode), teléfono (text, required).

On submit: calls `POST /api/patients` or `PUT /api/patients/:email` depending on mode.

### New component: `ImportPatientsModal`

Step 1 — File upload: drag-and-drop or file picker, accepts `.csv` and `.xlsx`. On upload, calls `POST /api/patients/import` and advances to Step 2.

Step 2 — Conflict review: shows a table with all conflicting rows. Each row has the incoming vs. existing data and a toggle `Mantener existente` / `Reemplazar con nuevo`. Clean rows are shown as a count ("X pacientes sin conflictos se importarán automáticamente"). Confirm button calls `POST /api/patients/import/confirm`.

Step 3 — Result: shows count of imported rows and any errors.

### Export button

Clicking `Exportar` opens a small dropdown: `CSV` / `Excel`. Triggers `GET /api/patients/export` or `GET /api/patients/export?format=xlsx` and downloads the file.

---

## Error handling

| Scenario | Response |
|----------|----------|
| Create patient with existing email | 409 + "Ya existe un paciente con ese email" |
| Delete patient with session history | 409 + "No se puede eliminar un paciente con historial de sesiones" |
| Edit non-manual patient via API | 404 + "Paciente no encontrado en el directorio manual" |
| Import file with wrong columns | 400 + "El archivo debe tener columnas: nombre, email, teléfono" |
| Import file too large (>1MB) | 400 + "El archivo no puede superar 1MB" |

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
  telefono     TEXT NOT NULL,
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(psicologo_id, email)
);
```

Apply with:
```bash
npx wrangler d1 execute psi-db --file=worker/src/db/migrations/migration_patients.sql
```

Also update `worker/src/db/schema.sql` to include the new table definition.
