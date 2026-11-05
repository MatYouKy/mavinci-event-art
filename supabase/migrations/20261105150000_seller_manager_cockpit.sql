-- =====================================================================================================================
-- Sprzedawcy zewnętrzni: opiekun z pełną kontrolą, prowizje w portalu ukryte do odsłonięcia, szybkie zapytania,
-- link do oferty dla gościa, kody QR, powiadomienia i kokpit opiekuna.
-- Wymaga: 20261105130000_event_settlement_commissions.sql. Kontrakt: docs/seller-portal.md.
-- Migrację można uruchomić ponownie.
-- =====================================================================================================================

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Opiekun sprzedawcy (i zastępca) w profilu sprzedawcy — jedno źródło prawdy
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE public.sales_partner_profiles
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS backup_manager_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_sales_partner_profiles_manager ON public.sales_partner_profiles(manager_id) WHERE manager_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_partner_profiles_backup ON public.sales_partner_profiles(backup_manager_id) WHERE backup_manager_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Widoczność wynagrodzenia w portalu (osobno dla marki). Naliczanie prowizji = commission_enabled, bez zmian.
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE public.sales_partner_brand_terms
  ADD COLUMN IF NOT EXISTS commissions_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commissions_visibility_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS commissions_visibility_changed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Historia zmian sprzedawcy (profil, opiekun, warunki marek, widoczność, konto portalu) — tylko dopisywanie
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_partner_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_partner_id uuid NOT NULL,
  my_company_id uuid,
  action text NOT NULL,
  before_values jsonb,
  after_values jsonb,
  reason text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_partner_audit_partner ON public.sales_partner_audit(sales_partner_id, created_at DESC);
ALTER TABLE public.sales_partner_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_partner_audit FROM anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Szybkie zapytania sprzedawcy („Sprawdź termin”) — z portalu i z kodu QR w hotelu
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seller_inquiry_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id) ON DELETE CASCADE,
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT seller_inquiry_links_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 120)
);
CREATE INDEX IF NOT EXISTS idx_seller_inquiry_links_partner ON public.seller_inquiry_links(sales_partner_id);

CREATE TABLE IF NOT EXISTS public.seller_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id) ON DELETE CASCADE,
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  link_id uuid REFERENCES public.seller_inquiry_links(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'portal',
  guest_name text NOT NULL,
  guest_company text,
  guest_email text,
  guest_phone text,
  event_date date NOT NULL,
  event_end_date date,
  guest_count integer,
  event_type text,
  venue_note text,
  budget_net numeric(14,2),
  note text,
  status text NOT NULL DEFAULT 'new',
  response text,
  responded_at timestamptz,
  responded_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_inquiries_source_check CHECK (source IN ('portal', 'qr')),
  CONSTRAINT seller_inquiries_status_check CHECK (status IN ('new', 'in_progress', 'answered', 'converted', 'closed')),
  CONSTRAINT seller_inquiries_type_check CHECK (event_type IS NULL OR event_type IN ('wedding', 'conference', 'gala', 'party', 'corporate', 'other')),
  CONSTRAINT seller_inquiries_guests_check CHECK (guest_count IS NULL OR guest_count BETWEEN 1 AND 100000),
  CONSTRAINT seller_inquiries_dates_check CHECK (event_end_date IS NULL OR event_end_date >= event_date),
  CONSTRAINT seller_inquiries_contact_check CHECK (coalesce(guest_email, '') <> '' OR coalesce(guest_phone, '') <> '')
);
CREATE INDEX IF NOT EXISTS idx_seller_inquiries_partner ON public.seller_inquiries(sales_partner_id, created_at DESC);
-- Formularz z kodu QR: skrót adresu urządzenia (bez zapisu samego adresu IP) do limitu zgłoszeń z jednego urządzenia.
ALTER TABLE public.seller_inquiries ADD COLUMN IF NOT EXISTS client_fingerprint text;
CREATE INDEX IF NOT EXISTS idx_seller_inquiries_link ON public.seller_inquiries(link_id, created_at DESC) WHERE link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_seller_inquiries_open ON public.seller_inquiries(status) WHERE status IN ('new', 'in_progress');
ALTER TABLE public.seller_inquiry_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_inquiries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_inquiry_links, public.seller_inquiries FROM anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Link do oferty dla gościa (podgląd bez logowania, akceptacja online)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seller_offer_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  accepted_at timestamptz,
  accepted_name text,
  accepted_email text,
  accepted_note text
);
-- Co dokładnie zaakceptował gość (pozycje i sumy w chwili akceptacji) — oferta może się później zmienić.
ALTER TABLE public.seller_offer_share_links ADD COLUMN IF NOT EXISTS accepted_snapshot jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS seller_offer_share_links_active ON public.seller_offer_share_links(offer_id) WHERE revoked_at IS NULL;
ALTER TABLE public.seller_offer_share_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_offer_share_links FROM anon, authenticated;

-- Historia oferty sprzedawcy: otwarcie i akceptacja przez gościa z linku.
ALTER TABLE public.partner_offer_activities DROP CONSTRAINT IF EXISTS partner_offer_activities_activity_type_check;
ALTER TABLE public.partner_offer_activities ADD CONSTRAINT partner_offer_activities_activity_type_check CHECK (activity_type = ANY (ARRAY[
  'draft_created', 'draft_updated', 'generated', 'sent', 'viewed', 'submitted_for_review', 'approved', 'changes_requested',
  'accepted', 'rejected', 'guest_viewed', 'guest_accepted']::text[]));

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Kto jest opiekunem i czyj jest sprzedawca
-- ---------------------------------------------------------------------------------------------------------------
-- Pracownik może prowadzić sprzedawców marki: aktywny, administrator albo uprawnienie do ofert, dostęp do marki.
CREATE OR REPLACE FUNCTION public.employee_can_manage_sellers(p_employee uuid, p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee AND e.is_active
    AND (p_company IS NULL OR public.employee_can_access_company(e.id, p_company))
    AND (e.role::text = 'admin' OR e.access_level::text = 'admin'
      OR coalesce(e.permissions, '{}'::text[]) && ARRAY['admin', 'offers_manage']::text[]));
$$;

