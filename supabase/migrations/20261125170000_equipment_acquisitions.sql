-- Magazyn → sprzęt → „Zakup” (CRM, Mac) i Dysk → Finanse → firma → „Majątek”: własność sprzętu i dokument zakupu.
--
-- • Wiersz `equipment_acquisitions` to partia sztuk danego sprzętu: ile sztuk, czyje (środek trwały firmy, wyposażenie firmy,
--   leasing lub najem, prywatne), od kiedy, za ile i na podstawie jakiego dokumentu — faktury kosztowej z KSeF, dokumentu spoza
--   KSeF albo umowy stałej (leasing, najem). Prywatne nie mają firmy ani dokumentu firmy — to sprzęt, który można sprzedać
--   bez faktury. Sztuki bez wiersza to sprzęt o nieustalonej własności (Finanse → „Do wyjaśnienia”).
-- • Widzą osoby z dostępem do faktur firmy (prywatne — z „Finanse — podgląd” w dowolnej firmie); dodają, zmieniają i usuwają —
--   „Finanse — zarządzanie” w firmie (prywatne — w dowolnej firmie). Zakres „sprzedaż” i portal sprzedawcy — nic.
-- • Dokument musi należeć do tej samej firmy (faktura z KSeF — otrzymana); pilnuje tego wyzwalacz.
-- • Bucket `finance-documents` przyjmuje też CSV (rejestr majątku dla księgowej w Dysku).
-- Plik idempotentny — można go wykonać ponownie.

begin;

-- 1. Tabela ------------------------------------------------------------------------------------------------------------------

create table if not exists public.equipment_acquisitions (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment_items(id) on delete cascade,
  quantity integer not null default 1,
  ownership text not null,
  my_company_id uuid references public.my_companies(id) on delete restrict,
  acquired_on date,
  net_amount numeric(14, 2),
  gross_amount numeric(14, 2),
  currency text not null default 'PLN',
  ksef_invoice_id uuid references public.ksef_invoices(id) on delete set null,
  external_invoice_id uuid references public.external_invoices(id) on delete set null,
  recurring_contract_id uuid references public.finance_recurring_contracts(id) on delete set null,
  document_note text not null default '',
  notes text not null default '',
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipment_acquisitions_quantity_check check (quantity between 1 and 100000),
  constraint equipment_acquisitions_ownership_check check (ownership in ('asset', 'equipment', 'leased', 'private')),
  constraint equipment_acquisitions_company_check check ((ownership = 'private') = (my_company_id is null)),
  constraint equipment_acquisitions_document_check check (num_nonnulls(ksef_invoice_id, external_invoice_id, recurring_contract_id) <= 1),
  constraint equipment_acquisitions_private_document_check check (
    ownership <> 'private' or num_nonnulls(ksef_invoice_id, external_invoice_id, recurring_contract_id) = 0
  ),
  constraint equipment_acquisitions_contract_check check (recurring_contract_id is null or ownership = 'leased'),
  constraint equipment_acquisitions_amount_check check (
    (net_amount is null or abs(net_amount) < 1000000000000) and (gross_amount is null or abs(gross_amount) < 1000000000000)
  ),
  constraint equipment_acquisitions_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint equipment_acquisitions_date_check check (acquired_on is null or acquired_on between date '1990-01-01' and date '2100-12-31'),
  constraint equipment_acquisitions_note_check check (char_length(document_note) <= 300 and char_length(notes) <= 2000)
);

create index if not exists equipment_acquisitions_equipment_idx on public.equipment_acquisitions (equipment_id);
create index if not exists equipment_acquisitions_company_idx on public.equipment_acquisitions (my_company_id, ownership);
create index if not exists equipment_acquisitions_ksef_idx on public.equipment_acquisitions (ksef_invoice_id) where ksef_invoice_id is not null;
create index if not exists equipment_acquisitions_external_idx on public.equipment_acquisitions (external_invoice_id) where external_invoice_id is not null;
create index if not exists equipment_acquisitions_contract_idx on public.equipment_acquisitions (recurring_contract_id) where recurring_contract_id is not null;

