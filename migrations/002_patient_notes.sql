-- Migration: Create paciente_notas table
CREATE TABLE paciente_notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  psicologo_id INTEGER NOT NULL,
  paciente_email TEXT NOT NULL,
  contenido TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (psicologo_id) REFERENCES psicologos(id)
);

CREATE INDEX IF NOT EXISTS idx_notas_psicologo_paciente ON paciente_notas(psicologo_id, paciente_email);
