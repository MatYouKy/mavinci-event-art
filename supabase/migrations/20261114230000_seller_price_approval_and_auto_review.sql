-- Audyt kreatora i strefy sprzedawcy, etap 2 (docs/seller-portal.md):
-- 1) Zgoda na cenę PRZED pokazaniem oferty klientowi: kreator wysyła prośbę do opiekuna, opiekun zatwierdza ceny
--    albo prosi o zmianę. Zgoda trzyma się tych samych pozycji i cen — zmiana tytułu czy terminu jej nie kasuje.
--    Do zgody link dla klienta jest wstrzymany (jak dotąd), a PDF dla klienta pobierzesz po zgodzie (trasa serwera).
-- 2) Akceptacja online klienta sama przekazuje ofertę do oceny opiekuna (z zaakceptowanym, aktualnym PDF).
--    Gdy się nie da (starsza wersja PDF, brak terminu, brak odbiorcy), zostaje jak dotąd: sprzedawca wysyła sam.
-- 3) „Klient” zamiast „gość” w tekstach z bazy (osoba zamawiająca wydarzenie; „gość hotelu” przy kodach QR zostaje).
-- Wymaga: 20261105150000_seller_manager_cockpit.sql. Można uruchomić ponownie.

-- ── Zgoda na cenę ────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS partner_price_approval_key text;
COMMENT ON COLUMN public.offers.partner_price_approval_key IS
  'Odcisk pozycji wymagających zgody (private.seller_offer_price_key) z chwili zgody na cenę. Ten sam odcisk po zapisie oferty = zgoda zostaje.';

CREATE TABLE IF NOT EXISTS public.seller_offer_price_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id) ON DELETE CASCADE,
  approval_key text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'changes_requested', 'superseded')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  response_note text NOT NULL DEFAULT '',
  decided_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  decided_at timestamptz
);
COMMENT ON TABLE public.seller_offer_price_requests IS
  'Prośby sprzedawcy o zgodę na cenę (pozycja własna albo cena poniżej stawki) i decyzje opiekuna. Tylko przez RPC.';
CREATE UNIQUE INDEX IF NOT EXISTS seller_offer_price_requests_pending ON public.seller_offer_price_requests(offer_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS seller_offer_price_requests_offer ON public.seller_offer_price_requests(offer_id, requested_at DESC);
ALTER TABLE public.seller_offer_price_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_offer_price_requests FROM anon, authenticated;

ALTER TABLE public.partner_offer_activities DROP CONSTRAINT IF EXISTS partner_offer_activities_activity_type_check;
ALTER TABLE public.partner_offer_activities ADD CONSTRAINT partner_offer_activities_activity_type_check CHECK (activity_type = ANY (ARRAY[
  'draft_created', 'draft_updated', 'generated', 'sent', 'viewed', 'submitted_for_review', 'approved', 'changes_requested',
  'accepted', 'rejected', 'guest_viewed', 'guest_accepted', 'price_approval_requested', 'price_approved', 'price_changes_requested'
]::text[]));

-- Pozycje wymagające zgody (jak trigger sum: offer_items.requires_internal_approval) — do prośby, panelu opiekuna i portalu.
CREATE OR REPLACE FUNCTION private.seller_offer_price_items(p_offer uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', i.name, 'custom', coalesce(i.is_partner_custom, false), 'unit', coalesce(nullif(i.unit, ''), 'szt.'),
      'quantity', i.quantity, 'days', coalesce(i.days, 1),
      'base_price', CASE WHEN coalesce(i.is_partner_custom, false) THEN NULL ELSE i.base_partner_unit_price END,
      'client_price', i.client_unit_price)
    ORDER BY i.display_order, i.name, i.client_unit_price), '[]'::jsonb)
  FROM public.offer_items i
  WHERE i.offer_id = p_offer AND coalesce(i.requires_internal_approval, false);
$$;

