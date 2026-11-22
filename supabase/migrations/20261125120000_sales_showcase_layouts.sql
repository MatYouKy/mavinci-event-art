-- Własny układ prezentacji pracownika (Strefa sprzedawcy → Prezentacje, 22.11.2026).
-- Każdy z dostępem do prezentacji widzi wszystkie działy, ale kolejność działów, kolejność kart w działach i to, co ukrył
-- u siebie, są jego własne — ten sam zapis w CRM, na Macu, telefonie i iPadzie (`/bridge/native/v1/showcase`:
-- `saveLayout`, `resetLayout`; `home` zwraca listę już w układzie pracownika). Treść kart, dział karty i widoczność dla
-- wszystkich („Widoczny na spotkaniach”) zostają w `sales_showcase_sections` / `sales_showcase_items`.
-- sections: [{"id": <dział>, "hidden": bool}] w kolejności pracownika; items: {"<dział>": [{"id": <karta>, "hidden": bool}]}.

create table if not exists public.sales_showcase_layouts (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  sections jsonb not null default '[]'::jsonb,
  items jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint sales_showcase_layouts_sections_array check (jsonb_typeof(sections) = 'array'),
  constraint sales_showcase_layouts_items_object check (jsonb_typeof(items) = 'object'),
  constraint sales_showcase_layouts_size check (pg_column_size(sections) + pg_column_size(items) < 1000000)
);

comment on table public.sales_showcase_layouts is
  'Własny układ Prezentacji pracownika: kolejność działów i kart oraz ukryte u niego (bez zmian treści i widoczności dla innych).';

alter table public.sales_showcase_layouts enable row level security;

drop policy if exists sales_showcase_layouts_select_own on public.sales_showcase_layouts;
drop policy if exists sales_showcase_layouts_insert_own on public.sales_showcase_layouts;
drop policy if exists sales_showcase_layouts_update_own on public.sales_showcase_layouts;
drop policy if exists sales_showcase_layouts_delete_own on public.sales_showcase_layouts;

-- Tylko własny układ (zapis — także z prawem podglądu prezentacji).
create policy sales_showcase_layouts_select_own on public.sales_showcase_layouts
  for select to authenticated using (employee_id = public.current_crm_employee_id());
create policy sales_showcase_layouts_insert_own on public.sales_showcase_layouts
  for insert to authenticated with check (employee_id = public.current_crm_employee_id() and public.sales_showcase_can('view'));
create policy sales_showcase_layouts_update_own on public.sales_showcase_layouts
  for update to authenticated using (employee_id = public.current_crm_employee_id())
  with check (employee_id = public.current_crm_employee_id() and public.sales_showcase_can('view'));
create policy sales_showcase_layouts_delete_own on public.sales_showcase_layouts
  for delete to authenticated using (employee_id = public.current_crm_employee_id());

revoke all on table public.sales_showcase_layouts from anon;
grant select, insert, update, delete on table public.sales_showcase_layouts to authenticated;
grant all on table public.sales_showcase_layouts to service_role;
