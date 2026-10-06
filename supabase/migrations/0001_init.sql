-- Local reference schema for the offline demo store.
-- Do not apply this file to the Redface Pay database. That project already has workforce_* tables.
-- New Pay features are in Redface-pay/supabase/migrations/0477_workforce_clock_features.sql.

create extension if not exists pgcrypto;

create type public.employment_status as enum ('active', 'inactive', 'terminated');
create type public.app_role as enum ('admin', 'manager', 'employee');
create type public.attendance_event_type as enum (
  'CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END', 'MANUAL_ADJUSTMENT'
);
create type public.verification_method as enum ('FACIAL', 'PIN', 'CARD', 'SUPERVISOR');
create type public.verification_status as enum ('SUCCESS', 'FAILED', 'OVERRIDDEN');
create type public.leave_status as enum ('pending', 'approved', 'denied');
create type public.overtime_status as enum ('pending', 'approved', 'rejected');
create type public.device_status as enum ('active', 'disabled');
create type public.template_status as enum ('active', 'revoked');
create type public.day_status as enum (
  'leave', 'day_off', 'expected', 'absent', 'late', 'present', 'early_departure', 'open'
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Africa/Johannesburg',
  address text not null default '',
  grace_minutes integer not null default 5 check (grace_minutes >= 0 and grace_minutes <= 60),
  absence_cutoff_minutes integer not null default 60 check (absence_cutoff_minutes > 0),
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  name text not null,
  unique (location_id, name)
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,
  first_name text not null,
  last_name text not null,
  location_id uuid not null references public.locations(id),
  department_id uuid references public.departments(id),
  position_id uuid references public.positions(id),
  manager_id uuid references public.employees(id),
  status public.employment_status not null default 'active',
  pin_hash text,
  card_hash text,
  hired_on date,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null,
  full_name text not null,
  employee_id uuid references public.employees(id),
  created_at timestamptz not null default now()
);

create table public.location_members (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  primary key (profile_id, location_id)
);

create table public.biometric_consents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  purpose text not null default 'attendance_verification',
  notice_version text not null,
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  recorded_by uuid references public.profiles(id)
);

-- Ciphertext is an AES-256-GCM embedding. There is no image column.
create table public.biometric_templates (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  ciphertext bytea not null,
  model_version text not null,
  quality_score numeric,
  status public.template_status not null default 'active',
  enrolled_at timestamptz not null default now(),
  device_id uuid,
  revoked_at timestamptz
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  device_code text not null unique,
  location_id uuid not null references public.locations(id),
  name text not null,
  status public.device_status not null default 'active',
  secret_hash text not null,
  camera_config jsonb not null default '{}'::jsonb,
  match_threshold numeric not null default 0.40 check (match_threshold > 0 and match_threshold <= 1),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.biometric_templates
  add constraint biometric_templates_device_fk
  foreign key (device_id) references public.devices(id);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  location_id uuid not null references public.locations(id),
  day_of_week integer not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now()
);

create table public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  is_day_off boolean not null default false,
  start_time time,
  end_time time,
  reason text not null default '',
  unique (employee_id, work_date)
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  location_id uuid not null references public.locations(id),
  leave_type text not null,
  starts_on date not null,
  ends_on date not null,
  status public.leave_status not null default 'pending',
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  event_type public.attendance_event_type not null,
  occurred_at timestamptz not null,
  verification_method public.verification_method not null,
  verification_status public.verification_status not null,
  device_id uuid references public.devices(id),
  confidence_score numeric check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  liveness_passed boolean,
  client_event_id text not null unique,
  adjustment jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  constraint facial_success_requires_liveness check (
    not (verification_method = 'FACIAL' and verification_status = 'SUCCESS')
    or (liveness_passed is true and confidence_score is not null)
  )
);

create table public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  location_id uuid not null references public.locations(id),
  work_date date not null,
  status public.day_status not null,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  late_minutes integer not null default 0,
  early_departure_minutes integer not null default 0,
  scheduled_minutes integer not null default 0,
  worked_minutes integer not null default 0,
  break_minutes integer not null default 0,
  potential_overtime_minutes integer not null default 0,
  exception_notes text,
  calculated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

