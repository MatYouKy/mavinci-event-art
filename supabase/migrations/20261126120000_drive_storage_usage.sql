-- Dysk → „Miejsce na Dysku” (CRM, Mac, telefon) — tylko administrator CRM.
--
-- • `crm_storage_plan` (jeden wiersz): zakupiony pakiet — nazwa oraz limit plików (magazyn Supabase Storage) i bazy danych.
--   Domyślnie Supabase Pro: 100 GB plików i 8 GB bazy. Zmienia administrator w Dysku („Pakiet…”).
-- • `crm_storage_usage()` — pakiet, rozmiar bazy i zajętość magazynu z podziałem na buckety (suma rozmiarów obiektów
--   `storage.objects`). `crm_set_storage_plan(…)` — zmiana pakietu, zwraca to samo co `crm_storage_usage()`.
-- • Tabela bez dostępu wprost; obie funkcje sprawdzają `current_employee_is_crm_admin()` (portal sprzedawcy — nigdy).
-- Plik idempotentny — można go wykonać ponownie.

begin;

-- 1. Pakiet ------------------------------------------------------------------------------------------------------------------

create table if not exists public.crm_storage_plan (
  id boolean primary key default true,
  plan_name text not null default 'Supabase Pro',
  files_quota_bytes bigint not null default 107374182400,
  database_quota_bytes bigint not null default 8589934592,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id) on delete set null,
  constraint crm_storage_plan_single check (id),
  constraint crm_storage_plan_name_check check (char_length(plan_name) between 1 and 80),
  constraint crm_storage_plan_files_check check (files_quota_bytes > 0),
  constraint crm_storage_plan_database_check check (database_quota_bytes > 0)
);

insert into public.crm_storage_plan (id) values (true) on conflict (id) do nothing;

alter table public.crm_storage_plan enable row level security;
revoke all on public.crm_storage_plan from public, anon, authenticated;
grant all on public.crm_storage_plan to service_role;

-- 2. Zajętość ----------------------------------------------------------------------------------------------------------------

create or replace function public.crm_storage_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_plan public.crm_storage_plan%rowtype;
begin
  if not public.current_employee_is_crm_admin() then
    raise exception 'Zajętość miejsca na Dysku widzi tylko administrator.' using errcode = '42501';
  end if;
  select * into v_plan from public.crm_storage_plan where id;
  return jsonb_build_object(
    'generatedAt', now(),
    'plan', jsonb_build_object(
      'name', coalesce(v_plan.plan_name, 'Supabase Pro'),
      'filesQuotaBytes', coalesce(v_plan.files_quota_bytes, 107374182400),
      'databaseQuotaBytes', coalesce(v_plan.database_quota_bytes, 8589934592),
      'updatedAt', v_plan.updated_at
    ),
    'databaseBytes', pg_database_size(current_database()),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', b.bucket_id, 'objects', b.objects, 'bytes', b.bytes) order by b.bytes desc, b.bucket_id)
      from (
        select o.bucket_id,
               count(*) as objects,
               coalesce(sum(case when (o.metadata ->> 'size') ~ '^[0-9]{1,18}$' then (o.metadata ->> 'size')::bigint else 0 end), 0) as bytes
        from storage.objects o
        group by o.bucket_id
      ) b
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.crm_storage_usage() from public, anon;
grant execute on function public.crm_storage_usage() to authenticated, service_role;

-- 3. Zmiana pakietu ----------------------------------------------------------------------------------------------------------

create or replace function public.crm_set_storage_plan(p_name text, p_files_gb numeric, p_database_gb numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', ' ', 'g')), 80);
begin
  if not public.current_employee_is_crm_admin() then
    raise exception 'Pakiet miejsca na Dysku zmienia tylko administrator.' using errcode = '42501';
  end if;
  if p_files_gb is null or p_files_gb < 1 or p_files_gb > 100000
     or p_database_gb is null or p_database_gb < 1 or p_database_gb > 100000 then
    raise exception 'Podaj limity od 1 do 100 000 GB.' using errcode = '22023';
  end if;
  insert into public.crm_storage_plan (id, plan_name, files_quota_bytes, database_quota_bytes, updated_at, updated_by)
  values (true, coalesce(nullif(v_name, ''), 'Pakiet'), round(p_files_gb * 1073741824)::bigint, round(p_database_gb * 1073741824)::bigint,
          now(), public.current_crm_employee_id())
  on conflict (id) do update set
    plan_name = excluded.plan_name,
    files_quota_bytes = excluded.files_quota_bytes,
    database_quota_bytes = excluded.database_quota_bytes,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
  return public.crm_storage_usage();
end $$;

revoke all on function public.crm_set_storage_plan(text, numeric, numeric) from public, anon;
grant execute on function public.crm_set_storage_plan(text, numeric, numeric) to authenticated, service_role;

commit;
