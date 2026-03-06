-- Migration: add recurring_bookings table and link columns

CREATE TABLE IF NOT EXISTS recurring_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  psychologist_id INTEGER NOT NULL,
  patient_name TEXT NOT NULL,
  patient_email TEXT NOT NULL,
  patient_phone TEXT NOT NULL,
  frequency_weeks INTEGER NOT NULL,
  start_date DATE NOT NULL,
  time TIME NOT NULL,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (psychologist_id) REFERENCES psychologists(id)
);

ALTER TABLE slots ADD COLUMN recurring_booking_id INTEGER REFERENCES recurring_bookings(id);
ALTER TABLE bookings ADD COLUMN recurring_booking_id INTEGER REFERENCES recurring_bookings(id);
