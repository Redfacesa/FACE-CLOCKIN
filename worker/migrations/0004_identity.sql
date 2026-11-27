ALTER TABLE companies ADD COLUMN default_start TEXT DEFAULT '08:00';
ALTER TABLE employees ADD COLUMN employee_number TEXT;
ALTER TABLE stations ADD COLUMN location TEXT;
ALTER TABLE stations ADD COLUMN methods TEXT DEFAULT 'nfc,qr,pin';
ALTER TABLE subscriptions ADD COLUMN employee_limit INTEGER;

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  method TEXT NOT NULL,
  lookup TEXT,
  secret_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  issued_at TEXT NOT NULL,
  confirmed_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  notice_version TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  withdrawn_at TEXT
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

UPDATE companies SET default_start = '08:00' WHERE default_start IS NULL;
UPDATE stations SET location = 'Main entrance' WHERE location IS NULL;
UPDATE stations SET methods = 'nfc,qr,pin' WHERE methods IS NULL;
UPDATE subscriptions SET employee_limit = 25 WHERE employee_limit IS NULL;
UPDATE subscriptions SET plan = 'starter' WHERE plan = 'trial';

UPDATE employees SET employee_number = 'EMP-001' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000101' AND employee_number IS NULL;
UPDATE employees SET employee_number = 'EMP-002' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000102' AND employee_number IS NULL;
UPDATE employees SET employee_number = 'EMP-003' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000103' AND employee_number IS NULL;
UPDATE employees SET employee_number = 'EMP-004' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000104' AND employee_number IS NULL;
UPDATE employees SET employee_number = 'EMP-005' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000105' AND employee_number IS NULL;
UPDATE employees SET employee_number = 'EMP-006' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000106' AND employee_number IS NULL;

CREATE INDEX IF NOT EXISTS idx_credentials_lookup ON credentials(company_id, method, lookup, status);
CREATE INDEX IF NOT EXISTS idx_leave_company ON leave_requests(company_id, starts_on, ends_on);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_number ON employees(company_id, employee_number);