-- Odcisk cen do zgody. Identyfikatory pozycji zmieniają się przy każdym zapisie, więc liczą się nazwa, produkt, ilość i ceny.
CREATE OR REPLACE FUNCTION private.seller_offer_price_key(p_offer uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE md5(jsonb_build_object(
      'model', max(o.commercial_model::text),
      'items', jsonb_agg(jsonb_build_object(
        'product', i.product_id, 'variant', i.product_variant_id, 'name', i.name, 'custom', coalesce(i.is_partner_custom, false),
        'unit', i.unit, 'quantity', i.quantity, 'days', coalesce(i.days, 1),
        'base', i.base_partner_unit_price, 'client', i.client_unit_price)
        ORDER BY i.display_order, i.name, i.client_unit_price))::text) END
  FROM public.offer_items i JOIN public.offers o ON o.id = i.offer_id
  WHERE i.offer_id = p_offer AND coalesce(i.requires_internal_approval, false);
$$;

-- Zapis oferty i trigger sum ustawiają `required` po każdej zmianie pozycji. Te same ceny co przy zgodzie = zgoda zostaje.
-- Każde przejście na `approved` (zgoda na cenę albo przyjęcie oferty w ocenie) zapamiętuje odcisk cen.
CREATE OR REPLACE FUNCTION private.keep_seller_price_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE v_key text;
BEGIN
  IF NEW.sales_channel IS DISTINCT FROM 'seller_portal' THEN RETURN NEW; END IF;
  IF NEW.partner_approval_status = 'required' AND NEW.partner_price_approval_key IS NOT NULL THEN
    v_key := private.seller_offer_price_key(NEW.id);
    IF v_key IS NOT NULL AND v_key = NEW.partner_price_approval_key THEN NEW.partner_approval_status := 'approved'; END IF;
  ELSIF NEW.partner_approval_status = 'approved' AND OLD.partner_approval_status IS DISTINCT FROM 'approved' THEN
    NEW.partner_price_approval_key := coalesce(private.seller_offer_price_key(NEW.id), NEW.partner_price_approval_key);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_keep_seller_price_approval ON public.offers;
CREATE TRIGGER trg_keep_seller_price_approval BEFORE UPDATE OF partner_approval_status ON public.offers
  FOR EACH ROW EXECUTE FUNCTION private.keep_seller_price_approval();

-- Oferty zatwierdzone przed wdrożeniem: zapamiętaj ich ceny (bez zmiany statusu).
UPDATE public.offers o SET partner_price_approval_key = private.seller_offer_price_key(o.id)
 WHERE o.sales_channel = 'seller_portal' AND o.partner_approval_status = 'approved' AND o.partner_price_approval_key IS NULL;

CREATE OR REPLACE FUNCTION private.seller_price_items_label(p_items jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $$
  SELECT CASE WHEN n = 1 THEN '1 pozycja do zgody'
              WHEN n % 10 BETWEEN 2 AND 4 AND n % 100 NOT BETWEEN 12 AND 14 THEN n || ' pozycje do zgody'
              ELSE n || ' pozycji do zgody' END
  FROM (SELECT coalesce(jsonb_array_length(p_items), 0) AS n) s;
$$;

-- Sprzedawca (portal): prośba o zgodę na cenę. Kreator wywołuje ją po każdym zapisie — gdy zgoda nie jest potrzebna
-- albo prośba o te same ceny już czeka, nic nie wysyła. Nowe ceny zastępują starą prośbę.
CREATE OR REPLACE FUNCTION public.request_seller_offer_price_approval(p_offer uuid, p_note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE o public.offers%ROWTYPE; r public.seller_offer_price_requests%ROWTYPE; v_key text; v_items jsonb; v_title text;
  v_note text := left(btrim(coalesce(p_note, '')), 1000);
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.current_session_is_seller_portal(), false) THEN
    RAISE EXCEPTION 'Prośbę o zgodę na cenę wysyła sprzedawca z portalu.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.offers WHERE id = p_offer AND sales_channel = 'seller_portal'
    AND sales_partner_id = public.current_sales_partner_id() FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t
      WHERE t.sales_partner_id = o.sales_partner_id AND t.my_company_id = o.my_company_id AND t.is_active) THEN
    RAISE EXCEPTION 'Brak dostępu do tej oferty i marki.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(o.partner_approval_status, 'not_required') <> 'required' THEN
    RETURN jsonb_build_object('status', coalesce(o.partner_approval_status, 'not_required'), 'created', false);
  END IF;
  IF o.status::text NOT IN ('draft', 'sent', 'viewed') THEN RAISE EXCEPTION 'Ta oferta nie jest już na etapie przygotowania.'; END IF;
  v_key := private.seller_offer_price_key(o.id);
  SELECT * INTO r FROM public.seller_offer_price_requests WHERE offer_id = o.id AND status = 'pending' FOR UPDATE;
  IF FOUND AND r.approval_key = v_key THEN
    IF v_note <> '' AND v_note IS DISTINCT FROM r.note THEN UPDATE public.seller_offer_price_requests SET note = v_note WHERE id = r.id; END IF;
    RETURN jsonb_build_object('status', 'required', 'request_id', r.id, 'request_status', 'pending', 'created', false);
  END IF;
  IF FOUND THEN UPDATE public.seller_offer_price_requests SET status = 'superseded', decided_at = now() WHERE id = r.id; END IF;
  v_items := private.seller_offer_price_items(o.id);
  INSERT INTO public.seller_offer_price_requests (offer_id, sales_partner_id, approval_key, items, note, requested_by)
  VALUES (o.id, o.sales_partner_id, v_key, v_items, v_note, auth.uid()) RETURNING * INTO r;
  INSERT INTO public.partner_offer_activities (offer_id, sales_partner_id, activity_type, metadata)
  VALUES (o.id, o.sales_partner_id, 'price_approval_requested', jsonb_build_object('request_id', r.id, 'items', jsonb_array_length(v_items)));
  v_title := coalesce(nullif(btrim(o.title), ''), o.offer_number, 'Oferta');
  PERFORM private.notify_seller_staff(o.sales_partner_id, o.my_company_id, false, 'Prośba o zgodę na cenę',
    private.seller_display_name(o.sales_partner_id) || ' · ' || v_title || ' · ' || private.seller_price_items_label(v_items),
    '/crm/offers/' || o.id || '#seller-price-approval', 'seller_offer', 'offer', o.id,
    jsonb_build_object('offer_id', o.id, 'event', 'price_approval_requested', 'price_request_id', r.id));
  RETURN jsonb_build_object('status', 'required', 'request_id', r.id, 'request_status', 'pending', 'created', true);
END $$;

-- Opiekun (CRM): zgoda na ceny albo prośba o zmianę. Decyzja dotyczy cen, które opiekun widział (p_expected_key).
CREATE OR REPLACE FUNCTION public.decide_seller_offer_price_approval(p_offer uuid, p_decision text, p_note text DEFAULT '', p_expected_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE o public.offers%ROWTYPE; r public.seller_offer_price_requests%ROWTYPE; v_key text; v_items jsonb; v_title text;
  v_employee uuid := public.current_employee_id(); v_note text := left(btrim(coalesce(p_note, '')), 2000);
BEGIN
  IF NOT public.seller_offer_can_manage(p_offer) THEN RAISE EXCEPTION 'Brak uprawnień do zgody na cenę tej oferty.' USING ERRCODE = '42501'; END IF;
  IF p_decision NOT IN ('approved', 'changes_requested') THEN RAISE EXCEPTION 'Nieprawidłowa decyzja.'; END IF;
  IF p_decision = 'changes_requested' AND length(v_note) < 3 THEN RAISE EXCEPTION 'Napisz sprzedawcy, którą cenę lub pozycję trzeba zmienić.'; END IF;
  SELECT * INTO o FROM public.offers WHERE id = p_offer AND sales_channel = 'seller_portal' FOR UPDATE;
  IF coalesce(o.partner_approval_status, 'not_required') <> 'required' THEN
    RAISE EXCEPTION 'Ta oferta nie czeka już na zgodę na cenę (ktoś ją zatwierdził albo sprzedawca zmienił pozycje). Odśwież widok.';
  END IF;
  IF o.status::text NOT IN ('draft', 'sent', 'viewed') THEN RAISE EXCEPTION 'Oferta nie jest już na etapie przygotowania.'; END IF;
  v_key := private.seller_offer_price_key(o.id);
  IF p_expected_key IS NULL OR p_expected_key IS DISTINCT FROM v_key THEN
    RAISE EXCEPTION 'Sprzedawca zmienił ceny lub pozycje. Odśwież widok i sprawdź aktualne ceny.';
  END IF;
  v_items := private.seller_offer_price_items(o.id);
  SELECT * INTO r FROM public.seller_offer_price_requests WHERE offer_id = o.id AND status = 'pending' FOR UPDATE;
  IF FOUND THEN
    UPDATE public.seller_offer_price_requests SET status = p_decision, approval_key = v_key, items = v_items, response_note = v_note,
           decided_by = v_employee, decided_at = now() WHERE id = r.id RETURNING * INTO r;
  ELSE
    INSERT INTO public.seller_offer_price_requests (offer_id, sales_partner_id, approval_key, items, status, response_note, decided_by, decided_at)
    VALUES (o.id, o.sales_partner_id, v_key, v_items, p_decision, v_note, v_employee, now()) RETURNING * INTO r;
  END IF;
  IF p_decision = 'approved' THEN
    UPDATE public.offers SET partner_approval_status = 'approved', partner_approved_by = v_employee, partner_approved_at = now(),
           partner_last_activity_at = now() WHERE id = o.id;
  END IF;
  INSERT INTO public.partner_offer_activities (offer_id, sales_partner_id, activity_type, metadata)
  VALUES (o.id, o.sales_partner_id, CASE WHEN p_decision = 'approved' THEN 'price_approved' ELSE 'price_changes_requested' END,
          jsonb_build_object('request_id', r.id, 'note', v_note));
  v_title := coalesce(nullif(btrim(o.title), ''), o.offer_number, 'Oferta');
  PERFORM private.notify_seller_portal(o.sales_partner_id, o.my_company_id,
    CASE WHEN p_decision = 'approved' THEN 'Cena zatwierdzona' ELSE 'Opiekun prosi o zmianę ceny' END,
    CASE WHEN p_decision = 'approved' THEN v_title || ' — możesz pobrać PDF i przekazać ofertę klientowi.'
         ELSE v_title || ' — ' || v_note END,
    '/seller/offers/' || o.id, 'seller_offer', 'offer', o.id,
    jsonb_build_object('offer_id', o.id, 'event', 'price_' || p_decision, 'price_request_id', r.id));
  RETURN jsonb_build_object('status', CASE WHEN p_decision = 'approved' THEN 'approved' ELSE 'required' END,
                            'request_id', r.id, 'request_status', r.status);
END $$;

-- Stan zgody na cenę: sprzedawca (własna oferta) i opiekun / zastępca / administrator.
CREATE OR REPLACE FUNCTION public.get_seller_offer_price_approval(p_offer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE o public.offers%ROWTYPE; r public.seller_offer_price_requests%ROWTYPE; v_key text; v_seller boolean;
BEGIN
  SELECT * INTO o FROM public.offers WHERE id = p_offer AND sales_channel = 'seller_portal';
  IF NOT FOUND THEN RAISE EXCEPTION 'Brak dostępu do tej oferty.' USING ERRCODE = '42501'; END IF;
  v_seller := o.sales_partner_id = public.current_sales_partner_id() AND EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t
    WHERE t.sales_partner_id = o.sales_partner_id AND t.my_company_id = o.my_company_id AND t.is_active);
  IF NOT coalesce(v_seller, false) AND NOT public.seller_partner_is_mine(o.sales_partner_id) THEN
    RAISE EXCEPTION 'Brak dostępu do tej oferty.' USING ERRCODE = '42501';
  END IF;
  v_key := private.seller_offer_price_key(o.id);
  SELECT * INTO r FROM public.seller_offer_price_requests WHERE offer_id = o.id ORDER BY requested_at DESC, id LIMIT 1;
  RETURN jsonb_build_object(
    'status', coalesce(o.partner_approval_status, 'not_required'),
    'price_key', v_key,
    'can_decide', public.seller_offer_can_manage(o.id) AND coalesce(o.partner_approval_status, '') = 'required' AND o.status::text IN ('draft', 'sent', 'viewed'),
    'items', private.seller_offer_price_items(o.id),
    'request', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', r.id, 'status', r.status, 'note', r.note, 'requested_at', r.requested_at, 'response_note', r.response_note,
      'decided_at', r.decided_at, 'current', r.approval_key IS NOT DISTINCT FROM v_key,
      'decided_by_name', (SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') FROM public.employees e WHERE e.id = r.decided_by)) END);
END $$;

-- Kokpit opiekuna (CRM i aplikacja mobilna): prośby o zgodę na cenę czekające na decyzję.
-- p_manager — filtr administratora w kokpicie (sprzedawcy, których opiekunem lub zastępcą jest wskazany pracownik).
CREATE OR REPLACE FUNCTION public.get_my_seller_price_requests(p_manager uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'request_id', r.id, 'offer_id', o.id, 'offer_title', coalesce(nullif(btrim(o.title), ''), o.offer_number, 'Oferta'),
      'offer_number', o.offer_number, 'sales_partner_id', o.sales_partner_id, 'seller_name', private.seller_display_name(o.sales_partner_id),
      'requested_at', r.requested_at, 'items', jsonb_array_length(r.items), 'note', r.note)
    ORDER BY r.requested_at), '[]'::jsonb)
  FROM public.seller_offer_price_requests r JOIN public.offers o ON o.id = r.offer_id
  WHERE r.status = 'pending' AND o.partner_approval_status = 'required' AND public.current_employee_id() IS NOT NULL
    AND public.seller_offer_can_manage(o.id)
    AND (p_manager IS NULL OR EXISTS (SELECT 1 FROM public.sales_partner_profiles sp
          WHERE sp.id = o.sales_partner_id AND (sp.manager_id = p_manager OR sp.backup_manager_id = p_manager)));
$$;

REVOKE ALL ON FUNCTION private.seller_offer_price_items(uuid), private.seller_offer_price_key(uuid), private.keep_seller_price_approval(),
  private.seller_price_items_label(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_seller_offer_price_approval(uuid, text), public.decide_seller_offer_price_approval(uuid, text, text, text),
  public.get_seller_offer_price_approval(uuid), public.get_my_seller_price_requests(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_seller_offer_price_approval(uuid, text), public.decide_seller_offer_price_approval(uuid, text, text, text),
  public.get_seller_offer_price_approval(uuid), public.get_my_seller_price_requests(uuid) TO authenticated;

-- Link dla klienta: komunikaty po nowemu (logika bez zmian — link działa po zgodzie na cenę).
CREATE OR REPLACE FUNCTION public.create_seller_offer_share_link(p_offer uuid, p_rotate boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE l public.seller_offer_share_links%ROWTYPE; v_token text;
BEGIN
  IF NOT private.seller_offer_share_access(p_offer) THEN RAISE EXCEPTION 'Brak dostępu do tej oferty.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.offers WHERE id = p_offer FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.offer_items i WHERE i.offer_id = p_offer) THEN
    RAISE EXCEPTION 'Dodaj do oferty usługi, zanim udostępnisz ją klientowi.';
  END IF;
  IF NOT (SELECT private.seller_offer_guest_ready(o) FROM public.offers o WHERE o.id = p_offer) THEN
    RAISE EXCEPTION 'Link dla klienta będzie dostępny po zgodzie opiekuna na cenę.';
  END IF;
  SELECT * INTO l FROM public.seller_offer_share_links WHERE offer_id = p_offer AND revoked_at IS NULL;
  IF FOUND AND NOT coalesce(p_rotate, false) THEN
    RETURN jsonb_build_object('token', l.token, 'path', '/oferta/' || l.token, 'created_at', l.created_at);
  END IF;
  UPDATE public.seller_offer_share_links SET revoked_at = now() WHERE offer_id = p_offer AND revoked_at IS NULL;
  v_token := encode(extensions.gen_random_bytes(18), 'hex');
  INSERT INTO public.seller_offer_share_links (offer_id, token, created_by) VALUES (p_offer, v_token, auth.uid()) RETURNING * INTO l;
  RETURN jsonb_build_object('token', l.token, 'path', '/oferta/' || l.token, 'created_at', l.created_at);
END $function$;

-- Lista ofert w portalu: etap zgody na cenę obok decyzji opiekuna.
CREATE OR REPLACE FUNCTION public.get_seller_offer_delivery_states(p_offers uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE partner uuid := public.current_sales_partner_id(); result jsonb;
BEGIN
  IF auth.uid() IS NULL OR partner IS NULL OR COALESCE(cardinality(p_offers), 0) > 200 THEN
    RAISE EXCEPTION 'Brak dostępu lub nieprawidłowe parametry listy ofert.';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'offer_id', o.id,
    'is_realization', o.status::text = 'accepted' OR COALESCE(e.status::text, '') IN ('offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress', 'completed', 'invoiced', 'settled', 'cancelled'),
    'review_status', CASE WHEN r.source_key = public.seller_offer_source_key(o.id) THEN r.status ELSE NULL END,
    'client_confirmed', EXISTS (SELECT 1 FROM public.seller_offer_client_acceptances a
      WHERE a.offer_id = o.id AND a.source_key = r.source_key AND a.document_id = r.document_id)
      AND r.source_key = public.seller_offer_source_key(o.id),
    'approval_status', COALESCE(o.partner_approval_status, 'not_required'),
    'price_request', (SELECT pr.status FROM public.seller_offer_price_requests pr
      WHERE pr.offer_id = o.id AND pr.status <> 'superseded' ORDER BY pr.requested_at DESC LIMIT 1)
  )), '[]'::jsonb) INTO result
  FROM public.offers o
  JOIN public.sales_partner_brand_terms t ON t.sales_partner_id = o.sales_partner_id AND t.my_company_id = o.my_company_id AND t.is_active
  LEFT JOIN public.seller_offer_reviews r ON r.offer_id = o.id
  LEFT JOIN public.events e ON e.id = o.event_id AND e.my_company_id = o.my_company_id
  WHERE o.id = ANY(p_offers) AND o.sales_partner_id = partner AND o.sales_channel = 'seller_portal';
  RETURN result;
END;
$function$;

-- ── Akceptacja online klienta → ocena opiekuna ──────────────────────────────────────────────────────────────

-- Jak request_seller_offer_review, ale bez sesji sprzedawcy (wywołuje ją akceptacja z publicznego linku).
-- Zapisuje też zgodę klienta przy tej wersji PDF (konto sprzedawcy jako właściciel oferty, opis „Akceptacja online klienta”).
CREATE OR REPLACE FUNCTION private.request_seller_offer_review_after_client_acceptance(p_offer uuid, p_document uuid, p_note text, p_client_name text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE o public.offers%ROWTYPE; v_key text; v_user uuid; v_count integer;
BEGIN
  SELECT * INTO o FROM public.offers WHERE id = p_offer AND sales_channel = 'seller_portal' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono oferty.'; END IF;
  IF o.status::text NOT IN ('draft', 'sent', 'viewed') OR EXISTS (SELECT 1 FROM public.events
      WHERE id = o.event_id AND status::text IN ('offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress', 'completed', 'invoiced', 'settled', 'cancelled')) THEN
    RAISE EXCEPTION 'Oferta nie jest na etapie przekazania do oceny.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t
      WHERE t.sales_partner_id = o.sales_partner_id AND t.my_company_id = o.my_company_id AND t.is_active) THEN
    RAISE EXCEPTION 'Dostęp sprzedawcy do marki nie jest aktywny.';
  END IF;
  v_key := public.seller_offer_source_key(o.id);
  IF NOT EXISTS (SELECT 1 FROM public.seller_offer_documents WHERE id = p_document AND offer_id = o.id AND source_key = v_key) THEN
    RAISE EXCEPTION 'Klient zaakceptował starszą wersję PDF.';
  END IF;
  IF o.event_date IS NULL THEN RAISE EXCEPTION 'Oferta nie ma terminu wydarzenia.'; END IF;
  IF EXISTS (SELECT 1 FROM public.seller_offer_reviews WHERE offer_id = o.id AND source_key = v_key AND status IN ('pending', 'approved')) THEN
    RAISE EXCEPTION 'Ta wersja oferty jest już u opiekuna.';
  END IF;
  SELECT p.portal_auth_user_id INTO v_user FROM public.sales_partner_profiles p WHERE p.id = o.sales_partner_id;
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sprzedawca nie ma konta w portalu.'; END IF;
  INSERT INTO public.seller_offer_reviews (offer_id, document_id, source_key, status, request_note)
  VALUES (o.id, p_document, v_key, 'pending', left(coalesce(p_note, ''), 5000))
  ON CONFLICT (offer_id) DO UPDATE SET document_id = EXCLUDED.document_id, source_key = EXCLUDED.source_key, status = 'pending',
    request_note = EXCLUDED.request_note, response_note = '', date_checked = false, resources_checked = false, capacity_checked = false,
    discount_percent = 0, discount_reason = '', reviewed_by = NULL, requested_at = now(), reviewed_at = NULL;
  INSERT INTO public.partner_offer_activities (offer_id, sales_partner_id, activity_type, metadata)
  VALUES (o.id, o.sales_partner_id, 'submitted_for_review',
          jsonb_build_object('document_id', p_document, 'note', left(coalesce(p_note, ''), 5000), 'source', 'client_online'));
  -- Bez odbiorcy powiadomienia zgłasza błąd — wtedy akceptacja zostaje, a sprzedawca wysyła ofertę sam.
  PERFORM public.notify_seller_offer_workflow(o.id, p_document, true);
  v_count := greatest(coalesce(cardinality(public.seller_offer_notification_recipients(o.id, true)), 0), 1);
  INSERT INTO public.seller_offer_client_acceptances (id, offer_id, document_id, source_key, confirmed_by, seller_name, notified_recipients)
  VALUES (gen_random_uuid(), o.id, p_document, v_key, v_user, left('Akceptacja online klienta: ' || coalesce(nullif(btrim(p_client_name), ''), 'klient'), 200), v_count);
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION private.request_seller_offer_review_after_client_acceptance(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_shared_seller_offer(p_token text, p_name text, p_email text, p_note text, p_consent boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE l public.seller_offer_share_links%ROWTYPE; o public.offers%ROWTYPE; v_name text := nullif(btrim(p_name), '');
  v_email text := lower(nullif(btrim(p_email), '')); v_title text; v_shared jsonb; v_document uuid;
  v_forwarded boolean := false; v_reason text := ''; v_review_note text;
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
  SELECT d.id INTO v_document FROM public.seller_offer_documents d WHERE d.offer_id = o.id ORDER BY d.created_at DESC LIMIT 1;
  UPDATE public.seller_offer_share_links SET accepted_at = now(), accepted_name = v_name, accepted_email = v_email,
         accepted_note = nullif(btrim(p_note), ''),
         accepted_snapshot = jsonb_build_object('offer', v_shared->'offer', 'items', v_shared->'items', 'totals', v_shared->'totals',
           'document', (SELECT jsonb_build_object('id', d.id, 'filename', d.filename, 'created_at', d.created_at)
                          FROM public.seller_offer_documents d WHERE d.id = v_document))
   WHERE id = l.id RETURNING * INTO l;
  INSERT INTO public.partner_offer_activities (offer_id, sales_partner_id, activity_type, metadata)
  VALUES (o.id, o.sales_partner_id, 'guest_accepted', jsonb_build_object('share_link_id', l.id, 'name', v_name, 'email', v_email));
  v_title := coalesce(nullif(btrim(o.title), ''), o.offer_number, 'Oferta');

  -- Akceptacja klienta sama przekazuje aktualną wersję do oceny opiekuna. Błąd nie cofa akceptacji.
  IF v_document IS NULL THEN
    v_reason := 'Oferta nie ma jeszcze PDF.';
  ELSE
    v_review_note := concat_ws(E'\n',
      'Klient zaakceptował ofertę online — przekazano automatycznie.',
      'Akceptacja: ' || v_name || ' · ' || v_email || ' · ' || to_char(now() AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'),
      CASE WHEN nullif(btrim(p_note), '') IS NOT NULL THEN 'Uwagi klienta: ' || left(btrim(p_note), 1000) END,
      'Oferta: ' || v_title,
      'Sprzedawca: ' || private.seller_display_name(o.sales_partner_id),
      CASE WHEN concat_ws(' · ', nullif(btrim(o.portal_client_company), ''), nullif(btrim(o.portal_client_name), '')) <> ''
           THEN 'Klient: ' || concat_ws(' · ', nullif(btrim(o.portal_client_company), ''), nullif(btrim(o.portal_client_name), '')) END,
      CASE WHEN o.event_date IS NOT NULL THEN 'Termin: ' || to_char(o.event_date AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY') END,
      CASE WHEN nullif(btrim(o.event_location), '') IS NOT NULL THEN 'Miejsce: ' || btrim(o.event_location) END,
      'Zakres oferty:',
      (SELECT string_agg('• ' || i.name || ' — ' || i.quantity::text || ' ' || coalesce(nullif(i.unit, ''), 'szt.')
                         || CASE WHEN coalesce(i.days, 1) > 1 THEN ' × ' || i.days || ' dni' ELSE '' END, E'\n' ORDER BY i.display_order, i.id)
         FROM public.offer_items i WHERE i.offer_id = o.id),
      'Montaż, demontaż i szczegóły organizacyjne ustalimy na etapie przygotowania realizacji.');
    BEGIN
      PERFORM private.request_seller_offer_review_after_client_acceptance(o.id, v_document, v_review_note, v_name);
      v_forwarded := true;
    EXCEPTION WHEN OTHERS THEN
      v_reason := SQLERRM;
    END;
  END IF;

  IF v_forwarded THEN
    PERFORM private.notify_seller_portal(o.sales_partner_id, o.my_company_id, 'Klient zaakceptował ofertę — jest u opiekuna',
      v_title || ' — ' || v_name || '. Oferta trafiła do opiekuna do oceny. Teraz nic nie musisz robić.', '/seller/offers/' || o.id,
      'seller_guest', 'offer', o.id, jsonb_build_object('offer_id', o.id, 'event', 'guest_accepted', 'forwarded', true));
  ELSE
    PERFORM private.notify_seller_portal(o.sales_partner_id, o.my_company_id, 'Klient zaakceptował ofertę online',
      v_title || ' — ' || v_name || '. Wyślij ofertę do opiekuna.' || CASE WHEN v_reason <> '' THEN ' (' || left(v_reason, 160) || ')' ELSE '' END,
      '/seller/offers/' || o.id, 'seller_guest', 'offer', o.id, jsonb_build_object('offer_id', o.id, 'event', 'guest_accepted', 'forwarded', false));
    PERFORM private.notify_seller_staff(o.sales_partner_id, o.my_company_id, false, 'Klient zaakceptował ofertę sprzedawcy',
      private.seller_display_name(o.sales_partner_id) || ' · ' || v_title || ' · ' || v_name || ' — czeka na wysłanie przez sprzedawcę',
      '/crm/offers/' || o.id, 'seller_guest', 'offer', o.id, jsonb_build_object('offer_id', o.id, 'event', 'guest_accepted', 'forwarded', false));
  END IF;
  RETURN jsonb_build_object('ok', true, 'accepted_at', l.accepted_at, 'forwarded', v_forwarded);
END $function$;

-- ── Słowo „klient” w tekstach z bazy ────────────────────────────────────────────────────────────────────────
-- Podmiana samych tekstów w aktualnych definicjach (logika bez zmian). Ponowne uruchomienie niczego nie zmienia.
DO $do$
DECLARE r record; v_def text; v_new text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('get_shared_seller_offer', 'submit_public_seller_inquiry', 'convert_seller_inquiry') LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, 'Gość otworzył ofertę', 'Klient otworzył ofertę');
    v_new := replace(v_new, ' — gość właśnie ją ogląda.', ' — klient właśnie ją ogląda.');
    v_new := replace(v_new, 'Gość zostawił zapytanie', 'Gość hotelu zostawił zapytanie');
    v_new := replace(v_new, '''Gość: ''', '''Klient: ''');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
END $do$;
