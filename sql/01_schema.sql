-- Run once in a NEW Supabase project. PostgreSQL 15+. All four files are transactional.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create type public.app_role as enum ('admin','marketing','production_head','production','inspection','warehouse','viewer');
create type public.order_status as enum ('Draft','Confirmed','Acknowledged','In Production','In Inspection','In Warehouse','Completed','Rejected','Cancelled');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 username text not null unique check (username ~ '^[a-z0-9][a-z0-9_.-]{2,31}$' and username !~ '\.\.|\.$'),
 full_name text not null check (length(btrim(full_name)) between 1 and 150),
 real_email text, role public.app_role not null default 'viewer', active boolean not null default true,
 must_change_password boolean not null default true, last_login timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references public.profiles(id) on delete restrict
);
create table public.customers (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(btrim(name)) between 1 and 150),
 description text, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id) default auth.uid()
);
create table public.fabrics (
 id uuid primary key default gen_random_uuid(), quality_name text not null unique check(length(btrim(quality_name)) between 1 and 150),
 description text, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id) default auth.uid()
);
create table public.processes (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(btrim(name)) between 1 and 150),
 typical_order integer check(typical_order >= 0), type text not null default 'Process', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id) default auth.uid()
);
create table public.orders (
 id uuid primary key default gen_random_uuid(), po_number text not null check(length(btrim(po_number)) between 1 and 100),
 customer_id uuid not null references public.customers(id), fabric_id uuid not null references public.fabrics(id),
 shade text not null check(length(btrim(shade)) between 1 and 100), grade text not null check(length(btrim(grade)) between 1 and 100),
 quantity numeric(14,3) not null check(quantity > 0 and quantity <> 'NaN'::numeric),
 confirmation_status text not null default 'Draft' check(confirmation_status in ('Draft','Confirmed','Cancelled')),
 status public.order_status not null default 'Draft', order_date date not null default current_date check(isfinite(order_date)),
 delivery_date date check(delivery_date is null or isfinite(delivery_date)), remarks text, roll_lot_number text, gsm numeric(10,3), width text, design_article_number text, notes text,
 acknowledged_by uuid references public.profiles(id), acknowledged_at timestamptz, status_reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id) default auth.uid(),
 unique(customer_id, po_number),
 check((acknowledged_at is null) = (acknowledged_by is null)),
 check ((status='Draft' and confirmation_status='Draft') or (status='Cancelled' and confirmation_status='Cancelled') or (status not in ('Draft','Cancelled') and confirmation_status='Confirmed'))
);
create table public.order_issues (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
 entry_date date not null default current_date check(isfinite(entry_date)), meters numeric(14,3) not null check(meters > 0 and meters <> 'NaN'::numeric), lot_batch_number text, remarks text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id) default auth.uid()
);
create table public.order_receipts (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
 entry_date date not null default current_date check(isfinite(entry_date)), meters numeric(14,3) not null check(meters > 0 and meters <> 'NaN'::numeric), remarks text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id) default auth.uid()
);
create table public.process_logs (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), process_id uuid not null references public.processes(id),
 date_in timestamptz not null default now() check(isfinite(date_in)), date_out timestamptz check(date_out is null or isfinite(date_out)), meters_in numeric(14,3) not null check(meters_in > 0 and meters_in <> 'NaN'::numeric),
 meters_out numeric(14,3) check(meters_out >= 0 and meters_out <> 'NaN'::numeric), operator text, remarks text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id) default auth.uid(),
 check(date_out is null or date_out >= date_in), check((date_out is null) = (meters_out is null))
);
create table public.inspections (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
 lot_number text not null check(length(btrim(lot_number)) between 1 and 100), entry_date date not null default current_date check(isfinite(entry_date)),
 meters_inspected numeric(14,3) not null check(meters_inspected > 0 and meters_inspected <> 'NaN'::numeric), meters_passed numeric(14,3) not null check(meters_passed >= 0 and meters_passed <> 'NaN'::numeric),
 meters_rejected numeric(14,3) not null check(meters_rejected >= 0 and meters_rejected <> 'NaN'::numeric), final_grade text not null check(length(btrim(final_grade)) between 1 and 100), remarks text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id) default auth.uid(),
 check(meters_passed + meters_rejected = meters_inspected)
);
create table public.warehouse_receipts (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
 entry_date date not null default current_date check(isfinite(entry_date)), meters numeric(14,3) not null check(meters > 0 and meters <> 'NaN'::numeric), location text not null check(length(btrim(location)) between 1 and 150), remarks text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id) default auth.uid()
);
create table public.status_history (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
 from_status public.order_status, to_status public.order_status not null, reason text, changed_by uuid references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id) default auth.uid()
);
create table public.login_audit (
 id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id),
 event text not null, details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id) default auth.uid()
);
create table public.change_audit (
 id uuid primary key default gen_random_uuid(), table_name text not null, record_id uuid not null, order_id uuid references public.orders(id),
 action text not null check(action in ('INSERT','UPDATE','DELETE')), old_data jsonb, new_data jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id) default auth.uid()
);
-- Hashes never enter public schemas or browser responses.
create table private.password_guards (
 id uuid primary key references public.profiles(id), temporary_hash text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id)
);
alter table private.password_guards enable row level security;
create index orders_status_idx on public.orders(status);
create index orders_dates_idx on public.orders(order_date,delivery_date);
create index orders_fabric_idx on public.orders(fabric_id);
create index orders_owner_idx on public.orders(created_by);
create index process_logs_process_idx on public.process_logs(process_id);
do $$ declare t text; begin
 foreach t in array array['order_issues','order_receipts','process_logs','inspections','warehouse_receipts','status_history'] loop
 execute format('create index %I on public.%I(order_id, created_at)',t||'_order_idx',t);
 end loop;
end $$;
create index login_audit_time_idx on public.login_audit(created_at desc);
create index login_audit_user_idx on public.login_audit(user_id);
create index change_audit_order_idx on public.change_audit(order_id, created_at desc);
commit;
