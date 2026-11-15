-- Audyt kreatora i strefy sprzedawcy, etap 3 (docs/seller-portal.md):
-- 1) Przewodnik pierwszego uruchomienia w portalu hotelu — postęp zapisany w bazie (był tylko w przeglądarce).
-- 2) CRM: „Gotowość do pracy” sprzedawcy — co jeszcze trzeba ustawić po dodaniu (hotel, sale, marka, opiekun, logowanie…).
-- 3) Demo z broszury: „Chcę dołączyć” tworzy zapytanie w CRM dla osoby, która wysłała broszurę (albo jej autora),
--    a raport demo pokazuje, kto poprosił o kontakt.
-- Wymaga: 20261105150000_seller_manager_cockpit.sql. Można uruchomić ponownie.

-- ── 1. Przewodnik pierwszego uruchomienia ───────────────────────────────────────────────────────────────
-- Osobna tabela, nie kolumna profilu: zmiana profilu sprzedawcy przelicza prowizje i zapisuje historię zmian.
CREATE TABLE IF NOT EXISTS public.seller_portal_onboarding (
  sales_partner_id uuid PRIMARY KEY REFERENCES public.sales_partner_profiles(id) ON DELETE CASCADE,
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.seller_portal_onboarding IS
  'Postęp przewodnika „Witaj w portalu MAVINCI” (kroki odhaczone przez sprzedawcę). Tylko przez RPC get_/update_seller_onboarding.';
ALTER TABLE public.seller_portal_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_portal_onboarding FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_seller_onboarding()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE v_partner uuid := public.current_sales_partner_id(); v_flags jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_partner IS NULL OR NOT coalesce(public.current_session_is_seller_portal(), false) THEN
    RAISE EXCEPTION 'Przewodnik jest dostępny w portalu sprzedawcy.' USING ERRCODE = '42501';
  END IF;
  SELECT s.flags INTO v_flags FROM public.seller_portal_onboarding s WHERE s.sales_partner_id = v_partner;
  RETURN coalesce(v_flags, '{}'::jsonb);
END $$;

-- Odhaczenie kroków: hotel_checked, branding_seen, manager_met, journey_seen, first_step, completed, dismissed.
CREATE OR REPLACE FUNCTION public.update_seller_onboarding(p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE v_partner uuid := public.current_sales_partner_id(); v_flags jsonb; k text;
  v_allowed text[] := ARRAY['hotel_checked', 'branding_seen', 'manager_met', 'journey_seen', 'first_step', 'completed', 'dismissed'];
BEGIN
  IF auth.uid() IS NULL OR v_partner IS NULL OR NOT coalesce(public.current_session_is_seller_portal(), false) THEN
    RAISE EXCEPTION 'Przewodnik jest dostępny w portalu sprzedawcy.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Nieprawidłowe dane przewodnika.'; END IF;
  INSERT INTO public.seller_portal_onboarding (sales_partner_id) VALUES (v_partner) ON CONFLICT (sales_partner_id) DO NOTHING;
  SELECT s.flags INTO v_flags FROM public.seller_portal_onboarding s WHERE s.sales_partner_id = v_partner FOR UPDATE;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT k = ANY (v_allowed) OR jsonb_typeof(p_patch -> k) <> 'boolean' THEN RAISE EXCEPTION 'Nieprawidłowe dane przewodnika.'; END IF;
    v_flags := v_flags || jsonb_build_object(k, (p_patch ->> k)::boolean);
    IF k IN ('completed', 'dismissed') AND (p_patch ->> k)::boolean AND NOT (v_flags ? (k || '_at')) THEN
      v_flags := v_flags || jsonb_build_object(k || '_at', now());
    END IF;
  END LOOP;
  UPDATE public.seller_portal_onboarding SET flags = v_flags, updated_at = now() WHERE sales_partner_id = v_partner;
  RETURN v_flags;
END $$;

REVOKE ALL ON FUNCTION public.get_seller_onboarding(), public.update_seller_onboarding(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_seller_onboarding(), public.update_seller_onboarding(jsonb) TO authenticated;

-- ── 2. CRM: gotowość sprzedawcy do pracy ────────────────────────────────────────────────────────────────
-- Same fakty; kroki i teksty liczy src/lib/seller/readiness.ts. Dostęp jak do „Sprzedaży sprzedawcy”.
CREATE OR REPLACE FUNCTION public.get_crm_seller_readiness(p_partner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE p public.sales_partner_profiles%ROWTYPE; v_result jsonb;
BEGIN
  IF NOT public.seller_partner_is_mine(p_partner) THEN
    RAISE EXCEPTION 'Tego sprzedawcę prowadzi inny opiekun. Poproś administratora o dostęp.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.sales_partner_profiles WHERE id = p_partner;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono sprzedawcy.' USING ERRCODE = 'P0002'; END IF;
  SELECT jsonb_build_object(
    'status', p.status,
    'partner_type', p.partner_type,
    'person', jsonb_build_object('kind', CASE WHEN p.contact_id IS NOT NULL THEN 'contact' ELSE 'employee' END,
      'email', coalesce((SELECT nullif(btrim(c.email), '') FROM public.contacts c WHERE c.id = p.contact_id),
                        (SELECT nullif(btrim(e.email), '') FROM public.employees e WHERE e.id = p.employee_id))),
    'organization', (SELECT jsonb_build_object('id', o.id, 'name', coalesce(nullif(btrim(o.alias), ''), o.name),
        'is_hotel', o.business_type = 'hotel', 'location_id', l.id, 'location_name', l.name,
        'rooms', CASE WHEN jsonb_typeof(l.rooms) = 'array'
                      THEN (SELECT count(*) FROM jsonb_array_elements(l.rooms) r WHERE nullif(btrim(r ->> 'name'), '') IS NOT NULL) ELSE 0 END,
        'branding', EXISTS (SELECT 1 FROM public.organization_offer_branding b WHERE b.organization_id = o.id))
      FROM public.organizations o LEFT JOIN public.locations l ON l.id = o.location_id WHERE o.id = p.organization_id),
    'brands', (SELECT jsonb_build_object('active', count(*) FILTER (WHERE t.is_active),
        'default_ok', count(*) FILTER (WHERE t.is_active) = 1 OR coalesce(bool_or(t.is_active AND t.my_company_id = p.portal_default_company_id), false),
        'commission', coalesce(bool_or(t.is_active AND t.commission_enabled), false),
        'commissions_visible', coalesce(bool_or(t.is_active AND t.commissions_visible), false))
      FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id = p.id),
    'manager', (SELECT jsonb_build_object('name', nullif(btrim(concat_ws(' ', m.name, m.surname)), ''),
        'ok', public.employee_can_manage_sellers(m.id, NULL))
      FROM public.employees m WHERE m.id = public.seller_partner_manager_id(p.id, NULL)),
    'portal', coalesce(public.seller_portal_account_state(p.id), '{}'::jsonb) || jsonb_build_object('enabled', p.portal_enabled),
    'guide', coalesce((SELECT s.flags FROM public.seller_portal_onboarding s WHERE s.sales_partner_id = p.id), '{}'::jsonb),
    'activity', jsonb_build_object(
      'offers', (SELECT count(*) FROM public.offers o WHERE o.sales_partner_id = p.id),
      'first_offer_at', (SELECT min(o.created_at) FROM public.offers o WHERE o.sales_partner_id = p.id),
      'events', (SELECT count(DISTINCT o.event_id) FROM public.offers o WHERE o.sales_partner_id = p.id AND o.event_id IS NOT NULL),
      'inquiries', (SELECT count(*) FROM public.seller_inquiries i WHERE i.sales_partner_id = p.id),
      'qr_links', (SELECT count(*) FROM public.seller_inquiry_links k WHERE k.sales_partner_id = p.id AND k.revoked_at IS NULL)),
    'created_at', p.created_at)
  INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_crm_seller_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_seller_readiness(uuid) TO authenticated;

-- ── 3. Demo z broszury: „Chcę dołączyć” ─────────────────────────────────────────────────────────────────
ALTER TABLE public.seller_demo_sessions ADD COLUMN IF NOT EXISTS join_requested_at timestamptz;
ALTER TABLE public.seller_demo_sessions ADD COLUMN IF NOT EXISTS join_note text;
ALTER TABLE public.seller_demo_sessions ADD COLUMN IF NOT EXISTS join_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

-- Wywołuje wyłącznie trasa serwera demo (rola serwisowa) po sprawdzeniu podpisanej sesji. Jedno zgłoszenie na sesję.
-- Zapytanie prowadzi: osoba, która wysłała broszurę (atrybucja sesji) → opiekun kontaktu broszury → autor broszury.
CREATE OR REPLACE FUNCTION public.submit_seller_demo_join(p_session uuid, p_brochure uuid, p_full_name text, p_organization text,
  p_email text, p_phone text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE s public.seller_demo_sessions%ROWTYPE; b public.sales_brochures%ROWTYPE; v_owner uuid; v_task uuid; v_notice uuid;
  v_name text := left(nullif(btrim(p_full_name), ''), 120); v_org text := left(nullif(btrim(p_organization), ''), 160);
  v_email text := lower(left(nullif(btrim(p_email), ''), 200)); v_phone text := left(nullif(btrim(p_phone), ''), 40);
  v_note text := left(nullif(btrim(p_note), ''), 2000); v_attribution jsonb; v_recipients uuid[];
  v_title text := 'Hotel chce dołączyć do portalu'; v_message text; v_url text; v_meta jsonb;
BEGIN
  SELECT * INTO s FROM public.seller_demo_sessions WHERE id = p_session AND brochure_id = p_brochure FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesja demonstracji wygasła. Odśwież stronę.'; END IF;
  IF s.join_task_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'duplicate', true); END IF;
  IF v_name IS NULL OR length(v_name) < 2 THEN RAISE EXCEPTION 'Podaj imię i nazwisko.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Podaj nazwę hotelu lub agencji.'; END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN RAISE EXCEPTION 'Podaj e-mail albo telefon, abyśmy mogli się odezwać.'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' THEN RAISE EXCEPTION 'Podaj poprawny adres e-mail.'; END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^[0-9 +()./-]{6,40}$' THEN RAISE EXCEPTION 'Podaj poprawny numer telefonu.'; END IF;
  SELECT * INTO b FROM public.sales_brochures WHERE id = p_brochure;
  v_attribution := CASE WHEN jsonb_typeof(s.brand_config -> 'attribution') = 'object' THEN s.brand_config -> 'attribution' ELSE '{}'::jsonb END;
  SELECT e.id INTO v_owner
    FROM unnest(ARRAY[s.employee_id,
                      CASE WHEN v_attribution ->> 'employeeId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN (v_attribution ->> 'employeeId')::uuid END,
                      b.contact_employee_id, b.created_by]) WITH ORDINALITY AS c(id, position)
    JOIN public.employees e ON e.id = c.id AND e.is_active
   ORDER BY c.position LIMIT 1;
  INSERT INTO public.tasks (title, description, is_inquiry, inquiry_stage, inquiry_owner_id, inquiry_details, next_action_at, owner_id)
  VALUES (left('Hotel chce dołączyć do portalu: ' || v_org, 300),
          concat_ws(E'\n',
            'Zgłoszenie z demo strefy sprzedawcy (broszura: ' || coalesce(nullif(b.name, ''), 'bez nazwy') || ').',
            'Osoba: ' || v_name,
            'Hotel / agencja: ' || v_org,
            CASE WHEN v_email IS NOT NULL THEN 'E-mail: ' || v_email END,
            CASE WHEN v_phone IS NOT NULL THEN 'Telefon: ' || v_phone END,
            CASE WHEN nullif(v_attribution ->> 'campaignName', '') IS NOT NULL THEN 'Kampania: ' || (v_attribution ->> 'campaignName') END,
            CASE WHEN nullif(v_attribution ->> 'recipientEmail', '') IS NOT NULL THEN 'Broszura wysłana na: ' || (v_attribution ->> 'recipientEmail') END,
            CASE WHEN v_note IS NOT NULL THEN 'Wiadomość: ' || v_note END,
            'Następny krok: rozmowa, potem „Mianuj sprzedawcą” w karcie kontaktu i zaproszenie do portalu.'),
          true, 'new', v_owner,
          jsonb_strip_nulls(jsonb_build_object('source_kind', 'seller_demo', 'source_name', 'Demo strefy sprzedawcy',
            'seller_demo_session_id', s.id, 'brochure_id', p_brochure,
            'client_text', v_name, 'client_company', v_org, 'client_email', v_email, 'client_phone', v_phone,
            'source_message_content', v_note)),
          now() + interval '1 day', v_owner)
  RETURNING id, inquiry_owner_id INTO v_task, v_owner;
  UPDATE public.seller_demo_sessions SET full_name = v_name, organization = v_org, email = coalesce(v_email, email), phone = coalesce(v_phone, phone),
         join_requested_at = now(), join_note = v_note, join_task_id = v_task, updated_at = now()
   WHERE id = s.id;

  -- Powiadomienie: przypisanie zapytania już powiadamia prowadzącego (trigger) — nadajemy mu konkretną treść.
  -- Bez prowadzącego albo gdy ma wyłączone powiadomienia — zgłoszenie widzą też administratorzy.
  v_message := left(v_org || ' · ' || v_name || ' · z demo broszury', 500);
  v_url := '/crm/inquiries/' || v_task;
  v_meta := jsonb_build_object('workflow', 'seller_demo', 'event', 'join_requested', 'inquiry_id', v_task);
  BEGIN
    UPDATE public.notifications n
       SET title = v_title, message = v_message, action_url = v_url, related_entity_type = 'inquiry', metadata = coalesce(n.metadata, '{}'::jsonb) || v_meta
     WHERE n.related_entity_id = v_task::text AND n.metadata ->> 'kind' = 'inquiry_assignment'
    RETURNING n.id INTO v_notice;
    IF v_notice IS NULL THEN
      SELECT coalesce(array_agg(DISTINCT u.id), '{}'::uuid[]) INTO v_recipients
        FROM public.employees e JOIN auth.users u ON u.id = coalesce(e.auth_user_id, e.id)
       WHERE e.is_active AND (e.id = v_owner OR e.role::text = 'admin' OR e.access_level::text = 'admin'
              OR 'admin' = ANY (coalesce(e.permissions, '{}'::text[])));
      IF cardinality(v_recipients) > 0 THEN
        INSERT INTO public.notifications (title, message, type, category, action_url, related_entity_type, related_entity_id, metadata)
        VALUES (v_title, v_message, 'info', 'tasks', v_url, 'inquiry', v_task::text, v_meta)
        RETURNING id INTO v_notice;
        INSERT INTO public.notification_recipients (notification_id, user_id, is_read)
        SELECT v_notice, r, false FROM unnest(v_recipients) r ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Powiadomienie o zgłoszeniu z demo nie zostało zapisane: %', SQLERRM;
  END;
  RETURN jsonb_build_object('ok', true, 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.submit_seller_demo_join(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_seller_demo_join(uuid, uuid, text, text, text, text, text) TO service_role;

-- Raport demo broszury: licznik „Chcą dołączyć” i link do zapytania przy osobie.
DO $$
DECLARE v_def text; v_new text;
BEGIN
  IF to_regprocedure('public.get_seller_demo_report_scoped(uuid,integer,boolean,uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.get_seller_demo_report_scoped(uuid,integer,boolean,uuid)'::regprocedure);
  IF position('join_task_id' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, 's.created_at,s.updated_at,s.employee_id,', 's.created_at,s.updated_at,s.employee_id,s.join_requested_at,s.join_task_id,');
  v_new := replace(v_new, '''leads'',(SELECT count(*) FROM sessions WHERE',
                   '''joins'',(SELECT count(*) FROM sessions WHERE join_requested_at IS NOT NULL),' || chr(10) || ' ''leads'',(SELECT count(*) FROM sessions WHERE');
  IF position('s.join_task_id' IN v_new) = 0 OR position('''joins''' IN v_new) = 0 THEN
    RAISE WARNING 'Raport demo broszury ma inną postać niż oczekiwana — pominięto zgłoszenia „Chcę dołączyć” w raporcie.';
    RETURN;
  END IF;
  EXECUTE v_new;
END $$;

-- ── 4. Naprawa: „Przypisano Ci zapytanie” nigdy nie docierało ───────────────────────────────────────────
-- Zmienna notification_id kolidowała z kolumną w ON CONFLICT (notification_id, user_id): błąd „column reference is
-- ambiguous” był tłumiony przez EXCEPTION, więc prowadzący nie dostawał powiadomień o przypisaniu (także z demo).
-- Treść i warunki bez zmian — zmieniona tylko nazwa zmiennej.
CREATE OR REPLACE FUNCTION public.notify_inquiry_owner_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_notification_id uuid;
  notifications_enabled boolean;
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true OR NEW.inquiry_owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.inquiry_owner_id IS NOT DISTINCT FROM OLD.inquiry_owner_id THEN
    RETURN NEW;
  END IF;

  -- Samodzielne przejęcie ma natychmiastowy feedback w interfejsie i nie wymaga
  -- dodatkowego bannera do tej samej osoby.
  IF NEW.inquiry_owner_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(settings.inquiry_assignments_enabled, true)
  INTO notifications_enabled
  FROM public.employees employee
  LEFT JOIN public.employee_notification_settings settings
    ON settings.employee_id = employee.id
  WHERE employee.id = NEW.inquiry_owner_id
    AND employee.is_active = true
    AND (
      employee.role = 'admin'
      OR employee.access_level = 'admin'
      OR 'inquiries_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'inquiries_view_own' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'inquiries_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'inquiries_manage_own' = ANY(COALESCE(employee.permissions, '{}'::text[]))
    );

  IF COALESCE(notifications_enabled, false) IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    title, message, type, category, action_url,
    related_entity_type, related_entity_id, metadata, created_at
  ) VALUES (
    'Przypisano Ci zapytanie',
    format('Otrzymujesz odpowiedzialność za „%s”.', NEW.title),
    'info',
    'tasks',
    format('/crm/tasks/%s', NEW.id),
    'task',
    NEW.id::text,
    jsonb_build_object('kind', 'inquiry_assignment', 'inquiry_id', NEW.id),
    now()
  ) RETURNING id INTO v_notification_id;

  INSERT INTO public.notification_recipients (notification_id, user_id, is_read)
  VALUES (v_notification_id, NEW.inquiry_owner_id, false)
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Nie udało się wysłać powiadomienia o przypisaniu zapytania: %', SQLERRM;
  RETURN NEW;
END;
$function$;
