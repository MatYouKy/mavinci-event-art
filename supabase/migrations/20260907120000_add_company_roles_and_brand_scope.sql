/*
  # Firmowe role dostępu i zakres marek

  Migracja jest zachowawcza:
  - nie zmienia uprawnień istniejących pracowników,
  - dodaje nowe, jednoznaczne role firmowe,
  - pakiet roli jest nakładany dopiero przy nowym przypisaniu roli,
  - zakres marek domyślnie pozostaje "all", aby nie odciąć istniejących kont.
*/

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS company_access_mode text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS role_permissions_inherited boolean NOT NULL DEFAULT false;

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_company_access_mode_check;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_company_access_mode_check
  CHECK (company_access_mode IN ('all', 'selected'));

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_selected_companies_required_check;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_selected_companies_required_check
  CHECK (company_access_mode = 'all' OR cardinality(my_company_ids) > 0);

ALTER TABLE public.access_levels
  ADD COLUMN IF NOT EXISTS is_company_role boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_employees_my_company_ids
  ON public.employees USING gin (my_company_ids);

CREATE OR REPLACE FUNCTION public.apply_access_level_package()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  access_row public.access_levels%ROWTYPE;
BEGIN
  IF NEW.access_level_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.access_level_id IS DISTINCT FROM OLD.access_level_id
     OR (NEW.role_permissions_inherited AND NOT OLD.role_permissions_inherited) THEN
    SELECT * INTO access_row
    FROM public.access_levels
    WHERE id = NEW.access_level_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Wybrana rola firmowa nie istnieje';
    END IF;

    NEW.permissions := COALESCE(access_row.default_permissions, '{}'::text[]);
    NEW.event_tabs := access_row.event_tabs;
    NEW.contact_tabs := access_row.contact_tabs;
    NEW.organization_tabs := access_row.organization_tabs;
    NEW.role_permissions_inherited := true;
    NEW.role := CASE WHEN access_row.slug IN ('admin', 'company-admin') THEN 'admin' ELSE 'employee' END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_access_level_package ON public.employees;
CREATE TRIGGER trg_apply_access_level_package
BEFORE INSERT OR UPDATE OF access_level_id, role_permissions_inherited
ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.apply_access_level_package();

CREATE OR REPLACE FUNCTION public.propagate_access_level_package()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.default_permissions IS DISTINCT FROM OLD.default_permissions
     OR NEW.event_tabs IS DISTINCT FROM OLD.event_tabs
     OR NEW.contact_tabs IS DISTINCT FROM OLD.contact_tabs
     OR NEW.organization_tabs IS DISTINCT FROM OLD.organization_tabs THEN
    UPDATE public.employees
    SET permissions = COALESCE(NEW.default_permissions, '{}'::text[]),
        event_tabs = NEW.event_tabs,
        contact_tabs = NEW.contact_tabs,
        organization_tabs = NEW.organization_tabs
    WHERE access_level_id = NEW.id
      AND role_permissions_inherited = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_access_level_package ON public.access_levels;
CREATE TRIGGER trg_propagate_access_level_package
AFTER UPDATE OF default_permissions, event_tabs, contact_tabs, organization_tabs
ON public.access_levels
FOR EACH ROW
EXECUTE FUNCTION public.propagate_access_level_package();

INSERT INTO public.access_levels
  (name, slug, description, config, default_permissions, event_tabs, contact_tabs, organization_tabs, order_index, is_company_role)
