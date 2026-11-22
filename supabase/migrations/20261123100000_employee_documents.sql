-- Dysk → Pracownicy → pracownik → „Dokumenty” i zakładka „Dokumenty” w profilu pracownika (CRM, Mac): dokumenty pracownika
-- (umowa, certyfikat, dokument tożsamości, badania, szkolenie BHP, inne) z plikiem w prywatnym buckecie `employee-documents`.
--
-- • Uprawnienia jak zakładka „Dokumenty” w profilu: widzi i dodaje sam pracownik (własne dokumenty), administrator i osoba
--   z prawem „Pracownicy — zarządzanie” (`employees_manage`); zmienia i usuwa administrator i `employees_manage`, a pracownik —
--   także dokument, który sam dodał. Sprzedawca z portalu — nic.
-- • Plik: `employee-documents/<pracownik>/<znacznik>-<nazwa>` (wysyłka z podpisanym adresem przez serwer Next — CRM, Mac,
--   Finder, telefon). Katalog `contracts/` w tym buckecie to kopie PDF dokumentów umów z „Umowy i rozliczenia” (Dysk →
--   Pracownicy → „Umowy”) — zapisuje i podpisuje je wyłącznie serwer (konto serwisowe); użytkownicy nie mają tam dostępu.
-- Plik idempotentny — można go wykonać ponownie.

begin;

-- 1. Tabela ------------------------------------------------------------------------------------------------------------------

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  name text not null,
  document_type text not null default 'other',
  description text not null default '',
  storage_path text not null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint,
  expiry_date date,
  uploaded_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_documents_name_check check (char_length(btrim(name)) between 1 and 200),
  constraint employee_documents_type_check check (document_type in ('contract', 'certificate', 'id_document', 'medical', 'training', 'other')),
  constraint employee_documents_description_check check (char_length(description) <= 2000),
  constraint employee_documents_file_name_check check (char_length(btrim(file_name)) between 1 and 255),
  constraint employee_documents_size_check check (size_bytes is null or size_bytes >= 0),
  constraint employee_documents_path_check check (
    storage_path ~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/[A-Za-z0-9._-]{1,200}$'
    and split_part(storage_path, '/', 1) = employee_id::text
  )
);

create unique index if not exists employee_documents_storage_path_key on public.employee_documents (storage_path);
create index if not exists employee_documents_employee_idx on public.employee_documents (employee_id, created_at desc);

-- Dokument: autor i daty ustawia baza, nazwa bez spacji na brzegach; pracownika i pliku nie można podmienić.
create or replace function public.employee_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.name := btrim(new.name);
  new.file_name := btrim(new.file_name);
  new.description := coalesce(new.description, '');
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(public.current_crm_employee_id(), new.uploaded_by);
    new.created_at := now();
  else
    if new.employee_id is distinct from old.employee_id or new.storage_path is distinct from old.storage_path then
      raise exception 'Dokumentu nie można przenieść do innego pracownika ani podmienić pliku — dodaj nowy dokument.' using errcode = '22023';
    end if;
    new.uploaded_by := old.uploaded_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists employee_documents_guard on public.employee_documents;
create trigger employee_documents_guard
  before insert or update on public.employee_documents
  for each row execute function public.employee_documents_guard();

-- 2. Uprawnienia -------------------------------------------------------------------------------------------------------------

-- `view` i `write` — sam pracownik, administrator, `employees_manage`; `manage` — administrator i `employees_manage`.
create or replace function public.employee_documents_can(p_employee uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select not public.current_session_is_seller_portal() and p_employee is not null and (
      e.role::text = 'admin' or e.access_level::text = 'admin' or 'admin' = any(coalesce(e.permissions, '{}'::text[]))
      or 'employees_manage' = any(coalesce(e.permissions, '{}'::text[]))
      or (p_action in ('view', 'write') and e.id = p_employee)
    )
    from public.employees e
    where e.id = public.current_crm_employee_id()
  ), false);
$$;

revoke all on function public.employee_documents_can(uuid, text) from public, anon;
grant execute on function public.employee_documents_can(uuid, text) to authenticated, service_role;

-- Obiekt w buckecie: `<pracownik>/<plik>`. Usunięcie: obiekt bez wpisu (przerwana wysyłka, wpis już usunięty) — kto może dodawać,
-- obiekt z wpisem — jak usunięcie wpisu.
create or replace function public.employee_documents_storage_can(p_name text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_employee uuid;
  v_uploaded_by uuid;
  v_found boolean;
begin
  if p_name is null or p_name !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/[A-Za-z0-9._-]{1,200}$' then
    return false;
  end if;
  v_employee := split_part(p_name, '/', 1)::uuid;
  if p_action = 'read' then
    return public.employee_documents_can(v_employee, 'view');
  elsif p_action = 'write' then
    return public.employee_documents_can(v_employee, 'write');
  elsif p_action = 'delete' then
    select true, d.uploaded_by into v_found, v_uploaded_by from public.employee_documents d where d.storage_path = p_name;
    if not coalesce(v_found, false) then
      return public.employee_documents_can(v_employee, 'write');
    end if;
    return public.employee_documents_can(v_employee, 'manage')
      or (v_uploaded_by = public.current_crm_employee_id() and public.employee_documents_can(v_employee, 'write'));
  end if;
  return false;
end $$;

revoke all on function public.employee_documents_storage_can(text, text) from public, anon;
grant execute on function public.employee_documents_storage_can(text, text) to authenticated, service_role;

-- 3. RLS ---------------------------------------------------------------------------------------------------------------------

alter table public.employee_documents enable row level security;

drop policy if exists employee_documents_select on public.employee_documents;
create policy employee_documents_select on public.employee_documents for select to authenticated
  using (public.employee_documents_can(employee_id, 'view'));

drop policy if exists employee_documents_insert on public.employee_documents;
create policy employee_documents_insert on public.employee_documents for insert to authenticated
  with check (public.employee_documents_can(employee_id, 'write'));

drop policy if exists employee_documents_update on public.employee_documents;
create policy employee_documents_update on public.employee_documents for update to authenticated
  using (public.employee_documents_can(employee_id, 'manage')) with check (public.employee_documents_can(employee_id, 'manage'));

drop policy if exists employee_documents_delete on public.employee_documents;
create policy employee_documents_delete on public.employee_documents for delete to authenticated
  using (
    public.employee_documents_can(employee_id, 'manage')
    or (uploaded_by = public.current_crm_employee_id() and public.employee_documents_can(employee_id, 'write'))
  );

revoke all on public.employee_documents from public, anon, authenticated;
grant select, insert, update, delete on public.employee_documents to authenticated;
grant all on public.employee_documents to service_role;

-- 4. Bucket `employee-documents` (prywatny, do 50 MB na plik) ----------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('employee-documents', 'employee-documents', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "Employee documents read" on storage.objects;
create policy "Employee documents read" on storage.objects for select to authenticated
  using (bucket_id = 'employee-documents' and public.employee_documents_storage_can(name, 'read'));

drop policy if exists "Employee documents insert" on storage.objects;
create policy "Employee documents insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-documents' and public.employee_documents_storage_can(name, 'write'));

drop policy if exists "Employee documents delete" on storage.objects;
create policy "Employee documents delete" on storage.objects for delete to authenticated
  using (bucket_id = 'employee-documents' and public.employee_documents_storage_can(name, 'delete'));

commit;
