-- Dysk → Finanse → firma → „Dokumenty spółki” (CRM, Mac, Finder; telefon — skaner): umowa spółki i KRS, uchwały i protokoły,
-- sprawozdania finansowe, rejestracje i zaświadczenia, pełnomocnictwa, inne — z plikiem w prywatnym buckecie `company-documents`.
--
-- • Widzą osoby z poziomem „Finanse — podgląd” w firmie (jak bank i deklaracje); dodają, zmieniają i usuwają — „Finanse —
--   zarządzanie” (administrator ma go we wszystkich firmach). Zakres finansów „sprzedaż” i portal sprzedawcy — nic.
-- • Plik: `company-documents/<firma>/<znacznik>-<nazwa>` (wysyłka z podpisanym adresem przez serwer Next; pobranie — adres
--   podpisany przez serwer po odczycie wiersza tokenem pracownika).
-- • Kategoria jak `DRIVE_CORPORATE_CATEGORIES` w `src/lib/drive/driveShared.ts`.
-- Plik idempotentny — można go wykonać ponownie.

begin;

-- 1. Tabela ------------------------------------------------------------------------------------------------------------------

create table if not exists public.company_documents (
  id uuid primary key default gen_random_uuid(),
  my_company_id uuid not null references public.my_companies(id) on delete cascade,
  category text not null default 'other',
  title text not null,
  document_date date,
  description text not null default '',
  storage_path text not null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint,
  uploaded_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_documents_category_check check (category in ('founding', 'resolutions', 'statements', 'registrations', 'powers', 'other')),
  constraint company_documents_title_check check (char_length(btrim(title)) between 1 and 200),
  constraint company_documents_description_check check (char_length(description) <= 2000),
  constraint company_documents_file_name_check check (char_length(btrim(file_name)) between 1 and 255),
  constraint company_documents_size_check check (size_bytes is null or size_bytes >= 0),
  constraint company_documents_date_check check (document_date is null or document_date between date '1990-01-01' and date '2100-12-31'),
  constraint company_documents_path_check check (
    storage_path ~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/[A-Za-z0-9._-]{1,200}$'
    and split_part(storage_path, '/', 1) = my_company_id::text
  )
);

create unique index if not exists company_documents_storage_path_key on public.company_documents (storage_path);
create index if not exists company_documents_company_idx on public.company_documents (my_company_id, category, document_date desc);

-- Dokument: autor i daty ustawia baza, tytuł bez spacji na brzegach; firmy i pliku nie można podmienić.
create or replace function public.company_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.title := btrim(new.title);
  new.file_name := btrim(new.file_name);
  new.description := coalesce(new.description, '');
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(public.current_crm_employee_id(), new.uploaded_by);
    new.created_at := now();
  else
    if new.my_company_id is distinct from old.my_company_id or new.storage_path is distinct from old.storage_path then
      raise exception 'Dokumentu nie można przenieść do innej firmy ani podmienić pliku — dodaj nowy dokument.' using errcode = '22023';
    end if;
    new.uploaded_by := old.uploaded_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists company_documents_guard on public.company_documents;
create trigger company_documents_guard
  before insert or update on public.company_documents
  for each row execute function public.company_documents_guard();

-- 2. RLS ---------------------------------------------------------------------------------------------------------------------

alter table public.company_documents enable row level security;

drop policy if exists company_documents_select on public.company_documents;
create policy company_documents_select on public.company_documents for select to authenticated
  using (public.finance_company_level_at_least(my_company_id, 'finance_view'));

drop policy if exists company_documents_insert on public.company_documents;
create policy company_documents_insert on public.company_documents for insert to authenticated
  with check (public.finance_company_manageable(my_company_id));

drop policy if exists company_documents_update on public.company_documents;
create policy company_documents_update on public.company_documents for update to authenticated
  using (public.finance_company_manageable(my_company_id)) with check (public.finance_company_manageable(my_company_id));

drop policy if exists company_documents_delete on public.company_documents;
create policy company_documents_delete on public.company_documents for delete to authenticated
  using (public.finance_company_manageable(my_company_id));

-- Jak pozostałe tabele finansów: zakres „sprzedaż” nie ma dostępu niezależnie od innych polityk.
drop policy if exists sales_finance_private on public.company_documents;
create policy sales_finance_private on public.company_documents as restrictive for all to authenticated
  using (public.invoice_finance_scope() <> 'sales') with check (public.invoice_finance_scope() <> 'sales');

revoke all on public.company_documents from public, anon, authenticated;
grant select, insert, update, delete on public.company_documents to authenticated;
grant all on public.company_documents to service_role;

-- 3. Bucket `company-documents` (prywatny, do 50 MB na plik) -----------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('company-documents', 'company-documents', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists company_documents_storage_read on storage.objects;
create policy company_documents_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'company-documents' and public.finance_storage_company_at_least((storage.foldername(name))[1], 'finance_view'));

drop policy if exists company_documents_storage_insert on storage.objects;
create policy company_documents_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'company-documents' and public.finance_storage_company_at_least((storage.foldername(name))[1], 'finance_manage'));

drop policy if exists company_documents_storage_delete on storage.objects;
create policy company_documents_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'company-documents' and public.finance_storage_company_at_least((storage.foldername(name))[1], 'finance_manage'));

commit;
