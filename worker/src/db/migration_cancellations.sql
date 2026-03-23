-- Migration: add cancellations audit table for dashboard tracking

CREATE TABLE IF NOT EXISTS cancellations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  psicologo_id     INTEGER NOT NULL,
  slot_id          INTEGER NOT NULL,
  slot_fecha       TEXT    NOT NULL,
  slot_hora_inicio TEXT    NOT NULL,
  paciente_nombre  TEXT    NOT NULL,
  paciente_email   TEXT    NOT NULL,
  paciente_telefono TEXT,
  reason           TEXT    NOT NULL DEFAULT 'patient_cancel',
  cancelled_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (psicologo_id) REFERENCES psicologos(id)
);

CREATE INDEX IF NOT EXISTS idx_cancellations_psicologo_fecha
  ON cancellations(psicologo_id, slot_fecha);
