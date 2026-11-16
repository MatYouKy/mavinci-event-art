-- Decyzja 5 audytu kreatora sprzedawcy (15.11.2026): portal nie zapowiada wynagrodzenia przed odsłonięciem (bez zmian),
-- a kokpit opiekuna przypomina o odsłonięciu, gdy hotel ma pierwsze rozliczone wydarzenie z naliczoną prowizją.
--
-- get_my_seller_cockpit: nowe ostrzeżenie `commission_reveal_due` („Wynagrodzenie do odsłonięcia”) — sprzedawca z dostępem
-- do portalu, marka z aktywnymi warunkami i prowizją, widoczność wynagrodzenia wyłączona i nigdy nie zmieniana
-- (commissions_visibility_changed_at IS NULL — świadome ukrycie przez opiekuna nie przypomina), a w tej marce jest
-- naliczenie zatwierdzone przy rozliczeniu wydarzenia (event_commissions: accrual, approved albo paid).
-- Ostrzeżenie trafia do sellers[].warnings i do listy `warnings` kokpitu — CRM, Mac i aplikacja mobilna pokazują je
-- bez zmian w kodzie odczytu (etykieta w src/lib/seller/sellerCockpit.ts).
-- Reszta funkcji bez zmian względem 20261105150000_seller_manager_cockpit.sql.

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
               WHEN p.status = 'active' AND act.at IS NOT NULL AND act.at < now() - interval '30 days' THEN 'Brak aktywności od 30 dni.' END,
          CASE WHEN p.portal_enabled AND reveal.brands IS NOT NULL
               THEN 'Hotel ma rozliczone wydarzenie z naliczoną prowizją, ale nie widzi wynagrodzenia (' || reveal.brands
                    || '). Pokaż je w ustawieniach sprzedawcy: „Wynagrodzenie w portalu”.' END
        ], NULL)),
      'warning_codes', to_jsonb(array_remove(ARRAY[
          CASE WHEN mg.id IS NULL THEN 'no_manager' END,
          CASE WHEN mg.id IS NOT NULL AND NOT ok.value THEN 'manager_without_rights' END,
          CASE WHEN NOT brands.any_active THEN 'no_active_terms' END,
          CASE WHEN p.portal_enabled AND (u.id IS NULL OR u.last_sign_in_at IS NULL)
                    AND coalesce(p.invited_at, u.created_at, p.created_at) < now() - interval '7 days' THEN 'invite_pending' END,
          CASE WHEN p.status = 'active' AND act.at IS NOT NULL AND act.at < now() - interval '60 days' THEN 'inactive_60'
               WHEN p.status = 'active' AND act.at IS NOT NULL AND act.at < now() - interval '30 days' THEN 'inactive_30' END,
          CASE WHEN p.portal_enabled AND reveal.brands IS NOT NULL THEN 'commission_reveal_due' END
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
    -- Przypomnienie o odsłonięciu (decyzja 5 audytu): marki z prowizją ukrytą przed hotelem, której nikt jeszcze
    -- nie odsłonił ani świadomie nie ukrył, a hotel ma już zatwierdzone (rozliczone) naliczenie z wydarzenia tej marki.
    CROSS JOIN LATERAL (
      SELECT string_agg(DISTINCT b.name, ', ' ORDER BY b.name) AS brands
        FROM public.event_commissions cm
        JOIN public.events e ON e.id = cm.event_id
        JOIN public.sales_partner_brand_terms t ON t.sales_partner_id = cm.sales_partner_id AND t.my_company_id = e.my_company_id
        JOIN public.my_companies b ON b.id = t.my_company_id
       WHERE cm.sales_partner_id = p.id AND cm.entry_kind = 'accrual' AND cm.status IN ('approved', 'paid')
         AND t.is_active AND t.commission_enabled AND NOT t.commissions_visible
         AND t.commissions_visibility_changed_at IS NULL) reveal
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

REVOKE ALL ON FUNCTION public.get_my_seller_cockpit(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_cockpit(uuid, uuid) TO authenticated;