-- Opiekun sprzedawcy: tylko profil (manager_id) — jedno źródło prawdy. Opiekun kontaktu NIE daje opiekuna sprzedawcy
-- (kontakt bez opiekuna mógłby „przejąć” każdy z prawem edycji kontaktów); zapas: ustawienie wysyłki ofert pracownika.
CREATE OR REPLACE FUNCTION public.seller_partner_manager_id(p_partner uuid, p_company uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce(p.manager_id, CASE WHEN p.contact_id IS NULL THEN s.manager_id END)
  FROM public.sales_partner_profiles p
  LEFT JOIN public.seller_offer_delivery_settings s ON s.sales_partner_id = p.id AND s.my_company_id = p_company
  WHERE p.id = p_partner;
$function$;

-- „Mój sprzedawca”: administrator, opiekun albo zastępca.
CREATE OR REPLACE FUNCTION public.seller_partner_is_mine(p_partner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT auth.uid() IS NOT NULL AND NOT coalesce(public.current_session_is_seller_portal(), true) AND (
    public.current_employee_is_crm_admin()
    OR EXISTS (SELECT 1 FROM public.sales_partner_profiles p
                WHERE p.id = p_partner AND public.current_employee_id() IN (p.manager_id, p.backup_manager_id)));
$$;

-- Warunki marek sprzedawcy zmienia administrator, finanse albo jego opiekun (z uprawnieniem do kontaktów).
CREATE OR REPLACE FUNCTION public.seller_terms_can_manage(p_partner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT auth.uid() IS NOT NULL AND NOT coalesce(public.current_session_is_seller_portal(), true) AND EXISTS (
    SELECT 1 FROM public.employees e WHERE e.id = public.current_employee_id() AND e.is_active
      AND (e.role::text = 'admin' OR e.access_level::text = 'admin'
        OR coalesce(e.permissions, '{}'::text[]) && ARRAY['admin', 'finances_manage']::text[]
        OR ('contacts_manage' = ANY (coalesce(e.permissions, '{}'::text[])) AND (public.seller_partner_is_mine(p_partner)
              -- nowy sprzedawca bez opiekuna: warunki startowe ustawia osoba, która go założyła
              OR EXISTS (SELECT 1 FROM public.sales_partner_profiles p WHERE p.id = p_partner AND p.manager_id IS NULL
                           AND p.backup_manager_id IS NULL AND p.created_by = e.id)))));
$$;

-- Wiersze kartoteki sprzedawców w CRM: administrator, opiekun / zastępca albo opiekun kontaktu.
CREATE OR REPLACE FUNCTION public.seller_directory_crm_row_access(p_employee uuid, p_contact uuid, p_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT auth.uid() IS NOT NULL AND NOT public.current_session_is_seller_portal()
    AND EXISTS(SELECT 1 FROM public.employees e
      WHERE e.id = public.current_employee_id() AND e.is_active = true
        AND (e.role::text = 'admin' OR e.access_level::text = 'admin'
          OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
          OR (p_employee IS NULL AND p_contact IS NOT NULL
            AND p_type IN ('hotel_employee', 'agency_employee', 'independent_referrer')
            AND (EXISTS(SELECT 1 FROM public.contacts c WHERE c.id = p_contact AND c.owner_id = e.id)
              OR EXISTS(SELECT 1 FROM public.sales_partner_profiles p WHERE p.contact_id = p_contact
                          AND e.id IN (p.manager_id, p.backup_manager_id))))));
$function$;

-- Rozmowy, skrzynka i obszar sprzedawcy w CRM: tylko „moi sprzedawcy” (administrator — wszyscy).
CREATE OR REPLACE FUNCTION public.seller_workspace_brand_access(p_partner uuid, p_company uuid, p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
 SELECT EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t
   WHERE t.sales_partner_id = p_partner AND t.my_company_id = p_company
   AND ((t.is_active AND p_partner = public.current_sales_partner_id())
     OR (public.seller_workspace_staff_access(p_company, p_write) AND public.seller_partner_is_mine(p_partner))));
$function$;

-- Oferty z portalu: decyzje podejmuje opiekun / zastępca sprzedawcy albo administrator.
CREATE OR REPLACE FUNCTION public.seller_offer_can_manage(p_offer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.offers o JOIN public.employees e ON e.id = public.current_employee_id()
    WHERE o.id = p_offer_id AND o.sales_channel = 'seller_portal' AND e.is_active = true
      AND public.current_employee_can_access_company(o.my_company_id)
      AND (e.role::text = 'admin' OR e.access_level::text = 'admin'
        OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'offers_manage' = ANY(COALESCE(e.permissions, '{}'::text[])))
      AND public.seller_partner_is_mine(o.sales_partner_id)
  );
$function$;

-- Oferta z portalu przed powiązaniem z wydarzeniem: widzi ją opiekun / zastępca, administrator i finanse.
-- Po powiązaniu z wydarzeniem obowiązują zwykłe zasady dostępu do wydarzenia.
CREATE OR REPLACE FUNCTION public.seller_portal_offer_staff_visible(p_partner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.seller_partner_is_mine(p_partner) OR coalesce(public.commission_settlement_can_access(NULL, true), false);
$$;

DROP POLICY IF EXISTS seller_portal_offer_manager_scope ON public.offers;
CREATE POLICY seller_portal_offer_manager_scope ON public.offers AS RESTRICTIVE FOR SELECT TO authenticated
  USING (sales_channel IS DISTINCT FROM 'seller_portal' OR public.current_session_is_seller_portal()
         OR event_id IS NOT NULL OR public.seller_portal_offer_staff_visible(sales_partner_id));

DROP POLICY IF EXISTS sales_partner_brand_terms_manage ON public.sales_partner_brand_terms;
CREATE POLICY sales_partner_brand_terms_manage ON public.sales_partner_brand_terms FOR ALL TO authenticated
  USING (public.current_employee_can_access_company(my_company_id) AND public.seller_terms_can_manage(sales_partner_id))
  WITH CHECK (public.current_employee_can_access_company(my_company_id) AND public.seller_terms_can_manage(sales_partner_id));
-- Sprzedawca nie czyta swoich warunków z tabeli (stawka przy ukrytym wynagrodzeniu) — dostaje je przez
-- get_seller_portal_context (z maskowaniem). Zasada klientów sprzedawcy sprawdza aktywną markę funkcją.
CREATE OR REPLACE FUNCTION public.seller_has_active_terms(p_partner uuid, p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t
                  WHERE t.sales_partner_id = p_partner AND t.my_company_id = p_company AND t.is_active);
$$;
REVOKE ALL ON FUNCTION public.seller_has_active_terms(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_has_active_terms(uuid, uuid) TO authenticated;
DROP POLICY IF EXISTS seller_clients_private_read ON public.sales_partner_clients;
CREATE POLICY seller_clients_private_read ON public.sales_partner_clients FOR SELECT TO authenticated
  USING (sales_partner_id = public.current_sales_partner_id() AND public.seller_has_active_terms(sales_partner_id, my_company_id));
DROP POLICY IF EXISTS sales_partner_brand_terms_portal_self ON public.sales_partner_brand_terms;

DROP POLICY IF EXISTS sales_partner_brand_terms_select ON public.sales_partner_brand_terms;
-- Odczyt bez zmian (kto widzi profil sprzedawcy i markę — np. panel prowizji wydarzenia); zapis tylko opiekun / finanse / administrator.
CREATE POLICY sales_partner_brand_terms_select ON public.sales_partner_brand_terms FOR SELECT TO authenticated
  USING (NOT coalesce(public.current_session_is_seller_portal(), false)
         AND EXISTS (SELECT 1 FROM public.sales_partner_profiles profile WHERE profile.id = sales_partner_brand_terms.sales_partner_id)
         AND public.current_employee_can_access_company(my_company_id));

-- Historia sprzedawcy: ci, którzy widzą sprzedawcę w kartotece.
DROP POLICY IF EXISTS sales_partner_audit_read ON public.sales_partner_audit;
CREATE POLICY sales_partner_audit_read ON public.sales_partner_audit FOR SELECT TO authenticated
  USING (public.seller_partner_is_mine(sales_partner_id));
GRANT SELECT ON public.sales_partner_audit TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Ochrona danych sprzedawcy
-- ---------------------------------------------------------------------------------------------------------------
-- Konto portalu podłącza wyłącznie zaproszenie (serwer z kluczem serwisowym); odłączyć wolno. Zapis daty zaproszenia.
CREATE OR REPLACE FUNCTION private.guard_seller_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.portal_auth_user_id IS NOT NULL
     AND NEW.portal_auth_user_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.portal_auth_user_id END) THEN
    IF auth.uid() IS NOT NULL AND coalesce(current_setting('mavinci.seller_invite', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Konto portalu podłącza zaproszenie do portalu (przycisk „Zaproś do portalu” w karcie sprzedawcy).';
    END IF;
    NEW.invited_at := coalesce(NEW.invited_at, now());
  END IF;
  -- Opiekuna i zastępcę zmienia administrator (set_seller_manager).
  -- Wyjątek: usunięcie pracownika (klucz obcy ON DELETE SET NULL) czyści opiekuna / zastępcę.
  IF TG_OP = 'UPDATE' AND (NEW.manager_id IS DISTINCT FROM OLD.manager_id OR NEW.backup_manager_id IS DISTINCT FROM OLD.backup_manager_id)
     AND auth.uid() IS NOT NULL AND coalesce(current_setting('mavinci.seller_manager', true), '') <> 'on'
     AND NOT ((NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id
               OR (NEW.manager_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = OLD.manager_id)))
          AND (NEW.backup_manager_id IS NOT DISTINCT FROM OLD.backup_manager_id
               OR (NEW.backup_manager_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = OLD.backup_manager_id)))) THEN
    RAISE EXCEPTION 'Opiekuna sprzedawcy zmienia administrator w karcie sprzedawcy.';
  END IF;
  -- Autor profilu z sesji (nie z aplikacji); później bez zmian.
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN NEW.created_by := coalesce(public.current_employee_id(), NEW.created_by);
    -- (usunięcie pracownika czyści autora kluczem obcym ON DELETE SET NULL)
    ELSIF NOT (NEW.created_by IS NULL AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = OLD.created_by)) THEN
      NEW.created_by := OLD.created_by;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND coalesce(current_setting('mavinci.seller_manager', true), '') <> 'on' THEN
    -- Nowy sprzedawca: opiekunem zostaje opiekun kontaktu (jeśli może prowadzić sprzedawców), inaczej tworzący.
    NEW.manager_id := NULL; NEW.backup_manager_id := NULL;
    SELECT CASE WHEN public.employee_can_manage_sellers(c.owner_id, NULL) THEN c.owner_id END INTO NEW.manager_id
      FROM public.contacts c WHERE c.id = NEW.contact_id;
    IF NEW.manager_id IS NULL AND public.employee_can_manage_sellers(public.current_employee_id(), NULL)
       AND NOT public.current_employee_is_crm_admin() THEN
      NEW.manager_id := public.current_employee_id();
    END IF;
    IF NEW.manager_id IS NOT NULL THEN NEW.manager_assigned_at := now(); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a_guard_seller_profile ON public.sales_partner_profiles;
CREATE TRIGGER a_guard_seller_profile BEFORE INSERT OR UPDATE ON public.sales_partner_profiles
  FOR EACH ROW EXECUTE FUNCTION private.guard_seller_profile();

-- Widoczność wynagrodzenia zmienia tylko set_seller_commission_visibility (z historią).
CREATE OR REPLACE FUNCTION private.guard_seller_terms_visibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(current_setting('mavinci.seller_visibility', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.commissions_visible := false; NEW.commissions_visibility_changed_at := NULL; NEW.commissions_visibility_changed_by := NULL;
  ELSIF NEW.commissions_visible IS DISTINCT FROM OLD.commissions_visible
     OR NEW.commissions_visibility_changed_at IS DISTINCT FROM OLD.commissions_visibility_changed_at
     OR (NEW.commissions_visibility_changed_by IS DISTINCT FROM OLD.commissions_visibility_changed_by
         -- usunięcie pracownika (ON DELETE SET NULL) czyści autora zmiany
         AND NOT (NEW.commissions_visibility_changed_by IS NULL
                  AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = OLD.commissions_visibility_changed_by))) THEN
    RAISE EXCEPTION 'Widoczność wynagrodzenia zmienia opiekun przełącznikiem „Pokaż wynagrodzenie w portalu”.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a_guard_seller_terms_visibility ON public.sales_partner_brand_terms;
CREATE TRIGGER a_guard_seller_terms_visibility BEFORE INSERT OR UPDATE ON public.sales_partner_brand_terms
  FOR EACH ROW EXECUTE FUNCTION private.guard_seller_terms_visibility();

-- Kontakt, który jest sprzedawcą, archiwizuje się statusem sprzedawcy — nie usuwa (zostają oferty i prowizje).
CREATE OR REPLACE FUNCTION private.guard_seller_contact_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sales_partner_profiles p WHERE p.contact_id = OLD.id) THEN
    RAISE EXCEPTION 'Ten kontakt jest sprzedawcą zewnętrznym — nie usuwaj go. Zmień status sprzedawcy na „nieaktywny”.';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS a_guard_seller_contact_delete ON public.contacts;
CREATE TRIGGER a_guard_seller_contact_delete BEFORE DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION private.guard_seller_contact_delete();

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Historia zmian sprzedawcy
-- ---------------------------------------------------------------------------------------------------------------
-- Zapis historii z nazwami (organizacja, opiekun, zastępca) — czytelny także po zmianie nazwiska lub usunięciu pracownika.
CREATE OR REPLACE FUNCTION private.seller_profile_audit_values(p public.sales_partner_profiles)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('status', p.status, 'partner_type', p.partner_type, 'organization_id', p.organization_id,
    'organization_name', (SELECT coalesce(nullif(btrim(g.alias), ''), g.name) FROM public.organizations g WHERE g.id = p.organization_id),
    'portal_enabled', p.portal_enabled, 'portal_account', p.portal_auth_user_id IS NOT NULL,
    'manager_id', p.manager_id, 'backup_manager_id', p.backup_manager_id,
    'manager_name', (SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') FROM public.employees e WHERE e.id = p.manager_id),
    'backup_manager_name', (SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') FROM public.employees e WHERE e.id = p.backup_manager_id));
$$;

CREATE OR REPLACE FUNCTION private.audit_seller_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_before jsonb; v_after jsonb; v_action text; v_reason text := nullif(current_setting('mavinci.seller_audit_reason', true), '');
BEGIN
  v_after := private.seller_profile_audit_values(NEW);
  IF TG_OP = 'INSERT' THEN
    v_action := 'profile_created';
  ELSE
    v_before := private.seller_profile_audit_values(OLD);
    IF v_before = v_after THEN RETURN NULL; END IF;
    v_action := CASE
      WHEN NEW.manager_id IS DISTINCT FROM OLD.manager_id OR NEW.backup_manager_id IS DISTINCT FROM OLD.backup_manager_id THEN 'manager_changed'
      WHEN OLD.portal_auth_user_id IS NULL AND NEW.portal_auth_user_id IS NOT NULL THEN 'portal_account_linked'
      WHEN OLD.portal_auth_user_id IS NOT NULL AND NEW.portal_auth_user_id IS NULL THEN 'portal_account_unlinked'
      ELSE 'profile_updated' END;
  END IF;
  INSERT INTO public.sales_partner_audit (sales_partner_id, action, before_values, after_values, reason, actor_id)
  VALUES (NEW.id, v_action, v_before, v_after, v_reason, public.current_invoice_employee_id());
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS zz_audit_seller_profile ON public.sales_partner_profiles;
CREATE TRIGGER zz_audit_seller_profile AFTER INSERT OR UPDATE ON public.sales_partner_profiles
  FOR EACH ROW EXECUTE FUNCTION private.audit_seller_profile();

CREATE OR REPLACE FUNCTION private.audit_seller_terms()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_before jsonb; v_after jsonb; v_action text; v_row public.sales_partner_brand_terms%ROWTYPE;
  v_reason text := nullif(current_setting('mavinci.seller_audit_reason', true), '');
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  IF TG_OP <> 'INSERT' THEN
    v_before := jsonb_build_object('is_active', OLD.is_active, 'commission_enabled', OLD.commission_enabled,
      'default_commission_rate', OLD.default_commission_rate, 'default_payment_method', OLD.default_payment_method,
      'dividend_tax_rate', OLD.dividend_tax_rate, 'commissions_visible', OLD.commissions_visible);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_after := jsonb_build_object('is_active', NEW.is_active, 'commission_enabled', NEW.commission_enabled,
      'default_commission_rate', NEW.default_commission_rate, 'default_payment_method', NEW.default_payment_method,
      'dividend_tax_rate', NEW.dividend_tax_rate, 'commissions_visible', NEW.commissions_visible);
  END IF;
  IF TG_OP = 'UPDATE' AND v_before = v_after THEN RETURN NULL; END IF;
  v_action := CASE TG_OP WHEN 'INSERT' THEN 'terms_created' WHEN 'DELETE' THEN 'terms_deleted'
    ELSE CASE WHEN (v_before - 'commissions_visible') = (v_after - 'commissions_visible') THEN 'visibility_changed' ELSE 'terms_updated' END END;
  INSERT INTO public.sales_partner_audit (sales_partner_id, my_company_id, action, before_values, after_values, reason, actor_id)
  VALUES (v_row.sales_partner_id, v_row.my_company_id, v_action, v_before, v_after, v_reason, public.current_invoice_employee_id());
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS zz_audit_seller_terms ON public.sales_partner_brand_terms;
CREATE TRIGGER zz_audit_seller_terms AFTER INSERT OR UPDATE OR DELETE ON public.sales_partner_brand_terms
  FOR EACH ROW EXECUTE FUNCTION private.audit_seller_terms();

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Powiadomienie w portalu sprzedawcy (dzwonek + skrzynka) — wspólna funkcja
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.notify_seller_portal(p_partner uuid, p_company uuid, p_title text, p_message text,
  p_url text, p_workflow text, p_entity_type text, p_entity_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid; v_notice uuid;
BEGIN
  SELECT p.portal_auth_user_id INTO v_user FROM public.sales_partner_profiles p
    JOIN auth.users u ON u.id = p.portal_auth_user_id
   WHERE p.id = p_partner AND p.portal_enabled AND p.status = 'active';
  IF v_user IS NULL THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.notifications(title, message, type, category, action_url, related_entity_type, related_entity_id, metadata)
    VALUES (left(p_title, 200), left(p_message, 500), 'info', 'system', p_url,
            CASE WHEN p_entity_type IN ('offer', 'event', 'task') THEN p_entity_type END, p_entity_id,
            coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('workflow', p_workflow, 'sales_partner_id', p_partner,
              'my_company_id', p_company, 'entity_type', p_entity_type, 'entity_id', p_entity_id))
    RETURNING id INTO v_notice;
    INSERT INTO public.notification_recipients(notification_id, user_id, is_read) VALUES (v_notice, v_user, false)
      ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Powiadomienie sprzedawcy nie zostało zapisane: %', SQLERRM;
  END;
END $$;

-- Odbiorcy po stronie CRM dla spraw sprzedawcy: opiekun i zastępca (jeśli mogą prowadzić sprzedawców marki),
-- a bez nich — administratorzy z dostępem do marki. p_with_admins: administratorzy zawsze w kopii.
CREATE OR REPLACE FUNCTION private.seller_staff_recipients(p_partner uuid, p_company uuid, p_with_admins boolean)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH people AS (
    SELECT e.id AS employee_id,
           (SELECT u.id FROM auth.users u WHERE u.id = e.auth_user_id OR u.id = e.id ORDER BY (u.id = e.auth_user_id) DESC NULLS LAST LIMIT 1) AS user_id,
           (e.role::text = 'admin' OR e.access_level::text = 'admin' OR 'admin' = ANY (coalesce(e.permissions, '{}'::text[]))) AS is_admin
      FROM public.employees e
     WHERE e.is_active AND (p_company IS NULL OR public.employee_can_access_company(e.id, p_company))
  ), managers AS (
    SELECT pe.user_id FROM people pe JOIN public.sales_partner_profiles p ON p.id = p_partner
     WHERE pe.employee_id IN (public.seller_partner_manager_id(p_partner, p_company), p.backup_manager_id)
       AND public.employee_can_manage_sellers(pe.employee_id, p_company)
  )
  SELECT coalesce(array_agg(DISTINCT x.user_id) FILTER (WHERE x.user_id IS NOT NULL), '{}'::uuid[]) FROM (
    SELECT user_id FROM managers
    UNION ALL
    SELECT pe.user_id FROM people pe WHERE pe.is_admin AND (p_with_admins OR NOT EXISTS (SELECT 1 FROM managers))
  ) x;
$$;

CREATE OR REPLACE FUNCTION private.notify_seller_staff(p_partner uuid, p_company uuid, p_with_admins boolean, p_title text,
  p_message text, p_url text, p_workflow text, p_entity_type text, p_entity_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_recipients uuid[] := private.seller_staff_recipients(p_partner, p_company, p_with_admins); v_notice uuid;
BEGIN
  IF coalesce(cardinality(v_recipients), 0) = 0 THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.notifications(title, message, type, category, action_url, related_entity_type, related_entity_id, metadata)
    VALUES (left(p_title, 200), left(p_message, 500), 'info', 'system', p_url,
            CASE WHEN p_entity_type IN ('offer', 'event', 'task') THEN p_entity_type END, p_entity_id,
            coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('workflow', p_workflow, 'sales_partner_id', p_partner,
              'my_company_id', p_company, 'entity_type', p_entity_type, 'entity_id', p_entity_id))
    RETURNING id INTO v_notice;
    INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
    SELECT v_notice, r, false FROM unnest(v_recipients) r WHERE r IS DISTINCT FROM auth.uid() ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Powiadomienie opiekuna nie zostało zapisane: %', SQLERRM;
  END;
END $$;

CREATE OR REPLACE FUNCTION private.seller_display_name(p_partner uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
                  nullif(btrim(concat_ws(' ', e.name, e.surname)), ''), 'Sprzedawca')
    FROM public.sales_partner_profiles p
    LEFT JOIN public.contacts c ON c.id = p.contact_id
    LEFT JOIN public.employees e ON e.id = p.employee_id
   WHERE p.id = p_partner;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 10. Opiekun, widoczność wynagrodzenia, historia
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_seller_manager(p_partner uuid, p_manager uuid, p_backup uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE p public.sales_partner_profiles%ROWTYPE; v_person uuid; v_name text; v_brand text;
BEGIN
  IF NOT public.current_employee_is_crm_admin() THEN
    RAISE EXCEPTION 'Opiekuna sprzedawcy przypisuje administrator.' USING ERRCODE = '42501';
  END IF;
  IF length(p_reason) > 1000 THEN RAISE EXCEPTION 'Powód może mieć najwyżej 1000 znaków.'; END IF;
  SELECT * INTO p FROM public.sales_partner_profiles WHERE id = p_partner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono sprzedawcy.'; END IF;
  IF p_manager IS NULL AND p_backup IS NOT NULL THEN RAISE EXCEPTION 'Najpierw wybierz opiekuna.'; END IF;
  IF p_backup IS NOT NULL AND p_backup = p_manager THEN RAISE EXCEPTION 'Zastępca musi być inną osobą niż opiekun.'; END IF;
  FOREACH v_person IN ARRAY array_remove(ARRAY[p_manager, p_backup], NULL) LOOP
    SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') INTO v_name FROM public.employees e WHERE e.id = v_person;
    IF NOT public.employee_can_manage_sellers(v_person, NULL) THEN
      RAISE EXCEPTION '% nie może prowadzić sprzedawców — potrzebne jest aktywne konto z uprawnieniem do ofert.', coalesce(v_name, 'Ta osoba');
    END IF;
    SELECT b.name INTO v_brand FROM public.sales_partner_brand_terms t JOIN public.my_companies b ON b.id = t.my_company_id
     WHERE t.sales_partner_id = p_partner AND t.is_active AND NOT public.employee_can_access_company(v_person, t.my_company_id)
     ORDER BY b.name LIMIT 1;
    IF v_brand IS NOT NULL THEN
      RAISE EXCEPTION '% nie ma dostępu do marki %, w której działa ten sprzedawca.', coalesce(v_name, 'Ta osoba'), v_brand;
    END IF;
  END LOOP;
  PERFORM set_config('mavinci.seller_manager', 'on', true);
  PERFORM set_config('mavinci.seller_audit_reason', coalesce(nullif(btrim(p_reason), ''), ''), true);
  UPDATE public.sales_partner_profiles SET manager_id = p_manager, backup_manager_id = p_backup,
         manager_assigned_at = now(), updated_at = now()
   WHERE id = p_partner;
  -- Kontakt sprzedawcy prowadzi jego opiekun (widoczność karty kontaktu w CRM).
  IF p_manager IS NOT NULL AND p.contact_id IS NOT NULL THEN
    UPDATE public.contacts SET owner_id = p_manager WHERE id = p.contact_id AND owner_id IS DISTINCT FROM p_manager;
  END IF;
  PERFORM set_config('mavinci.seller_manager', '', true);
  PERFORM set_config('mavinci.seller_audit_reason', '', true);
  RETURN jsonb_build_object('ok', true, 'manager_id', p_manager, 'backup_manager_id', p_backup);
END $$;

CREATE OR REPLACE FUNCTION public.set_seller_commission_visibility(p_partner uuid, p_company uuid, p_visible boolean,
  p_reason text DEFAULT NULL, p_notify boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t public.sales_partner_brand_terms%ROWTYPE; v_brand text; v_total numeric;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.current_session_is_seller_portal(), true)
     OR NOT (public.seller_partner_is_mine(p_partner) OR coalesce(public.commission_settlement_can_access(NULL, true), false)) THEN
    RAISE EXCEPTION 'Widoczność wynagrodzenia zmienia opiekun sprzedawcy, finanse lub administrator.' USING ERRCODE = '42501';
  END IF;
  IF p_visible IS NULL THEN RAISE EXCEPTION 'Wybierz: pokaż albo ukryj.'; END IF;
  IF length(p_reason) > 1000 THEN RAISE EXCEPTION 'Powód może mieć najwyżej 1000 znaków.'; END IF;
  SELECT * INTO t FROM public.sales_partner_brand_terms WHERE sales_partner_id = p_partner AND my_company_id = p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sprzedawca nie ma warunków współpracy w tej marce.'; END IF;
  IF t.commissions_visible = p_visible THEN RETURN jsonb_build_object('ok', true, 'commissions_visible', p_visible, 'changed', false); END IF;
  PERFORM set_config('mavinci.seller_visibility', 'on', true);
  PERFORM set_config('mavinci.seller_audit_reason', coalesce(nullif(btrim(p_reason), ''), ''), true);
  UPDATE public.sales_partner_brand_terms SET commissions_visible = p_visible, commissions_visibility_changed_at = now(),
         commissions_visibility_changed_by = public.current_invoice_employee_id(), updated_at = now()
   WHERE id = t.id;
  PERFORM set_config('mavinci.seller_visibility', '', true);
  PERFORM set_config('mavinci.seller_audit_reason', '', true);
  IF p_visible AND coalesce(p_notify, true) THEN
    SELECT b.name INTO v_brand FROM public.my_companies b WHERE b.id = p_company;
    SELECT coalesce(sum(CASE WHEN c.entry_kind = 'deduction' THEN -c.amount ELSE c.amount END), 0) INTO v_total
      FROM public.event_commissions c JOIN public.events e ON e.id = c.event_id
     WHERE c.sales_partner_id = p_partner AND e.my_company_id = p_company AND c.status <> 'cancelled';
    PERFORM private.notify_seller_portal(p_partner, p_company, 'Twoje wynagrodzenie jest już widoczne',
      concat_ws(' ', 'Opiekun włączył podgląd wynagrodzenia', CASE WHEN v_brand IS NOT NULL THEN '(' || v_brand || ').' ELSE '.' END,
        CASE WHEN v_total > 0 THEN 'Naliczone do tej pory: ' || private.pl_money(v_total) || ' zł.' END),
      '/seller/commissions', 'seller_visibility', 'sales_partner', p_partner, '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object('ok', true, 'commissions_visible', p_visible, 'changed', true);
END $$;

CREATE OR REPLACE FUNCTION public.get_seller_audit(p_partner uuid, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.seller_partner_is_mine(p_partner) AND NOT coalesce(public.commission_settlement_can_access(NULL, false), false) THEN
    RAISE EXCEPTION 'Historię sprzedawcy widzi jego opiekun, finanse lub administrator.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'my_company_id', a.my_company_id,
            'brand_name', b.name, 'before', a.before_values, 'after', a.after_values, 'reason', a.reason,
            'actor_name', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''), 'created_at', a.created_at)
            ORDER BY a.created_at DESC, a.id), '[]'::jsonb)
    FROM (SELECT * FROM public.sales_partner_audit WHERE sales_partner_id = p_partner
           ORDER BY created_at DESC LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)) a
    LEFT JOIN public.my_companies b ON b.id = a.my_company_id
    LEFT JOIN public.employees e ON e.id = a.actor_id);
END $$;

-- Stan konta portalu sprzedawcy (zaproszony / aktywny, ostatnie logowanie) — dla opiekuna.
CREATE OR REPLACE FUNCTION public.seller_portal_account_state(p_partner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN NOT public.seller_partner_is_mine(p_partner) THEN NULL ELSE (
    SELECT jsonb_build_object(
      'portal_account', CASE WHEN p.portal_auth_user_id IS NULL OR u.id IS NULL THEN 'none'
                             WHEN u.last_sign_in_at IS NULL THEN 'invited' ELSE 'active' END,
      'last_sign_in_at', u.last_sign_in_at, 'invited_at', coalesce(p.invited_at, u.invited_at, u.created_at))
      FROM public.sales_partner_profiles p LEFT JOIN auth.users u ON u.id = p.portal_auth_user_id
     WHERE p.id = p_partner) END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 11. Kokpit opiekuna
-- ---------------------------------------------------------------------------------------------------------------
-- p_partner: tylko jeden sprzedawca (karta sprzedawcy w CRM) — ten sam zakres „moich”.
DROP FUNCTION IF EXISTS public.get_my_seller_cockpit(uuid);
CREATE OR REPLACE FUNCTION public.get_my_seller_cockpit(p_manager uuid DEFAULT NULL, p_partner uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_me uuid := public.current_employee_id();
  v_admin boolean := public.current_employee_is_crm_admin();
  v_partners uuid[];
  v_sellers jsonb; v_today jsonb; v_pipeline jsonb; v_upcoming jsonb; v_warnings jsonb; v_managers jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_me IS NULL OR coalesce(public.current_session_is_seller_portal(), true) THEN
    RAISE EXCEPTION 'Wymagane konto pracownika CRM.' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(array_agg(p.id), '{}'::uuid[]) INTO v_partners
    FROM public.sales_partner_profiles p LEFT JOIN public.contacts c ON c.id = p.contact_id
   WHERE p.contact_id IS NOT NULL AND p.partner_type <> 'internal_employee' AND (p_partner IS NULL OR p.id = p_partner)
     AND CASE WHEN v_admin THEN p_partner IS NOT NULL OR p_manager IS NULL OR p_manager IN (p.manager_id, p.backup_manager_id)
              ELSE v_me IN (p.manager_id, p.backup_manager_id) END;

  -- Oferty sprzedawców z etapem lejka.
  WITH o AS (
    SELECT x.id, x.sales_partner_id, x.my_company_id, x.event_id, x.status::text AS status, x.created_at,
           coalesce(nullif(btrim(x.title), ''), x.offer_number, 'Oferta') AS title, x.offer_number, x.client_total_net,
           r.status AS review_status, r.document_id, r.requested_at,
           EXISTS (SELECT 1 FROM public.seller_offer_documents d WHERE d.offer_id = x.id) AS has_pdf,
           e.status::text AS event_status, e.event_date
      FROM public.offers x
      LEFT JOIN public.seller_offer_reviews r ON r.offer_id = x.id
      LEFT JOIN public.events e ON e.id = x.event_id
     WHERE x.sales_channel = 'seller_portal' AND x.sales_partner_id = ANY (v_partners)
       AND coalesce(x.status::text, '') NOT IN ('rejected', 'cancelled')
  ), staged AS (
    SELECT o.*, CASE
      WHEN o.event_id IS NOT NULL AND o.event_status = 'settled' THEN 'settled'
      WHEN o.event_id IS NOT NULL AND o.event_status IN ('completed', 'invoiced') THEN 'completed'
      WHEN o.event_id IS NOT NULL AND o.event_status <> 'cancelled' THEN 'confirmed'
      WHEN o.event_id IS NOT NULL THEN NULL
      WHEN o.status = 'accepted' THEN 'accepted'
      WHEN o.review_status = 'pending' THEN 'review'
      WHEN o.has_pdf THEN 'pdf'
      ELSE 'draft' END AS stage
      FROM o
  )
  SELECT jsonb_build_object(
           'draft', count(*) FILTER (WHERE stage = 'draft'), 'pdf', count(*) FILTER (WHERE stage = 'pdf'),
           'review', count(*) FILTER (WHERE stage = 'review'), 'accepted', count(*) FILTER (WHERE stage = 'accepted'),
           'confirmed', count(*) FILTER (WHERE stage = 'confirmed'), 'completed', count(*) FILTER (WHERE stage = 'completed'),
           'settled', count(*) FILTER (WHERE stage = 'settled')),
         jsonb_build_object(
           'reviews', coalesce(jsonb_agg(jsonb_build_object('offer_id', id, 'document_id', document_id,
               'sales_partner_id', sales_partner_id, 'seller_name', private.seller_display_name(sales_partner_id),
               'title', title, 'offer_number', offer_number, 'requested_at', requested_at, 'client_total_net', client_total_net)
               ORDER BY requested_at) FILTER (WHERE review_status = 'pending' AND event_id IS NULL), '[]'::jsonb))
    INTO v_pipeline, v_today
    FROM staged;

  v_today := v_today || jsonb_build_object(
    'wizard_steps', (SELECT coalesce(jsonb_agg(jsonb_build_object('offer_id', s.offer_id, 'event_id', x.event_id,
        'sales_partner_id', x.sales_partner_id, 'seller_name', private.seller_display_name(x.sales_partner_id),
        'title', coalesce(nullif(btrim(x.title), ''), x.offer_number, 'Realizacja'), 'step_key', s.step_key, 'submitted_at', s.submitted_at)
        ORDER BY s.submitted_at), '[]'::jsonb)
      FROM public.seller_realization_steps s JOIN public.offers x ON x.id = s.offer_id
     WHERE s.status = 'submitted' AND x.sales_partner_id = ANY (v_partners)),
    'events_pending', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('event_id', e.id, 'name', e.name, 'event_date', e.event_date,
        'sales_partner_id', x.sales_partner_id, 'seller_name', private.seller_display_name(x.sales_partner_id),
        'confirmation_required', coalesce(e.seller_confirmation_required, false), 'schedule_pending', coalesce(e.seller_schedule_pending, false))), '[]'::jsonb)
      FROM public.events e JOIN public.offers x ON x.event_id = e.id AND x.sales_channel = 'seller_portal'
     WHERE x.sales_partner_id = ANY (v_partners) AND e.status::text <> 'cancelled'
       AND (coalesce(e.seller_confirmation_required, false) OR coalesce(e.seller_schedule_pending, false))),
    'chats_waiting', (SELECT coalesce(jsonb_agg(jsonb_build_object('conversation_id', c.id, 'sales_partner_id', c.sales_partner_id,
        'seller_name', private.seller_display_name(c.sales_partner_id), 'contact_id', p.contact_id, 'offer_id', c.offer_id,
        'title', CASE WHEN c.offer_id IS NULL THEN 'Rozmowa ogólna' ELSE coalesce(nullif(btrim(ox.title), ''), ox.offer_number, 'Rozmowa o ofercie') END,
        'last_message_at', m.created_at, 'preview', left(m.body, 160),
        'waiting_hours', round(extract(epoch FROM now() - m.created_at) / 3600.0, 1))
        ORDER BY m.created_at), '[]'::jsonb)
      FROM public.seller_conversations c
      JOIN public.sales_partner_profiles p ON p.id = c.sales_partner_id
      LEFT JOIN public.offers ox ON ox.id = c.offer_id
      JOIN LATERAL (SELECT mm.* FROM public.seller_messages mm WHERE mm.conversation_id = c.id ORDER BY mm.seq DESC LIMIT 1) m ON true
     WHERE c.sales_partner_id = ANY (v_partners) AND m.sender_kind = 'seller'),
    'inquiries', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'sales_partner_id', i.sales_partner_id,
        'seller_name', private.seller_display_name(i.sales_partner_id), 'source', i.source, 'guest_name', i.guest_name,
        'event_date', i.event_date, 'guest_count', i.guest_count, 'event_type', i.event_type, 'created_at', i.created_at,
        'status', i.status) ORDER BY i.created_at), '[]'::jsonb)
      FROM public.seller_inquiries i WHERE i.sales_partner_id = ANY (v_partners) AND i.status IN ('new', 'in_progress')),
    'guest_acceptances', (SELECT coalesce(jsonb_agg(jsonb_build_object('offer_id', x.id, 'sales_partner_id', x.sales_partner_id,
        'seller_name', private.seller_display_name(x.sales_partner_id), 'title', coalesce(nullif(btrim(x.title), ''), x.offer_number, 'Oferta'),
        'accepted_at', l.accepted_at, 'accepted_name', l.accepted_name) ORDER BY l.accepted_at), '[]'::jsonb)
      FROM public.seller_offer_share_links l JOIN public.offers x ON x.id = l.offer_id
      LEFT JOIN public.seller_offer_reviews r ON r.offer_id = x.id
     WHERE l.revoked_at IS NULL AND l.accepted_at IS NOT NULL AND x.sales_partner_id = ANY (v_partners)
       AND x.event_id IS NULL AND x.status::text <> 'accepted' AND r.status IS DISTINCT FROM 'pending'));

  SELECT coalesce(jsonb_agg(row ORDER BY row->>'name'), '[]'::jsonb) INTO v_sellers FROM (
    SELECT jsonb_build_object(
      'id', p.id, 'contact_id', p.contact_id, 'name', private.seller_display_name(p.id),
      'email', c.email, 'phone', coalesce(nullif(c.mobile, ''), c.phone),
      'organization_id', p.organization_id, 'organization_name', coalesce(nullif(btrim(org.alias), ''), org.name),
      'partner_type', p.partner_type, 'status', p.status, 'portal_enabled', p.portal_enabled,
      'portal_account', CASE WHEN p.portal_auth_user_id IS NULL OR u.id IS NULL THEN 'none'
                             WHEN u.last_sign_in_at IS NULL THEN 'invited' ELSE 'active' END,
      'last_sign_in_at', u.last_sign_in_at, 'last_activity_at', act.at,
      'manager', CASE WHEN mg.id IS NOT NULL THEN jsonb_build_object('id', mg.id, 'name', nullif(btrim(concat_ws(' ', mg.name, mg.surname)), '')) END,
      'backup_manager', CASE WHEN bk.id IS NOT NULL THEN jsonb_build_object('id', bk.id, 'name', nullif(btrim(concat_ws(' ', bk.name, bk.surname)), '')) END,
      'manager_ok', ok.value,
      'brands', brands.list,
      'offers', offers.counts,
      'upcoming_events', ev.upcoming,
      'payable', money.payable, 'forecast', money.forecast,
      'warnings', to_jsonb(array_remove(ARRAY[
          CASE WHEN mg.id IS NULL THEN 'Brak opiekuna — sprawy sprzedawcy trafiają do administratorów.' END,
          CASE WHEN mg.id IS NOT NULL AND NOT ok.value THEN 'Opiekun nie ma uprawnień do ofert lub dostępu do marki sprzedawcy.' END,
          CASE WHEN NOT brands.any_active THEN 'Brak aktywnych warunków współpracy w żadnej marce.' END,
          CASE WHEN p.portal_enabled AND (u.id IS NULL OR u.last_sign_in_at IS NULL)
                    AND coalesce(p.invited_at, u.created_at, p.created_at) < now() - interval '7 days'
               THEN 'Zaproszenie do portalu nieprzyjęte od ponad 7 dni.' END,
          CASE WHEN p.status = 'active' AND act.at IS NOT NULL AND act.at < now() - interval '60 days' THEN 'Brak aktywności od 60 dni.'
               WHEN p.status = 'active' AND act.at IS NOT NULL AND act.at < now() - interval '30 days' THEN 'Brak aktywności od 30 dni.' END
        ], NULL)),
      'warning_codes', to_jsonb(array_remove(ARRAY[
          CASE WHEN mg.id IS NULL THEN 'no_manager' END,
          CASE WHEN mg.id IS NOT NULL AND NOT ok.value THEN 'manager_without_rights' END,
          CASE WHEN NOT brands.any_active THEN 'no_active_terms' END,
          CASE WHEN p.portal_enabled AND (u.id IS NULL OR u.last_sign_in_at IS NULL)
                    AND coalesce(p.invited_at, u.created_at, p.created_at) < now() - interval '7 days' THEN 'invite_pending' END,
          CASE WHEN p.status = 'active' AND act.at IS NOT NULL AND act.at < now() - interval '60 days' THEN 'inactive_60'
               WHEN p.status = 'active' AND act.at IS NOT NULL AND act.at < now() - interval '30 days' THEN 'inactive_30' END
        ], NULL))) AS row
    FROM public.sales_partner_profiles p
    LEFT JOIN public.contacts c ON c.id = p.contact_id
    LEFT JOIN public.organizations org ON org.id = p.organization_id
    LEFT JOIN auth.users u ON u.id = p.portal_auth_user_id
    LEFT JOIN public.employees mg ON mg.id = p.manager_id
    LEFT JOIN public.employees bk ON bk.id = p.backup_manager_id
    CROSS JOIN LATERAL (SELECT greatest(
        (SELECT max(a.created_at) FROM public.partner_offer_activities a WHERE a.sales_partner_id = p.id),
        (SELECT max(x.partner_last_activity_at) FROM public.offers x WHERE x.sales_partner_id = p.id),
        (SELECT max(m.created_at) FROM public.seller_messages m JOIN public.seller_conversations cv ON cv.id = m.conversation_id
          WHERE cv.sales_partner_id = p.id AND m.sender_kind = 'seller'),
        (SELECT max(i.created_at) FROM public.seller_inquiries i WHERE i.sales_partner_id = p.id AND i.source = 'portal'),
        u.last_sign_in_at) AS at) act
    CROSS JOIN LATERAL (
      SELECT coalesce(jsonb_agg(jsonb_build_object('my_company_id', t.my_company_id, 'name', b.name, 'is_active', t.is_active,
               'commission_enabled', t.commission_enabled, 'rate', t.default_commission_rate,
               'commissions_visible', t.commissions_visible) ORDER BY b.name), '[]'::jsonb) AS list,
             coalesce(bool_or(t.is_active), false) AS any_active
        FROM public.sales_partner_brand_terms t JOIN public.my_companies b ON b.id = t.my_company_id
       WHERE t.sales_partner_id = p.id) brands
    CROSS JOIN LATERAL (SELECT mg.id IS NOT NULL AND public.employee_can_manage_sellers(mg.id, NULL)
        AND NOT EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id = p.id AND t.is_active
                          AND NOT public.employee_can_access_company(mg.id, t.my_company_id)) AS value) ok
    CROSS JOIN LATERAL (
      SELECT jsonb_build_object(
        'draft', count(*) FILTER (WHERE x.event_id IS NULL AND x.status::text <> 'accepted' AND r.status IS DISTINCT FROM 'pending'
                                    AND NOT EXISTS (SELECT 1 FROM public.seller_offer_documents d WHERE d.offer_id = x.id)),
        'pdf', count(*) FILTER (WHERE x.event_id IS NULL AND x.status::text <> 'accepted' AND r.status IS DISTINCT FROM 'pending'
                                  AND EXISTS (SELECT 1 FROM public.seller_offer_documents d WHERE d.offer_id = x.id)),
        'review', count(*) FILTER (WHERE x.event_id IS NULL AND r.status = 'pending'),
        'accepted', count(*) FILTER (WHERE x.status::text = 'accepted' OR x.event_id IS NOT NULL),
        'total', count(*)) AS counts
        FROM public.offers x LEFT JOIN public.seller_offer_reviews r ON r.offer_id = x.id
       WHERE x.sales_channel = 'seller_portal' AND x.sales_partner_id = p.id
         AND coalesce(x.status::text, '') NOT IN ('rejected', 'cancelled')) offers
    CROSS JOIN LATERAL (
      SELECT count(DISTINCT e.id) AS upcoming FROM public.events e
       WHERE e.status::text <> 'cancelled' AND coalesce(e.event_end_date, e.event_date) >= now()
         AND (e.referring_sales_partner_id = p.id
              OR EXISTS (SELECT 1 FROM public.offers x WHERE x.event_id = e.id AND x.sales_partner_id = p.id))) ev
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(greatest(0, cm.amount - coalesce((SELECT sum(po.amount) FROM public.event_commission_payouts po WHERE po.commission_id = cm.id), 0)))
               FILTER (WHERE cm.status = 'approved' AND cm.entry_kind <> 'deduction'), 0) AS payable,
             coalesce(sum(cm.amount) FILTER (WHERE cm.status = 'planned' AND cm.entry_kind = 'accrual'), 0) AS forecast
        FROM public.event_commissions cm WHERE cm.sales_partner_id = p.id) money
   WHERE p.id = ANY (v_partners)
  ) s;

  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('event_id', e.id, 'name', e.name, 'event_date', e.event_date,
           'status', e.status, 'sales_partner_id', sp.id, 'seller_name', private.seller_display_name(sp.id))), '[]'::jsonb)
    INTO v_upcoming
    FROM public.events e
    JOIN LATERAL (SELECT coalesce(e.referring_sales_partner_id,
                    (SELECT x.sales_partner_id FROM public.offers x WHERE x.event_id = e.id AND x.sales_partner_id IS NOT NULL LIMIT 1)) AS id) sp ON true
   WHERE sp.id = ANY (v_partners) AND e.status::text <> 'cancelled'
     AND e.event_date >= date_trunc('day', now()) AND e.event_date < now() + interval '14 days';

  SELECT coalesce(jsonb_agg(jsonb_build_object('sales_partner_id', s->>'id', 'seller_name', s->>'name',
           'code', w.code, 'message', w.message)), '[]'::jsonb)
    INTO v_warnings
    FROM jsonb_array_elements(v_sellers) s
    CROSS JOIN LATERAL (SELECT c.value #>> '{}' AS code, m.value #>> '{}' AS message
                          FROM jsonb_array_elements(s->'warning_codes') WITH ORDINALITY c(value, n)
                          JOIN jsonb_array_elements(s->'warnings') WITH ORDINALITY m(value, n) ON m.n = c.n) w;

  IF v_admin THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
             'eligible', public.employee_can_manage_sellers(e.id, NULL)) ORDER BY e.surname, e.name), '[]'::jsonb)
      INTO v_managers
      FROM public.employees e
     WHERE e.is_active AND (public.employee_can_manage_sellers(e.id, NULL)
        OR EXISTS (SELECT 1 FROM public.sales_partner_profiles p WHERE e.id IN (p.manager_id, p.backup_manager_id)));
  END IF;

  RETURN jsonb_build_object(
    'viewer', jsonb_build_object('employee_id', v_me, 'is_admin', v_admin),
    'managers', v_managers,
    'today', v_today,
    -- sellers[].warnings = kody (etykiety w sellerCockpit.ts), sellers[].warning_messages = gotowe komunikaty.
    'sellers', (SELECT coalesce(jsonb_agg((x - 'warning_codes' - 'warnings')
                  || jsonb_build_object('warnings', x->'warning_codes', 'warning_messages', x->'warnings') ORDER BY x->>'name'), '[]'::jsonb)
                  FROM jsonb_array_elements(v_sellers) x),
    'pipeline', v_pipeline,
    'upcoming', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'event_date'), '[]'::jsonb) FROM jsonb_array_elements(v_upcoming) x),
    'warnings', v_warnings);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 12. Zapytania sprzedawców po stronie CRM
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_seller_inquiry(p_inquiry uuid, p_status text, p_response text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE i public.seller_inquiries%ROWTYPE; v_response text := nullif(btrim(p_response), '');
BEGIN
  SELECT * INTO i FROM public.seller_inquiries WHERE id = p_inquiry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono zapytania.'; END IF;
  IF NOT public.seller_partner_is_mine(i.sales_partner_id) THEN
    RAISE EXCEPTION 'Zapytanie obsługuje opiekun sprzedawcy lub administrator.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('in_progress', 'answered', 'closed') THEN RAISE EXCEPTION 'Nieprawidłowy status zapytania.'; END IF;
  IF p_status = 'answered' AND v_response IS NULL THEN RAISE EXCEPTION 'Napisz odpowiedź dla sprzedawcy.'; END IF;
  IF length(v_response) > 4000 THEN RAISE EXCEPTION 'Odpowiedź może mieć najwyżej 4000 znaków.'; END IF;
  UPDATE public.seller_inquiries SET status = p_status, response = coalesce(v_response, response),
         responded_at = CASE WHEN v_response IS NOT NULL THEN now() ELSE responded_at END,
         responded_by = CASE WHEN v_response IS NOT NULL THEN public.current_invoice_employee_id() ELSE responded_by END,
         updated_at = now()
   WHERE id = i.id;
  IF v_response IS NOT NULL THEN
    PERFORM private.notify_seller_portal(i.sales_partner_id, i.my_company_id, 'Odpowiedź na zapytanie: ' || i.guest_name,
      left(v_response, 300), '/seller/inquiries?inquiry=' || i.id, 'seller_inquiry', 'seller_inquiry', i.id,
      jsonb_build_object('inquiry_id', i.id));
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', p_status);
END $$;

CREATE OR REPLACE FUNCTION public.convert_seller_inquiry(p_inquiry uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE i public.seller_inquiries%ROWTYPE; v_owner uuid; v_task uuid; v_seller text;
BEGIN
  SELECT * INTO i FROM public.seller_inquiries WHERE id = p_inquiry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono zapytania.'; END IF;
  IF NOT public.seller_partner_is_mine(i.sales_partner_id) THEN
    RAISE EXCEPTION 'Zapytanie obsługuje opiekun sprzedawcy lub administrator.' USING ERRCODE = '42501';
  END IF;
  IF i.task_id IS NOT NULL THEN RETURN i.task_id; END IF;
  v_owner := coalesce(CASE WHEN public.employee_can_manage_sellers(public.seller_partner_manager_id(i.sales_partner_id, i.my_company_id), i.my_company_id)
                           THEN public.seller_partner_manager_id(i.sales_partner_id, i.my_company_id) END,
                      public.current_employee_id());
  v_seller := private.seller_display_name(i.sales_partner_id);
  INSERT INTO public.tasks (title, description, is_inquiry, inquiry_stage, inquiry_owner_id, inquiry_details, estimated_value,
                            next_action_at, created_by, owner_id)
  VALUES (left('Zapytanie od sprzedawcy: ' || i.guest_name || coalesce(' (' || nullif(i.guest_company, '') || ')', ''), 300),
          concat_ws(E'\n',
            'Sprzedawca: ' || v_seller,
            'Termin: ' || to_char(i.event_date, 'DD.MM.YYYY') || coalesce(' – ' || to_char(i.event_end_date, 'DD.MM.YYYY'), ''),
            CASE WHEN i.guest_count IS NOT NULL THEN 'Liczba gości: ' || i.guest_count END,
            CASE WHEN i.event_type IS NOT NULL THEN 'Rodzaj: ' || i.event_type END,
            CASE WHEN nullif(i.venue_note, '') IS NOT NULL THEN 'Miejsce: ' || i.venue_note END,
            'Gość: ' || concat_ws(' · ', i.guest_name, nullif(i.guest_company, ''), nullif(i.guest_email, ''), nullif(i.guest_phone, '')),
            CASE WHEN nullif(i.note, '') IS NOT NULL THEN 'Uwagi: ' || i.note END),
          true, 'new', v_owner,
          jsonb_strip_nulls(jsonb_build_object('source', 'seller_portal', 'seller_inquiry_id', i.id, 'sales_partner_id', i.sales_partner_id,
            'my_company_id', i.my_company_id, 'event_date', i.event_date, 'event_end_date', i.event_end_date,
            'guest_count', i.guest_count, 'event_type', i.event_type, 'client_name', i.guest_name, 'client_company', nullif(i.guest_company, ''),
            'client_email', nullif(i.guest_email, ''), 'client_phone', nullif(i.guest_phone, ''))),
          i.budget_net, now() + interval '1 day', public.current_employee_id(), v_owner)
  RETURNING id INTO v_task;
  UPDATE public.seller_inquiries SET status = 'converted', task_id = v_task, updated_at = now() WHERE id = i.id;
  RETURN v_task;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 13. Klient z danych oferty sprzedawcy (zamiast przepisywania z opisu wydarzenia)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_client_from_seller_offer(p_offer uuid, p_confirm boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.offers%ROWTYPE; v_name text; v_company text; v_email text; v_phone text; v_first text; v_last text;
  v_contact uuid; v_org uuid; v_created boolean := false; v_owner uuid;
BEGIN
  SELECT * INTO o FROM public.offers WHERE id = p_offer AND sales_channel = 'seller_portal' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono oferty sprzedawcy.'; END IF;
  IF NOT public.seller_partner_is_mine(o.sales_partner_id) THEN
    RAISE EXCEPTION 'Klienta z oferty tworzy opiekun sprzedawcy lub administrator.' USING ERRCODE = '42501';
  END IF;
  v_name := nullif(btrim(o.portal_client_name), ''); v_company := nullif(btrim(o.portal_client_company), '');
  v_email := lower(nullif(btrim(o.portal_client_email), '')); v_phone := nullif(btrim(o.portal_client_phone), '');
  IF v_name IS NULL AND v_company IS NULL THEN RAISE EXCEPTION 'Oferta nie ma danych klienta.'; END IF;
  SELECT c.id INTO v_contact FROM public.contacts c WHERE v_email IS NOT NULL AND lower(c.email) = v_email ORDER BY c.created_at LIMIT 1;
  SELECT g.id INTO v_org FROM public.organizations g WHERE v_company IS NOT NULL
     AND (lower(btrim(g.name)) = lower(v_company) OR lower(btrim(g.alias)) = lower(v_company)) ORDER BY g.created_at LIMIT 1;
  IF NOT coalesce(p_confirm, false) THEN
    RETURN jsonb_build_object(
      'contact', CASE WHEN v_name IS NOT NULL THEN jsonb_build_object('full_name', v_name, 'email', v_email, 'phone', v_phone) END,
      'organization', CASE WHEN v_company IS NOT NULL THEN jsonb_build_object('name', v_company) END,
      'matches', jsonb_strip_nulls(jsonb_build_object('contact_id', v_contact, 'organization_id', v_org)),
      'linked', jsonb_strip_nulls(jsonb_build_object('contact_id', o.contact_id, 'organization_id', o.organization_id)));
  END IF;
  v_owner := coalesce(public.seller_partner_manager_id(o.sales_partner_id, o.my_company_id), public.current_employee_id());
  IF v_org IS NULL AND v_company IS NOT NULL AND o.organization_id IS NULL THEN
    INSERT INTO public.organizations (name, email, phone, owner_id, notes)
    VALUES (v_company, CASE WHEN v_name IS NULL THEN v_email END, CASE WHEN v_name IS NULL THEN v_phone END, v_owner,
            'Utworzono z oferty sprzedawcy ' || coalesce(o.offer_number, o.id::text))
    RETURNING id INTO v_org;
    v_created := true;
  END IF;
  IF v_contact IS NULL AND v_name IS NOT NULL AND o.contact_id IS NULL THEN
    v_first := split_part(v_name, ' ', 1);
    v_last := coalesce(nullif(btrim(substr(v_name, length(v_first) + 1)), ''), '-');
    INSERT INTO public.contacts (first_name, last_name, full_name, email, phone, owner_id, source, contact_type, notes)
    VALUES (v_first, v_last, v_name, v_email, v_phone, v_owner, 'seller_portal', CASE WHEN v_company IS NULL THEN 'individual' ELSE 'contact' END,
            'Utworzono z oferty sprzedawcy ' || coalesce(o.offer_number, o.id::text))
    RETURNING id INTO v_contact;
    v_created := true;
  END IF;
  v_contact := coalesce(o.contact_id, v_contact); v_org := coalesce(o.organization_id, v_org);
  IF v_contact IS NOT NULL AND v_org IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.contact_organizations r WHERE r.contact_id = v_contact AND r.organization_id = v_org) THEN
    INSERT INTO public.contact_organizations (contact_id, organization_id, is_current, is_primary) VALUES (v_contact, v_org, true, true);
  END IF;
  -- offers_client_check: firma → client_type business; sama osoba → individual.
  UPDATE public.offers SET contact_id = coalesce(contact_id, v_contact), organization_id = coalesce(organization_id, v_org),
         client_type = CASE WHEN coalesce(organization_id, v_org) IS NOT NULL THEN 'business'::public.client_type_enum
                            WHEN coalesce(contact_id, v_contact) IS NOT NULL THEN 'individual'::public.client_type_enum
                            ELSE client_type END
   WHERE id = o.id;
  IF o.event_id IS NOT NULL THEN
    UPDATE public.events SET contact_person_id = coalesce(contact_person_id, v_contact), organization_id = coalesce(organization_id, v_org),
           client_type = coalesce(client_type, CASE WHEN coalesce(organization_id, v_org) IS NOT NULL THEN 'business'::public.client_type_enum
                                                    WHEN coalesce(contact_person_id, v_contact) IS NOT NULL THEN 'individual'::public.client_type_enum END)
     WHERE id = o.event_id AND (contact_person_id IS NULL OR organization_id IS NULL);
  END IF;
  RETURN jsonb_build_object('ok', true, 'contact_id', v_contact, 'organization_id', v_org, 'created', v_created);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 14. Szybkie zapytania sprzedawcy i kody QR
-- ---------------------------------------------------------------------------------------------------------------
-- Walidacja danych zapytania (portal i formularz z kodu QR). Zwraca znormalizowane wartości.
CREATE OR REPLACE FUNCTION private.seller_inquiry_values(p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v jsonb := coalesce(p_values, '{}'::jsonb); v_name text; v_email text; v_phone text; v_date date; v_end date;
  v_count integer; v_type text; v_budget numeric;
BEGIN
  IF jsonb_typeof(v) <> 'object' OR octet_length(v::text) > 20000 THEN RAISE EXCEPTION 'Nieprawidłowe dane zapytania.'; END IF;
  v_name := nullif(btrim(v->>'guest_name'), '');
  v_email := lower(nullif(btrim(v->>'guest_email'), ''));
  v_phone := nullif(btrim(v->>'guest_phone'), '');
  IF v_name IS NULL OR length(v_name) > 200 THEN RAISE EXCEPTION 'Podaj imię i nazwisko gościa (do 200 znaków).'; END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN RAISE EXCEPTION 'Podaj e-mail albo telefon gościa.'; END IF;
  IF v_email IS NOT NULL AND (length(v_email) > 254 OR v_email !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$') THEN
    RAISE EXCEPTION 'Popraw adres e-mail gościa.';
  END IF;
  IF v_phone IS NOT NULL AND (v_phone !~ '^\+?[0-9 ().-]+$' OR length(regexp_replace(v_phone, '[^0-9]', '', 'g')) NOT BETWEEN 7 AND 15) THEN
    RAISE EXCEPTION 'Popraw numer telefonu gościa.';
  END IF;
  BEGIN v_date := (v->>'event_date')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Podaj datę wydarzenia.'; END;
  IF v_date IS NULL THEN RAISE EXCEPTION 'Podaj datę wydarzenia.'; END IF;
  IF v_date < (current_timestamp AT TIME ZONE 'Europe/Warsaw')::date THEN RAISE EXCEPTION 'Data wydarzenia nie może być w przeszłości.'; END IF;
  IF v_date > (current_timestamp AT TIME ZONE 'Europe/Warsaw')::date + 1100 THEN RAISE EXCEPTION 'Data wydarzenia jest zbyt odległa.'; END IF;
  IF nullif(v->>'event_end_date', '') IS NOT NULL THEN
    BEGIN v_end := (v->>'event_end_date')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Popraw datę zakończenia.'; END;
    IF v_end < v_date OR v_end > v_date + 30 THEN RAISE EXCEPTION 'Data zakończenia musi być w ciągu 30 dni od rozpoczęcia.'; END IF;
  END IF;
  IF nullif(v->>'guest_count', '') IS NOT NULL THEN
    BEGIN v_count := (v->>'guest_count')::integer; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Podaj liczbę gości.'; END;
    IF v_count NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Liczba gości musi wynosić od 1 do 100 000.'; END IF;
  END IF;
  v_type := nullif(v->>'event_type', '');
  IF v_type IS NOT NULL AND v_type NOT IN ('wedding', 'conference', 'gala', 'party', 'corporate', 'other') THEN
    RAISE EXCEPTION 'Wybierz rodzaj wydarzenia.';
  END IF;
  IF nullif(v->>'budget_net', '') IS NOT NULL THEN
    BEGIN v_budget := round((v->>'budget_net')::numeric, 2); EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Podaj budżet jako kwotę.'; END;
    IF v_budget < 0 OR v_budget >= 1000000000 THEN RAISE EXCEPTION 'Nieprawidłowy budżet.'; END IF;
  END IF;
  IF length(v->>'note') > 4000 OR length(v->>'venue_note') > 500 OR length(v->>'guest_company') > 200 THEN
    RAISE EXCEPTION 'Skróć uwagi (do 4000 znaków), miejsce (do 500) i nazwę firmy (do 200).';
  END IF;
  RETURN jsonb_build_object('guest_name', v_name, 'guest_company', nullif(btrim(v->>'guest_company'), ''), 'guest_email', v_email,
    'guest_phone', v_phone, 'event_date', v_date, 'event_end_date', v_end, 'guest_count', v_count, 'event_type', v_type,
    'venue_note', nullif(btrim(v->>'venue_note'), ''), 'budget_net', v_budget, 'note', nullif(btrim(v->>'note'), ''));
END $$;

CREATE OR REPLACE FUNCTION private.insert_seller_inquiry(p_partner uuid, p_company uuid, p_link uuid, p_source text,
  p_request_id uuid, p_values jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v jsonb := private.seller_inquiry_values(p_values); v_id uuid; v_seller text;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Brak identyfikatora zapytania.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('seller-inquiry:' || p_request_id::text, 0));
  SELECT id INTO v_id FROM public.seller_inquiries WHERE request_id = p_request_id;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.seller_inquiries WHERE id = v_id AND sales_partner_id = p_partner) THEN
      RAISE EXCEPTION 'Identyfikator zapytania został już wykorzystany.';
    END IF;
    RETURN v_id;
  END IF;
  INSERT INTO public.seller_inquiries (request_id, sales_partner_id, my_company_id, link_id, source, guest_name, guest_company,
    guest_email, guest_phone, event_date, event_end_date, guest_count, event_type, venue_note, budget_net, note)
  VALUES (p_request_id, p_partner, p_company, p_link, p_source, v->>'guest_name', v->>'guest_company', v->>'guest_email',
    v->>'guest_phone', (v->>'event_date')::date, (v->>'event_end_date')::date, (v->>'guest_count')::integer, v->>'event_type',
    v->>'venue_note', (v->>'budget_net')::numeric, v->>'note')
  RETURNING id INTO v_id;
  v_seller := private.seller_display_name(p_partner);
  PERFORM private.notify_seller_staff(p_partner, p_company, false,
    CASE WHEN p_source = 'qr' THEN 'Zapytanie z kodu QR hotelu' ELSE 'Szybkie zapytanie od sprzedawcy' END,
    concat_ws(' · ', v_seller, v->>'guest_name', to_char((v->>'event_date')::date, 'DD.MM.YYYY'),
      CASE WHEN v->>'guest_count' IS NOT NULL THEN (v->>'guest_count') || ' os.' END),
    '/crm/salespeople?inquiry=' || v_id, 'seller_inquiry', 'seller_inquiry', v_id, jsonb_build_object('inquiry_id', v_id));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.submit_seller_inquiry(p_company uuid, p_request_id uuid, p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_partner uuid := public.current_sales_partner_id(); v_id uuid;
BEGIN
  IF v_partner IS NULL THEN RAISE EXCEPTION 'Zapytanie wysyła sprzedawca zalogowany w portalu.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id = v_partner AND t.my_company_id = p_company AND t.is_active) THEN
    RAISE EXCEPTION 'Wybierz markę, z którą współpracujesz.';
  END IF;
  v_id := private.insert_seller_inquiry(v_partner, p_company, NULL, 'portal', p_request_id, p_values);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.get_seller_inquiries(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_partner uuid := public.current_sales_partner_id();
BEGIN
  IF v_partner IS NULL THEN RAISE EXCEPTION 'Wymagane konto w portalu sprzedawcy.' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'my_company_id', i.my_company_id, 'brand_name', b.name,
            'source', i.source, 'guest_name', i.guest_name, 'guest_company', i.guest_company, 'event_date', i.event_date,
            'event_end_date', i.event_end_date, 'guest_count', i.guest_count, 'event_type', i.event_type, 'status', i.status,
            'response', i.response, 'responded_at', i.responded_at, 'created_at', i.created_at, 'label', l.label)
            ORDER BY i.created_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.seller_inquiries WHERE sales_partner_id = v_partner ORDER BY created_at DESC
           LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)) i
    LEFT JOIN public.my_companies b ON b.id = i.my_company_id
    LEFT JOIN public.seller_inquiry_links l ON l.id = i.link_id);
END $$;

CREATE OR REPLACE FUNCTION public.create_seller_inquiry_link(p_company uuid, p_label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_partner uuid := public.current_sales_partner_id(); v_label text := nullif(btrim(p_label), ''); v_token text; v_id uuid;
BEGIN
  IF v_partner IS NULL THEN RAISE EXCEPTION 'Kod QR tworzy sprzedawca zalogowany w portalu.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id = v_partner AND t.my_company_id = p_company AND t.is_active) THEN
    RAISE EXCEPTION 'Wybierz markę, z którą współpracujesz.';
  END IF;
  IF v_label IS NULL OR length(v_label) > 120 THEN RAISE EXCEPTION 'Nazwij kod (np. „Recepcja”, „Pokoje”) — do 120 znaków.'; END IF;
  IF (SELECT count(*) FROM public.seller_inquiry_links WHERE sales_partner_id = v_partner AND revoked_at IS NULL) >= 20 THEN
    RAISE EXCEPTION 'Masz już 20 aktywnych kodów. Wyłącz nieużywany kod.';
  END IF;
  v_token := encode(extensions.gen_random_bytes(18), 'hex');
  INSERT INTO public.seller_inquiry_links (sales_partner_id, my_company_id, token, label) VALUES (v_partner, p_company, v_token, v_label)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'token', v_token, 'path', '/zapytanie/' || v_token, 'label', v_label);
END $$;

CREATE OR REPLACE FUNCTION public.get_seller_inquiry_links()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_partner uuid := public.current_sales_partner_id();
BEGIN
  IF v_partner IS NULL THEN RAISE EXCEPTION 'Wymagane konto w portalu sprzedawcy.' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'my_company_id', l.my_company_id, 'brand_name', b.name,
            'label', l.label, 'token', l.token, 'path', '/zapytanie/' || l.token, 'created_at', l.created_at, 'revoked_at', l.revoked_at,
            'submission_count', s.n, 'last_submission_at', s.last_at) ORDER BY l.revoked_at NULLS FIRST, l.created_at DESC), '[]'::jsonb)
    FROM public.seller_inquiry_links l LEFT JOIN public.my_companies b ON b.id = l.my_company_id
    CROSS JOIN LATERAL (SELECT count(*) AS n, max(i.created_at) AS last_at FROM public.seller_inquiries i WHERE i.link_id = l.id) s
    WHERE l.sales_partner_id = v_partner);
