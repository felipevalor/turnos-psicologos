-- Seed: test psychologist
INSERT INTO psicologos (nombre, email, password_hash)
VALUES ('Psicólogo Admin', 'admin@turnospsi.com', '91bbd8e127307b8e48144671d5cc2a32:025bb35dbac2dc393f82eb5b2af7c63e0785a83f4a3446f441b9eada8846dd24')
ON CONFLICT(email) DO NOTHING;
