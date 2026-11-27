CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'online'
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  pin_hash TEXT,
  nfc_hash TEXT,
  face_object_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qr_challenges (
  token TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS attendance_events (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  station_id TEXT,
  event_type TEXT NOT NULL,
  method TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  work_date TEXT NOT NULL,
  client_event_id TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee_time
  ON attendance_events (employee_id, occurred_at);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  employee_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);