END $$;

CREATE OR REPLACE FUNCTION public.revoke_seller_inquiry_link(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_partner uuid := public.current_sales_partner_id();
BEGIN
  UPDATE public.seller_inquiry_links SET revoked_at = coalesce(revoked_at, now())
   WHERE id = p_id AND (sales_partner_id = v_partner OR public.seller_partner_is_mine(sales_partner_id));
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono kodu.'; END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Formularz z kodu QR (bez logowania).
CREATE OR REPLACE FUNCTION public.get_seller_inquiry_form(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN l.id IS NULL THEN jsonb_build_object('active', false) ELSE jsonb_build_object('active', true,
    'hotel_name', coalesce(nullif(btrim(org.alias), ''), org.name, b.name), 'brand_name', b.name, 'label', l.label,
    'logo_url', b.logo_url) END
    FROM (SELECT 1) one
    LEFT JOIN public.seller_inquiry_links l ON l.token = p_token AND l.revoked_at IS NULL
      AND EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t JOIN public.sales_partner_profiles p ON p.id = t.sales_partner_id
                   WHERE t.sales_partner_id = l.sales_partner_id AND t.my_company_id = l.my_company_id AND t.is_active AND p.status = 'active')
    LEFT JOIN public.sales_partner_profiles p ON p.id = l.sales_partner_id
    LEFT JOIN public.organizations org ON org.id = p.organization_id
    LEFT JOIN public.my_companies b ON b.id = l.my_company_id;
$$;

CREATE OR REPLACE FUNCTION public.submit_public_seller_inquiry(p_token text, p_request_id uuid, p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE l public.seller_inquiry_links%ROWTYPE; v_id uuid; v_ip text; v_fingerprint text;
BEGIN
  SELECT * INTO l FROM public.seller_inquiry_links WHERE token = p_token AND revoked_at IS NULL;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t JOIN public.sales_partner_profiles p ON p.id = t.sales_partner_id
                               WHERE t.sales_partner_id = l.sales_partner_id AND t.my_company_id = l.my_company_id AND t.is_active AND p.status = 'active') THEN
    RAISE EXCEPTION 'Ten formularz jest nieaktywny.';
  END IF;
  IF coalesce((p_values->>'consent')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Zaznacz zgodę na kontakt w sprawie zapytania.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('seller-inquiry-partner:' || l.sales_partner_id::text, 0));
  -- Kod QR wisi publicznie: limity na urządzenie (5/h), link (20/h, 60/dzień) i sprzedawcę (150/dzień, wszystkie kody).
  v_ip := nullif(btrim(split_part(coalesce(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', ''), ',', 1)), '');
  v_fingerprint := CASE WHEN v_ip IS NOT NULL THEN md5(v_ip || ':' || l.id::text) END;
  IF NOT EXISTS (SELECT 1 FROM public.seller_inquiries WHERE request_id = p_request_id) THEN
    IF (v_fingerprint IS NOT NULL AND (SELECT count(*) FROM public.seller_inquiries WHERE link_id = l.id AND client_fingerprint = v_fingerprint
                                         AND created_at > now() - interval '1 hour') >= 5)
       OR (SELECT count(*) FROM public.seller_inquiries WHERE link_id = l.id AND created_at > now() - interval '1 hour') >= 20 THEN
      RAISE EXCEPTION 'Zbyt wiele zapytań w krótkim czasie. Spróbuj ponownie za godzinę.';
    END IF;
    IF (SELECT count(*) FROM public.seller_inquiries WHERE link_id = l.id AND created_at > now() - interval '1 day') >= 60
       OR (SELECT count(*) FROM public.seller_inquiries WHERE sales_partner_id = l.sales_partner_id AND source = 'qr'
             AND created_at > now() - interval '1 day') >= 150 THEN
      RAISE EXCEPTION 'Formularz przyjął dziś już bardzo dużo zapytań. Zadzwoń do recepcji hotelu albo spróbuj jutro.';
    END IF;
  END IF;
  v_id := private.insert_seller_inquiry(l.sales_partner_id, l.my_company_id, l.id, 'qr', p_request_id, p_values - 'consent');
  UPDATE public.seller_inquiries SET client_fingerprint = v_fingerprint WHERE id = v_id AND client_fingerprint IS NULL AND v_fingerprint IS NOT NULL;
  PERFORM private.notify_seller_portal(l.sales_partner_id, l.my_company_id, 'Nowe zapytanie z kodu QR: ' || l.label,
    'Gość zostawił zapytanie — opiekun MAVINCI już je widzi.', '/seller/inquiries?inquiry=' || v_id, 'seller_inquiry',
    'seller_inquiry', v_id, jsonb_build_object('inquiry_id', v_id));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 15. Link do oferty dla gościa
-- ---------------------------------------------------------------------------------------------------------------
-- Link dla gościa działa tylko dla oferty zatwierdzonej przez MAVINCI (albo niewymagającej zatwierdzenia),
-- aktywnego sprzedawcy z włączonym portalem i aktywnych warunków marki.
CREATE OR REPLACE FUNCTION private.seller_offer_guest_ready(o public.offers)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT o.sales_channel = 'seller_portal' AND coalesce(o.status::text, '') NOT IN ('rejected', 'cancelled')
    AND coalesce(o.partner_approval_status, 'not_required') IN ('not_required', 'approved')
    AND EXISTS (SELECT 1 FROM public.sales_partner_profiles p JOIN public.sales_partner_brand_terms t ON t.sales_partner_id = p.id
                 WHERE p.id = o.sales_partner_id AND p.status = 'active' AND p.portal_enabled
                   AND t.my_company_id = o.my_company_id AND t.is_active);
$$;

CREATE OR REPLACE FUNCTION private.seller_offer_share_access(p_offer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.offers o WHERE o.id = p_offer AND o.sales_channel = 'seller_portal'
    AND ((o.sales_partner_id = public.current_sales_partner_id()
          AND EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id = o.sales_partner_id
                        AND t.my_company_id = o.my_company_id AND t.is_active))
         OR public.seller_partner_is_mine(o.sales_partner_id)));
$$;

CREATE OR REPLACE FUNCTION public.get_seller_offer_share_state(p_offer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE l public.seller_offer_share_links%ROWTYPE;
BEGIN
  IF NOT private.seller_offer_share_access(p_offer) THEN RAISE EXCEPTION 'Brak dostępu do tej oferty.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.seller_offer_share_links WHERE offer_id = p_offer AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('active', false, 'guest_ready', (SELECT private.seller_offer_guest_ready(o) FROM public.offers o WHERE o.id = p_offer));
  END IF;
  RETURN jsonb_build_object('active', true, 'token', l.token, 'path', '/oferta/' || l.token, 'created_at', l.created_at,
    'first_viewed_at', l.first_viewed_at, 'last_viewed_at', l.last_viewed_at, 'view_count', l.view_count,
    'accepted_at', l.accepted_at, 'accepted_name', l.accepted_name, 'accepted_email', l.accepted_email, 'accepted_note', l.accepted_note,
    'accepted_totals', l.accepted_snapshot->'totals', 'accepted_document', l.accepted_snapshot->'document',
    'guest_ready', (SELECT private.seller_offer_guest_ready(o) FROM public.offers o WHERE o.id = p_offer));
END $$;

CREATE OR REPLACE FUNCTION public.create_seller_offer_share_link(p_offer uuid, p_rotate boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE l public.seller_offer_share_links%ROWTYPE; v_token text;
BEGIN
  IF NOT private.seller_offer_share_access(p_offer) THEN RAISE EXCEPTION 'Brak dostępu do tej oferty.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.offers WHERE id = p_offer FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.offer_items i WHERE i.offer_id = p_offer) THEN
    RAISE EXCEPTION 'Dodaj do oferty usługi, zanim udostępnisz ją gościowi.';
  END IF;
  IF NOT (SELECT private.seller_offer_guest_ready(o) FROM public.offers o WHERE o.id = p_offer) THEN
    RAISE EXCEPTION 'Link dla gościa będzie dostępny, gdy MAVINCI zatwierdzi ofertę (zmiany w ofercie czekają na sprawdzenie).';
  END IF;
  SELECT * INTO l FROM public.seller_offer_share_links WHERE offer_id = p_offer AND revoked_at IS NULL;
  IF FOUND AND NOT coalesce(p_rotate, false) THEN
    RETURN jsonb_build_object('token', l.token, 'path', '/oferta/' || l.token, 'created_at', l.created_at);
  END IF;
  UPDATE public.seller_offer_share_links SET revoked_at = now() WHERE offer_id = p_offer AND revoked_at IS NULL;
  v_token := encode(extensions.gen_random_bytes(18), 'hex');
  INSERT INTO public.seller_offer_share_links (offer_id, token, created_by) VALUES (p_offer, v_token, auth.uid()) RETURNING * INTO l;
  RETURN jsonb_build_object('token', l.token, 'path', '/oferta/' || l.token, 'created_at', l.created_at);
END $$;

CREATE OR REPLACE FUNCTION public.revoke_seller_offer_share_link(p_offer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT private.seller_offer_share_access(p_offer) THEN RAISE EXCEPTION 'Brak dostępu do tej oferty.' USING ERRCODE = '42501'; END IF;
  UPDATE public.seller_offer_share_links SET revoked_at = now() WHERE offer_id = p_offer AND revoked_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Podgląd oferty przez gościa (bez logowania): zapis wyświetlenia, dane oferty, marka hotelu.
CREATE OR REPLACE FUNCTION public.get_shared_seller_offer(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE l public.seller_offer_share_links%ROWTYPE; o public.offers%ROWTYPE; v_status text; v_first boolean; v_staff boolean;
  v_vat numeric; v_net numeric; v_doc public.seller_offer_documents%ROWTYPE; v_hotel text; v_brand text;
  v_seller jsonb; v_items jsonb; b jsonb; v_result jsonb;
BEGIN
  SELECT * INTO l FROM public.seller_offer_share_links WHERE token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ten link do oferty jest nieaktywny.'; END IF;
  IF l.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  SELECT * INTO o FROM public.offers WHERE id = l.offer_id AND sales_channel = 'seller_portal';
  IF NOT FOUND OR (l.accepted_at IS NULL AND NOT private.seller_offer_guest_ready(o))
     OR coalesce(o.status::text, '') IN ('rejected', 'cancelled') THEN
    RETURN jsonb_build_object('status', 'revoked');
  END IF;
  v_status := CASE WHEN l.accepted_at IS NOT NULL THEN 'accepted'
                   WHEN o.valid_until IS NOT NULL AND o.valid_until < now() THEN 'expired' ELSE 'active' END;
  -- Otwarcie przez zalogowanego sprzedawcę lub pracownika (podgląd własnego linku) nie liczy się jako wizyta gościa.
  v_staff := auth.uid() IS NOT NULL AND (public.current_session_is_seller_portal() OR public.current_employee_id() IS NOT NULL);
  v_first := l.first_viewed_at IS NULL AND NOT v_staff;
  IF NOT v_staff THEN
    UPDATE public.seller_offer_share_links SET view_count = view_count + 1, first_viewed_at = coalesce(first_viewed_at, now()),
           last_viewed_at = now() WHERE id = l.id;
  END IF;
  IF v_first THEN
    INSERT INTO public.partner_offer_activities (offer_id, sales_partner_id, activity_type, metadata)
    VALUES (o.id, o.sales_partner_id, 'guest_viewed', jsonb_build_object('share_link_id', l.id));
    PERFORM private.notify_seller_portal(o.sales_partner_id, o.my_company_id, 'Gość otworzył ofertę',
      coalesce(nullif(btrim(o.title), ''), o.offer_number, 'Oferta') || ' — gość właśnie ją ogląda.',
      '/seller/offers/' || o.id, 'seller_guest', 'offer', o.id, jsonb_build_object('offer_id', o.id, 'event', 'guest_viewed'));
  END IF;
  SELECT coalesce(nullif(btrim(g.alias), ''), g.name) INTO v_hotel FROM public.organizations g
   WHERE g.id = coalesce(o.partner_organization_id, (SELECT p.organization_id FROM public.sales_partner_profiles p WHERE p.id = o.sales_partner_id));
  SELECT b.name INTO v_brand FROM public.my_companies b WHERE b.id = o.my_company_id;
  b := coalesce(o.partner_branding_snapshot, '{}'::jsonb);
  -- Kontakt jak w ofercie PDF: dane z wizytówki sprzedawcy, a bez nich — z kontaktu.
  SELECT jsonb_build_object('name', coalesce(nullif(b->>'display_name', ''), c.full_name),
           'position', nullif(b->>'position_title', ''),
           'email', coalesce(nullif(b->>'contact_email', ''), c.email),
           'phone', coalesce(nullif(b->>'contact_phone', ''), nullif(c.mobile, ''), c.phone))
    INTO v_seller FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id = p.contact_id WHERE p.id = o.sales_partner_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'description', nullif(i.description, ''), 'quantity', i.quantity,
           'days', coalesce(i.days, 1), 'unit', i.unit, 'unit_price_net', coalesce(i.client_unit_price, i.unit_price, 0),
           'total_net', round(coalesce(i.client_unit_price, i.unit_price, 0) * coalesce(i.quantity, 1) * coalesce(i.days, 1), 2))
           ORDER BY i.display_order NULLS LAST, i.created_at), '[]'::jsonb)
    INTO v_items FROM public.offer_items i WHERE i.offer_id = o.id;
  v_net := coalesce(o.client_total_net, (SELECT sum((x->>'total_net')::numeric) FROM jsonb_array_elements(v_items) x), 0);
  v_vat := coalesce(o.tax_percent, 23);
  SELECT * INTO v_doc FROM public.seller_offer_documents d WHERE d.offer_id = o.id ORDER BY d.created_at DESC LIMIT 1;
  v_result := jsonb_build_object(
    'status', v_status,
    'offer', jsonb_build_object('number', o.offer_number, 'title', coalesce(nullif(btrim(o.title), ''), 'Oferta'),
      'event_date', o.event_date, 'location', nullif(o.event_location, ''), 'guest_count', o.guest_count,
      'client_name', nullif(o.portal_client_name, ''), 'client_company', nullif(o.portal_client_company, ''),
      'valid_until', o.valid_until, 'description', nullif(o.description, '')),
    'items', v_items,
    'totals', jsonb_build_object('net', round(v_net, 2), 'vat', round(v_net * v_vat / 100, 2),
      'gross', round(v_net * (1 + v_vat / 100), 2), 'vat_percent', v_vat),
    -- Tylko pola wizualne (bez modelu rozliczeń, identyfikatorów i ścieżek plików); obrazy przez trasę serwera.
    'branding', jsonb_build_object('hotel_name', v_hotel, 'brand_name', v_brand,
      'has_logo', nullif(b->>'hotel_logo_url', '') IS NOT NULL, 'has_cover', nullif(b->>'hotel_cover_image_url', '') IS NOT NULL,
      'snapshot', jsonb_strip_nulls(jsonb_build_object(
        'display_name', b->>'display_name', 'position_title', b->>'position_title',
        'organization_name', b->>'organization_name', 'organization_website', b->>'organization_website',
        'organization_address', b->>'organization_address', 'brand_primary_color', b->>'brand_primary_color',
        'brand_secondary_color', b->>'brand_secondary_color', 'brand_surface_color', b->>'brand_surface_color',
        'heading_font_family', b->>'heading_font_family', 'footer_text', b->>'footer_text', 'disclosure_text', b->>'disclosure_text'))),
    'seller', v_seller,
    'document', jsonb_build_object('available', v_doc.id IS NOT NULL, 'filename', v_doc.filename),
    'accepted', CASE WHEN l.accepted_at IS NOT NULL THEN jsonb_build_object('at', l.accepted_at, 'name', l.accepted_name) END);
  -- Po akceptacji gość widzi to, co zaakceptował (oferta mogła się później zmienić).
  IF l.accepted_snapshot IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('items', l.accepted_snapshot->'items', 'totals', l.accepted_snapshot->'totals');
  END IF;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.accept_shared_seller_offer(p_token text, p_name text, p_email text, p_note text, p_consent boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE l public.seller_offer_share_links%ROWTYPE; o public.offers%ROWTYPE; v_name text := nullif(btrim(p_name), '');
  v_email text := lower(nullif(btrim(p_email), '')); v_title text; v_shared jsonb;
BEGIN
  SELECT * INTO l FROM public.seller_offer_share_links WHERE token = p_token AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ten link do oferty jest nieaktywny.'; END IF;
  IF l.accepted_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'accepted_at', l.accepted_at, 'duplicate', true); END IF;
  SELECT * INTO o FROM public.offers WHERE id = l.offer_id AND sales_channel = 'seller_portal';
  IF NOT FOUND OR NOT private.seller_offer_guest_ready(o) THEN RAISE EXCEPTION 'Ta oferta jest teraz niedostępna — skontaktuj się z hotelem.'; END IF;
  IF o.valid_until IS NOT NULL AND o.valid_until < now() THEN RAISE EXCEPTION 'Oferta wygasła — skontaktuj się z hotelem.'; END IF;
  IF p_consent IS NOT TRUE THEN RAISE EXCEPTION 'Zaznacz zgodę, aby potwierdzić akceptację.'; END IF;
  IF v_name IS NULL OR length(v_name) < 2 OR length(v_name) > 200 THEN RAISE EXCEPTION 'Podaj imię i nazwisko.'; END IF;
  IF v_email IS NULL OR length(v_email) > 254 OR v_email !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$' THEN
    RAISE EXCEPTION 'Podaj poprawny adres e-mail.';
  END IF;
  IF length(p_note) > 2000 THEN RAISE EXCEPTION 'Uwagi mogą mieć najwyżej 2000 znaków.'; END IF;
  v_shared := public.get_shared_seller_offer(p_token);
  UPDATE public.seller_offer_share_links SET accepted_at = now(), accepted_name = v_name, accepted_email = v_email,
         accepted_note = nullif(btrim(p_note), ''),
         accepted_snapshot = jsonb_build_object('offer', v_shared->'offer', 'items', v_shared->'items', 'totals', v_shared->'totals',
           'document', (SELECT jsonb_build_object('id', d.id, 'filename', d.filename, 'created_at', d.created_at)
                          FROM public.seller_offer_documents d WHERE d.offer_id = o.id ORDER BY d.created_at DESC LIMIT 1))
   WHERE id = l.id RETURNING * INTO l;
  INSERT INTO public.partner_offer_activities (offer_id, sales_partner_id, activity_type, metadata)
  VALUES (o.id, o.sales_partner_id, 'guest_accepted', jsonb_build_object('share_link_id', l.id, 'name', v_name, 'email', v_email));
  v_title := coalesce(nullif(btrim(o.title), ''), o.offer_number, 'Oferta');
  PERFORM private.notify_seller_portal(o.sales_partner_id, o.my_company_id, 'Gość zaakceptował ofertę online',
    v_title || ' — ' || v_name || '. Przekaż ofertę do potwierdzenia przez MAVINCI.', '/seller/offers/' || o.id,
    'seller_guest', 'offer', o.id, jsonb_build_object('offer_id', o.id, 'event', 'guest_accepted'));
  PERFORM private.notify_seller_staff(o.sales_partner_id, o.my_company_id, false, 'Gość zaakceptował ofertę sprzedawcy',
    private.seller_display_name(o.sales_partner_id) || ' · ' || v_title || ' · ' || v_name,
    '/crm/offers/' || o.id, 'seller_guest', 'offer', o.id, jsonb_build_object('offer_id', o.id, 'event', 'guest_accepted'));
  RETURN jsonb_build_object('ok', true, 'accepted_at', l.accepted_at);
END $$;

-- Dla serwera (klucz serwisowy): logo / zdjęcie hotelu z wizytówki oferty (prywatny bucket seller-brand-assets).
CREATE OR REPLACE FUNCTION public.get_shared_seller_offer_asset(p_token text, p_kind text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('bucket', 'seller-brand-assets', 'storage_path',
           nullif(o.partner_branding_snapshot->>(CASE p_kind WHEN 'logo' THEN 'hotel_logo_url' WHEN 'cover' THEN 'hotel_cover_image_url' END), ''))
    FROM public.seller_offer_share_links l
    JOIN public.offers o ON o.id = l.offer_id AND o.sales_channel = 'seller_portal'
   WHERE l.token = p_token AND l.revoked_at IS NULL AND p_kind IN ('logo', 'cover');
$$;

-- Dla serwera (klucz serwisowy): ścieżka PDF oferty udostępnionej gościowi.
CREATE OR REPLACE FUNCTION public.get_shared_seller_offer_document(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('storage_path', d.storage_path, 'filename', d.filename)
    FROM public.seller_offer_share_links l
    JOIN public.offers o ON o.id = l.offer_id AND o.sales_channel = 'seller_portal' AND coalesce(o.status::text, '') NOT IN ('rejected', 'cancelled')
    JOIN LATERAL (SELECT x.* FROM public.seller_offer_documents x WHERE x.offer_id = o.id ORDER BY x.created_at DESC LIMIT 1) d ON true
   WHERE l.token = p_token AND l.revoked_at IS NULL AND (l.accepted_at IS NOT NULL OR private.seller_offer_guest_ready(o));
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 16. Zapis oferty z portalu: liczba gości (kreator ją zbiera, wcześniejsze wersje zapisu ją pomijały)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_seller_portal_offer_v5(p_request_id uuid, p_offer jsonb, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE r jsonb; v_id uuid; v_guests integer; v_raw text := btrim(coalesce(p_offer->>'guest_count', ''));
BEGIN
  r := public.save_seller_portal_offer_v4(p_request_id, p_offer, p_items);
  v_id := nullif(r->>'offer_id', '')::uuid;
  IF v_id IS NOT NULL AND p_offer ? 'guest_count' THEN
    IF v_raw <> '' AND v_raw !~ '^[0-9]{1,6}$' THEN RAISE EXCEPTION 'Liczba gości musi być liczbą całkowitą.'; END IF;
    v_guests := nullif(v_raw, '')::integer;
    IF v_guests IS NOT NULL AND (v_guests < 1 OR v_guests > 100000) THEN RAISE EXCEPTION 'Liczba gości musi być od 1 do 100 000.'; END IF;
    UPDATE public.offers SET guest_count = v_guests
     WHERE id = v_id AND sales_channel = 'seller_portal' AND guest_count IS DISTINCT FROM v_guests;
  END IF;
  RETURN r;
END $function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 16. Powiadomienia CRM o ofertach i rozmowach sprzedawców
-- ---------------------------------------------------------------------------------------------------------------
-- PDF oferty: opiekun + administratorzy (wcześniej tylko administratorzy). Prośba o sprawdzenie: opiekun, bez niego
-- administratorzy (bez zmian).
CREATE OR REPLACE FUNCTION public.seller_offer_notification_recipients(p_offer_id uuid, p_review boolean)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_company uuid; v_partner uuid; v_manager uuid; v_backup uuid; v_recipients uuid[];
BEGIN
  SELECT my_company_id, sales_partner_id INTO v_company, v_partner
    FROM public.offers WHERE id = p_offer_id AND sales_channel = 'seller_portal';
  IF NOT FOUND THEN RETURN '{}'::uuid[]; END IF;
  v_manager := public.seller_partner_manager_id(v_partner, v_company);
  SELECT backup_manager_id INTO v_backup FROM public.sales_partner_profiles WHERE id = v_partner;
  WITH eligible AS (
    SELECT e.id, login.id AS user_id,
      (e.role::text = 'admin' OR e.access_level::text = 'admin' OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))) AS is_admin
    FROM public.employees e CROSS JOIN LATERAL (
      SELECT u.id FROM auth.users u WHERE u.id = e.auth_user_id OR u.id = e.id
        ORDER BY (u.id = e.auth_user_id) DESC NULLS LAST, u.id LIMIT 1
    ) login
    WHERE e.is_active AND public.employee_can_access_company(e.id, v_company)
      AND (e.role::text = 'admin' OR e.access_level::text = 'admin'
        OR COALESCE(e.permissions, '{}'::text[]) && ARRAY['admin', 'offers_manage']::text[])
      AND NOT EXISTS(SELECT 1 FROM public.sales_partner_profiles p
        WHERE p.portal_auth_user_id = login.id AND p.portal_enabled AND p.contact_id IS NOT NULL)
  ), managers AS (SELECT user_id FROM eligible WHERE id IN (v_manager, v_backup))
  SELECT array_agg(DISTINCT user_id) INTO v_recipients FROM eligible
    WHERE id IN (v_manager, v_backup)
       OR (is_admin AND (NOT p_review OR NOT EXISTS (SELECT 1 FROM managers)));
  RETURN COALESCE(v_recipients, '{}'::uuid[]);
END;
$function$;

-- Wiadomość sprzedawcy: opiekun i zastępca + administratorzy (kopia jak dotąd); bez opiekuna — administratorzy
-- (już nie cały zespół marki, który i tak nie widzi rozmów cudzych sprzedawców).
CREATE OR REPLACE FUNCTION public.send_seller_message(p_conversation uuid, p_message_id uuid, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_c record; v_kind text; v_name text; v_seq bigint; v_notice uuid; v_recipients uuid[]; v_url text;
BEGIN
  IF NOT COALESCE(public.seller_conversation_access(p_conversation, true), false) THEN RAISE EXCEPTION 'Brak uprawnień do wysłania wiadomości'; END IF;
  IF length(btrim(COALESCE(p_body, ''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Wiadomość musi mieć od 1 do 10 000 znaków'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_message_id::text, 1));
  IF EXISTS(SELECT 1 FROM public.seller_messages WHERE id = p_message_id) THEN
    IF EXISTS(SELECT 1 FROM public.seller_messages WHERE id = p_message_id AND conversation_id = p_conversation
      AND sender_user_id = auth.uid() AND body = btrim(p_body)) THEN RETURN p_message_id; END IF;
    RAISE EXCEPTION 'Identyfikator wiadomości został już wykorzystany';
  END IF;
  SELECT c.*, p.contact_id, p.employee_id, p.portal_auth_user_id INTO v_c
  FROM public.seller_conversations c JOIN public.sales_partner_profiles p ON p.id = c.sales_partner_id
  WHERE c.id = p_conversation FOR UPDATE OF c;
  v_kind := CASE WHEN public.current_session_is_seller_portal() THEN 'seller' ELSE 'crm' END;
  IF v_kind = 'seller' THEN
    SELECT full_name INTO v_name FROM public.contacts WHERE id = v_c.contact_id;
    v_recipients := private.seller_staff_recipients(v_c.sales_partner_id, v_c.my_company_id, true);
    v_url := CASE WHEN v_c.contact_id IS NOT NULL THEN '/crm/contacts/' || v_c.contact_id || '?tab=seller&conversation=' || p_conversation
      ELSE '/crm/salespeople?seller=' || v_c.sales_partner_id || '&conversation=' || p_conversation END;
  ELSE
    SELECT concat_ws(' ', name, surname) INTO v_name FROM public.employees WHERE id = public.current_employee_id();
    SELECT array_agg(id) INTO v_recipients FROM auth.users WHERE id = v_c.portal_auth_user_id;
    v_url := '/seller/messages?conversation=' || p_conversation;
  END IF;
  INSERT INTO public.seller_messages(id, conversation_id, sender_user_id, sender_kind, sender_name, body)
    VALUES(p_message_id, p_conversation, auth.uid(), v_kind, COALESCE(NULLIF(v_name, ''), 'MAVINCI'), btrim(p_body)) RETURNING seq INTO v_seq;
  IF COALESCE(cardinality(v_recipients), 0) > 0 THEN
    INSERT INTO public.notifications(title, message, type, category, action_url, related_entity_type, related_entity_id, metadata)
    VALUES(CASE WHEN v_kind = 'seller' THEN 'Wiadomość od sprzedawcy' ELSE 'Odpowiedź opiekuna MAVINCI' END,
      COALESCE(v_name, 'MAVINCI') || ' · ' || left(btrim(p_body), 160), 'info', 'system', v_url, NULL, p_message_id,
      jsonb_build_object('workflow', 'seller_chat', 'sales_partner_id', v_c.sales_partner_id, 'conversation_id', p_conversation)) RETURNING id INTO v_notice;
    INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
      SELECT v_notice, u, false FROM unnest(v_recipients) u WHERE u <> auth.uid() ON CONFLICT DO NOTHING;
  END IF;
  RETURN p_message_id;
END;
$function$;

-- Skrzynka sprzedawcy / opiekuna: nowe rodzaje powiadomień portalu; po stronie CRM tylko „moi sprzedawcy”.
CREATE OR REPLACE FUNCTION public.get_seller_inbox()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
 WITH items AS (
   SELECT 'review:' || r.offer_id AS id, 'review'::text AS kind, o.sales_partner_id,
     COALESCE(o.offer_number, o.title, 'Oferta') AS title, 1::bigint AS count, r.requested_at AS created_at,
     '/crm/offers/' || o.id || '?document=' || r.document_id || '&preview=1#seller-offer-review' AS action_url,
     NULL::uuid AS recipient_id, NULL::uuid AS conversation_id, o.id AS offer_id,
     r.document_id, md5(r.document_id::text || '|' || extract(epoch FROM r.requested_at)::text || '|' || COALESCE(r.source_key, '')) AS read_token
   FROM public.seller_offer_reviews r JOIN public.offers o ON o.id = r.offer_id
   WHERE r.status = 'pending' AND public.seller_offer_can_manage(o.id)
     AND public.seller_workspace_offers_access(o.my_company_id)
   UNION ALL
   SELECT 'chat:' || c.id, 'message', c.sales_partner_id,
     CASE WHEN c.offer_id IS NULL THEN 'Rozmowa ogólna' ELSE COALESCE(o.offer_number, o.title, 'Rozmowa o ofercie') END,
     count(*), max(m.created_at), CASE WHEN public.current_session_is_seller_portal() THEN '/seller/messages?conversation=' || c.id
       WHEN p.contact_id IS NOT NULL THEN '/crm/contacts/' || p.contact_id || '?tab=seller&conversation=' || c.id
       ELSE '/crm/salespeople?seller=' || p.id || '&conversation=' || c.id END, NULL::uuid, c.id, c.offer_id, NULL::uuid, NULL::text
   FROM public.seller_conversations c JOIN public.sales_partner_profiles p ON p.id = c.sales_partner_id
   LEFT JOIN public.offers o ON o.id = c.offer_id
   JOIN public.seller_messages m ON m.conversation_id = c.id
   LEFT JOIN public.seller_message_reads r ON r.conversation_id = c.id AND r.user_id = auth.uid()
   WHERE public.seller_conversation_access(c.id) AND m.seq > COALESCE(r.last_read_seq, 0)
     AND m.sender_kind = CASE WHEN public.current_session_is_seller_portal() THEN 'crm' ELSE 'seller' END
   GROUP BY c.id, p.id, o.id
   UNION ALL
   SELECT 'notice:' || nr.id, 'notification', p.id, n.title, 1, n.created_at, n.action_url, nr.id, NULL::uuid, o.id, NULL::uuid, NULL::text
   FROM public.notification_recipients nr JOIN public.notifications n ON n.id = nr.notification_id
   JOIN public.sales_partner_profiles p ON p.id::text = n.metadata->>'sales_partner_id'
   LEFT JOIN public.offers o ON o.id::text = n.related_entity_id::text AND n.related_entity_type IS DISTINCT FROM 'event'
   WHERE nr.user_id = auth.uid() AND NOT nr.is_read
     AND n.metadata->>'workflow' IN ('seller_offer', 'seller_review_result', 'seller_event', 'seller_commission',
                                     'seller_inquiry', 'seller_guest', 'seller_visibility')
     AND ((public.current_session_is_seller_portal() AND p.id = public.current_sales_partner_id()
       AND EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id = p.id
                    AND t.my_company_id = coalesce(o.my_company_id, (n.metadata->>'my_company_id')::uuid) AND t.is_active))
       OR (NOT public.current_session_is_seller_portal() AND public.seller_partner_is_mine(p.id)
           AND (o.id IS NULL OR public.seller_workspace_offers_access(o.my_company_id))))
     AND (o.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.seller_offer_reviews r WHERE r.offer_id = o.id AND r.status = 'pending')
          OR n.metadata->>'workflow' <> 'seller_offer')
     AND (n.metadata->>'workflow' <> 'seller_offer' OR n.title <> 'Zapytanie sprzedawcy: termin i zasoby')
 ) SELECT COALESCE(jsonb_agg(to_jsonb(items) ORDER BY created_at DESC, id), '[]'::jsonb) FROM items;
$function$;

-- Obszar sprzedawcy w CRM: tylko „mój sprzedawca”.
CREATE OR REPLACE FUNCTION public.get_crm_seller_workspace(p_partner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_brands jsonb; v_offers jsonb; v_events jsonb;
BEGIN
 IF NOT public.seller_partner_is_mine(p_partner) THEN
   RAISE EXCEPTION 'Tego sprzedawcę prowadzi inny opiekun. Poproś administratora o dostęp.' USING ERRCODE = '42501';
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.my_company_id, 'name', b.name,
   'can_chat', public.seller_workspace_brand_access(p_partner, t.my_company_id, true)) ORDER BY b.name), '[]'::jsonb) INTO v_brands
 FROM public.sales_partner_brand_terms t JOIN public.my_companies b ON b.id = t.my_company_id
 WHERE t.sales_partner_id = p_partner AND public.seller_workspace_brand_access(p_partner, t.my_company_id);
 IF v_brands = '[]'::jsonb THEN RAISE EXCEPTION 'Brak dostępu do sprzedaży tego sprzedawcy w przypisanych markach'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'offer_number', o.offer_number,
   'my_company_id', o.my_company_id, 'brand_name', b.name, 'status', o.status, 'created_at', o.created_at,
   'client_name', COALESCE(NULLIF(o.portal_client_company, ''), o.portal_client_name),
   'event_date', o.event_date, 'event_id', o.event_id, 'client_total_net', o.client_total_net,
   'partner_base_net', o.partner_base_net, 'generated_at', o.partner_generated_at,
   'review_status', r.status, 'document_id', r.document_id,
   'guest_link', (SELECT jsonb_build_object('view_count', l.view_count, 'accepted_at', l.accepted_at, 'accepted_name', l.accepted_name)
                    FROM public.seller_offer_share_links l WHERE l.offer_id = o.id AND l.revoked_at IS NULL)) ORDER BY o.created_at DESC, o.id), '[]'::jsonb) INTO v_offers
 FROM public.offers o JOIN public.my_companies b ON b.id = o.my_company_id
 LEFT JOIN public.seller_offer_reviews r ON r.offer_id = o.id
 WHERE o.sales_partner_id = p_partner AND public.seller_workspace_offers_access(o.my_company_id);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'event_date', e.event_date,
   'status', e.status, 'my_company_id', e.my_company_id, 'brand_name', b.name) ORDER BY e.event_date DESC, e.id), '[]'::jsonb) INTO v_events
 FROM public.events e LEFT JOIN public.my_companies b ON b.id = e.my_company_id
 WHERE public.current_employee_can_view_event(e.id) AND public.seller_workspace_staff_access(e.my_company_id)
 AND (EXISTS(SELECT 1 FROM public.offers o WHERE o.event_id = e.id AND o.sales_partner_id = p_partner)
   OR e.referring_sales_partner_id = p_partner
   OR EXISTS(SELECT 1 FROM public.event_commissions c WHERE c.event_id = e.id AND c.sales_partner_id = p_partner AND c.status <> 'cancelled'));
 RETURN jsonb_build_object('brands', v_brands, 'offers', v_offers, 'events', v_events,
   'can_view_offers', EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id = p_partner AND public.seller_workspace_offers_access(t.my_company_id)),
   'manager', (SELECT jsonb_build_object('manager_id', p.manager_id, 'backup_manager_id', p.backup_manager_id,
                 'manager_name', nullif(btrim(concat_ws(' ', m.name, m.surname)), ''),
                 'backup_manager_name', nullif(btrim(concat_ws(' ', bk.name, bk.surname)), ''),
                 'manager_ok', m.id IS NOT NULL AND public.employee_can_manage_sellers(m.id, NULL),
                 'can_assign', public.current_employee_is_crm_admin())
                 FROM public.sales_partner_profiles p
                 LEFT JOIN public.employees m ON m.id = public.seller_partner_manager_id(p.id, NULL)
                 LEFT JOIN public.employees bk ON bk.id = p.backup_manager_id
                WHERE p.id = p_partner),
   'portal', public.seller_portal_account_state(p_partner),
   'terms', (SELECT COALESCE(jsonb_agg(jsonb_build_object('my_company_id', t.my_company_id, 'name', b.name, 'is_active', t.is_active,
               'commission_enabled', t.commission_enabled, 'rate', t.default_commission_rate, 'commissions_visible', t.commissions_visible,
               'visibility_changed_at', t.commissions_visibility_changed_at,
               'visibility_changed_by', (SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') FROM public.employees e WHERE e.id = t.commissions_visibility_changed_by))
               ORDER BY b.name), '[]'::jsonb)
               FROM public.sales_partner_brand_terms t JOIN public.my_companies b ON b.id = t.my_company_id
              WHERE t.sales_partner_id = p_partner AND public.current_employee_can_access_company(t.my_company_id)));
END; $function$;

-- Kartoteka sprzedawców: opiekun, stan konta portalu, ostatnia aktywność, „mój”.
CREATE OR REPLACE FUNCTION public.get_crm_seller_directory()
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_admin boolean;
  v_profiles jsonb;
  v_partner_ids uuid[];
  v_inbox jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN
    RAISE EXCEPTION 'Brak dostępu do kartoteki sprzedawców CRM' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_employee FROM public.employees WHERE id = public.current_employee_id() AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brak aktywnego pracownika CRM' USING ERRCODE = '42501'; END IF;
  v_admin := COALESCE(v_employee.role::text = 'admin' OR v_employee.access_level::text = 'admin'
    OR 'admin' = ANY(COALESCE(v_employee.permissions, '{}'::text[])), false);
  IF NOT v_admin AND NOT (COALESCE(v_employee.permissions, '{}'::text[])
    && ARRAY['contacts_view', 'contacts_manage', 'finances_view', 'finances_manage', 'offers_manage']) THEN
    RAISE EXCEPTION 'Brak uprawnień do kartoteki sprzedawców' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'employee_id', p.employee_id, 'contact_id', p.contact_id, 'partner_type', p.partner_type,
    'organization_id', p.organization_id, 'status', p.status, 'portal_enabled', p.portal_enabled,
    'portal_auth_user_id', p.portal_auth_user_id, 'notes', p.notes,
    'manager_id', mg.manager_id, 'backup_manager_id', p.backup_manager_id,
    'manager_name', (SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') FROM public.employees e WHERE e.id = mg.manager_id),
    'backup_manager_name', (SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') FROM public.employees e WHERE e.id = p.backup_manager_id),
    'portal_account', acc.state->>'portal_account', 'last_sign_in_at', acc.state->>'last_sign_in_at',
    'last_activity_at', (SELECT max(x.partner_last_activity_at) FROM public.offers x WHERE x.sales_partner_id = p.id),
    'is_mine', coalesce(v_employee.id IN (p.manager_id, p.backup_manager_id), false)
  ) ORDER BY p.created_at DESC, p.id), '[]'::jsonb), COALESCE(array_agg(p.id), '{}'::uuid[])
  INTO v_profiles, v_partner_ids
  FROM public.sales_partner_profiles p
  CROSS JOIN LATERAL (SELECT public.seller_portal_account_state(p.id) AS state) acc
  CROSS JOIN LATERAL (SELECT p.manager_id) mg
  WHERE public.seller_directory_crm_row_access(p.employee_id, p.contact_id, p.partner_type);

  SELECT COALESCE(jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb) INTO v_inbox
  FROM jsonb_array_elements(public.get_seller_inbox()) WITH ORDINALITY item(value, ordinality)
  WHERE (item.value->>'sales_partner_id')::uuid = ANY(v_partner_ids);

  RETURN jsonb_build_object('employee_id', v_employee.id, 'is_admin', v_admin,
    'can_manage', v_admin OR COALESCE(v_employee.permissions, '{}'::text[]) && ARRAY['contacts_manage', 'finances_manage'],
    'profiles', v_profiles, 'inbox', v_inbox);
