-- Porządkowanie klauzul produktów (CRM: /crm/contract-templates/porzadkowanie-klauzul): przed zapisem uporządkowanych
-- klauzul zapisujemy poprzednią treść produktu albo wariantu, żeby można było ją przywrócić jednym kliknięciem.
-- Dostęp jak do edycji produktów: administrator albo uprawnienie offers_manage.

create table if not exists public.contract_clause_cleanup_backups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.offer_products(id) on delete cascade,
  variant_id uuid references public.offer_product_variants(id) on delete cascade,
  previous_clauses text,
  previous_category text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  restored_at timestamptz
);

create index if not exists contract_clause_cleanup_backups_product_idx
  on public.contract_clause_cleanup_backups (product_id, created_at desc);

alter table public.contract_clause_cleanup_backups enable row level security;

drop policy if exists "Product managers manage clause cleanup backups" on public.contract_clause_cleanup_backups;
create policy "Product managers manage clause cleanup backups"
  on public.contract_clause_cleanup_backups
  for all
  to authenticated
  using (exists (
    select 1 from public.employees
    where employees.id = auth.uid() and (employees.role = 'admin' or 'offers_manage' = any (employees.permissions))
  ))
  with check (exists (
    select 1 from public.employees
    where employees.id = auth.uid() and (employees.role = 'admin' or 'offers_manage' = any (employees.permissions))
  ));

grant select, insert, update on public.contract_clause_cleanup_backups to authenticated;
