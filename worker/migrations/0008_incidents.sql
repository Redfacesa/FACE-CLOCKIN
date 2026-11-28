CREATE TABLE IF NOT EXISTS platform_incidents (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  code TEXT,
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_created ON platform_incidents(created_at);
