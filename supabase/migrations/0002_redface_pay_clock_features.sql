-- Additive Face Clock features on the existing Redface Pay workforce tables.
-- Requires workforce migration 0476. Does not open a database connection and does not
-- rewrite biometric descriptors that are already stored.

do $$
begin
  if to_regclass('public.workforce_attendance_events') is null then
    raise exception 'workforce_attendance_events is missing. Apply workforce migration 0476 first.';
  end if;
  if to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.merchant_owned(uuid)') is null then
    raise exception 'public.is_admin() or public.merchant_owned(uuid) is missing';
  end if;
  if exists (
    select 1
    from public.workforce_attendance_events
    where event_type not in ('clock_in', 'clock_out', 'break_start', 'break_end', 'manual_adjustment')
  ) then
    raise exception 'workforce_attendance_events has an event_type the new check would reject';
  end if;
end $$;

alter table public.workforce_attendance_events
  drop constraint if exists workforce_attendance_events_event_type_check;
alter table public.workforce_attendance_events
  add constraint workforce_attendance_events_event_type_check
  check (event_type in ('clock_in', 'clock_out', 'break_start', 'break_end', 'manual_adjustment'));

alter table public.workforce_attendance_events
  add column if not exists liveness_passed boolean,
  add column if not exists client_event_id text;

create unique index if not exists workforce_attendance_events_client_id_idx
  on public.workforce_attendance_events (client_event_id)
  where client_event_id is not null;

-- Merchant deletion must not cascade straight into events. Employee deletion
-- removes that employee's events first, then this NO ACTION check runs.
do $$
declare
  constraint_name text;
begin
  select c.conname into constraint_name
  from pg_constraint c
  join pg_class referenced on referenced.oid = c.confrelid
  where c.conrelid = 'public.workforce_attendance_events'::regclass
    and c.contype = 'f'
    and referenced.relname = 'merchants'
  limit 1;
  if constraint_name is not null then
    execute format(
      'alter table public.workforce_attendance_events drop constraint %I',
      constraint_name
    );
  end if;
end $$;

alter table public.workforce_attendance_events
  add constraint workforce_attendance_events_merchant_id_fkey
  foreign key (merchant_id) references public.merchants(id) on delete no action;

alter table public.workforce_biometric_profiles
  add column if not exists embedding_ciphertext text,
  add column if not exists embedding_model text;

comment on column public.workforce_biometric_profiles.descriptor is
  'Existing values are left unchanged. This migration does not encrypt or delete them. Face Clock writes a new AES-GCM package here.';
comment on column public.workforce_biometric_profiles.embedding_ciphertext is
  'Optional AES-GCM copy of a face embedding. Attendance does not store photographs. Existing descriptor values are not copied into this column.';

alter table public.workforce_overtime_approvals
  add column if not exists approved_minutes int;

create table if not exists public.workforce_devices (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  device_code text not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  secret_hash text not null,
  match_threshold numeric not null default 0.40,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (merchant_id, device_code)
);

alter table public.workforce_devices
  drop constraint if exists workforce_devices_match_threshold_check;
alter table public.workforce_devices
  add constraint workforce_devices_match_threshold_check
  check (match_threshold >= 0 and match_threshold <= 1);

alter table public.workforce_devices enable row level security;
drop policy if exists workforce_devices_merchant on public.workforce_devices;
create policy workforce_devices_merchant on public.workforce_devices
  for all to authenticated
  using (public.is_admin() or public.merchant_owned(merchant_id))
  with check (public.is_admin() or public.merchant_owned(merchant_id));

revoke all on table public.workforce_devices from public, anon;
grant select, insert, update, delete on table public.workforce_devices to authenticated;

revoke update, delete on table public.workforce_attendance_events from public, anon, authenticated;

-- Only an employee-row delete may remove that employee's events.
-- A direct delete, or a nested delete from any other trigger, is rejected.
create or replace function public.workforce_events_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('workforce.allow_event_delete', true) = 'employee-delete' then
      return old;
    end if;
    raise exception 'workforce_attendance_events are append-only';
  end if;

  if old.shift_id is not null
     and new.shift_id is null
     and new.id is not distinct from old.id
     and new.merchant_id is not distinct from old.merchant_id
     and new.employee_id is not distinct from old.employee_id
     and new.event_type is not distinct from old.event_type
     and new.occurred_at is not distinct from old.occurred_at
     and new.method is not distinct from old.method
     and new.match_score is not distinct from old.match_score
     and new.device_label is not distinct from old.device_label
     and new.notes is not distinct from old.notes
     and new.recorded_by is not distinct from old.recorded_by
     and new.metadata is not distinct from old.metadata
     and new.created_at is not distinct from old.created_at
     and new.client_event_id is not distinct from old.client_event_id
     and new.liveness_passed is not distinct from old.liveness_passed
  then
    return new;
  end if;

  raise exception 'workforce_attendance_events are append-only';
end;
$$;

revoke all on function public.workforce_events_append_only() from public, anon, authenticated;

drop trigger if exists workforce_attendance_events_immutable on public.workforce_attendance_events;
create trigger workforce_attendance_events_immutable
  before update or delete on public.workforce_attendance_events
  for each row execute function public.workforce_events_append_only();

create or replace function public.workforce_employee_delete_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('workforce.allow_event_delete', 'employee-delete', true);
  delete from public.workforce_attendance_events where employee_id = old.id;
  perform set_config('workforce.allow_event_delete', '', true);
  return old;
end;
$$;

revoke all on function public.workforce_employee_delete_events() from public, anon, authenticated;

drop trigger if exists workforce_employees_delete_events on public.workforce_employees;
create trigger workforce_employees_delete_events
  before delete on public.workforce_employees
  for each row execute function public.workforce_employee_delete_events();
