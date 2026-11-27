CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  registration_number TEXT,
  industry TEXT,
  address TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS company_users (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  effective_from TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS employee_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO companies (id, name, industry, contact_email, timezone, status, created_at)
SELECT id, name, 'Restaurant', 'owner@abcrestaurant.test', timezone, 'active', '2026-11-27T08:00:00.000Z'
FROM businesses
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE companies.id = businesses.id);
ALTER TABLE employees ADD COLUMN company_id TEXT;
ALTER TABLE employees ADD COLUMN department_id TEXT;
ALTER TABLE employees ADD COLUMN role_id TEXT;
ALTER TABLE employees ADD COLUMN nfc_lookup TEXT;
ALTER TABLE stations ADD COLUMN company_id TEXT;
ALTER TABLE stations ADD COLUMN public_code TEXT;
ALTER TABLE attendance_events ADD COLUMN company_id TEXT;
ALTER TABLE qr_challenges ADD COLUMN company_id TEXT;
UPDATE employees SET company_id = business_id WHERE company_id IS NULL;
UPDATE stations SET company_id = business_id WHERE company_id IS NULL;
UPDATE attendance_events SET company_id = business_id WHERE company_id IS NULL;
UPDATE stations SET public_code = 'abc7k2front' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000002' AND (public_code IS NULL OR public_code = '');
UPDATE employees SET nfc_lookup = '6f2204b43458e1f8dee2a5033d76146f5e0d8acfda7c523ba57ae88cd7e7ed7c' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000101';
UPDATE employees SET nfc_lookup = 'de476eb55796c1ec9c7db30c78424670433707db44d32842119696f2ec972615' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000102';
UPDATE employees SET nfc_lookup = '27b8d0db6ad90f87730ba4bb78c19e7e88c22873ed6e2a1f39ad3243588bbfe8' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000103';
UPDATE employees SET nfc_lookup = '7f8f3769209258e89f668fee43ec2593a4c17954c376fc9687172aadf8440968' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000104';
UPDATE employees SET nfc_lookup = 'bd58d4db2a7adfabd6e5f5349e717cc7152dad9843b8e8fc1461aa9e0787e97f' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000105';
UPDATE employees SET nfc_lookup = 'cd9e4ec76d1db7328759d6a8ab0159672c8230171681596c33c8bb05a10a5fcd' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000106';
INSERT OR IGNORE INTO departments (id, company_id, name) VALUES
('8f0c1a2e-7b34-4c1a-9d11-abc000000301', '8f0c1a2e-7b34-4c1a-9d11-abc000000001', 'Front of house'),
('8f0c1a2e-7b34-4c1a-9d11-abc000000302', '8f0c1a2e-7b34-4c1a-9d11-abc000000001', 'Kitchen');
INSERT OR IGNORE INTO roles (id, company_id, name) VALUES
('8f0c1a2e-7b34-4c1a-9d11-abc000000401', '8f0c1a2e-7b34-4c1a-9d11-abc000000001', 'Waiter'),
('8f0c1a2e-7b34-4c1a-9d11-abc000000402', '8f0c1a2e-7b34-4c1a-9d11-abc000000001', 'Manager'),
('8f0c1a2e-7b34-4c1a-9d11-abc000000403', '8f0c1a2e-7b34-4c1a-9d11-abc000000001', 'Chef'),
('8f0c1a2e-7b34-4c1a-9d11-abc000000404', '8f0c1a2e-7b34-4c1a-9d11-abc000000001', 'Cashier'),
('8f0c1a2e-7b34-4c1a-9d11-abc000000405', '8f0c1a2e-7b34-4c1a-9d11-abc000000001', 'Kitchen');
UPDATE employees SET department_id = '8f0c1a2e-7b34-4c1a-9d11-abc000000302', role_id = '8f0c1a2e-7b34-4c1a-9d11-abc000000403' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000103';
UPDATE employees SET department_id = '8f0c1a2e-7b34-4c1a-9d11-abc000000302', role_id = '8f0c1a2e-7b34-4c1a-9d11-abc000000405' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000106';
UPDATE employees SET department_id = '8f0c1a2e-7b34-4c1a-9d11-abc000000301', role_id = '8f0c1a2e-7b34-4c1a-9d11-abc000000402' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000102';
UPDATE employees SET department_id = '8f0c1a2e-7b34-4c1a-9d11-abc000000301', role_id = '8f0c1a2e-7b34-4c1a-9d11-abc000000404' WHERE id = '8f0c1a2e-7b34-4c1a-9d11-abc000000104';
UPDATE employees SET department_id = '8f0c1a2e-7b34-4c1a-9d11-abc000000301', role_id = '8f0c1a2e-7b34-4c1a-9d11-abc000000401' WHERE role_title = 'Waiter' AND company_id = '8f0c1a2e-7b34-4c1a-9d11-abc000000001';
INSERT OR IGNORE INTO company_users (id, company_id, email, password_hash, full_name, role, status, created_at)
VALUES ('8f0c1a2e-7b34-4c1a-9d11-abc000000201', '8f0c1a2e-7b34-4c1a-9d11-abc000000001', 'owner@abcrestaurant.test', 'pbkdf2$10000$8f0c1a2e-7b34-4c1a-9d11-abc000000201$wClEeTvUflrXYwP2yeL/S2iWmc6XA0cYap9lvFun7nY=', 'ABC Owner', 'owner', 'active', '2026-11-27T08:00:00.000Z');
INSERT OR IGNORE INTO subscriptions (id, company_id, plan, status, started_at)
VALUES ('8f0c1a2e-7b34-4c1a-9d11-abc000000501', '8f0c1a2e-7b34-4c1a-9d11-abc000000001', 'trial', 'active', '2026-11-27T08:00:00.000Z');
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id, status, first_name);
CREATE INDEX IF NOT EXISTS idx_employees_card ON employees(company_id, nfc_lookup);
CREATE INDEX IF NOT EXISTS idx_events_company_day ON attendance_events(company_id, work_date, occurred_at);
CREATE INDEX IF NOT EXISTS idx_stations_company ON stations(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stations_code ON stations(public_code);