END; $function$;

-- Licznik przy menu: „moi” = sprzedawcy, których jestem opiekunem / zastępcą.
CREATE OR REPLACE FUNCTION public.get_seller_sidebar_badge()
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_admin boolean;
  v_scope text := 'mine';
  v_items jsonb := '[]'::jsonb;
  v_count bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN
    RETURN jsonb_build_object('items', v_items, 'count', 0, 'scope', v_scope, 'employee_id', NULL, 'can_choose_scope', false);
  END IF;
  SELECT * INTO v_employee FROM public.employees WHERE id = public.current_employee_id() AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('items', v_items, 'count', 0, 'scope', v_scope, 'employee_id', NULL, 'can_choose_scope', false);
  END IF;
  v_admin := COALESCE(v_employee.role::text = 'admin' OR v_employee.access_level::text = 'admin'
    OR 'admin' = ANY(COALESCE(v_employee.permissions, '{}'::text[])), false);
  IF NOT v_admin AND NOT (COALESCE(v_employee.permissions, '{}'::text[])
    && ARRAY['contacts_view', 'contacts_manage', 'finances_view', 'finances_manage', 'offers_manage']) THEN
    RETURN jsonb_build_object('items', v_items, 'count', 0, 'scope', v_scope, 'employee_id', v_employee.id, 'can_choose_scope', false);
  END IF;
  IF v_admin AND COALESCE(v_employee.preferences #>> '{notifications,sellerSidebarScope}', 'all') <> 'mine' THEN
    v_scope := 'all';
  END IF;

  WITH candidates AS (
    SELECT item.value, (item.value->>'document_id')::uuid AS document_id,
      (item.value->>'read_token') AS token,
      seen.read_token
    FROM jsonb_array_elements(public.get_seller_inbox()) item(value)
    JOIN public.sales_partner_profiles p ON p.id::text = item.value->>'sales_partner_id'
    LEFT JOIN public.contacts c ON c.id = p.contact_id
    LEFT JOIN public.seller_review_reads seen ON seen.offer_id = (item.value->>'offer_id')::uuid AND seen.user_id = auth.uid()
    WHERE public.seller_directory_crm_row_access(p.employee_id, p.contact_id, p.partner_type)
      AND (v_scope = 'all' OR v_employee.id IN (p.manager_id, p.backup_manager_id))
  ), unread AS (
    SELECT CASE WHEN value->>'kind' = 'review'
      THEN value || jsonb_build_object('read_token', token, 'document_id', document_id)
      ELSE value END AS item
    FROM candidates
    WHERE value->>'kind' <> 'review' OR (token IS NOT NULL AND read_token IS DISTINCT FROM token)
  )
  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'created_at')::timestamptz DESC, item->>'id'), '[]'::jsonb),
    COALESCE(sum((item->>'count')::bigint), 0)
  INTO v_items, v_count FROM unread;
  RETURN jsonb_build_object('items', v_items, 'count', v_count, 'scope', v_scope,
    'employee_id', v_employee.id, 'can_choose_scope', v_admin);
