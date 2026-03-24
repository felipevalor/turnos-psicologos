-- Add slot_id to paciente_notas to link notes to specific sessions
ALTER TABLE paciente_notas ADD COLUMN slot_id INTEGER REFERENCES slots(id);

-- Add index for performance when querying notes by slot
CREATE INDEX IF NOT EXISTS idx_notas_slot_id ON paciente_notas(slot_id);
