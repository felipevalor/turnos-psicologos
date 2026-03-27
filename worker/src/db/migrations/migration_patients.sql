CREATE TABLE IF NOT EXISTS patients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  psicologo_id INTEGER NOT NULL,
  nombre       TEXT NOT NULL,
  email        TEXT NOT NULL,
  telefono     TEXT DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(psicologo_id, email),
  FOREIGN KEY (psicologo_id) REFERENCES psicologos(id)
);