END; $function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 17. „Mój dzień”: sprawy sprzedawców
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.sales_day_sellers()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c jsonb; t jsonb; v_items jsonb;
BEGIN
  BEGIN
    c := public.get_my_seller_cockpit(NULL);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF jsonb_array_length(c->'sellers') = 0 THEN RETURN NULL; END IF;
  t := c->'today';
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'at' DESC NULLS LAST), '[]'::jsonb) INTO v_items FROM (
    SELECT x FROM (
      SELECT jsonb_build_object('kind', 'review', 'title', r->>'title', 'seller_name', r->>'seller_name', 'at', r->>'requested_at',
               'url', '/crm/offers/' || (r->>'offer_id') || CASE WHEN r->>'document_id' IS NOT NULL THEN '?document=' || (r->>'document_id') || '&preview=1' ELSE '' END || '#seller-offer-review') AS x
        FROM jsonb_array_elements(t->'reviews') r
      UNION ALL
      SELECT jsonb_build_object('kind', 'chat', 'title', r->>'title', 'seller_name', r->>'seller_name', 'at', r->>'last_message_at',
               'url', CASE WHEN r->>'contact_id' IS NOT NULL THEN '/crm/contacts/' || (r->>'contact_id') || '?tab=seller&conversation=' || (r->>'conversation_id')
                           ELSE '/crm/salespeople?seller=' || (r->>'sales_partner_id') || '&conversation=' || (r->>'conversation_id') END)
        FROM jsonb_array_elements(t->'chats_waiting') r
      UNION ALL
      SELECT jsonb_build_object('kind', 'inquiry', 'title', 'Zapytanie: ' || (r->>'guest_name'), 'seller_name', r->>'seller_name',
               'at', r->>'created_at', 'url', '/crm/salespeople?inquiry=' || (r->>'id'))
        FROM jsonb_array_elements(t->'inquiries') r
      UNION ALL
      SELECT jsonb_build_object('kind', 'wizard', 'title', r->>'title', 'seller_name', r->>'seller_name', 'at', r->>'submitted_at',
               'url', CASE WHEN r->>'event_id' IS NOT NULL THEN '/crm/events/' || (r->>'event_id') || '?tab=seller-arrangements'
                           ELSE '/crm/offers/' || (r->>'offer_id') END)
        FROM jsonb_array_elements(t->'wizard_steps') r
      UNION ALL
      SELECT jsonb_build_object('kind', 'event', 'title', r->>'name', 'seller_name', r->>'seller_name', 'at', r->>'event_date',
               'url', '/crm/events/' || (r->>'event_id'))
        FROM jsonb_array_elements(t->'events_pending') r
      UNION ALL
      SELECT jsonb_build_object('kind', 'guest', 'title', r->>'title', 'seller_name', r->>'seller_name', 'at', r->>'accepted_at',
               'url', '/crm/offers/' || (r->>'offer_id'))
        FROM jsonb_array_elements(t->'guest_acceptances') r
    ) all_items ORDER BY x->>'at' DESC NULLS LAST LIMIT 10
  ) limited;
  RETURN jsonb_build_object('reviews', jsonb_array_length(t->'reviews'), 'chats_waiting', jsonb_array_length(t->'chats_waiting'),
    'inquiries', jsonb_array_length(t->'inquiries'), 'wizard_steps', jsonb_array_length(t->'wizard_steps'),
    'events_pending', jsonb_array_length(t->'events_pending'), 'guest_acceptances', jsonb_array_length(t->'guest_acceptances'),
    'items', v_items);
