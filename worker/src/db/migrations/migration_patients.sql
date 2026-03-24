CREATE TABLE IF NOT EXISTS patients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  psicologo_id INTEGER NOT NULL REFERENCES psicologos(id),
  nombre       TEXT NOT NULL,
  email        TEXT NOT NULL,
  telefono     TEXT DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(psicologo_id, email)
);
