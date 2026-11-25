-- Przetargi → Konfiguracja filtrów: uprawnienia `tender_filter_config`.
--
-- Polityka `tender_filter_config_employees_only` (FOR ALL, USING current_employee_can_view_tenders()) pozwalała każdemu
-- pracownikowi z dostępem do przetargów (tenders_view) USUWAĆ konfiguracje filtrów — przy DELETE liczy się tylko USING,
-- a WITH CHECK (administrator) nie jest sprawdzane. Odczyt zapewnia `tender_filter_config_view` (tenders_view),
-- dodawanie, zmiany i usuwanie — `tender_filter_config_admin` (administrator CRM), więc zbędna polityka jest usuwana.
-- Po migracji: odczyt — tenders_view; zapis i usuwanie — administrator (jak w CRM, na Macu i w telefonie). Plik idempotentny.

begin;

drop policy if exists tender_filter_config_employees_only on public.tender_filter_config;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tender_filter_config' and policyname = 'tender_filter_config_view'
  ) then
    create policy tender_filter_config_view on public.tender_filter_config
      for select to authenticated using (public.current_employee_can_view_tenders());
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tender_filter_config' and policyname = 'tender_filter_config_admin'
  ) then
    create policy tender_filter_config_admin on public.tender_filter_config
      for all to authenticated using (public.current_employee_is_crm_admin()) with check (public.current_employee_is_crm_admin());
  end if;
end
$$;

commit;
