ALTER TABLE subscriptions ADD COLUMN features TEXT DEFAULT 'reports,payroll';

CREATE TABLE IF NOT EXISTS pay_policies (
  company_id TEXT PRIMARY KEY,
  day_start TEXT NOT NULL,
  day_end TEXT NOT NULL,
  work_days TEXT NOT NULL,
  weekly_minutes INTEGER NOT NULL,
  lunch_allowance_minutes INTEGER NOT NULL,
  late_grace_minutes INTEGER NOT NULL,
  overtime_multiplier REAL NOT NULL,
  deduct_late INTEGER NOT NULL,
  deduct_extra_break INTEGER NOT NULL,
  deduct_absence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS employee_pay (
  employee_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  pay_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  month TEXT NOT NULL,
  status TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_month ON payroll_runs(company_id, month, status);

UPDATE subscriptions SET features = 'reports,payroll' WHERE features IS NULL OR features = '';
