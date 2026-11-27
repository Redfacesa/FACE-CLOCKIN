ALTER TABLE company_users ADD COLUMN email_verified_at TEXT;
ALTER TABLE company_users ADD COLUMN activated_at TEXT;
ALTER TABLE employees ADD COLUMN phone TEXT;
ALTER TABLE employees ADD COLUMN email TEXT;
ALTER TABLE employees ADD COLUMN photo_key TEXT;

CREATE TABLE IF NOT EXISTS email_verifications (
  lookup TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS face_templates (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  descriptor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_face_company ON face_templates(company_id, status);

UPDATE company_users SET email_verified_at = created_at WHERE email_verified_at IS NULL;
UPDATE company_users SET activated_at = created_at WHERE activated_at IS NULL;
UPDATE stations SET methods = 'nfc,qr,pin,face' WHERE methods IS NULL OR methods NOT LIKE '%face%';