END $$;

CREATE OR REPLACE FUNCTION public.get_my_sales_day()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE
  actor uuid := public.current_crm_employee_id();
  actor_auth uuid;
  day_end timestamptz;
BEGIN
  IF actor IS NULL OR public.current_session_is_seller_portal() THEN
    RAISE EXCEPTION 'Wymagane aktywne konto pracownika.' USING ERRCODE = '42501';
  END IF;
  SELECT auth_user_id INTO actor_auth FROM public.employees WHERE id = actor;
  day_end := (date_trunc('day', now() AT TIME ZONE 'Europe/Warsaw') + interval '1 day') AT TIME ZONE 'Europe/Warsaw';

  RETURN jsonb_build_object(
    'generated_at', now(),
    'followups', (
      SELECT coalesce(jsonb_agg(item ORDER BY item.next_action_at), '[]'::jsonb) FROM (
        SELECT t.id, t.title, t.inquiry_stage AS stage, t.next_action_at, t.estimated_value,
          t.next_action_at < now() AS overdue, t.tender_id
        FROM public.tasks t
        WHERE t.is_inquiry AND t.inquiry_owner_id = actor AND t.archived_at IS NULL
          AND coalesce(t.inquiry_stage, 'new') NOT IN ('won', 'lost')
          AND t.next_action_at IS NOT NULL AND t.next_action_at < day_end
        ORDER BY t.next_action_at
        LIMIT 30
      ) item
    ),
    'unscheduled_inquiries', (
      SELECT count(*) FROM public.tasks t
      WHERE t.is_inquiry AND t.inquiry_owner_id = actor AND t.archived_at IS NULL
        AND coalesce(t.inquiry_stage, 'new') NOT IN ('won', 'lost') AND t.next_action_at IS NULL
    ),
    'waiting_offers', (
      SELECT coalesce(jsonb_agg(item ORDER BY item.sent_at), '[]'::jsonb) FROM (
        SELECT o.id, coalesce(nullif(o.title, ''), o.offer_number) AS title, o.offer_number, o.sent_at, o.viewed_at,
          o.total_amount, o.valid_until, o.inquiry_id, o.event_id,
          floor(extract(epoch FROM now() - o.sent_at) / 86400)::int AS days_waiting
        FROM public.offers o
        LEFT JOIN public.tasks inquiry ON inquiry.id = o.inquiry_id
        WHERE o.status::text = 'sent' AND o.sent_at IS NOT NULL AND o.sent_at < now() - interval '3 days'
          AND (o.created_by IN (actor, actor_auth) OR inquiry.inquiry_owner_id = actor)
          AND (inquiry.id IS NULL OR (inquiry.archived_at IS NULL AND coalesce(inquiry.inquiry_stage, '') NOT IN ('won', 'lost')))
        ORDER BY o.sent_at
        LIMIT 20
      ) item
    ),
    'tenders', CASE WHEN public.current_employee_can_view_tenders() THEN (
      SELECT coalesce(jsonb_agg(item ORDER BY item.submission_deadline), '[]'::jsonb) FROM (
        SELECT t.id, t.title, t.submission_deadline, t.status, t.inquiry_id, t.relevance_score,
          t.assigned_to = actor AS mine
        FROM public.tenders t
        WHERE t.submission_deadline > now() AND t.submission_deadline <= now() + interval '7 days'
          AND t.status IN ('new', 'reviewing', 'interested', 'preparing')
          AND NOT coalesce(t.is_hidden, false)
          AND (t.assigned_to = actor
            OR (t.assigned_to IS NULL AND (t.is_matched OR t.manual_relevance = 'relevant' OR t.is_watched)))
        ORDER BY t.submission_deadline
        LIMIT 15
      ) item
    ) ELSE '[]'::jsonb END,
    'pipeline', (
      SELECT coalesce(jsonb_agg(item ORDER BY item.position), '[]'::jsonb) FROM (
        SELECT coalesce(t.inquiry_stage, 'new') AS stage,
          CASE coalesce(t.inquiry_stage, 'new') WHEN 'new' THEN 1 WHEN 'contacted' THEN 2 WHEN 'qualified' THEN 3
            WHEN 'proposal' THEN 4 WHEN 'negotiation' THEN 5 ELSE 6 END AS position,
          count(*) AS count,
          coalesce(sum(t.estimated_value), 0) AS value,
          coalesce(sum(t.estimated_value * coalesce(t.win_probability, 0) / 100.0), 0) AS weighted_value
        FROM public.tasks t
        WHERE t.is_inquiry AND t.inquiry_owner_id = actor AND t.archived_at IS NULL
          AND coalesce(t.inquiry_stage, 'new') NOT IN ('won', 'lost')
        GROUP BY coalesce(t.inquiry_stage, 'new')
      ) item
    ),
    'sellers', private.sales_day_sellers()
  );
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 18. Wydarzenie z oferty sprzedawcy: prowadzi je opiekun sprzedawcy; zmiany wydarzenia trafiają do sprzedawcy
-- ---------------------------------------------------------------------------------------------------------------
-- Wydarzenie z oferty sprzedawcy prowadzi opiekun przez udział sprzedaży (podsumowanie wydarzenia) — autora wydarzenia
-- nie zmieniamy (strażnik autora pozwala na to tylko administratorowi).
DROP TRIGGER IF EXISTS zz_seller_offer_event_owner ON public.offers;
DROP FUNCTION IF EXISTS private.seller_offer_event_owner();

-- Krok „sprzedaż”: najpierw główny sprzedawca wydarzenia z podsumowania (udział), potem autor zaakceptowanej oferty.
CREATE OR REPLACE FUNCTION public.event_step_assignee(p_event uuid, p_role text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
  SELECT CASE p_role
    WHEN 'warehouse' THEN (SELECT h.accepted_by FROM public.event_warehouse_handoffs h
      JOIN public.employees e ON e.id = h.accepted_by AND e.is_active WHERE h.event_id = p_event)
    WHEN 'manager' THEN (SELECT r.manager_id FROM public.event_realizations r
      JOIN public.employees e ON e.id = r.manager_id AND e.is_active WHERE r.event_id = p_event)
    WHEN 'driver' THEN (SELECT v.driver_id FROM public.event_vehicles v
      JOIN public.employees e ON e.id = v.driver_id AND e.is_active
      WHERE v.event_id = p_event AND coalesce(v.status,'planned') <> 'cancelled'
      ORDER BY v.departure_time NULLS LAST, v.created_at LIMIT 1)
    WHEN 'sales' THEN coalesce(
      (SELECT s.employee_id FROM public.event_sales_shares s JOIN public.employees e ON e.id = s.employee_id AND e.is_active
        WHERE s.event_id = p_event ORDER BY s.share_percent DESC, s.created_at LIMIT 1),
      (SELECT o.created_by FROM public.offers o JOIN public.employees e ON e.id = o.created_by AND e.is_active
        WHERE o.event_id = p_event AND o.status::text = 'accepted' ORDER BY o.updated_at DESC LIMIT 1),
      (SELECT e.id FROM public.events ev JOIN public.employees e ON ev.created_by IN (e.id, e.auth_user_id) AND e.is_active
        WHERE ev.id = p_event LIMIT 1))
    WHEN 'author' THEN (SELECT e.id FROM public.events ev JOIN public.employees e ON ev.created_by IN (e.id, e.auth_user_id) AND e.is_active
        WHERE ev.id = p_event LIMIT 1)
    ELSE NULL
  END;
$function$;

-- Odwołanie, zmiana terminu lub miejsca wydarzenia z oferty sprzedawcy → sprzedawca i opiekun wiedzą od razu.
CREATE OR REPLACE FUNCTION private.notify_seller_event_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record; v_title text; v_message text;
BEGIN
  IF NEW.status::text = 'cancelled' AND OLD.status::text IS DISTINCT FROM 'cancelled' THEN
    v_title := 'Wydarzenie odwołane';
    v_message := NEW.name || ' — wydarzenie zostało odwołane.';
  ELSIF NEW.status::text <> 'cancelled' AND (NEW.event_date IS DISTINCT FROM OLD.event_date OR NEW.event_end_date IS DISTINCT FROM OLD.event_end_date) THEN
    v_title := 'Zmiana terminu wydarzenia';
    v_message := NEW.name || ' — nowy termin: ' || to_char(NEW.event_date AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI')
      || coalesce(' – ' || to_char(NEW.event_end_date AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'), '') || '.';
  ELSIF NEW.status::text <> 'cancelled' AND (NEW.location IS DISTINCT FROM OLD.location OR NEW.location_id IS DISTINCT FROM OLD.location_id) THEN
    v_title := 'Zmiana miejsca wydarzenia';
    v_message := NEW.name || coalesce(' — nowe miejsce: ' || nullif(btrim(NEW.location), '') || '.', ' — zmieniło się miejsce wydarzenia.');
  ELSE
    RETURN NULL;
  END IF;
  FOR r IN SELECT DISTINCT o.id AS offer_id, o.sales_partner_id, o.my_company_id FROM public.offers o
            WHERE o.event_id = NEW.id AND o.sales_channel = 'seller_portal' AND o.sales_partner_id IS NOT NULL LOOP
    PERFORM private.notify_seller_portal(r.sales_partner_id, r.my_company_id, v_title, v_message,
      '/seller/realizations/' || r.offer_id, 'seller_event', 'event', NEW.id,
      jsonb_build_object('event_id', NEW.id, 'offer_id', r.offer_id));
    PERFORM private.notify_seller_staff(r.sales_partner_id, r.my_company_id, false, v_title || ' (sprzedawca zewnętrzny)',
      private.seller_display_name(r.sales_partner_id) || ' · ' || v_message, '/crm/events/' || NEW.id, 'seller_event', 'event', NEW.id,
      jsonb_build_object('event_id', NEW.id, 'offer_id', r.offer_id));
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS zz_notify_seller_event_change ON public.events;
CREATE TRIGGER zz_notify_seller_event_change AFTER UPDATE OF status, event_date, event_end_date, location, location_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.notify_seller_event_change();

-- Prowizja sprzedawcy do wypłaty / wypłacona → powiadomienie w portalu (gdy wynagrodzenie jest widoczne).
CREATE OR REPLACE FUNCTION private.notify_seller_commission_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_company uuid; v_event text;
BEGIN
  IF NEW.sales_partner_id IS NULL OR NEW.entry_kind = 'deduction' OR NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('approved', 'paid') THEN
    RETURN NULL;
  END IF;
  SELECT e.my_company_id, e.name INTO v_company, v_event FROM public.events e WHERE e.id = NEW.event_id;
  IF NOT public.seller_commissions_visible(NEW.sales_partner_id, v_company) THEN RETURN NULL; END IF;
  PERFORM private.notify_seller_portal(NEW.sales_partner_id, v_company,
    CASE NEW.status WHEN 'paid' THEN 'Prowizja wypłacona' ELSE 'Prowizja do wypłaty' END,
    coalesce(v_event, 'Wydarzenie') || ' · ' || private.pl_money(NEW.amount) || ' zł',
    '/seller/commissions', 'seller_commission', 'event', NEW.event_id,
    jsonb_build_object('commission_id', NEW.id, 'event_id', NEW.event_id, 'status', NEW.status));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS zz_notify_seller_commission_status ON public.event_commissions;
CREATE TRIGGER zz_notify_seller_commission_status AFTER UPDATE OF status ON public.event_commissions
  FOR EACH ROW EXECUTE FUNCTION private.notify_seller_commission_status();

-- ---------------------------------------------------------------------------------------------------------------
-- 19. Portal: opiekun, widoczność wynagrodzenia, prowizje tylko z widocznych marek
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seller_commissions_visible(p_partner uuid, p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT t.commissions_visible AND t.is_active FROM public.sales_partner_brand_terms t
                    WHERE t.sales_partner_id = p_partner AND t.my_company_id = p_company), false);
$$;

CREATE OR REPLACE FUNCTION public.get_seller_portal_context()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT jsonb_build_object(
    'default_offer_organization_id', public.seller_default_offer_organization(p.id),
    'organizations', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', org.id,
      'name', COALESCE(NULLIF(org.alias, ''), org.name), 'business_type', org.business_type)
      ORDER BY COALESCE(NULLIF(org.alias, ''), org.name), org.id)
      FROM public.seller_partner_organization_ids(p.id) h JOIN public.organizations org ON org.id = h.organization_id), '[]'::jsonb),
    'profile', jsonb_build_object('id', p.id, 'partner_type', p.partner_type, 'organization_id', p.organization_id,
      'person', jsonb_build_object('name', c.full_name, 'email', c.email, 'phone', COALESCE(c.mobile, c.phone), 'photo_url', c.avatar_url,
        'position', (SELECT r.position FROM public.contact_organizations r WHERE r.contact_id = p.contact_id AND r.organization_id = p.organization_id AND r.is_current LIMIT 1)),
      'organization', jsonb_build_object('id', o.id, 'name', o.name, 'alias', o.alias, 'email', o.email, 'phone', o.phone, 'website', o.website, 'address', o.address, 'city', o.city)),
    'manager', (SELECT jsonb_build_object('name', nullif(btrim(concat_ws(' ', m.name, m.surname)), ''), 'email', m.email,
                  'phone', nullif(m.phone_number, ''), 'photo_url', m.avatar_url,
                  'position', coalesce(nullif(m.occupation, ''), 'Opiekun sprzedawców'))
                  FROM public.employees m WHERE m.id = public.seller_partner_manager_id(p.id, NULL) AND m.is_active),
    'brands', COALESCE((SELECT jsonb_agg(jsonb_build_object('my_company_id', t.my_company_id, 'name', b.name, 'legal_name', b.legal_name, 'logo_url', b.logo_url,
      'commission_enabled', t.commission_enabled, 'commissions_visible', t.commissions_visible,
      -- Ukryte wynagrodzenie: bez stawki i sposobu wypłaty (null). Marka bez prowizji — jak dotąd.
      'default_commission_rate', CASE WHEN t.commission_enabled AND NOT t.commissions_visible THEN NULL ELSE t.default_commission_rate END,
      'default_payment_method', CASE WHEN t.commission_enabled AND NOT t.commissions_visible THEN NULL ELSE t.default_payment_method END,
      'branding', public.resolve_seller_offer_branding_for_organization(p.id, t.my_company_id, public.seller_default_offer_organization(p.id))) ORDER BY b.name)
      FROM public.sales_partner_brand_terms t JOIN public.my_companies b ON b.id = t.my_company_id
      WHERE t.sales_partner_id = p.id AND t.is_active AND b.is_active), '[]'::jsonb))
  FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id = p.contact_id
  LEFT JOIN public.organizations o ON o.id = p.organization_id
  WHERE p.id = public.current_sales_partner_id() AND p.portal_enabled AND p.status = 'active';
$function$;

