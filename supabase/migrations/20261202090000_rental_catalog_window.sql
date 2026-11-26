-- Rental → „Wypożyczenia klientom”: katalog magazynu z dostępnością w terminie i zajęcie sprzętu od wyjazdu do powrotu
-- ===============================================================================================================
-- Można uruchomić ponownie. Opis: docs/rental.md (sekcje „Stan magazynu” i „Katalog magazynu”).
--
-- Okno zajęcia magazynu (decyzja właściciela 26.11.2026: „wyłączenie z magazynu od momentu odbioru wysyłki, aż do
-- potencjalnego pojawienia się na magazynie”):
--   od   — najwcześniejsze z: termin wydania, faktyczne wydanie (protokół wcześniej niż termin), wyjazd dostawy (`rental_trips`);
--   do   — późniejsze z: planowany zwrot, koniec przejazdu odbioru od klienta (sprzęt wraca na magazyn z odbiorem);
--          sprzęt u klienta po tym czasie — bez końca, aż wróci (jak dotąd); uszkodzenia i braki — aż magazyn rozstrzygnie.
--   Okno liczą `private.rental_demand` (eventy i oferty widzą wypożyczenia w tym oknie) i `private.rental_block` (sprawdzanie
--   samego wypożyczenia: rezerwacja, zmiana terminu, pozycji i przejazdów).
--
-- Dostępność w oknie = stan sprawny − największa liczba sztuk zajętych naraz przez eventy i inne wypożyczenia (szczyt
-- jednoczesnej zajętości, a nie suma wszystkich rezerwacji z okna: sztuki wracające z jednego eventu mogą jechać na kolejny,
-- a wypożyczenie potrzebuje ich przez cały czas — wystarczy, że naraz nigdy nie zabraknie).
--
-- rental_catalog(od, do, wypożyczenie) — katalog magazynu do wyboru pozycji (CRM, Mac, telefon): kategorie, sprzęt i zestawy
--   z liczbą wolnych sztuk w oknie (bez pozycji wskazanego wypożyczenia), okno zajęcia; cena za dobę — tylko sprzedaż.
-- rental_set_trips — przy zarezerwowanym / wydanym wypożyczeniu zmiana godzin dostawy lub odbioru sprawdza dostępność sprzętu.

BEGIN;

-- ─── Okno zajęcia magazynu ───────────────────────────────────────────────────────────────────────────────────────────────

