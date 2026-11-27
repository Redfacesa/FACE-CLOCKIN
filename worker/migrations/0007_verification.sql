ALTER TABLE companies ADD COLUMN trading_name TEXT;
ALTER TABLE companies ADD COLUMN business_type TEXT;
ALTER TABLE companies ADD COLUMN employee_estimate INTEGER;
ALTER TABLE companies ADD COLUMN owner_id_number TEXT;
ALTER TABLE companies ADD COLUMN review_note TEXT;

CREATE TABLE IF NOT EXISTS business_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