CREATE OR REPLACE FUNCTION public.get_seller_portal_commissions()
RETURNS TABLE(id uuid, event_id uuid, event_name text, event_date timestamp with time zone, amount numeric, status text, due_date date, paid_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT commission.id, commission.event_id, event.name, event.event_date::timestamptz,
         CASE WHEN commission.entry_kind = 'deduction' THEN -commission.amount ELSE commission.amount END,
         commission.status, commission.due_date, commission.paid_at
  FROM public.event_commissions commission
  JOIN public.events event ON event.id = commission.event_id
  WHERE commission.sales_partner_id = public.current_sales_partner_id()
    AND commission.status <> 'cancelled'
    AND EXISTS (
      SELECT 1 FROM public.sales_partner_brand_terms term
      WHERE term.sales_partner_id = commission.sales_partner_id AND term.my_company_id = event.my_company_id
        AND term.is_active = true AND term.commission_enabled = true AND term.commissions_visible = true)
  ORDER BY event.event_date DESC NULLS LAST, commission.created_at DESC;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 20. Rozliczenia prowizji: portal tylko z widocznych marek, bez rozbicia podstawy; opiekun = „mój sprzedawca”
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_commission_settlements(p_mode text DEFAULT 'crm'::text, p_account_type text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE seller_id uuid; account_type text := p_account_type; account_id uuid := p_account_id; own_account boolean := false;
  rows jsonb; sales_scope boolean := public.invoice_finance_scope() = 'sales';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Wymagane logowanie.' USING ERRCODE = '42501'; END IF;
  IF p_mode = 'seller' THEN
    IF p_account_id IS NOT NULL OR p_account_type IS NOT NULL THEN
      RAISE EXCEPTION 'Portal udostępnia tylko własne konto.' USING ERRCODE = '42501';
    END IF;
    seller_id := public.current_sales_partner_id();
    IF seller_id IS NULL THEN RAISE EXCEPTION 'Brak dostępu do portalu sprzedawcy.' USING ERRCODE = '42501'; END IF;
    account_type := 'partner'; account_id := seller_id;
  ELSIF p_mode = 'crm' THEN
    IF account_type IS NULL OR account_type NOT IN ('contact','partner','employee','organization') OR account_id IS NULL THEN
      RAISE EXCEPTION 'Wybierz prawidłowe konto prowizji.';
    END IF;
    own_account := account_type = 'employee' AND account_id = public.current_invoice_employee_id();
    IF own_account THEN
      NULL; -- własne prowizje pracownika (np. udział w sprzedaży) widzi każdy pracownik
    ELSIF sales_scope THEN
      IF NOT ((account_type = 'partner' AND public.seller_partner_is_mine(account_id))
           OR (account_type = 'contact' AND (EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = account_id AND c.owner_id = public.current_invoice_employee_id())
               OR EXISTS (SELECT 1 FROM public.sales_partner_profiles p WHERE p.contact_id = account_id AND public.seller_partner_is_mine(p.id))))) THEN
        RAISE EXCEPTION 'Możesz zobaczyć wyłącznie sprzedawców, których jesteś opiekunem.' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT public.commission_settlement_can_access(NULL, false) THEN
      RAISE EXCEPTION 'Brak dostępu do finansów.' USING ERRCODE = '42501';
    END IF;
  ELSE RAISE EXCEPTION 'Nieprawidłowy widok rozliczeń.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'event_id', c.event_id, 'event_name', e.name, 'event_date', e.event_date,
    'my_company_id', e.my_company_id, 'company_name', company.name,
    'can_manage', p_mode = 'crm' AND public.commission_settlement_can_access(c.event_id, true),
    'beneficiary_name', c.beneficiary_name, 'amount', c.amount,
    'base_amount', c.base_amount, 'rate', c.rate,
    -- Portal: stawka i kwota podstawy, bez rozbicia kosztów Mavinci i bez opisów z CRM.
    'base_description', CASE WHEN p_mode = 'seller' THEN NULL ELSE c.base_description END,
    'rate_reason', CASE WHEN p_mode = 'seller' THEN NULL ELSE c.rate_reason END,
    'entry_kind', c.entry_kind, 'corrects_commission_id', c.corrects_commission_id, 'automatic_source', c.automatic_source,
    'share_percent', c.share_percent, 'client_owned', c.client_owned, 'settlement_revision', c.settlement_revision,
    'company_cost_amount', CASE WHEN p_mode = 'crm' AND NOT sales_scope THEN coalesce(c.company_cost_amount,c.amount) ELSE NULL END,
    'status', c.status, 'automatic_waiting_for_offer', c.automatic_waiting_for_offer,
    'created_at', c.created_at, 'due_date', c.due_date, 'payment_method', c.payment_method,
    'paid_amount', CASE WHEN payments.count = 0 AND c.status = 'paid' THEN c.amount ELSE payments.total END,
    'remaining_amount', CASE WHEN c.status IN ('cancelled','paid') OR c.entry_kind = 'deduction' THEN 0 ELSE greatest(0,c.amount-payments.total) END,
    -- Potrącenie: kwota do potrącenia z kolejnych prowizji (nie do wypłaty); kwota ze znakiem do sum salda.
    'to_offset', CASE WHEN c.entry_kind = 'deduction' AND c.status = 'approved' THEN greatest(0, c.amount - payments.total) ELSE 0 END,
    'signed_amount', CASE WHEN c.entry_kind = 'deduction' THEN -c.amount ELSE c.amount END,
    'offset_amount', payments.offset_total,
    'payments', CASE WHEN payments.count = 0 AND c.status = 'paid' THEN jsonb_build_array(jsonb_build_object(
      'id', 'legacy:' || c.id::text, 'commission_id', c.id, 'amount', c.amount,
      'payment_date', (c.paid_at AT TIME ZONE 'Europe/Warsaw')::date,
      'recorded_at', NULL, 'reference', NULL, 'note', NULL, 'source', 'legacy'
    )) ELSE payments.entries END
  ) ORDER BY e.event_date DESC NULLS LAST,c.created_at DESC,c.id), '[]'::jsonb) INTO rows
  FROM public.event_commissions c JOIN public.events e ON e.id = c.event_id
  LEFT JOIN public.my_companies company ON company.id = e.my_company_id
  LEFT JOIN public.sales_partner_profiles profile ON profile.id = c.sales_partner_id
  CROSS JOIN LATERAL (
    SELECT count(*) AS count, coalesce(sum(p.amount),0) AS total,
      coalesce(sum(p.amount) FILTER (WHERE p.is_offset),0) AS offset_total,
      coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'commission_id', p.commission_id, 'amount', p.amount,
        'payment_date', p.payment_date, 'recorded_at', p.recorded_at, 'reference', p.reference,
        'note', CASE WHEN p_mode = 'crm' AND NOT sales_scope THEN p.note ELSE NULL END, 'source', CASE WHEN p.is_offset THEN 'offset' ELSE 'ledger' END, 'is_offset', p.is_offset
      ) ORDER BY p.payment_date DESC,p.recorded_at DESC,p.id), '[]'::jsonb) AS entries
    FROM public.event_commission_payouts p WHERE p.commission_id = c.id
  ) payments
  WHERE ((p_mode = 'seller' AND public.seller_commissions_visible(coalesce(c.sales_partner_id, account_id), e.my_company_id)) OR (own_account AND c.employee_id = account_id AND c.beneficiary_type = 'employee') OR CASE WHEN sales_scope THEN public.sales_commission_visible(c.id)
    ELSE public.commission_settlement_can_access(c.event_id,false) END)
    AND CASE account_type
      WHEN 'contact' THEN c.contact_id = account_id OR profile.contact_id = account_id
      WHEN 'employee' THEN c.employee_id = account_id OR c.salesperson_id = account_id OR profile.employee_id = account_id
      WHEN 'organization' THEN c.organization_id = account_id
      WHEN 'partner' THEN c.sales_partner_id = account_id OR (c.sales_partner_id IS NULL AND EXISTS (
        SELECT 1 FROM public.sales_partner_profiles own_profile WHERE own_profile.id = account_id
          AND ((own_profile.contact_id IS NOT NULL AND c.contact_id = own_profile.contact_id)
            OR (own_profile.employee_id IS NOT NULL AND (c.employee_id = own_profile.employee_id OR c.salesperson_id = own_profile.employee_id)))))
      ELSE false END;
  RETURN jsonb_build_object('mode', p_mode, 'accountType', account_type, 'accountId', account_id,
    'canManage', p_mode = 'crm' AND public.commission_settlement_can_access(NULL,true),
    'currency','PLN','commissions',rows);