-- Okno jednego wypożyczenia (p_start / p_end — inny termin wydania / zwrotu do sprawdzenia przed zapisem). To samo wyrażenie
-- co w `private.rental_demand`; wydane po terminie zwrotu — co najmniej do teraz (jeszcze nie wróciło).
CREATE OR REPLACE FUNCTION private.rental_block(p_rental uuid, p_start timestamptz DEFAULT NULL, p_end timestamptz DEFAULT NULL)
RETURNS TABLE(starts_at timestamptz, ends_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT least(coalesce(p_start, o.starts_at), o.issued_at, d.starts_at),
         greatest(coalesce(p_end, o.ends_at), c.ends_at, CASE WHEN o.status = 'issued' THEN now() END)
    FROM public.rental_orders o
    LEFT JOIN public.rental_trips d ON d.rental_id = o.id AND d.kind = 'delivery'
    LEFT JOIN public.rental_trips c ON c.rental_id = o.id AND c.kind = 'collection'
   WHERE o.id = p_rental;
$$;

-- Zapotrzebowanie wypożyczeń na sprzęt: planned — zarezerwowane niewydane (w oknie), out — u klienta (do końca okna, po nim bez
-- końca), issues — nierozstrzygnięte uszkodzenia i braki (bez końca). `starts_at` — początek okna, `until` = infinity — do odwołania.
CREATE OR REPLACE VIEW private.rental_demand AS
SELECT o.id AS rental_id, i.id AS item_id, i.equipment_id, x.part, x.qty, least(o.starts_at, o.issued_at, d.starts_at) AS starts_at, x.until
  FROM public.rental_orders o
  LEFT JOIN public.rental_trips d ON d.rental_id = o.id AND d.kind = 'delivery'
  LEFT JOIN public.rental_trips c ON c.rental_id = o.id AND c.kind = 'collection'
  CROSS JOIN LATERAL (SELECT greatest(o.ends_at, c.ends_at) AS back_at) b
  JOIN public.rental_order_items i ON i.rental_id = o.id AND i.kind = 'equipment'
  CROSS JOIN LATERAL (VALUES
    ('planned'::text, CASE WHEN o.status IN ('reserved', 'issued') THEN i.quantity - i.issued_qty ELSE 0 END, b.back_at),
    ('out', CASE WHEN o.status IN ('issued', 'returned', 'settled')
        THEN i.issued_qty - i.returned_ok_qty - i.returned_damaged_qty - i.returned_missing_qty ELSE 0 END,
      CASE WHEN b.back_at > now() THEN b.back_at ELSE 'infinity'::timestamptz END),
    ('issues', CASE WHEN o.status IN ('issued', 'returned', 'settled')
        THEN (i.returned_damaged_qty - i.damaged_back_qty - i.damaged_out_qty) + (i.returned_missing_qty - i.missing_back_qty - i.missing_out_qty)
        ELSE 0 END,
      'infinity'::timestamptz)
  ) AS x(part, qty, until)
 WHERE o.status IN ('reserved', 'issued', 'returned', 'settled') AND x.qty > 0;

-- ─── Zajętość i dostępność ───────────────────────────────────────────────────────────────────────────────────────────────

-- Przedziały zajętości sprzętu w oknie: rezerwacje eventów (jak `validate_event_kit_inventory`: eventy nieanulowane, bez
-- wynajmu zewnętrznego i pozycji usuniętych z oferty; zestawy rozpisane na składniki) i wypożyczeń (bez wskazanego).
CREATE OR REPLACE FUNCTION private.rental_busy(p_start timestamptz, p_end timestamptz, p_exclude_rental uuid)
RETURNS TABLE(equipment_id uuid, source text, ref_id uuid, starts_at timestamptz, ends_at timestamptz, qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH active AS (
    SELECT r.event_id, r.equipment_id, r.kit_id, r.quantity, e.event_date AS ev_start,
           coalesce(e.event_end_date, e.event_date + interval '1 day') AS ev_end
      FROM public.event_equipment r JOIN public.events e ON e.id = r.event_id
     WHERE NOT coalesce(r.use_external_rental, false) AND NOT coalesce(r.removed_from_offer, false)
       AND coalesce(r.status::text, 'reserved') IN ('reserved', 'in_use') AND coalesce(e.status::text, '') <> 'cancelled'
       AND e.event_date < p_end AND coalesce(e.event_end_date, e.event_date + interval '1 day') > p_start
  )
  SELECT a.equipment_id, 'event'::text, a.event_id, a.ev_start, a.ev_end, a.quantity::numeric FROM active a WHERE a.equipment_id IS NOT NULL
  UNION ALL
  SELECT i.equipment_id, 'event', a.event_id, a.ev_start, a.ev_end, a.quantity::numeric * i.quantity
    FROM active a JOIN public.equipment_kit_items i ON i.kit_id = a.kit_id WHERE i.equipment_id IS NOT NULL
  UNION ALL
  SELECT d.equipment_id, 'rental', d.rental_id, d.starts_at, d.until, d.qty::numeric
    FROM private.rental_demand d
   WHERE d.starts_at < p_end AND d.until > p_start AND d.rental_id IS DISTINCT FROM p_exclude_rental;
$$;

-- Szczyt jednoczesnej zajętości sprzętu w oknie (ile sztuk naraz zajmują eventy i inne wypożyczenia). Zajętość rośnie tylko
-- na początkach przedziałów, więc wystarczy policzyć ją w tych chwilach (przyciętych do okna).
CREATE OR REPLACE FUNCTION private.rental_peaks(p_start timestamptz, p_end timestamptz, p_exclude_rental uuid, p_equipment uuid[] DEFAULT NULL)
RETURNS TABLE(equipment_id uuid, peak integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH busy AS (
    SELECT b.equipment_id, b.starts_at, b.ends_at, b.qty FROM private.rental_busy(p_start, p_end, p_exclude_rental) b
     WHERE p_equipment IS NULL OR b.equipment_id = ANY (p_equipment)
  )
  SELECT p.equipment_id, max(c.q)::integer
    FROM (SELECT DISTINCT b.equipment_id, greatest(b.starts_at, p_start) AS at FROM busy b) p
    CROSS JOIN LATERAL (SELECT sum(x.qty) AS q FROM busy x
                         WHERE x.equipment_id = p.equipment_id AND x.starts_at <= p.at AND x.ends_at > p.at) c
   GROUP BY p.equipment_id;
$$;

-- Dostępność sprzętu na wypożyczenie w oknie: stan sprawny, szczyt zajętości (busy), rezerwacje eventów i innych wypożyczeń
-- z okna (events / rentals — sumy do opisu), konflikty. p_items: [{equipment_id, quantity}]. Nazwy eventów — tylko widoczne
-- dla osoby; klient innego wypożyczenia — tylko sprzedaży.
CREATE OR REPLACE FUNCTION private.rental_availability_json(p_start timestamptz, p_end timestamptz, p_items jsonb, p_exclude_rental uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH req AS (
    SELECT (x->>'equipment_id')::uuid AS equipment_id, sum(greatest(coalesce((x->>'quantity')::integer, 0), 0))::integer AS qty
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END) x
     WHERE coalesce(x->>'equipment_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     GROUP BY 1
  ),
  busy AS (SELECT b.* FROM private.rental_busy(p_start, p_end, p_exclude_rental) b JOIN req ON req.equipment_id = b.equipment_id),
  peak AS (SELECT p.* FROM private.rental_peaks(p_start, p_end, p_exclude_rental,
                                 coalesce((SELECT array_agg(req.equipment_id) FROM req), '{}'::uuid[])) p),
  ev_list AS (
    SELECT d.equipment_id, sum(d.qty)::integer AS qty,
           jsonb_agg(jsonb_build_object('type', 'event', 'id', d.ref_id,
             'name', CASE WHEN public.current_employee_can_view_event(d.ref_id) THEN e.name ELSE 'Inny event' END,
             'starts_at', d.starts_at, 'ends_at', d.ends_at, 'qty', d.qty) ORDER BY d.starts_at) AS list
      FROM (SELECT b.equipment_id, b.ref_id, min(b.starts_at) AS starts_at, max(b.ends_at) AS ends_at, sum(b.qty)::integer AS qty
              FROM busy b WHERE b.source = 'event' GROUP BY 1, 2) d
      JOIN public.events e ON e.id = d.ref_id
     GROUP BY d.equipment_id
  ),
  rd_list AS (
    SELECT d.equipment_id, sum(d.qty)::integer AS qty,
           jsonb_agg(jsonb_build_object('type', 'rental', 'id', o.id,
             'name', o.number || CASE WHEN public.rental_can(o.id, 'sales_view') THEN ' · ' || o.client_name ELSE '' END,
             'starts_at', d.starts_at, 'ends_at', CASE WHEN d.ends_at = 'infinity'::timestamptz THEN NULL ELSE d.ends_at END,
             'open_ended', d.ends_at = 'infinity'::timestamptz, 'qty', d.qty) ORDER BY d.starts_at) AS list
      FROM (SELECT b.equipment_id, b.ref_id, min(b.starts_at) AS starts_at, max(b.ends_at) AS ends_at, sum(b.qty)::integer AS qty
              FROM busy b WHERE b.source = 'rental' GROUP BY 1, 2) d
      JOIN public.rental_orders o ON o.id = d.ref_id
     GROUP BY d.equipment_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'equipment_id', r.equipment_id, 'name', coalesce(it.name, 'Sprzęt'), 'required', r.qty, 'stock', s.stock,
      'events', coalesce(e.qty, 0), 'rentals', coalesce(x.qty, 0), 'busy', coalesce(p.peak, 0),
      'available', greatest(s.stock - coalesce(p.peak, 0), 0),
      'shortage', greatest(r.qty - greatest(s.stock - coalesce(p.peak, 0), 0), 0),
      'conflicts', coalesce(e.list, '[]'::jsonb) || coalesce(x.list, '[]'::jsonb)) ORDER BY it.name), '[]'::jsonb)
    FROM req r
    LEFT JOIN public.equipment_items it ON it.id = r.equipment_id
    CROSS JOIN LATERAL (SELECT public.kit_component_usable_stock(r.equipment_id, NULL)::integer AS stock) s
    LEFT JOIN peak p ON p.equipment_id = r.equipment_id
    LEFT JOIN ev_list e ON e.equipment_id = r.equipment_id
    LEFT JOIN rd_list x ON x.equipment_id = r.equipment_id;
$$;

-- Dostępność do sprawdzenia przed zapisem. Z wypożyczeniem (p_exclude_rental) — w jego oknie (z wcześniejszym wydaniem,
-- dostawą i odbiorem), bez jego własnych pozycji.
CREATE OR REPLACE FUNCTION public.rental_check_availability(p_start timestamptz, p_end timestamptz, p_items jsonb, p_exclude_rental uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_start timestamptz; v_end timestamptz;
BEGIN
  PERFORM private.require_crm_employee();
  IF NOT public.rental_can(NULL, 'view') AND NOT public.rental_can(NULL, 'create') THEN
    RAISE EXCEPTION 'Nie masz dostępu do wypożyczeń.' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'Podaj termin wydania i zwrotu (zwrot po wydaniu).' USING ERRCODE = '22023';
  END IF;
  IF p_exclude_rental IS NOT NULL AND public.rental_can(p_exclude_rental, 'view') THEN
    SELECT b.starts_at, b.ends_at INTO v_start, v_end FROM private.rental_block(p_exclude_rental, p_start, p_end) b;
  END IF;
  RETURN private.rental_availability_json(coalesce(v_start, p_start), coalesce(v_end, p_end), p_items, p_exclude_rental);
END $$;

-- Braki sprzętu wypożyczenia w jego oknie (bez niego samego); pusty tekst — wszystko dostępne. Wypożyczenie potrzebuje tego,
-- co trzyma: niewydane, u klienta i nierozstrzygnięte rozbieżności (bez tego, co wróciło na stan albo zeszło ze stanu).
CREATE OR REPLACE FUNCTION private.rental_shortage_text(p_rental uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(string_agg(format('%s (potrzeba %s, dostępne %s)', a->>'name', a->>'required', a->>'available'), '; '
                             ORDER BY a->>'name'), '')
    FROM private.rental_block(p_rental) w
   CROSS JOIN LATERAL jsonb_array_elements(private.rental_availability_json(w.starts_at, w.ends_at,
     (SELECT coalesce(jsonb_agg(jsonb_build_object('equipment_id', i.equipment_id, 'quantity', h.qty)), '[]'::jsonb)
        FROM public.rental_order_items i
       CROSS JOIN LATERAL (SELECT i.quantity - i.returned_ok_qty - i.damaged_back_qty - i.damaged_out_qty
                                  - i.missing_back_qty - i.missing_out_qty AS qty) h
       WHERE i.rental_id = p_rental AND i.kind = 'equipment' AND h.qty > 0), p_rental)) a
   WHERE (a->>'shortage')::integer > 0;
$$;

-- Dostępność sprzętu wypożyczenia w jego oknie (bez niego samego) — ilości, które wypożyczenie trzyma (jak `rental_shortage_text`).
CREATE OR REPLACE FUNCTION public.rental_availability(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_start timestamptz; v_end timestamptz;
BEGIN
  PERFORM private.require_crm_employee();
  IF NOT EXISTS (SELECT 1 FROM public.rental_orders WHERE id = p_id) OR NOT public.rental_can(p_id, 'view') THEN
    RAISE EXCEPTION 'Nie masz dostępu do tego wypożyczenia.' USING ERRCODE = '42501';
  END IF;
  SELECT b.starts_at, b.ends_at INTO v_start, v_end FROM private.rental_block(p_id) b;
  RETURN private.rental_availability_json(v_start, v_end,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('equipment_id', i.equipment_id, 'quantity', i.quantity - i.returned_ok_qty
               - i.damaged_back_qty - i.damaged_out_qty - i.missing_back_qty - i.missing_out_qty)), '[]'::jsonb)
       FROM public.rental_order_items i WHERE i.rental_id = p_id AND i.kind = 'equipment'), p_id);
END $$;

-- ─── Katalog magazynu ────────────────────────────────────────────────────────────────────────────────────────────────────

-- Katalog do wyboru pozycji: kategorie, aktywny sprzęt (stan sprawny, szczyt zajętości, wolne sztuki w oknie) i zestawy (ile
-- kompletów da się złożyć z wolnych składników; przewody poza wypożyczeniami). Z wypożyczeniem — okno z jego wcześniejszym
-- wydaniem, dostawą i odbiorem, bez jego własnych pozycji (ile można mieć w tym wypożyczeniu łącznie). Cena za dobę — sprzedaż.
CREATE OR REPLACE FUNCTION public.rental_catalog(p_start timestamptz, p_end timestamptz, p_rental uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_start timestamptz; v_end timestamptz; v_prices boolean; v_result jsonb;
BEGIN
  PERFORM private.require_crm_employee();
  IF p_rental IS NULL THEN
    IF NOT public.rental_can(NULL, 'view') AND NOT public.rental_can(NULL, 'create') THEN
      RAISE EXCEPTION 'Nie masz dostępu do wypożyczeń.' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.rental_orders WHERE id = p_rental) OR NOT public.rental_can(p_rental, 'view') THEN
    RAISE EXCEPTION 'Nie masz dostępu do tego wypożyczenia.' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'Podaj termin wydania i zwrotu (zwrot po wydaniu).' USING ERRCODE = '22023';
  END IF;
  IF p_rental IS NOT NULL THEN
    SELECT b.starts_at, b.ends_at INTO v_start, v_end FROM private.rental_block(p_rental, p_start, p_end) b;
  END IF;
  v_start := coalesce(v_start, p_start);
  v_end := coalesce(v_end, p_end);
  IF v_end - v_start > interval '400 days' THEN
    RAISE EXCEPTION 'Katalog liczy dostępność dla okresu do 400 dni — skróć termin wypożyczenia.' USING ERRCODE = '22023';
  END IF;
  v_prices := public.rental_can(NULL, 'sales_view') OR (p_rental IS NOT NULL AND public.rental_can(p_rental, 'sales_view'));

  WITH eq AS (
    SELECT e.id, e.name, e.brand, e.model, e.warehouse_category_id, e.thumbnail_url, e.rental_price_per_day,
           public.kit_component_usable_stock(e.id, NULL)::integer AS stock
      FROM public.equipment_items e WHERE e.is_active AND e.deleted_at IS NULL
  ),
  peak AS (SELECT p.* FROM private.rental_peaks(v_start, v_end, p_rental) p),
  avail AS (
    SELECT eq.*, coalesce(p.peak, 0) AS busy, greatest(eq.stock - coalesce(p.peak, 0), 0) AS available
      FROM eq LEFT JOIN peak p ON p.equipment_id = eq.id
  ),
  items AS (
    SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'brand', f.brand, 'model', f.model,
             'category_id', f.warehouse_category_id, 'thumbnail_url', f.thumbnail_url,
             'price', CASE WHEN v_prices THEN f.rental_price_per_day END,
             'stock', f.stock, 'busy', f.busy, 'available', f.available) ORDER BY f.name) AS list
      FROM avail f
  ),
  kits AS (
    SELECT jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'category_id', k.warehouse_category_id,
             'thumbnail_url', k.thumbnail_url, 'available', c.available, 'components', c.components) ORDER BY k.name) AS list
      FROM public.equipment_kits k
      CROSS JOIN LATERAL (
        SELECT coalesce(min(floor(coalesce(f.available, 0)::numeric / ki.q)), 0)::integer AS available,
               jsonb_agg(jsonb_build_object('equipment_id', ki.equipment_id, 'quantity', ki.q, 'name', coalesce(it.name, 'Sprzęt'))
                 ORDER BY it.name) AS components
          FROM (SELECT x.equipment_id, sum(x.quantity)::integer AS q FROM public.equipment_kit_items x
                 WHERE x.kit_id = k.id AND x.equipment_id IS NOT NULL GROUP BY x.equipment_id) ki
          LEFT JOIN public.equipment_items it ON it.id = ki.equipment_id
          LEFT JOIN avail f ON f.id = ki.equipment_id
         WHERE ki.q > 0
      ) c
     WHERE k.is_active AND k.deleted_at IS NULL AND c.components IS NOT NULL
  ),
  cats AS (
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'parent_id', c.parent_id, 'level', c.level,
             'order_index', c.order_index) ORDER BY c.level NULLS LAST, c.order_index NULLS LAST, c.name) AS list
      FROM public.warehouse_categories c WHERE coalesce(c.is_active, true)
  )
  SELECT jsonb_build_object(
           'window', jsonb_build_object('starts_at', v_start, 'ends_at', v_end),
           'categories', coalesce(cats.list, '[]'::jsonb),
           'items', coalesce(items.list, '[]'::jsonb),
           'kits', coalesce(kits.list, '[]'::jsonb))
    INTO v_result
    FROM items, kits, cats;
  RETURN v_result;