create table public.overtime_approvals (
  id uuid primary key default gen_random_uuid(),
  attendance_day_id uuid not null unique references public.attendance_days(id),
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  potential_minutes integer not null check (potential_minutes >= 0),
  approved_minutes integer check (approved_minutes is null or approved_minutes >= 0),
  status public.overtime_status not null default 'pending',
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_label text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index attendance_events_employee_time_idx on public.attendance_events (employee_id, occurred_at);
create index attendance_days_location_date_idx on public.attendance_days (location_id, work_date);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create or replace function public.prevent_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'attendance_events are append-only';
end;
$$;

create trigger attendance_events_immutable
before update or delete on public.attendance_events
for each row execute function public.prevent_event_mutation();

create or replace function public.touch_employee()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger employees_touch
before update on public.employees
for each row execute function public.touch_employee();

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select employee_id from public.profiles where id = auth.uid()
$$;

create or replace function public.can_access_location(loc uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() = 'admin'
    or exists (
      select 1 from public.location_members
      where profile_id = auth.uid() and location_id = loc
    )
$$;

alter table public.locations enable row level security;
alter table public.departments enable row level security;
alter table public.positions enable row level security;
alter table public.employees enable row level security;
alter table public.profiles enable row level security;
alter table public.location_members enable row level security;
alter table public.biometric_consents enable row level security;
alter table public.biometric_templates enable row level security;
alter table public.devices enable row level security;
alter table public.schedules enable row level security;
alter table public.schedule_exceptions enable row level security;
alter table public.leave_requests enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_days enable row level security;
alter table public.overtime_approvals enable row level security;
alter table public.audit_logs enable row level security;

-- The data API must not be able to read embedding ciphertext or device secrets.
revoke all on public.biometric_templates from anon, authenticated;
grant select (
  id, employee_id, model_version, quality_score, status, enrolled_at, device_id, revoked_at
) on public.biometric_templates to authenticated;

revoke all on public.devices from anon, authenticated;
grant select (
  id, device_code, location_id, name, status, camera_config, match_threshold, last_seen_at, created_at
) on public.devices to authenticated;

create policy locations_select on public.locations for select to authenticated
using (public.current_app_role() = 'admin' or public.can_access_location(id));

create policy departments_select on public.departments for select to authenticated
using (public.can_access_location(location_id));

create policy positions_select on public.positions for select to authenticated
using (auth.uid() is not null);

create policy employees_select on public.employees for select to authenticated
using (
  public.current_app_role() = 'admin'
  or public.can_access_location(location_id)
  or id = public.current_employee_id()
);

create policy profiles_select on public.profiles for select to authenticated
using (id = auth.uid() or public.current_app_role() in ('admin', 'manager'));

create policy members_select on public.location_members for select to authenticated
using (profile_id = auth.uid() or public.current_app_role() = 'admin');

create policy consents_select on public.biometric_consents for select to authenticated
using (
  exists (
    select 1 from public.employees e
    where e.id = employee_id
      and (public.can_access_location(e.location_id) or e.id = public.current_employee_id())
  )
);

create policy templates_select on public.biometric_templates for select to authenticated
using (
  exists (
    select 1 from public.employees e
    where e.id = employee_id and public.can_access_location(e.location_id)
  )
);

create policy devices_select on public.devices for select to authenticated
using (public.can_access_location(location_id));

create policy schedules_select on public.schedules for select to authenticated
using (
  public.can_access_location(location_id) or employee_id = public.current_employee_id()
);

create policy exceptions_select on public.schedule_exceptions for select to authenticated
using (
  employee_id = public.current_employee_id()
  or exists (
    select 1 from public.employees e
    where e.id = employee_id and public.can_access_location(e.location_id)
  )
);

create policy leave_select on public.leave_requests for select to authenticated
using (
  public.can_access_location(location_id) or employee_id = public.current_employee_id()
);

create policy events_select on public.attendance_events for select to authenticated
using (
  exists (
    select 1 from public.employees e
    where e.id = employee_id
      and (public.can_access_location(e.location_id) or e.id = public.current_employee_id())
  )
);

create policy days_select on public.attendance_days for select to authenticated
using (
  public.can_access_location(location_id) or employee_id = public.current_employee_id()
);

create policy overtime_select on public.overtime_approvals for select to authenticated
using (
  employee_id = public.current_employee_id()
  or exists (
    select 1 from public.employees e
    where e.id = employee_id and public.can_access_location(e.location_id)
  )
);

create policy audit_select on public.audit_logs for select to authenticated
using (public.current_app_role() in ('admin', 'manager'));

-- Writes from the browser are denied. The Next.js server uses the service role
-- after it has checked the signed-in role. Devices never receive a user JWT.
revoke insert, update, delete on all tables in schema public from anon, authenticated;