END; $function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 21. Podsumowanie wydarzenia: prowizja z „Ustaleń ze sprzedawcą” tylko dla osoby nadal pracującej w organizacji
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.event_settlement_compute(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  e public.events%ROWTYPE;
  settings public.compensation_settings%ROWTYPE;
  v_raw jsonb; v_lines jsonb;
  v_revenue numeric := 0; v_sub numeric := 0; v_direct numeric := 0; v_team numeric := 0; v_ext_lines numeric := 0;
  v_partner_base numeric := 0; v_external jsonb := '[]'; v_ext_auto numeric := 0; v_profit numeric := 0;
  v_internal jsonb := '[]'; v_internal_total numeric := 0; v_internal_cost numeric := 0;
  v_issues jsonb := '[]'; v_warnings jsonb := '[]';
  v_unconfirmed integer := 0; v_forecast_lines integer := 0; v_share_sum numeric; v_share_count integer;
  v_finished boolean; v_cancelled boolean; v_key_input jsonb; v_revision integer; v_clawback boolean;
  v_refresh_rates boolean;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO settings FROM public.compensation_settings WHERE id = 1;
  SELECT s.revision, s.refresh_rates INTO v_revision, v_refresh_rates FROM public.event_settlements s WHERE s.event_id = p_event_id;
  v_revision := coalesce(v_revision, 0);
  -- Administrator otworzył podsumowanie z przeliczeniem stawek: nie zachowujemy stawek z poprzedniego zatwierdzenia.
  v_refresh_rates := coalesce(v_refresh_rates, false);
  v_cancelled := e.status::text = 'cancelled';
  -- Anulowanie po zatwierdzeniu: ponowne zatwierdzenie zeruje prowizje (dopłaty / potrącenia).
  v_clawback := v_cancelled AND v_revision > 0;
  v_finished := e.status::text IN ('completed', 'invoiced', 'settled')
    OR coalesce(e.event_end_date, e.event_date) < now();

  -- 1. Pozycje: automatyczne + korekty + ręczne. Korekta kwoty / potwierdzenie obowiązuje, dopóki kwota źródła
  --    się nie zmieni (source_net); po zmianie źródła pozycja wymaga ponownego potwierdzenia.
  WITH auto AS (SELECT * FROM private.event_settlement_auto_lines(p_event_id)),
  ov AS (SELECT * FROM public.event_settlement_lines l WHERE l.event_id = p_event_id AND l.source_type <> 'manual'),
  joined AS (
    SELECT a.*, ov.id AS ov_id, ov.category AS ov_category, ov.net_amount AS ov_net, ov.source_net AS ov_source_net,
           ov.included AS ov_included, ov.confirmed AS ov_confirmed, ov.note AS ov_note, ov.updated_at AS ov_updated_at,
           ov.updated_by AS ov_updated_by,
           (ov.id IS NOT NULL AND (ov.net_amount IS NOT NULL OR ov.confirmed)) AS ov_has_value,
           (ov.source_net IS NOT DISTINCT FROM a.suggested_net) AS ov_valid
      FROM auto a LEFT JOIN ov ON ov.source_type = a.source_type AND ov.source_id = a.source_id
  ),
  merged AS (
    SELECT jsonb_build_object(
             'key', j.source_type || ':' || j.source_id, 'line_id', j.ov_id, 'source_type', j.source_type,
             'source_id', j.source_id, 'kind', j.kind,
             'category', CASE WHEN j.source_type IN ('event_cost', 'subcontractor_task') AND j.ov_category IN ('subcontractor', 'direct_cost')
                              THEN j.ov_category ELSE j.category END,
             'name', j.name, 'detail', nullif(j.detail, ''), 'date', j.line_date, 'suggested_net', j.suggested_net,
             'net_amount', coalesce(CASE WHEN j.source_type IN ('event_cost', 'subcontractor_task', 'team', 'cash', 'forecast')
                                              AND j.ov_net IS NOT NULL AND j.ov_valid
                                         THEN j.ov_net ELSE j.suggested_net END, 0),
             'gross_amount', j.gross_amount, 'auto_included', j.auto_included,
             'included', coalesce(j.ov_included, j.auto_included),
             'needs_confirmation', (j.needs_confirmation AND NOT (coalesce(j.ov_confirmed, false) AND j.ov_valid))
                                   OR (j.ov_has_value AND NOT j.ov_valid),
             'confirmed', CASE WHEN j.needs_confirmation THEN coalesce(j.ov_confirmed, false) AND j.ov_valid ELSE true END,
             'source_changed', j.ov_has_value AND NOT j.ov_valid,
             'previous_source_net', CASE WHEN j.ov_has_value AND NOT j.ov_valid THEN j.ov_source_net END,
             'auto', true, 'auto_note', j.auto_note, 'note', j.ov_note, 'updated_at', j.ov_updated_at,
             'updated_by', j.ov_updated_by,
             'editable', CASE j.source_type
                WHEN 'event_cost' THEN '["included","category","net","confirm","note"]'::jsonb
                WHEN 'subcontractor_task' THEN '["included","category","net","note"]'::jsonb
                WHEN 'team' THEN '["included","net","note"]'::jsonb
                WHEN 'cash' THEN '["included","net","confirm","note"]'::jsonb
                WHEN 'forecast' THEN '["included","net","note"]'::jsonb
                ELSE '["included","note"]'::jsonb END,
             'sort_order', j.sort_order, 'group_id', j.group_id, 'ref_partner', j.ref_partner, 'ref_contact', j.ref_contact,
             'ref_employee', j.ref_employee, 'precedes', j.precedes) AS l
      FROM joined j
    UNION ALL
    SELECT jsonb_build_object(
             'key', 'manual:' || l.id, 'line_id', l.id, 'source_type', 'manual', 'source_id', NULL, 'kind', l.kind,
             'category', l.category, 'name', l.name, 'detail', NULL, 'date', l.created_at::date, 'suggested_net', l.net_amount,
             'net_amount', coalesce(l.net_amount, 0), 'gross_amount', NULL, 'auto_included', true,
             'included', coalesce(l.included, true), 'needs_confirmation', false, 'confirmed', true, 'source_changed', false,
             'previous_source_net', NULL, 'auto', false, 'auto_note', NULL, 'note', l.note, 'updated_at', l.updated_at,
             'updated_by', l.updated_by, 'editable', '["included","category","net","name","note","delete"]'::jsonb,
             'sort_order', CASE WHEN l.kind = 'revenue' THEN 15 ELSE 95 END)
      FROM public.event_settlement_lines l
     WHERE l.event_id = p_event_id AND l.source_type = 'manual'
  )
  SELECT coalesce(jsonb_agg(m.l ORDER BY (m.l->>'sort_order')::int, m.l->>'date' NULLS LAST, m.l->>'name'), '[]'::jsonb)
    INTO v_raw FROM merged m;

  -- 2. Zlecenia podwykonawcy: liczy się tylko część niepokryta kosztami tego podwykonawcy już wpisanymi (np. jego
  --    fakturą). Pokrycie liczymy raz na podwykonawcę: Σ zleceń − Σ jego kosztów, rozdzielone po kolei na zlecenia
  --    (faktura za jedno zlecenie nie zeruje pozostałych).
  WITH el AS (
    SELECT t.l, t.ord FROM jsonb_array_elements(v_raw) WITH ORDINALITY AS t(l, ord)
  ),
  cov AS (
    SELECT el.l->>'group_id' AS g, sum((el.l->>'net_amount')::numeric) AS covered
      FROM el
     WHERE el.l->>'source_type' = 'event_cost' AND (el.l->>'included')::boolean AND el.l->>'group_id' IS NOT NULL
     GROUP BY 1
  ),
  tasks AS (
    SELECT el.ord, cov.covered,
           greatest(0, cov.covered - coalesce(sum((el.l->>'net_amount')::numeric) OVER (
             PARTITION BY el.l->>'group_id' ORDER BY el.ord ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)) AS available
      FROM el JOIN cov ON cov.g = el.l->>'group_id'
     WHERE el.l->>'source_type' = 'subcontractor_task' AND (el.l->>'included')::boolean AND cov.covered > 0
  )
  SELECT coalesce(jsonb_agg(
           CASE WHEN tk.ord IS NOT NULL AND tk.available > 0
                THEN el.l || jsonb_build_object(
                       'net_amount', greatest(0, round((el.l->>'net_amount')::numeric - least((el.l->>'net_amount')::numeric, tk.available), 2)),
                       'auto_note', format('Kwota uzgodniona %s zł − pokryte kosztami tego podwykonawcy już wpisanymi %s zł (razem jego koszty: %s zł).',
                                           private.pl_money((el.l->>'net_amount')::numeric),
                                           private.pl_money(least((el.l->>'net_amount')::numeric, tk.available)),
                                           private.pl_money(tk.covered)))
                ELSE el.l END ORDER BY el.ord), '[]'::jsonb)
    INTO v_raw
    FROM el LEFT JOIN tasks tk ON tk.ord = el.ord;

  SELECT coalesce(sum((l->>'net_amount')::numeric) FILTER (WHERE (l->>'included')::boolean AND l->>'kind' = 'revenue'), 0),
         coalesce(sum((l->>'net_amount')::numeric) FILTER (WHERE (l->>'included')::boolean AND l->>'kind' = 'cost' AND l->>'category' = 'subcontractor'), 0),
         coalesce(sum((l->>'net_amount')::numeric) FILTER (WHERE (l->>'included')::boolean AND l->>'kind' = 'cost' AND l->>'category' = 'direct_cost'), 0),
         coalesce(sum((l->>'net_amount')::numeric) FILTER (WHERE (l->>'included')::boolean AND l->>'kind' = 'cost' AND l->>'category' = 'team'), 0),
         count(*) FILTER (WHERE (l->>'included')::boolean AND (l->>'needs_confirmation')::boolean),
         count(*) FILTER (WHERE (l->>'included')::boolean AND l->>'source_type' IN ('offer', 'forecast'))
    INTO v_revenue, v_sub, v_direct, v_team, v_unconfirmed, v_forecast_lines
    FROM jsonb_array_elements(v_raw) l;

  v_partner_base := greatest(0, round(v_revenue - v_sub, 2));

  -- 3. Sprzedawcy zewnętrzni: portal (prowizja), polecenie, kontakt rozliczeniowy, pośrednik (Ustalenia), dodany ręcznie.
  IF NOT v_cancelled THEN
    WITH src AS (
      SELECT o.sales_partner_id AS pid, 'seller_portal'::text AS src, 1 AS prio, o.partner_commission_rate AS offer_rate,
             NULL::uuid AS org_id, o.commercial_model
        FROM public.offers o
       WHERE o.event_id = p_event_id AND o.status::text = 'accepted' AND o.sales_channel = 'seller_portal' AND o.sales_partner_id IS NOT NULL
      UNION ALL
      SELECT e.referring_sales_partner_id, 'event_referral', 2, NULL, NULL, NULL WHERE e.referring_sales_partner_id IS NOT NULL
      UNION ALL
      SELECT p.id, 'billing_contact', 3, NULL, b.organization_id, NULL
        FROM public.event_billing_contacts b
        JOIN public.sales_partner_profiles p ON p.contact_id = b.contact_id
       WHERE b.event_id = p_event_id AND coalesce(e.billing_arrangement, 'direct') <> 'direct'
         AND b.organization_id = e.billing_organization_id
         -- Osoba pracowała w tej organizacji w dniu wydarzenia (odejście po wydarzeniu nie odbiera prowizji).
         AND EXISTS (SELECT 1 FROM public.contact_organizations r
                      WHERE r.contact_id = b.contact_id AND r.organization_id = b.organization_id
                        AND (r.is_current OR r.ended_at::date >= e.event_date::date))
      UNION ALL
      SELECT p.id, 'partner_arrangement', 4, NULL, a.organization_id, NULL
        FROM public.event_partner_arrangements a
        JOIN public.sales_partner_profiles p ON p.contact_id = a.contact_id
       WHERE a.event_id = p_event_id AND a.enabled AND a.contact_id IS NOT NULL
         -- Tylko osoba, która pracowała w tej organizacji w dniu wydarzenia (jak przy kontakcie rozliczeniowym).
         AND (a.organization_id IS NULL OR EXISTS (SELECT 1 FROM public.contact_organizations r
                WHERE r.contact_id = a.contact_id AND r.organization_id = a.organization_id
                  AND (r.is_current OR r.ended_at::date >= e.event_date::date)))
      UNION ALL
      SELECT c.sales_partner_id, 'manual_partner', 5, NULL, c.organization_id, NULL
        FROM public.event_commissions c
       WHERE c.event_id = p_event_id AND c.automatic_source = 'manual_partner' AND c.entry_kind = 'accrual'
         AND c.sales_partner_id IS NOT NULL AND (c.status <> 'cancelled' OR c.auto_cancelled)
    ),
    picked AS (
      SELECT DISTINCT ON (s.pid) s.* FROM src s ORDER BY s.pid, s.prio
    ),
    rows AS (
      SELECT pk.pid, pk.src, pk.prio, pk.offer_rate, pk.commercial_model, p.contact_id, p.employee_id, p.partner_type,
             p.status AS profile_status,
             coalesce(pk.org_id, p.organization_id, e.billing_organization_id) AS org_id,
             coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
                      nullif(btrim(concat_ws(' ', emp.name, emp.surname)), '')) AS person,
             t.is_active, t.commission_enabled, t.default_payment_method, t.dividend_tax_rate, t.default_commission_rate,
             cur.id AS cur_id, cur.status AS cur_status, cur.auto_cancelled AS cur_auto_cancelled, cur.cancel_reason AS cur_cancel_reason,
             -- Prowizja już zatwierdzona: przy ponownym rozliczeniu zostaje jej stawka i sposób wypłaty
             -- (późniejsza zmiana warunków w kartotece nie działa wstecz).
             (cur.id IS NOT NULL AND cur.settlement_revision IS NOT NULL AND cur.status IN ('approved', 'paid')) AS retained,
             coalesce(lc.rate, cur.rate) AS cur_rate, cur.payment_method AS cur_payment, cur.dividend_tax_rate AS cur_dividend
        FROM picked pk
        JOIN public.sales_partner_profiles p ON p.id = pk.pid
        LEFT JOIN public.contacts c ON c.id = p.contact_id
        LEFT JOIN public.employees emp ON emp.id = p.employee_id
        LEFT JOIN public.sales_partner_brand_terms t ON t.sales_partner_id = p.id AND t.my_company_id = e.my_company_id
        LEFT JOIN public.event_commissions cur
          ON cur.id = private.commission_uuid('mavinci:event-commission:' || p_event_id::text || ':' || pk.pid::text)
        -- Stawka z ostatniego zatwierdzenia (dopłata / potrącenie zapisują stawkę swojej wersji).
        LEFT JOIN LATERAL (
          SELECT x.rate FROM public.event_commissions x
           WHERE (x.id = cur.id OR x.corrects_commission_id = cur.id) AND x.status <> 'cancelled'
           ORDER BY x.settlement_revision DESC NULLS LAST, x.created_at DESC LIMIT 1) lc ON true
    ),
    judged AS (
      SELECT r.*,
             CASE WHEN r.retained AND NOT v_refresh_rates THEN r.cur_rate
                  WHEN r.src = 'seller_portal' AND r.commercial_model = 'commission' THEN coalesce(r.offer_rate, r.default_commission_rate)
                  ELSE r.default_commission_rate END AS rate,
             CASE WHEN r.retained AND NOT v_refresh_rates THEN 'Stawka z zatwierdzonego rozliczenia'
                  WHEN r.src = 'seller_portal' AND r.commercial_model = 'commission' AND r.offer_rate IS NOT NULL
                    THEN 'Stawka uzgodniona w ofercie sprzedawcy'
                  ELSE 'Stawka z kartoteki sprzedawców (marka wydarzenia)' END AS rate_reason,
             CASE WHEN r.retained THEN r.cur_payment ELSE coalesce(r.default_payment_method, 'cash_dividend') END AS payment_method,
             CASE WHEN r.retained THEN r.cur_dividend ELSE coalesce(r.dividend_tax_rate, 19) END AS dividend,
             CASE WHEN r.cur_id IS NOT NULL AND r.cur_status = 'cancelled' AND NOT r.cur_auto_cancelled
                    THEN 'Prowizja anulowana ręcznie' || coalesce(': ' || r.cur_cancel_reason, ' w ewidencji prowizji') || '.'
                  WHEN EXISTS (SELECT 1 FROM public.event_commissions mc
                                WHERE mc.event_id = p_event_id AND mc.status <> 'cancelled' AND mc.entry_kind = 'accrual'
                                  AND (mc.automatic_source IS NULL OR NOT (mc.automatic_source = ANY (private.commission_auto_sources())))
                                  AND (mc.sales_partner_id = r.pid OR (r.contact_id IS NOT NULL AND mc.contact_id = r.contact_id))
                                  AND private.commission_manual_precedes(mc))
                    THEN 'Ma zatwierdzony ręczny wpis prowizji w tym wydarzeniu — liczymy wpis ręczny.'
                  WHEN r.src = 'seller_portal' AND r.commercial_model = 'markup' THEN 'Rozliczany narzutem w swojej ofercie — bez dodatkowej prowizji.'
                  WHEN r.partner_type = 'internal_employee' THEN 'Pracownik — jego prowizję liczy udział sprzedawcy wydarzenia.'
                  WHEN r.retained THEN NULL
                  WHEN r.profile_status <> 'active' THEN 'Profil sprzedawcy jest nieaktywny.'
                  WHEN e.my_company_id IS NULL THEN 'Wydarzenie nie ma marki — brak warunków prowizji.'
                  WHEN NOT coalesce(r.is_active AND r.commission_enabled, false) THEN 'Brak aktywnej prowizji dla marki wydarzenia w kartotece sprzedawców.'
                  WHEN r.person IS NULL THEN 'Uzupełnij dane osoby w kartotece sprzedawców.'
             END AS skip_reason
        FROM rows r
    ),
    calc AS (
      SELECT j.*,
             coalesce(j.skip_reason, CASE WHEN coalesce(j.rate, 0) <= 0 THEN 'Stawka prowizji wynosi 0%.' END) AS reason,
             round(v_partner_base * coalesce(j.rate, 0) / 100, 2) AS amount
        FROM judged j
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'partner_id', c.pid, 'contact_id', c.contact_id, 'employee_id', c.employee_id, 'organization_id', c.org_id,
             'name', coalesce(c.person, 'Sprzedawca'), 'source', c.src, 'eligible', c.reason IS NULL,
             'skip_reason', c.reason, 'rate', c.rate, 'rate_reason', c.rate_reason, 'retained', c.retained, 'base', v_partner_base,
             'previous_rate', CASE WHEN c.retained AND v_refresh_rates AND c.cur_rate IS DISTINCT FROM c.rate THEN c.cur_rate END,
             'amount', CASE WHEN c.reason IS NULL THEN c.amount ELSE 0 END,
             'payment_method', c.payment_method,
             'dividend_tax_rate', c.dividend,
             'company_cost', CASE WHEN c.reason IS NOT NULL THEN 0
                                  WHEN c.payment_method = 'cash_dividend'
                                    THEN round(c.amount / (1 - least(99.99, greatest(0, coalesce(c.dividend, 19))) / 100), 2)
                                  ELSE c.amount END,
             'commission_id', private.commission_uuid('mavinci:event-commission:' || p_event_id::text || ':' || c.pid::text))
             ORDER BY c.prio, c.person), '[]'::jsonb)
      INTO v_external
      FROM calc c;
  END IF;

  SELECT coalesce(sum((x->>'company_cost')::numeric) FILTER (WHERE (x->>'eligible')::boolean), 0)
    INTO v_ext_auto FROM jsonb_array_elements(v_external) x;

  -- 4. Ręczny wpis prowizji osoby, którą liczy podsumowanie, a który nie ma pierwszeństwa (czeka na zatwierdzenie
  --    przez finanse): nie odejmujemy go podwójnie.
  SELECT coalesce(jsonb_agg(
           CASE WHEN l->>'source_type' = 'commission' AND NOT coalesce((l->>'precedes')::boolean, false)
                     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_external) x
                                  WHERE (x->>'eligible')::boolean
                                    AND (x->>'partner_id' = l->>'ref_partner' OR (l->>'ref_contact' IS NOT NULL AND x->>'contact_id' = l->>'ref_contact')))
                THEN l || jsonb_build_object('included', false,
                       'auto_note', 'Ręczny wpis czeka na zatwierdzenie przez finanse — do tego czasu liczy się prowizja z podsumowania.')
                ELSE l END ORDER BY ord), '[]'::jsonb)
    INTO v_raw
    FROM jsonb_array_elements(v_raw) WITH ORDINALITY AS t(l, ord);

  SELECT coalesce(sum((l->>'net_amount')::numeric) FILTER (WHERE (l->>'included')::boolean AND l->>'kind' = 'cost' AND l->>'category' = 'external_commission'), 0)
    INTO v_ext_lines FROM jsonb_array_elements(v_raw) l;

  v_profit := round(v_revenue - v_sub - v_direct - v_team - v_ext_lines - v_ext_auto, 2);

  -- 5. Pracownicy: udział sprzedawcy × stawka (5% / 10% przy kliencie własnym) × zysk netto.
  SELECT count(*), coalesce(sum(sh.share_percent), 0) INTO v_share_count, v_share_sum
    FROM public.event_sales_shares sh WHERE sh.event_id = p_event_id;

  IF NOT v_cancelled THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'employee_id', z.employee_id, 'name', z.person, 'share_percent', z.share_percent, 'source', z.source,
             'client_owned', z.client_owned, 'client_label', z.client_label, 'client_checked_at', z.client_checked_at,
             'client_check_basis', z.client_check_basis,
             'enabled', z.enabled, 'rate', z.rate, 'retained', z.retained,
             'previous_rate', CASE WHEN z.retained AND v_refresh_rates AND z.retained_rate IS DISTINCT FROM z.rate THEN z.retained_rate END,
             'blocked_reason', z.blocked_reason,
             'rate_reason', CASE WHEN z.retained AND z.keep_rate THEN 'Stawka z zatwierdzonego rozliczenia'
                                 WHEN z.client_owned THEN 'Klient własny' || coalesce(' (' || z.client_label || ')', '')
                                   || CASE WHEN z.client_check_basis = 'offer_acceptance' THEN ' — opiekun w dniu akceptacji oferty'
                                           WHEN z.client_check_basis = 'manual' THEN ' — potwierdzone przez administratora'
                                           ELSE ' — opiekun w dniu przypisania sprzedawcy' END
                                 ELSE 'Stawka podstawowa' END,
             'base', z.base, 'amount', CASE WHEN z.enabled AND z.blocked_reason IS NULL THEN z.amount ELSE 0 END,
             'payment_method', z.payment_method, 'dividend_tax_rate', z.dividend_rate,
             'employer_social_rate', z.employer_rate,
             'company_cost', CASE WHEN NOT z.enabled OR z.blocked_reason IS NOT NULL THEN 0
                                  WHEN z.payment_method = 'payroll' THEN round(z.amount * (1 + coalesce(z.employer_rate, 0) / 100), 2)
                                  WHEN z.payment_method = 'cash_dividend' THEN round(z.amount / (1 - least(99.99, z.dividend_rate) / 100), 2)
                                  ELSE z.amount END,
             'commission_id', z.commission_id)
             ORDER BY z.share_percent DESC, z.person), '[]'::jsonb)
      INTO v_internal
      FROM (
        SELECT y.*,
               round(greatest(0, v_profit) * y.share_percent / 100, 2) AS base,
               round(round(greatest(0, v_profit) * y.share_percent / 100, 2) * y.rate / 100, 2) AS amount
          FROM (
            SELECT sh.*, n.person, n.commission_id, x.retained, x.keep_rate, x.blocked_reason, x.cur_rate AS retained_rate,
                   n.enabled_now OR x.retained AS enabled,
                   CASE WHEN x.retained AND x.keep_rate THEN x.cur_rate ELSE n.rate_now END AS rate,
                   CASE WHEN x.retained THEN x.cur_payment ELSE n.payment_now END AS payment_method,
                   CASE WHEN x.retained THEN coalesce(x.cur_employer, settings.employer_social_rate) ELSE settings.employer_social_rate END AS employer_rate,
                   coalesce(settings.dividend_rate, 19) AS dividend_rate
              FROM public.event_sales_shares sh
              JOIN public.employees emp ON emp.id = sh.employee_id
              LEFT JOIN public.employee_sales_commission_terms t ON t.employee_id = sh.employee_id
              CROSS JOIN LATERAL (
                SELECT coalesce(nullif(btrim(concat_ws(' ', emp.name, emp.surname)), ''), 'Pracownik') AS person,
                       private.commission_uuid('mavinci:sales-share:' || p_event_id::text || ':' || sh.employee_id::text) AS commission_id,
                       coalesce(t.enabled, false) AS enabled_now,
                       CASE WHEN sh.client_owned THEN coalesce(t.own_client_rate, settings.sales_commission_own_client_rate, 10)
                            ELSE coalesce(t.standard_rate, settings.sales_commission_standard_rate, 5) END AS rate_now,
                       coalesce(t.payment_method, 'payroll') AS payment_now
              ) n
              LEFT JOIN public.event_commissions cur ON cur.id = n.commission_id
              LEFT JOIN LATERAL (
                SELECT x.rate, x.client_owned FROM public.event_commissions x
                 WHERE (x.id = cur.id OR x.corrects_commission_id = cur.id) AND x.status <> 'cancelled'
                 ORDER BY x.settlement_revision DESC NULLS LAST, x.created_at DESC LIMIT 1) lc ON true
              CROSS JOIN LATERAL (
                SELECT (cur.id IS NOT NULL AND cur.settlement_revision IS NOT NULL AND cur.status IN ('approved', 'paid')) AS retained,
                       -- Stawkę z zatwierdzenia zachowujemy, chyba że administrator zmienił „klient własny” albo otworzył
                       -- podsumowanie z przeliczeniem stawek.
                       (coalesce(lc.client_owned, cur.client_owned) IS NOT DISTINCT FROM sh.client_owned AND NOT v_refresh_rates) AS keep_rate,
                       coalesce(lc.rate, cur.rate) AS cur_rate, cur.payment_method AS cur_payment, cur.employer_social_rate AS cur_employer,
                       CASE WHEN cur.id IS NOT NULL AND cur.status = 'cancelled' AND NOT cur.auto_cancelled
                              THEN 'Prowizja anulowana ręcznie' || coalesce(': ' || cur.cancel_reason, ' w ewidencji prowizji') || '.'
                            WHEN EXISTS (SELECT 1 FROM public.event_commissions mc
                                          WHERE mc.event_id = p_event_id AND mc.employee_id = sh.employee_id AND mc.status <> 'cancelled'
                                            AND mc.entry_kind = 'accrual'
                                            AND (mc.automatic_source IS NULL OR NOT (mc.automatic_source = ANY (private.commission_auto_sources())))
                                            AND private.commission_manual_precedes(mc))
                              THEN 'Ma zatwierdzony ręczny wpis prowizji w tym wydarzeniu — liczymy wpis ręczny.' END AS blocked_reason
              ) x
             WHERE sh.event_id = p_event_id
          ) y
      ) z;
  END IF;

  SELECT coalesce(sum((x->>'amount')::numeric), 0), coalesce(sum((x->>'company_cost')::numeric), 0)
    INTO v_internal_total, v_internal_cost FROM jsonb_array_elements(v_internal) x;

  -- Pozycje do wyświetlenia: bez pól technicznych, z nazwiskiem ostatniej osoby, która zmieniła pozycję.
  SELECT coalesce(jsonb_agg(
           (l - 'sort_order' - 'group_id' - 'ref_partner' - 'ref_contact' - 'ref_employee' - 'precedes' - 'updated_by')
           || jsonb_build_object('updated_by_name', nullif(btrim(concat_ws(' ', u.name, u.surname)), ''),
                                 'needs_confirmation', (l->>'needs_confirmation')::boolean AND (l->>'included')::boolean)
           ORDER BY ord), '[]'::jsonb)
    INTO v_lines
    FROM jsonb_array_elements(v_raw) WITH ORDINALITY AS t(l, ord)
    LEFT JOIN public.employees u ON u.id::text = l->>'updated_by';

  -- 6. Braki blokujące wysłanie i zatwierdzenie.
  IF v_cancelled AND NOT v_clawback THEN v_issues := v_issues || jsonb_build_array('Wydarzenie jest anulowane — nie ma czego rozliczać.'); END IF;
  IF NOT v_clawback THEN
    IF NOT v_finished THEN v_issues := v_issues || jsonb_build_array('Podsumowanie wyślesz po zakończeniu wydarzenia.'); END IF;
    IF v_revenue <= 0 THEN v_issues := v_issues || jsonb_build_array('Brak przychodu netto — potrzebna jest faktura sprzedaży, potwierdzony przychód gotówkowy albo pozycja ręczna.'); END IF;
    IF v_forecast_lines > 0 THEN
      v_issues := v_issues || jsonb_build_array('Przychód pochodzi z prognozy (oferta lub kalkulacja). Do rozliczenia potrzebna jest faktura sprzedaży, potwierdzony przychód gotówkowy albo pozycja ręczna.');
    END IF;
    IF v_unconfirmed > 0 THEN
      v_issues := v_issues || jsonb_build_array(format('Potwierdź kwotę netto w pozycjach: %s.', v_unconfirmed));
    END IF;
    IF v_share_count > 0 AND round(v_share_sum, 2) <> 100 THEN
      v_issues := v_issues || jsonb_build_array('Udziały sprzedawców muszą dawać razem 100%.');
    END IF;
  END IF;

  -- Ostrzeżenia (nie blokują).
  IF v_clawback THEN
    v_warnings := v_warnings || jsonb_build_array('Wydarzenie anulowane po zatwierdzeniu — ponowne zatwierdzenie wyzeruje prowizje (niewypłacone anuluje, wypłacone zamieni w potrącenia).');
  END IF;
  IF v_refresh_rates THEN
    v_warnings := v_warnings || jsonb_build_array('Podsumowanie otwarto z przeliczeniem stawek — przy zatwierdzeniu stawki będą według aktualnych warunków (różnica: dopłata albo potrącenie).');
  END IF;
  IF v_share_count = 0 AND NOT v_cancelled THEN
    v_warnings := v_warnings || jsonb_build_array('Wydarzenie nie ma przypisanego sprzedawcy — prowizja pracownika nie zostanie naliczona.');
  END IF;
  -- Przeliczenie stawek: kto i jak się zmieni (różnica — dopłata albo potrącenie przy zatwierdzeniu).
  SELECT v_warnings || coalesce(jsonb_agg(format('%s: stawka %s%% → %s%% (przeliczenie stawek).', x->>'name',
           private.pl_number((x->>'previous_rate')::numeric), private.pl_number((x->>'rate')::numeric))), '[]'::jsonb)
    INTO v_warnings
    FROM (SELECT * FROM jsonb_array_elements(v_internal) UNION ALL SELECT * FROM jsonb_array_elements(v_external)) AS t(x)
   WHERE x->>'previous_rate' IS NOT NULL;
  SELECT v_warnings || coalesce(jsonb_agg(format('%s nie ma włączonej prowizji od sprzedaży.', x->>'name')), '[]'::jsonb)
    INTO v_warnings FROM jsonb_array_elements(v_internal) x WHERE NOT (x->>'enabled')::boolean;
  SELECT v_warnings || coalesce(jsonb_agg(format('%s: %s', x->>'name', x->>'blocked_reason')), '[]'::jsonb)
    INTO v_warnings FROM jsonb_array_elements(v_internal) x WHERE x->>'blocked_reason' IS NOT NULL;
  SELECT v_warnings || coalesce(jsonb_agg(format('%s: %s', x->>'name', x->>'skip_reason')), '[]'::jsonb)
    INTO v_warnings FROM jsonb_array_elements(v_external) x WHERE NOT (x->>'eligible')::boolean;
  IF v_profit < 0 THEN
    v_warnings := v_warnings || jsonb_build_array('Wydarzenie jest na minusie — prowizja od zysku wynosi 0 zł.');
  END IF;
  IF (SELECT count(*) FROM public.offers o WHERE o.event_id = p_event_id AND o.status::text = 'accepted') > 1 THEN
    v_warnings := v_warnings || jsonb_build_array('Wydarzenie ma kilka zaakceptowanych ofert — sprawdź, czy przychód nie jest liczony podwójnie.');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_raw) l WHERE (l->>'source_changed')::boolean) THEN
    v_warnings := v_warnings || jsonb_build_array('Kwota źródłowa części pozycji zmieniła się po korekcie — potwierdź je ponownie.');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_raw) l
              WHERE l->>'source_type' = 'commission' AND NOT coalesce((l->>'precedes')::boolean, false)) THEN
    v_warnings := v_warnings || jsonb_build_array('Ręczne wpisy prowizji czekają na zatwierdzenie przez finanse.');
  END IF;

  -- Liczby w kluczu w jednej skali (stawka z ustawień „15” i zapisana w ewidencji „15.000” to ta sama wartość).
  v_key_input := jsonb_build_object(
    'lines', (SELECT coalesce(jsonb_agg(jsonb_build_array(l->>'key', l->'included', l->>'category',
                round((l->>'net_amount')::numeric, 2), l->'confirmed', l->>'kind', round((l->>'suggested_net')::numeric, 2))
                ORDER BY l->>'key'), '[]'::jsonb) FROM jsonb_array_elements(v_lines) l),
    'external', (SELECT coalesce(jsonb_agg(jsonb_build_array(x->>'partner_id', x->'eligible', round((x->>'rate')::numeric, 3),
                x->>'payment_method', round((x->>'dividend_tax_rate')::numeric, 2))
                ORDER BY x->>'partner_id'), '[]'::jsonb) FROM jsonb_array_elements(v_external) x),
    'internal', (SELECT coalesce(jsonb_agg(jsonb_build_array(x->>'employee_id', round((x->>'share_percent')::numeric, 2), x->'client_owned',
                x->'enabled', round((x->>'rate')::numeric, 3), x->>'payment_method', x->>'blocked_reason')
                ORDER BY x->>'employee_id'), '[]'::jsonb) FROM jsonb_array_elements(v_internal) x),
    'cancelled', v_cancelled);

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'lines', v_lines,
    'totals', jsonb_build_object(
      'revenue_net', round(v_revenue, 2), 'subcontractor_net', round(v_sub, 2), 'direct_cost_net', round(v_direct, 2),
      'team_net', round(v_team, 2), 'external_commission_lines', round(v_ext_lines, 2),
      'external_commission_auto', round(v_ext_auto, 2),
      'costs_net', round(v_sub + v_direct + v_team + v_ext_lines + v_ext_auto, 2),
      'partner_base', v_partner_base, 'profit_net', v_profit,
      'internal_commissions', round(v_internal_total, 2), 'internal_commissions_cost', round(v_internal_cost, 2),
      'profit_after_commissions', round(v_profit - v_internal_cost, 2)),
    'external', v_external,
    'internal', v_internal,
    'shares_sum', v_share_sum,
    'issues', v_issues,
    'warnings', v_warnings,
    'finished', v_finished,
    'clawback', v_clawback,
    'refresh_rates', v_refresh_rates,
    'forecast', v_forecast_lines > 0 OR v_revenue <= 0,
    'source_key', md5(v_key_input::text));
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 22. Start: opiekun z opiekuna kontaktu, widoczne wynagrodzenie tam, gdzie było widoczne przed wdrożeniem
-- ---------------------------------------------------------------------------------------------------------------
-- Tylko przy pierwszym uruchomieniu (znacznik w komentarzu tabeli historii): ponowne uruchomienie nie odsłania
-- wynagrodzenia nowym warunkom ani nie przywraca opiekuna usuniętego przez administratora.
DO $$
BEGIN
  IF coalesce(obj_description('public.sales_partner_audit'::regclass, 'pg_class'), '') LIKE '%[start:2026-11-05]%' THEN
    RAISE NOTICE 'Start sprzedawców już wykonany — pomijam.';
    RETURN;
  END IF;
  PERFORM set_config('mavinci.seller_audit_reason', 'Start: opiekun przejęty z opiekuna kontaktu', true);
  UPDATE public.sales_partner_profiles p SET manager_id = c.owner_id, manager_assigned_at = now()
    FROM public.contacts c
   WHERE c.id = p.contact_id AND p.manager_id IS NULL AND c.owner_id IS NOT NULL
     AND public.employee_can_manage_sellers(c.owner_id, NULL);
  PERFORM set_config('mavinci.seller_audit_reason', 'Start: wynagrodzenie było widoczne w portalu przed wdrożeniem', true);
  UPDATE public.sales_partner_brand_terms SET commissions_visible = true, commissions_visibility_changed_at = now()
   WHERE is_active AND commission_enabled AND NOT commissions_visible AND commissions_visibility_changed_at IS NULL;
  PERFORM set_config('mavinci.seller_audit_reason', '', true);
  COMMENT ON TABLE public.sales_partner_audit IS 'Historia zmian sprzedawców zewnętrznych (tylko dopisywanie). [start:2026-11-05]';
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 23. Uprawnienia
-- ---------------------------------------------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.employee_can_manage_sellers(uuid, uuid)', 'public.seller_partner_is_mine(uuid)', 'public.seller_terms_can_manage(uuid)',
    'public.seller_portal_offer_staff_visible(uuid)',
    'public.set_seller_manager(uuid, uuid, uuid, text)', 'public.set_seller_commission_visibility(uuid, uuid, boolean, text, boolean)',
    'public.get_seller_audit(uuid, integer)', 'public.seller_portal_account_state(uuid)', 'public.get_my_seller_cockpit(uuid, uuid)',
    'public.respond_seller_inquiry(uuid, text, text)', 'public.convert_seller_inquiry(uuid)',
    'public.create_client_from_seller_offer(uuid, boolean)', 'public.submit_seller_inquiry(uuid, uuid, jsonb)',
    'public.get_seller_inquiries(integer)', 'public.create_seller_inquiry_link(uuid, text)', 'public.get_seller_inquiry_links()',
    'public.revoke_seller_inquiry_link(uuid)', 'public.get_seller_offer_share_state(uuid)',
    'public.create_seller_offer_share_link(uuid, boolean)', 'public.revoke_seller_offer_share_link(uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  -- Strony publiczne (bez logowania): oferta dla gościa i formularz z kodu QR.
  FOREACH f IN ARRAY ARRAY['public.get_shared_seller_offer(text)', 'public.accept_shared_seller_offer(text, text, text, text, boolean)',
    'public.get_seller_inquiry_form(text)', 'public.submit_public_seller_inquiry(text, uuid, jsonb)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f);
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public.get_shared_seller_offer_document(text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_shared_seller_offer_document(text) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.get_shared_seller_offer_asset(text, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_shared_seller_offer_asset(text, text) TO service_role';
  -- Pomocnicza do zapytań wewnątrz funkcji — bez wywołań z aplikacji.
  EXECUTE 'REVOKE ALL ON FUNCTION public.seller_commissions_visible(uuid, uuid) FROM PUBLIC, anon, authenticated';
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname IN ('notify_seller_portal', 'seller_staff_recipients', 'notify_seller_staff',
              'seller_display_name', 'guard_seller_profile', 'guard_seller_terms_visibility', 'guard_seller_contact_delete',
              'seller_profile_audit_values', 'audit_seller_profile', 'audit_seller_terms', 'seller_inquiry_values', 'insert_seller_inquiry',
              'seller_offer_share_access', 'seller_offer_guest_ready', 'sales_day_sellers', 'notify_seller_event_change',
              'notify_seller_commission_status')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;