-- Dokument z tej samej firmy (faktura z KSeF — otrzymana); autor i daty ustawia baza.
create or replace function public.equipment_acquisitions_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_company uuid;
  v_type text;
begin
  new.document_note := btrim(coalesce(new.document_note, ''));
  new.notes := btrim(coalesce(new.notes, ''));
  if new.ksef_invoice_id is not null then
    select k.my_company_id, k.invoice_type into v_company, v_type from public.ksef_invoices k where k.id = new.ksef_invoice_id;
    if v_company is distinct from new.my_company_id or v_type is distinct from 'received' then
      raise exception 'Faktura z KSeF musi być fakturą kosztową (otrzymaną) tej samej firmy.' using errcode = '22023';
    end if;
  end if;
  if new.external_invoice_id is not null then
    select x.my_company_id into v_company from public.external_invoices x where x.id = new.external_invoice_id;
    if v_company is distinct from new.my_company_id then
      raise exception 'Dokument spoza KSeF musi należeć do tej samej firmy.' using errcode = '22023';
    end if;
  end if;
  if new.recurring_contract_id is not null then
    select c.my_company_id into v_company from public.finance_recurring_contracts c where c.id = new.recurring_contract_id;
    if v_company is distinct from new.my_company_id then
      raise exception 'Umowa leasingu lub najmu musi należeć do tej samej firmy.' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(public.current_crm_employee_id(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists equipment_acquisitions_guard on public.equipment_acquisitions;
create trigger equipment_acquisitions_guard
  before insert or update on public.equipment_acquisitions
  for each row execute function public.equipment_acquisitions_guard();

-- 2. RLS ---------------------------------------------------------------------------------------------------------------------

alter table public.equipment_acquisitions enable row level security;

drop policy if exists equipment_acquisitions_select on public.equipment_acquisitions;
create policy equipment_acquisitions_select on public.equipment_acquisitions for select to authenticated
  using (
    (my_company_id is null and public.finance_can_view())
    or (my_company_id is not null and public.finance_company_level_at_least(my_company_id, 'invoices'))
  );

drop policy if exists equipment_acquisitions_insert on public.equipment_acquisitions;
create policy equipment_acquisitions_insert on public.equipment_acquisitions for insert to authenticated
  with check ((my_company_id is null and public.finance_can_manage()) or public.finance_company_manageable(my_company_id));

drop policy if exists equipment_acquisitions_update on public.equipment_acquisitions;
create policy equipment_acquisitions_update on public.equipment_acquisitions for update to authenticated
  using ((my_company_id is null and public.finance_can_manage()) or public.finance_company_manageable(my_company_id))
  with check ((my_company_id is null and public.finance_can_manage()) or public.finance_company_manageable(my_company_id));

drop policy if exists equipment_acquisitions_delete on public.equipment_acquisitions;
create policy equipment_acquisitions_delete on public.equipment_acquisitions for delete to authenticated
  using ((my_company_id is null and public.finance_can_manage()) or public.finance_company_manageable(my_company_id));

drop policy if exists sales_finance_private on public.equipment_acquisitions;
create policy sales_finance_private on public.equipment_acquisitions as restrictive for all to authenticated
  using (public.invoice_finance_scope() <> 'sales') with check (public.invoice_finance_scope() <> 'sales');

revoke all on public.equipment_acquisitions from public, anon, authenticated;
grant select, insert, update, delete on public.equipment_acquisitions to authenticated;
grant all on public.equipment_acquisitions to service_role;

-- 3. Rejestr majątku w CSV (Dysk → Finanse → Majątek) -----------------------------------------------------------------------

update storage.buckets
   set allowed_mime_types = array['application/pdf', 'application/xml', 'text/xml', 'text/csv']
 where id = 'finance-documents';

commit;
