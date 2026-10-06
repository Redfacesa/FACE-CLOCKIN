-- Additive Face Clock features on the existing Redface Pay workforce tables.
-- Requires workforce migration 0476. Does not create those tables, open a database
-- connection, or rewrite biometric descriptors that are already stored.
-- Attendance events are retained. Deleting an employee is refused while any of
-- that employee's events exist. Deactivate the employee instead of deleting the row.
--
-- Run this file as one transaction. BEGIN/COMMIT roll every change back if a
-- later statement fails. Do not run it inside a transaction that is already open.

begin;

-- Names the one single-column foreign key on workforce_attendance_events from
-- p_source_column to p_referenced_schema.p_referenced_table(p_referenced_column).
-- Composite keys and references in any other schema are ignored.
create or replace function pg_temp.workforce_event_fk_name(
  p_source_column text,
  p_referenced_schema text,
  p_referenced_table text,
  p_referenced_column text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  names text[];
begin
  select pg_catalog.array_agg(c.conname order by c.conname)
    into names
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class source_table on source_table.oid = c.conrelid
  join pg_catalog.pg_namespace source_schema on source_schema.oid = source_table.relnamespace
  join pg_catalog.pg_class referenced_table on referenced_table.oid = c.confrelid
  join pg_catalog.pg_namespace referenced_schema on referenced_schema.oid = referenced_table.relnamespace
  join pg_catalog.pg_attribute source_column
    on source_column.attrelid = c.conrelid
   and source_column.attnum = c.conkey[1]
   and not source_column.attisdropped
  join pg_catalog.pg_attribute referenced_column
    on referenced_column.attrelid = c.confrelid
   and referenced_column.attnum = c.confkey[1]
   and not referenced_column.attisdropped
  where c.contype = 'f'
    and pg_catalog.array_length(c.conkey, 1) = 1
    and pg_catalog.array_length(c.confkey, 1) = 1
    and source_schema.nspname = 'public'
    and source_table.relname = 'workforce_attendance_events'
    and source_column.attname = p_source_column
    and referenced_schema.nspname = p_referenced_schema
    and referenced_table.relname = p_referenced_table
    and referenced_column.attname = p_referenced_column;

  if names is null or pg_catalog.array_length(names, 1) is null then
    raise exception
      'public.workforce_attendance_events.% has no single-column foreign key to %.%(%)',
      p_source_column, p_referenced_schema, p_referenced_table, p_referenced_column;
  end if;
  if pg_catalog.array_length(names, 1) > 1 then
    raise exception
      'public.workforce_attendance_events.% has more than one single-column foreign key to %.%(%)',
      p_source_column, p_referenced_schema, p_referenced_table, p_referenced_column;
  end if;
  return names[1];
end;
$$;

do $$
declare
  required_tables text[] := array[
    'merchants',
    'workforce_employees',
    'workforce_attendance_events',
    'workforce_biometric_profiles',
    'workforce_overtime_approvals'
  ];
  event_columns text[] := array[
    'id',
    'merchant_id',
    'employee_id',
    'shift_id',
    'event_type',
    'occurred_at',
    'method',
    'match_score',
    'device_label',
    'notes',
    'recorded_by',
    'metadata',
    'created_at'
  ];
  required_name text;
  v_required_column text;
begin
  foreach required_name in array required_tables loop
    if to_regclass('public.' || required_name) is null then
      raise exception 'public.% is missing. Apply workforce migration 0476 first.', required_name;
    end if;
  end loop;

  if to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.merchant_owned(uuid)') is null then
    raise exception 'public.is_admin() or public.merchant_owned(uuid) is missing';
  end if;

  foreach v_required_column in array event_columns loop
    if not exists (
      select 1
      from information_schema.columns as c
      where c.table_schema = 'public'
        and c.table_name = 'workforce_attendance_events'
        and c.column_name = v_required_column
    ) then
      raise exception 'public.workforce_attendance_events.% is missing', v_required_column;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workforce_biometric_profiles'
      and column_name = 'descriptor'
  ) then
    raise exception 'public.workforce_biometric_profiles.descriptor is missing';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'merchants'
      and column_name = 'id'
  ) then
    raise exception 'public.merchants.id is missing';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workforce_employees'
      and column_name = 'id'
  ) then
    raise exception 'public.workforce_employees.id is missing';
  end if;

  perform pg_temp.workforce_event_fk_name('merchant_id', 'public', 'merchants', 'id');
  perform pg_temp.workforce_event_fk_name('employee_id', 'public', 'workforce_employees', 'id');

  if exists (
    select 1
    from public.workforce_attendance_events
    where event_type is null
       or event_type not in ('clock_in', 'clock_out', 'break_start', 'break_end', 'manual_adjustment')
  ) then
    raise exception 'workforce_attendance_events has an event_type the new check would reject';
  end if;
end $$;

alter table public.workforce_attendance_events
  drop constraint if exists workforce_attendance_events_event_type_check;
alter table public.workforce_attendance_events
  add constraint workforce_attendance_events_event_type_check
  check (event_type is not null and event_type in ('clock_in', 'clock_out', 'break_start', 'break_end', 'manual_adjustment'));