END $$;

-- ─── Przejazdy ───────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Przejazdy (pełna lista po rodzaju: delivery, collection; pominięty — usunięty). Sprzedaż albo magazyn, przed zwrotem.
-- Wyjazd dostawy i powrót z odbioru wyznaczają okno zajęcia magazynu — w zarezerwowanym / wydanym kontrola dostępności sprzętu.
CREATE OR REPLACE FUNCTION public.rental_set_trips(p_id uuid, p_trips jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.rental_orders%ROWTYPE; x jsonb; v_kinds text[] := '{}'; v_kind text; v_vehicle uuid; v_driver uuid; v_start timestamptz; v_end timestamptz;
  v_short text;
BEGIN
  PERFORM private.require_crm_employee();
  SELECT * INTO o FROM public.rental_orders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono wypożyczenia.' USING ERRCODE = 'P0002'; END IF;
  IF NOT (public.rental_can(p_id, 'sales_manage') OR public.rental_can(p_id, 'warehouse_act')) THEN
    RAISE EXCEPTION 'Nie masz uprawnień do planowania dostawy tego wypożyczenia.' USING ERRCODE = '42501';
  END IF;
  IF o.status NOT IN ('draft', 'reserved', 'issued') THEN RAISE EXCEPTION 'Przejazdy planuje się przed zwrotem sprzętu.' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_trips) <> 'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista przejazdów.' USING ERRCODE = '22023'; END IF;
  -- Bez własnych przejazdów przy sprawdzaniu pojazdu (zmiana godzin tego samego przejazdu to nie konflikt).
  DELETE FROM public.rental_trips t WHERE t.rental_id = p_id;
  FOR x IN SELECT value FROM jsonb_array_elements(p_trips) LOOP
    v_kind := x->>'kind';
    IF v_kind NOT IN ('delivery', 'collection') OR v_kind = ANY (v_kinds) THEN RAISE EXCEPTION 'Nieprawidłowy przejazd.' USING ERRCODE = '22023'; END IF;
    v_kinds := v_kinds || v_kind;
    v_vehicle := nullif(x->>'vehicle_id', '')::uuid; v_driver := nullif(x->>'driver_id', '')::uuid;
    v_start := (x->>'starts_at')::timestamptz; v_end := (x->>'ends_at')::timestamptz;
    IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN
      RAISE EXCEPTION 'Podaj godziny przejazdu (koniec po początku).' USING ERRCODE = '22023';
    END IF;
    IF v_vehicle IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = v_vehicle) THEN
      RAISE EXCEPTION 'Nie znaleziono pojazdu.' USING ERRCODE = '22023';
    END IF;
    IF v_driver IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = v_driver AND e.is_active) THEN
      RAISE EXCEPTION 'Nie znaleziono kierowcy.' USING ERRCODE = '22023';
    END IF;
    IF v_vehicle IS NOT NULL AND o.status IN ('reserved', 'issued')
       AND (public.rental_vehicle_busy(v_vehicle, v_start, v_end, p_id) OR NOT coalesce(public.is_vehicle_available(v_vehicle, v_start, v_end, NULL), false)) THEN
      RAISE EXCEPTION 'Pojazd jest zajęty w tym czasie (%).', CASE v_kind WHEN 'delivery' THEN 'dostawa' ELSE 'odbiór' END USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.rental_trips(rental_id, kind, vehicle_id, driver_id, starts_at, ends_at, note)
    VALUES (p_id, v_kind, v_vehicle, v_driver, v_start, v_end, left(nullif(btrim(coalesce(x->>'note', '')), ''), 1000));
  END LOOP;
  IF o.status IN ('reserved', 'issued') THEN
    v_short := private.rental_shortage_text(p_id);
    IF v_short <> '' THEN
      RAISE EXCEPTION 'Przy tych godzinach dostawy i odbioru brakuje sprzętu: %.', v_short USING ERRCODE = '23514';
    END IF;
  END IF;
  PERFORM private.rental_log(p_id, 'warehouse', 'trips', jsonb_build_object('kinds', to_jsonb(v_kinds)));
  RETURN public.rental_get(p_id);
END $$;

-- ─── Uprawnienia ─────────────────────────────────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON private.rental_demand FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  private.rental_block(uuid, timestamptz, timestamptz), private.rental_busy(timestamptz, timestamptz, uuid),
  private.rental_peaks(timestamptz, timestamptz, uuid, uuid[]), private.rental_availability_json(timestamptz, timestamptz, jsonb, uuid),
  private.rental_shortage_text(uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.rental_catalog(timestamptz, timestamptz, uuid), public.rental_check_availability(timestamptz, timestamptz, jsonb, uuid),
  public.rental_availability(uuid), public.rental_set_trips(uuid, jsonb)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.rental_catalog(timestamptz, timestamptz, uuid), public.rental_check_availability(timestamptz, timestamptz, jsonb, uuid),
  public.rental_availability(uuid), public.rental_set_trips(uuid, jsonb)
TO authenticated, service_role;

COMMIT;