VALUES
  (
    'Zarząd / Dyrektor operacyjny', 'operations-director', 'Pełny wgląd zarządczy i operacyjny w przydzielonych markach.',
    '{"view_full_event":true,"view_agenda":true,"view_files":true,"view_team":true,"view_equipment":true,"view_client_info":true,"view_budget":true,"edit_tasks":true,"manage_equipment":true}'::jsonb,
    ARRAY['events_manage','events_create','calendar_manage','tasks_manage','tasks_create','clients_manage','clients_create','contacts_manage','contacts_create','inquiries_view','inquiries_manage','inquiries_view_all','inquiries_manage_all','inquiries_assign','offers_manage','offers_create','contracts_manage','contracts_create','messages_manage','messages_assign','equipment_manage','equipment_create','fleet_manage','fleet_create','locations_manage','locations_create','subcontractors_manage','time_tracking_manage','finances_view','invoices_view','employees_view','marketing_campaigns_view','chat_manage','chat_create_group']::text[],
    ARRAY['overview','details','phases','agenda','offer','finances','contract','equipment','team','logistics','subcontractors','files','tasks','history','mavinci-live']::text[],
    ARRAY['details','notes','history']::text[], ARRAY['details','contacts','invoices','events','notes','history']::text[], 20, true
  ),
  (
    'Sprzedaż / Opiekun klienta', 'sales-specialist', 'Zapytania, kontakty, oferty i umowy w przydzielonych markach.',
    '{"view_full_event":true,"view_agenda":true,"view_files":true,"view_team":true,"view_equipment":false,"view_client_info":true,"view_budget":true,"edit_tasks":true,"manage_equipment":false}'::jsonb,
    ARRAY['events_view','events_create','calendar_view','tasks_view','tasks_manage','tasks_create','clients_manage','clients_create','contacts_manage','contacts_create','inquiries_view','inquiries_manage','inquiries_view_pool','inquiries_view_own','inquiries_manage_own','inquiries_assign','offers_manage','offers_create','contracts_manage','contracts_create','messages_view','messages_assign','locations_view','finances_view','chat_view']::text[],
    ARRAY['overview','details','phases','agenda','offer','finances','contract','team','files','tasks','history']::text[],
    ARRAY['details','notes','history']::text[], ARRAY['details','contacts','invoices','events','notes','history']::text[], 30, true
  ),
  (
    'Event Manager / Project Manager', 'event-manager', 'Pełna odpowiedzialność za przygotowanie i realizację wydarzeń.',
    '{"view_full_event":true,"view_agenda":true,"view_files":true,"view_team":true,"view_equipment":true,"view_client_info":true,"view_budget":true,"edit_tasks":true,"manage_equipment":true}'::jsonb,
    ARRAY['events_manage','events_create','calendar_manage','tasks_manage','tasks_create','clients_view','contacts_view','offers_view','contracts_view','equipment_view','fleet_view','locations_manage','locations_create','subcontractors_manage','time_tracking_view','employees_view','messages_view','finances_view','chat_manage','chat_create_group']::text[],
    ARRAY['overview','details','phases','agenda','offer','finances','contract','equipment','team','logistics','subcontractors','files','tasks','history','mavinci-live']::text[],
    ARRAY['details','notes','history']::text[], ARRAY['details','contacts','events','notes','history']::text[], 40, true
  ),
  (
    'Magazyn / Logistyka sprzętu', 'warehouse', 'Planowanie dostępności, rezerwacje, wydania, zwroty i logistyka sprzętu.',
    '{"view_full_event":false,"view_agenda":true,"view_files":true,"view_team":true,"view_equipment":true,"view_client_info":false,"view_budget":false,"edit_tasks":false,"manage_equipment":true}'::jsonb,
    ARRAY['events_view','events_view_planning','calendar_view','calendar_view_accepted_only','tasks_view','contacts_view','equipment_manage','equipment_create','fleet_view','fleet_manage','locations_view','time_tracking_view','chat_view']::text[],
    ARRAY['overview','phases','agenda','equipment','team','logistics','files','tasks']::text[],
    ARRAY['details']::text[], ARRAY['details','events']::text[], 50, true
  ),
  (
    'Technik / Realizator', 'event-technician', 'Dostęp do przypisanych realizacji, agendy, sprzętu i aplikacji wykonawczych.',
    '{"view_full_event":false,"view_agenda":true,"view_files":true,"view_team":true,"view_equipment":true,"view_client_info":false,"view_budget":false,"edit_tasks":false,"manage_equipment":false}'::jsonb,
    ARRAY['events_view','calendar_view','tasks_view','equipment_view','fleet_view','locations_view','time_tracking_view','mavinci_live_view','mavinci_live_light_magic','mavinci_live_streaming','chat_view']::text[],
    ARRAY['overview','phases','agenda','equipment','team','logistics','files','tasks','mavinci-live']::text[],
    ARRAY['details']::text[], ARRAY['details','events']::text[], 60, true
  ),
  (
    'Finanse / Księgowość', 'finance-accounting', 'Rozliczenia wydarzeń, faktury, KSeF i dokumenty handlowe.',
    '{"view_full_event":false,"view_agenda":false,"view_files":true,"view_team":false,"view_equipment":false,"view_client_info":true,"view_budget":true,"edit_tasks":false,"manage_equipment":false}'::jsonb,
    ARRAY['events_view','events_view_operational','calendar_view','clients_view','contacts_view','offers_view','contracts_view','finances_manage','invoices_manage','databases_view','tasks_view']::text[],
    ARRAY['overview','offer','finances','contract','files','history']::text[],
    ARRAY['details','history']::text[], ARRAY['details','contacts','invoices','events','history']::text[], 70, true
  ),
  (
    'Marketing', 'marketing-specialist', 'Marketing marek, kampanie, social media i treści stron.',
    '{"view_full_event":false,"view_agenda":false,"view_files":true,"view_team":false,"view_equipment":false,"view_client_info":false,"view_budget":false,"edit_tasks":false,"manage_equipment":false}'::jsonb,
    ARRAY['marketing_campaigns_manage','marketing_campaigns_approve','page_manage','website_edit','contacts_view','clients_view','messages_view','tasks_view','chat_view']::text[],
    ARRAY['overview','files']::text[],
    ARRAY['details','notes','history']::text[], ARRAY['details','contacts','events','notes','history']::text[], 80, true
  ),
  (
    'Podwykonawca / Freelancer', 'external-contractor', 'Wyłącznie przypisane realizacje i niezbędne dane wykonawcze.',
    '{"view_full_event":false,"view_agenda":true,"view_files":true,"view_team":false,"view_equipment":false,"view_client_info":false,"view_budget":false,"edit_tasks":false,"manage_equipment":false}'::jsonb,
    ARRAY['events_view','calendar_view','tasks_view','time_tracking_view','chat_view']::text[],
    ARRAY['overview','agenda','files','tasks']::text[],
    ARRAY['details']::text[], ARRAY['details']::text[], 90, true
  )
ON CONFLICT (slug) DO NOTHING;

UPDATE public.access_levels
SET is_company_role = true
WHERE slug = 'admin';

COMMENT ON COLUMN public.employees.company_access_mode IS
'all = wszystkie marki; selected = wyłącznie marki zapisane w my_company_ids.';
COMMENT ON COLUMN public.employees.role_permissions_inherited IS
'true = pakiet i zakładki są synchronizowane z rolą firmową; false = ustawienia indywidualne.';