alter table public.workforce_attendance_events
  add column if not exists liveness_passed boolean,
  add column if not exists client_event_id text;

create unique index if not exists workforce_attendance_events_client_id_idx
  on public.workforce_attendance_events (client_event_id)
  where client_event_id is not null;

-- Replace only merchant_id -> public.merchants(id). A composite key, or a
-- foreign key to some other merchants table, is left in place.
do $$
begin
  execute format(
    'alter table public.workforce_attendance_events drop constraint %I',
    pg_temp.workforce_event_fk_name('merchant_id', 'public', 'merchants', 'id')
  );
end $$;

alter table public.workforce_attendance_events
  add constraint workforce_attendance_events_merchant_id_fkey
  foreign key (merchant_id) references public.merchants(id) on delete no action;

-- Replace only employee_id -> public.workforce_employees(id). Employee deletion
-- is refused while attendance events still reference that employee.
do $$
begin
  execute format(
    'alter table public.workforce_attendance_events drop constraint %I',
    pg_temp.workforce_event_fk_name('employee_id', 'public', 'workforce_employees', 'id')
  );
end $$;

alter table public.workforce_attendance_events
  add constraint workforce_attendance_events_employee_id_fkey
  foreign key (employee_id) references public.workforce_employees(id) on delete no action;

alter table public.workforce_biometric_profiles
  add column if not exists embedding_ciphertext text,
  add column if not exists embedding_model text;

comment on column public.workforce_biometric_profiles.descriptor is
  'Legacy face data. Existing values are left unchanged and are not encrypted by this migration. New enrollments do not write a face template here.';
comment on column public.workforce_biometric_profiles.embedding_ciphertext is
  'Canonical face template. Base64 of AES-256-GCM bytes in this order: 12-byte nonce, 16-byte authentication tag, then ciphertext. The stored value is not ciphertext alone. Attendance does not store photographs.';

alter table public.workforce_overtime_approvals
  add column if not exists approved_minutes int;

create table if not exists public.workforce_devices (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  device_code text not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  match_threshold numeric not null default 0.40,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (merchant_id, device_code)
);

-- Device secrets are not on the client-visible table. RLS would still expose
-- every column of a granted row. This table has no privileges for API roles.
create table if not exists public.workforce_device_secrets (
  device_id uuid primary key references public.workforce_devices(id) on delete cascade,
  secret_hash text not null
);

comment on table public.workforce_device_secrets is
  'SHA-256 device secret. Not granted to anon, authenticated, or public. Registration writes it through workforce_register_device().';

-- A previous draft stored the hash on workforce_devices. Move it off that table
-- so a client select cannot return it. Skipped when this revision is applied first.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workforce_devices'
      and column_name = 'secret_hash'
  ) then
    insert into public.workforce_device_secrets (device_id, secret_hash)
    select id, secret_hash
    from public.workforce_devices
    where secret_hash is not null
    on conflict (device_id) do nothing;
    alter table public.workforce_devices drop column secret_hash;
  end if;
end $$;

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

revoke all on table public.workforce_devices from public, anon, authenticated;
grant select, update, delete on table public.workforce_devices to authenticated;

alter table public.workforce_device_secrets enable row level security;
revoke all on table public.workforce_device_secrets from public, anon, authenticated;

create or replace function public.workforce_register_device(
  p_merchant_id uuid,
  p_device_code text,
  p_name text,
  p_match_threshold numeric,
  p_secret_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text;
begin
  if not (
    coalesce(public.is_admin(), false)
    or coalesce(public.merchant_owned(p_merchant_id), false)
  ) then
    raise exception 'not allowed to register a device for this merchant';
  end if;
  if p_match_threshold is null or p_match_threshold < 0 or p_match_threshold > 1 then
    raise exception 'match_threshold must be between 0 and 1';
  end if;
  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'device secret hash must be a sha256 hex digest';
  end if;
  v_code := pg_catalog.upper(pg_catalog.btrim(p_device_code));
  if v_code is null or v_code = '' or p_name is null or pg_catalog.btrim(p_name) = '' then
    raise exception 'device code and name are required';
  end if;

  insert into public.workforce_devices (
    merchant_id, device_code, name, status, match_threshold
  ) values (
    p_merchant_id, v_code, pg_catalog.btrim(p_name), 'active', p_match_threshold
  )
  returning id into v_id;

  insert into public.workforce_device_secrets (device_id, secret_hash)
  values (v_id, p_secret_hash);

  return pg_catalog.jsonb_build_object('id', v_id, 'device_code', v_code);
end;
$$;

revoke all on function public.workforce_register_device(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.workforce_register_device(uuid, text, text, numeric, text) to authenticated;

revoke update, delete, truncate on table public.workforce_attendance_events from public, anon, authenticated;

-- Every direct delete is rejected. This trigger never disables another trigger.
create or replace function public.workforce_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
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

drop trigger if exists workforce_employees_delete_events on public.workforce_employees;
drop function if exists public.workforce_employee_delete_events();

commit;
