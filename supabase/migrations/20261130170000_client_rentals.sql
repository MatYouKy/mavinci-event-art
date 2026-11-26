-- Rental → „Wypożyczenia klientom”: wypożyczenie sprzętu i dekoracji z magazynu klientowi (bez eventu) — rezerwacja stanu,
-- protokół wydania (WZ) i odbioru (PZ), rozbieżności (uszkodzenia, braki), naliczenia i rozliczenie z kaucją, dostawa pojazdem.
--
-- Dostęp (decyzja właściciela 25.11.2026: „Rental jest też sprzedażą — tematy sprzedażowe widzi sprzedawca, wydanie i protokół
-- wydania — magazyn”), `rental_access`:
--  - sprzedaż (klient, ceny, rabat, kaucja, naliczenia, faktury, dokumenty handlowe): administrator, `offers_manage`, finanse
--    (wystawianie faktur — podgląd) oraz opiekun / autor wypożyczenia z dostępem do ofert (`offers_view`, `offers_create`);
--    zmiany — administrator, `offers_manage`, opiekun / autor z `offers_create`; nowe wypożyczenie — `offers_create` / `offers_manage`;
--  - magazyn (pozycje bez cen, termin, odbierający, dostawa, protokoły, zdjęcia, rozbieżności): `equipment_view` / `equipment_manage`
--    od rezerwacji (szkic widzi tylko sprzedaż); wydanie, odbiór i rozbieżności — `equipment_manage`, jak w eventach nie opiekun
--    ani autor wypożyczenia (administrator — wszystko).
-- Tabele czytają bezpośrednio tylko osoby ze sprzedaży (RLS); magazyn i wszystkie zapisy — przez funkcje `rental_*`.
--
-- Stan magazynu: od rezerwacji pozycje blokują sprzęt we wspólnym liczeniu dostępności z eventami (`rental_equipment_demand`):
--  - zarezerwowane, jeszcze niewydane — w terminie wypożyczenia,
--  - wydane i jeszcze u klienta — do planowanego zwrotu, a po terminie zwrotu bez końca (aż wrócą),
--  - zwrócone uszkodzone albo brakujące — bez końca, aż magazyn rozstrzygnie (sprawne / do serwisu / spisane / oddane później).
-- Funkcje dostępności eventów i ofert doliczają te ilości (zmiany na końcu pliku), a rezerwacja wypożyczenia liczy rezerwacje
-- eventów tak jak walidacja zestawów (eventy nieanulowane, bez wynajmu zewnętrznego i pozycji usuniętych z oferty).
-- Zestaw dodany do wypożyczenia rozpisuje się na składniki (pozycje z `kit_id` do grupowania). Przewody — poza wypożyczeniami.
-- Dostawa i odbiór pojazdem (`rental_trips`) rezerwują pojazd — event nie dostanie zajętego pojazdu (`is_vehicle_available`).
BEGIN;

-- ─── Tabele ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.rental_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  -- draft — szkic sprzedaży, reserved — zarezerwowane (blokuje stan), issued — wydane, returned — zwrócone (wszystko rozliczone
  -- w protokołach odbioru), settled — rozliczone handlowo, cancelled — anulowane (tylko przed wydaniem).
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reserved', 'issued', 'returned', 'settled', 'cancelled')),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 200),
  my_company_id uuid REFERENCES public.my_companies(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  -- Nazwa klienta na dokumentach (także klient spoza bazy).
  client_name text NOT NULL CHECK (length(btrim(client_name)) BETWEEN 1 AND 300),
  recipient_name text CHECK (length(recipient_name) <= 200),
  recipient_phone text CHECK (length(recipient_phone) <= 50),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  handover text NOT NULL DEFAULT 'pickup' CHECK (handover IN ('pickup', 'delivery')),
  delivery_address text CHECK (length(delivery_address) <= 500),
  delivery_location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  seller_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  vat_rate numeric(5,2) NOT NULL DEFAULT 23 CHECK (vat_rate BETWEEN 0 AND 100),
  deposit_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  deposit_received_at timestamptz,
  deposit_returned_amount numeric(12,2) CHECK (deposit_returned_amount >= 0),
  deposit_settled_at timestamptz,
  sales_note text CHECK (length(sales_note) <= 4000),
  warehouse_note text CHECK (length(warehouse_note) <= 4000),
  cancel_reason text CHECK (length(cancel_reason) <= 1000),
  reserved_at timestamptz,
  reserved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  issued_at timestamptz,
  returned_at timestamptz,
  settled_at timestamptz,
  settled_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX rental_orders_status ON public.rental_orders(status);
CREATE INDEX rental_orders_period ON public.rental_orders(starts_at, ends_at);
CREATE INDEX rental_orders_seller ON public.rental_orders(seller_id);
CREATE INDEX rental_orders_organization ON public.rental_orders(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX rental_orders_contact ON public.rental_orders(contact_id) WHERE contact_id IS NOT NULL;

-- Pozycje: sprzęt z magazynu (kind = equipment) albo usługa (transport, montaż, czyszczenie — bez wpływu na stan).
-- Liczniki zwrotu: sprawne, uszkodzone, brakujące; rozstrzygnięcia rozbieżności: *_back — wróciło na stan, *_out — serwis / spisane.
CREATE TABLE public.rental_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  kind text NOT NULL CHECK (kind IN ('equipment', 'service')),
  equipment_id uuid REFERENCES public.equipment_items(id) ON DELETE RESTRICT,
  kit_id uuid REFERENCES public.equipment_kits(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  unit text NOT NULL DEFAULT 'szt.' CHECK (length(unit) BETWEEN 1 AND 20),
  price_mode text NOT NULL DEFAULT 'per_day' CHECK (price_mode IN ('per_day', 'flat')),
  unit_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  days numeric(6,1) CHECK (days > 0),
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  replacement_value numeric(12,2) CHECK (replacement_value >= 0),
  note text CHECK (length(note) <= 1000),
  issued_qty integer NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  returned_ok_qty integer NOT NULL DEFAULT 0 CHECK (returned_ok_qty >= 0),
  returned_damaged_qty integer NOT NULL DEFAULT 0 CHECK (returned_damaged_qty >= 0),
  returned_missing_qty integer NOT NULL DEFAULT 0 CHECK (returned_missing_qty >= 0),
  damaged_back_qty integer NOT NULL DEFAULT 0 CHECK (damaged_back_qty >= 0),
  damaged_out_qty integer NOT NULL DEFAULT 0 CHECK (damaged_out_qty >= 0),
  missing_back_qty integer NOT NULL DEFAULT 0 CHECK (missing_back_qty >= 0),
  missing_out_qty integer NOT NULL DEFAULT 0 CHECK (missing_out_qty >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'equipment') = (equipment_id IS NOT NULL)),
  CHECK (kind = 'equipment' OR issued_qty = 0),
  CHECK (issued_qty <= quantity),
  CHECK (returned_ok_qty + returned_damaged_qty + returned_missing_qty <= issued_qty),
  CHECK (damaged_back_qty + damaged_out_qty <= returned_damaged_qty),
  CHECK (missing_back_qty + missing_out_qty <= returned_missing_qty)
);
CREATE INDEX rental_order_items_rental ON public.rental_order_items(rental_id, position);
CREATE INDEX rental_order_items_equipment ON public.rental_order_items(equipment_id) WHERE equipment_id IS NOT NULL;

-- Dostawa do klienta i odbiór od klienta (pojazd z floty i kierowca); rezerwuje pojazd od rezerwacji wypożyczenia.
CREATE TABLE public.rental_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('delivery', 'collection')),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  note text CHECK (length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rental_id, kind),
  CHECK (ends_at > starts_at)
);
CREATE INDEX rental_trips_vehicle ON public.rental_trips(vehicle_id, starts_at) WHERE vehicle_id IS NOT NULL;

-- Protokoły: wydania (WZ) i odbioru (PZ); kilka na wypożyczenie (dowydanie, zwrot częściowy). Podpis — skan w `rental_files`.
CREATE TABLE public.rental_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('issue', 'return')),
  seq integer NOT NULL CHECK (seq > 0),
  number text NOT NULL,
  person_name text NOT NULL CHECK (length(btrim(person_name)) BETWEEN 2 AND 200),
  note text CHECK (length(note) <= 2000),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rental_id, kind, seq)
);

-- Pozycje protokołu: wydanie — qty; odbiór — qty sprawne, damaged, missing. Zdjęcia: ścieżki w buckecie `rental-files`.
CREATE TABLE public.rental_protocol_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id uuid NOT NULL REFERENCES public.rental_protocols(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.rental_order_items(id) ON DELETE CASCADE,
  qty integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  damaged integer NOT NULL DEFAULT 0 CHECK (damaged >= 0),
  missing integer NOT NULL DEFAULT 0 CHECK (missing >= 0),
  note text CHECK (length(note) <= 2000),
  photos text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photos) <= 10),
  UNIQUE (protocol_id, item_id)
);
CREATE INDEX rental_protocol_lines_item ON public.rental_protocol_lines(item_id);

-- Pliki: skany podpisanych protokołów i zdjęcia (magazyn, `<wypożyczenie>/warehouse/…`), dokumenty handlowe (`<wypożyczenie>/sales/…`).
CREATE TABLE public.rental_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  protocol_id uuid REFERENCES public.rental_protocols(id) ON DELETE SET NULL,
  area text NOT NULL CHECK (area IN ('sales', 'warehouse')),
  kind text NOT NULL CHECK (kind IN ('scan', 'photo', 'document')),
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 300),
  mime_type text,
  size_bytes bigint CHECK (size_bytes >= 0),
  uploaded_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rental_files_rental ON public.rental_files(rental_id);

-- Naliczenia dla klienta (netto): uszkodzenia, braki, opóźnienie zwrotu, czyszczenie, inne.
CREATE TABLE public.rental_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.rental_order_items(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('damage', 'missing', 'late', 'cleaning', 'other')),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rental_charges_rental ON public.rental_charges(rental_id);

-- Faktury z Finansów powiązane z wypożyczeniem (za wypożyczenie, kaucja, naliczenia).
CREATE TABLE public.rental_invoices (
  rental_id uuid NOT NULL REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'rental' CHECK (kind IN ('rental', 'deposit', 'charges')),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rental_id, invoice_id)
);
CREATE INDEX rental_invoices_invoice ON public.rental_invoices(invoice_id);

-- Historia: sales — widzi sprzedaż, warehouse — wszyscy z dostępem.
CREATE TABLE public.rental_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  area text NOT NULL CHECK (area IN ('sales', 'warehouse')),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  actor_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rental_log_rental ON public.rental_log(rental_id, created_at DESC);

CREATE TRIGGER rental_orders_updated_at BEFORE UPDATE ON public.rental_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER rental_order_items_updated_at BEFORE UPDATE ON public.rental_order_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER rental_trips_updated_at BEFORE UPDATE ON public.rental_trips FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Powiadomienia o wypożyczeniach (kategoria i typ powiązania „rental”).
ALTER TABLE public.notifications DROP CONSTRAINT notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check CHECK (((category = ANY (ARRAY['client'::text, 'event'::text,
  'offer'::text, 'employee'::text, 'system'::text, 'global'::text, 'contact_form'::text, 'tasks'::text, 'event_assignment'::text,
  'event_update'::text, 'message_assignment'::text, 'email_received'::text, 'vehicle_conflict'::text, 'absence_request'::text,
  'absence_approved'::text, 'absence_rejected'::text, 'team_invitation'::text, 'team_response'::text, 'meeting_invitation'::text,
  'rental'::text])) OR (category = ANY (ARRAY['meeting'::text, 'meeting_invitation'::text]))));
ALTER TABLE public.notifications DROP CONSTRAINT notifications_related_entity_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_related_entity_type_check CHECK (((related_entity_type = ANY (ARRAY['client'::text,
  'event'::text, 'offer'::text, 'employee'::text, 'equipment'::text, 'contact_messages'::text, 'task'::text, 'vehicle'::text,
  'event_vehicle'::text, 'maintenance_record'::text, 'insurance_policy'::text, 'fuel_entry'::text, 'absence'::text,
  'employee_assignment'::text, 'event_phase_assignment'::text, 'inquiry'::text, 'meeting'::text, 'rental'::text]))
  OR (related_entity_type = 'meeting'::text) OR (related_entity_type = ANY (ARRAY['received_email'::text, 'received_emails'::text]))));

-- ─── Dostęp ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Uprawnienia zalogowanego pracownika do wypożyczenia (bez identyfikatora — do listy i nowego wypożyczenia).
CREATE FUNCTION public.rental_access(p_rental uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := public.sales_employee_id();
  v_perm text[]; v_role text; v_level text; v_admin boolean; v_finance boolean; v_own boolean;
  o public.rental_orders%ROWTYPE;
  v_none constant jsonb := jsonb_build_object('create', false, 'sales_view', false, 'sales_manage', false, 'sales_all', false,
    'warehouse_view', false, 'warehouse_act', false, 'admin', false, 'own', false, 'employee_id', NULL);
BEGIN
  IF v_actor IS NULL OR coalesce(public.current_session_is_seller_portal(), true) THEN RETURN v_none; END IF;
  SELECT coalesce(e.permissions, '{}'::text[]), e.role::text, e.access_level::text INTO v_perm, v_role, v_level
    FROM public.employees e WHERE e.id = v_actor AND e.is_active;
  IF NOT FOUND THEN RETURN v_none; END IF;
  v_admin := coalesce(v_role = 'admin', false) OR coalesce(v_level = 'admin', false) OR 'admin' = ANY (v_perm);
  v_finance := coalesce(public.can_manage_invoices(), false);
  IF p_rental IS NULL THEN
    RETURN jsonb_build_object(
      'create', v_admin OR v_perm && ARRAY['offers_manage', 'offers_create'],
      'sales_view', v_admin OR v_finance OR v_perm && ARRAY['offers_manage', 'offers_create', 'offers_view'],
      'sales_manage', v_admin OR v_perm && ARRAY['offers_manage', 'offers_create'],
      'sales_all', v_admin OR v_finance OR 'offers_manage' = ANY (v_perm),
      'warehouse_view', v_admin OR v_perm && ARRAY['equipment_view', 'equipment_manage'],
      'warehouse_act', v_admin OR 'equipment_manage' = ANY (v_perm),
      'admin', v_admin, 'own', false, 'employee_id', v_actor);
  END IF;
  SELECT * INTO o FROM public.rental_orders WHERE id = p_rental;
  IF NOT FOUND THEN RETURN v_none; END IF;
  IF o.my_company_id IS NOT NULL AND NOT public.employee_can_access_company(v_actor, o.my_company_id) THEN RETURN v_none; END IF;
  v_own := coalesce(v_actor = o.seller_id, false) OR coalesce(v_actor = o.created_by, false);
  RETURN jsonb_build_object(
    'create', v_admin OR v_perm && ARRAY['offers_manage', 'offers_create'],
    'sales_view', v_admin OR v_finance OR 'offers_manage' = ANY (v_perm)
      OR (v_own AND v_perm && ARRAY['offers_manage', 'offers_create', 'offers_view']),
    'sales_manage', v_admin OR 'offers_manage' = ANY (v_perm) OR (v_own AND 'offers_create' = ANY (v_perm)),
    'sales_all', v_admin OR v_finance OR 'offers_manage' = ANY (v_perm),
    'warehouse_view', o.status <> 'draft' AND (v_admin OR v_perm && ARRAY['equipment_view', 'equipment_manage']),
    'warehouse_act', o.status NOT IN ('draft', 'cancelled') AND (v_admin OR ('equipment_manage' = ANY (v_perm) AND NOT v_own)),
    'admin', v_admin, 'own', v_own, 'employee_id', v_actor);
END $$;

-- view — sprzedaż albo magazyn; pozostałe klucze jak w `rental_access`.
CREATE FUNCTION public.rental_can(p_rental uuid, p_what text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_what = 'view'
    THEN coalesce((s.a->>'sales_view')::boolean, false) OR coalesce((s.a->>'warehouse_view')::boolean, false)
    ELSE coalesce((s.a->>p_what)::boolean, false) END
  FROM (SELECT public.rental_access(p_rental) AS a) s;
$$;

-- Wypożyczenie zablokowane do zmiany w tej transakcji, po sprawdzeniu prawa (`rental_can`).
CREATE FUNCTION private.rental_lock(p_rental uuid, p_what text, p_message text)
RETURNS public.rental_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.rental_orders%ROWTYPE;
BEGIN
  PERFORM private.require_crm_employee();
  SELECT * INTO o FROM public.rental_orders WHERE id = p_rental FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono wypożyczenia.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.rental_can(p_rental, p_what) THEN RAISE EXCEPTION '%', p_message USING ERRCODE = '42501'; END IF;
  RETURN o;
END $$;

CREATE FUNCTION private.rental_actor_name(p_employee uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), '') FROM public.employees e WHERE e.id = p_employee;
$$;

CREATE FUNCTION private.rental_log(p_rental uuid, p_area text, p_action text, p_details jsonb DEFAULT '{}'::jsonb, p_note text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO public.rental_log(rental_id, area, action, details, note, actor_id, actor_name)
  VALUES (p_rental, p_area, p_action, coalesce(p_details, '{}'::jsonb), nullif(btrim(p_note), ''), public.sales_employee_id(),
          private.rental_actor_name(public.sales_employee_id()));
$$;

-- Adresaci powiadomień: sales — opiekun i autor; warehouse — magazyn (`equipment_manage`, nie opiekun / autor; bez magazynu —
-- administratorzy); admins — administratorzy. Tylko aktywni pracownicy z dostępem do firmy wypożyczenia.
CREATE FUNCTION private.rental_people(p_rental uuid, p_roles text[])
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH o AS (SELECT r.* FROM public.rental_orders r WHERE r.id = p_rental),
  staff AS (
    SELECT e.* FROM public.employees e, o WHERE e.is_active AND (o.my_company_id IS NULL OR public.employee_can_access_company(e.id, o.my_company_id))
  ),
  warehouse AS (
    SELECT s.id FROM staff s, o WHERE 'equipment_manage' = ANY (coalesce(s.permissions, '{}'::text[]))
      AND s.id IS DISTINCT FROM o.seller_id AND s.id IS DISTINCT FROM o.created_by
  ),
  admins AS (SELECT s.id FROM staff s WHERE s.role = 'admin' OR s.access_level = 'admin'),
  people AS (
    SELECT o.seller_id AS id FROM o WHERE 'sales' = ANY (p_roles)
    UNION SELECT o.created_by FROM o WHERE 'sales' = ANY (p_roles)
    UNION SELECT w.id FROM warehouse w WHERE 'warehouse' = ANY (p_roles)
    UNION SELECT a.id FROM admins a WHERE 'admins' = ANY (p_roles) OR ('warehouse' = ANY (p_roles) AND NOT EXISTS (SELECT 1 FROM warehouse))
  )
  SELECT coalesce(array_agg(DISTINCT p.id) FILTER (WHERE p.id IS NOT NULL), '{}'::uuid[])
    FROM people p JOIN staff s ON s.id = p.id;
$$;

-- Powiadomienie (bez autora zmiany); błąd zapisu powiadomienia nie cofa operacji.
CREATE FUNCTION private.rental_notify(p_rental uuid, p_title text, p_message text, p_type text, p_recipients uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.rental_orders%ROWTYPE; v_notice uuid; v_actor uuid := public.sales_employee_id();
BEGIN
  SELECT * INTO o FROM public.rental_orders WHERE id = p_rental;
  IF o.id IS NULL OR coalesce(cardinality(p_recipients), 0) = 0 THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = ANY (p_recipients) AND e.id IS DISTINCT FROM v_actor
                 AND e.is_active AND e.auth_user_id IS NOT NULL) THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.notifications(category, title, message, type, related_entity_type, related_entity_id, action_url, metadata)
    VALUES ('rental', left(p_title, 200),
            left(format('Wypożyczenie %s%s: %s', o.number, CASE WHEN o.title <> '' THEN ' „' || o.title || '”' ELSE '' END, p_message), 1000),
            CASE WHEN p_type IN ('info', 'success', 'warning', 'error') THEN p_type ELSE 'info' END, 'rental', o.id::text,
            '/crm/rental/' || o.id, jsonb_build_object('rental_id', o.id))
    RETURNING id INTO v_notice;
    INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
    SELECT DISTINCT v_notice, e.auth_user_id, false FROM public.employees e
     WHERE e.id = ANY (p_recipients) AND e.id IS DISTINCT FROM v_actor AND e.is_active AND e.auth_user_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Powiadomienie o wypożyczeniu nie zostało zapisane: %', SQLERRM;
  END;
END $$;

-- ─── Stan magazynu ────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Zapotrzebowanie wypożyczeń na sprzęt (patrz nagłówek): planned — zarezerwowane niewydane, out — u klienta, issues —
-- nierozstrzygnięte uszkodzenia i braki. `until` = infinity — do odwołania.
CREATE VIEW private.rental_demand AS
SELECT o.id AS rental_id, i.id AS item_id, i.equipment_id, x.part, x.qty, o.starts_at, x.until
  FROM public.rental_orders o
  JOIN public.rental_order_items i ON i.rental_id = o.id AND i.kind = 'equipment'
  CROSS JOIN LATERAL (VALUES
    ('planned'::text, CASE WHEN o.status IN ('reserved', 'issued') THEN i.quantity - i.issued_qty ELSE 0 END, o.ends_at),
    ('out', CASE WHEN o.status IN ('issued', 'returned', 'settled')
        THEN i.issued_qty - i.returned_ok_qty - i.returned_damaged_qty - i.returned_missing_qty ELSE 0 END,
      CASE WHEN o.ends_at > now() THEN o.ends_at ELSE 'infinity'::timestamptz END),
    ('issues', CASE WHEN o.status IN ('issued', 'returned', 'settled')
        THEN (i.returned_damaged_qty - i.damaged_back_qty - i.damaged_out_qty) + (i.returned_missing_qty - i.missing_back_qty - i.missing_out_qty)
        ELSE 0 END,
      'infinity'::timestamptz)
  ) AS x(part, qty, until)
 WHERE x.qty > 0;

-- Ile sztuk sprzętu zajmują wypożyczenia w terminie (bez wskazanego wypożyczenia) — do liczenia dostępności eventów i ofert.
CREATE FUNCTION public.rental_equipment_demands(p_start timestamptz, p_end timestamptz, p_exclude_rental uuid DEFAULT NULL)
RETURNS TABLE(equipment_id uuid, qty integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.equipment_id, sum(d.qty)::integer FROM private.rental_demand d
   WHERE d.starts_at < p_end AND d.until > p_start AND d.rental_id IS DISTINCT FROM p_exclude_rental
   GROUP BY d.equipment_id;
$$;

CREATE FUNCTION public.rental_equipment_demand(p_equipment uuid, p_start timestamptz, p_end timestamptz, p_exclude_rental uuid DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(sum(d.qty), 0)::integer FROM private.rental_demand d
   WHERE d.equipment_id = p_equipment AND d.starts_at < p_end AND d.until > p_start AND d.rental_id IS DISTINCT FROM p_exclude_rental;
$$;

-- Rezerwacje eventów w terminie (jak `validate_event_kit_inventory`: eventy nieanulowane, bez wynajmu zewnętrznego i pozycji
-- usuniętych z oferty; zestawy rozpisane na składniki).
CREATE FUNCTION private.rental_event_demand(p_start timestamptz, p_end timestamptz)
RETURNS TABLE(equipment_id uuid, event_id uuid, qty numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH active AS (
    SELECT r.event_id, r.equipment_id, r.kit_id, r.quantity FROM public.event_equipment r JOIN public.events e ON e.id = r.event_id
     WHERE NOT coalesce(r.use_external_rental, false) AND NOT coalesce(r.removed_from_offer, false)
       AND coalesce(r.status::text, 'reserved') IN ('reserved', 'in_use') AND coalesce(e.status::text, '') <> 'cancelled'
       AND e.event_date < p_end AND coalesce(e.event_end_date, e.event_date + interval '1 day') > p_start
  )
  SELECT a.equipment_id, a.event_id, a.quantity::numeric FROM active a WHERE a.equipment_id IS NOT NULL
  UNION ALL
  SELECT i.equipment_id, a.event_id, a.quantity::numeric * i.quantity
    FROM active a JOIN public.equipment_kit_items i ON i.kit_id = a.kit_id WHERE i.equipment_id IS NOT NULL;
$$;

-- Dostępność sprzętu na wypożyczenie: stan sprawny, rezerwacje eventów i innych wypożyczeń w terminie, konflikty.
-- p_items: [{equipment_id, quantity}]. Nazwy eventów — tylko widoczne dla osoby; klient innego wypożyczenia — tylko sprzedaży.
CREATE FUNCTION private.rental_availability_json(p_start timestamptz, p_end timestamptz, p_items jsonb, p_exclude_rental uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH req AS (
    SELECT (x->>'equipment_id')::uuid AS equipment_id, sum(greatest(coalesce((x->>'quantity')::integer, 0), 0))::integer AS qty
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END) x
     WHERE coalesce(x->>'equipment_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     GROUP BY 1
  ),
  ev AS (SELECT d.* FROM private.rental_event_demand(p_start, p_end) d JOIN req ON req.equipment_id = d.equipment_id),
  rd AS (
    SELECT d.* FROM private.rental_demand d JOIN req ON req.equipment_id = d.equipment_id
     WHERE d.starts_at < p_end AND d.until > p_start AND d.rental_id IS DISTINCT FROM p_exclude_rental
  ),
  ev_list AS (
    SELECT d.equipment_id, sum(d.qty)::integer AS qty,
           jsonb_agg(jsonb_build_object('type', 'event', 'id', d.event_id,
             'name', CASE WHEN public.current_employee_can_view_event(d.event_id) THEN e.name ELSE 'Inny event' END,
             'starts_at', e.event_date, 'ends_at', coalesce(e.event_end_date, e.event_date + interval '1 day'), 'qty', d.qty)
             ORDER BY e.event_date) AS list
      FROM (SELECT equipment_id, event_id, sum(qty)::integer AS qty FROM ev GROUP BY 1, 2) d
      JOIN public.events e ON e.id = d.event_id
     GROUP BY d.equipment_id
  ),
  rd_list AS (
    SELECT d.equipment_id, sum(d.qty)::integer AS qty,
           jsonb_agg(jsonb_build_object('type', 'rental', 'id', o.id,
             'name', o.number || CASE WHEN public.rental_can(o.id, 'sales_view') THEN ' · ' || o.client_name ELSE '' END,
             'starts_at', o.starts_at, 'ends_at', CASE WHEN d.until = 'infinity'::timestamptz THEN NULL ELSE d.until END,
             'open_ended', d.until = 'infinity'::timestamptz, 'qty', d.qty) ORDER BY o.starts_at) AS list
      FROM (SELECT equipment_id, rental_id, sum(qty)::integer AS qty, max(until) AS until FROM rd GROUP BY 1, 2) d
      JOIN public.rental_orders o ON o.id = d.rental_id
     GROUP BY d.equipment_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'equipment_id', r.equipment_id, 'name', coalesce(it.name, 'Sprzęt'), 'required', r.qty, 'stock', s.stock,
      'events', coalesce(e.qty, 0), 'rentals', coalesce(x.qty, 0),
      'available', greatest(s.stock - coalesce(e.qty, 0) - coalesce(x.qty, 0), 0),
      'shortage', greatest(r.qty - greatest(s.stock - coalesce(e.qty, 0) - coalesce(x.qty, 0), 0), 0),
      'conflicts', coalesce(e.list, '[]'::jsonb) || coalesce(x.list, '[]'::jsonb)) ORDER BY it.name), '[]'::jsonb)
    FROM req r
    LEFT JOIN public.equipment_items it ON it.id = r.equipment_id
    CROSS JOIN LATERAL (SELECT public.kit_component_usable_stock(r.equipment_id, NULL)::integer AS stock) s
    LEFT JOIN ev_list e ON e.equipment_id = r.equipment_id
    LEFT JOIN rd_list x ON x.equipment_id = r.equipment_id;
$$;

CREATE FUNCTION public.rental_check_availability(p_start timestamptz, p_end timestamptz, p_items jsonb, p_exclude_rental uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM private.require_crm_employee();
  IF NOT public.rental_can(NULL, 'view') AND NOT public.rental_can(NULL, 'create') THEN
    RAISE EXCEPTION 'Nie masz dostępu do wypożyczeń.' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'Podaj termin wydania i zwrotu (zwrot po wydaniu).' USING ERRCODE = '22023';
  END IF;
  RETURN private.rental_availability_json(p_start, p_end, p_items, p_exclude_rental);
END $$;

-- Braki sprzętu wypożyczenia w jego terminie (bez niego samego); pusty tekst — wszystko dostępne. Wypożyczenie potrzebuje tego,
-- co trzyma: niewydane, u klienta i nierozstrzygnięte rozbieżności (bez tego, co wróciło na stan albo zeszło ze stanu).
CREATE FUNCTION private.rental_shortage_text(p_rental uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(string_agg(format('%s (potrzeba %s, dostępne %s)', a->>'name', a->>'required', a->>'available'), '; '), '')
    FROM public.rental_orders o
   CROSS JOIN LATERAL jsonb_array_elements(private.rental_availability_json(o.starts_at, o.ends_at,
     (SELECT coalesce(jsonb_agg(jsonb_build_object('equipment_id', i.equipment_id, 'quantity', h.qty)), '[]'::jsonb)
        FROM public.rental_order_items i
       CROSS JOIN LATERAL (SELECT i.quantity - i.returned_ok_qty - i.damaged_back_qty - i.damaged_out_qty
                                  - i.missing_back_qty - i.missing_out_qty AS qty) h
       WHERE i.rental_id = o.id AND i.kind = 'equipment' AND h.qty > 0), o.id)) a
   WHERE o.id = p_rental AND (a->>'shortage')::integer > 0;
$$;

-- ─── Pojazdy ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Przejazdy wypożyczeń zarezerwowanych i wydanych zajmują pojazd.
CREATE FUNCTION public.rental_vehicle_busy(p_vehicle uuid, p_start timestamptz, p_end timestamptz, p_exclude_rental uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rental_trips t JOIN public.rental_orders o ON o.id = t.rental_id
     WHERE t.vehicle_id = p_vehicle AND o.status IN ('reserved', 'issued') AND o.id IS DISTINCT FROM p_exclude_rental
       AND t.starts_at < p_end AND t.ends_at > p_start);
$$;

-- Konflikty pojazdu w terminie: eventy (jak `is_vehicle_available`) i przejazdy innych wypożyczeń.
CREATE FUNCTION public.rental_vehicle_conflicts(p_vehicle uuid, p_start timestamptz, p_end timestamptz, p_exclude_rental uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM private.require_crm_employee();
  IF p_vehicle IS NULL OR p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN RETURN '[]'::jsonb; END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(c ORDER BY c->>'starts_at'), '[]'::jsonb) FROM (
      SELECT jsonb_build_object('type', 'event', 'id', e.id,
               'name', CASE WHEN public.current_employee_can_view_event(e.id) THEN e.name ELSE 'Inny event' END,
               'starts_at', coalesce(ep.start_time, e.event_date), 'ends_at', coalesce(ep.end_time, e.event_end_date)) AS c
        FROM public.event_vehicles ev
        JOIN public.events e ON e.id = ev.event_id
        LEFT JOIN public.event_phases ep ON ep.id = (SELECT ep_sub.id FROM public.event_phases ep_sub WHERE ep_sub.event_id = e.id
                                                   ORDER BY ep_sub.start_time ASC LIMIT 1)
       WHERE ev.vehicle_id = p_vehicle AND ev.status <> 'cancelled' AND e.status <> 'cancelled'
         AND coalesce(ep.start_time, e.event_date) < p_end AND coalesce(ep.end_time, e.event_end_date) > p_start
      UNION ALL
      SELECT jsonb_build_object('type', 'rental', 'id', o.id,
               'name', o.number || ' · ' || CASE t.kind WHEN 'delivery' THEN 'dostawa' ELSE 'odbiór' END,
               'starts_at', t.starts_at, 'ends_at', t.ends_at)
        FROM public.rental_trips t JOIN public.rental_orders o ON o.id = t.rental_id
       WHERE t.vehicle_id = p_vehicle AND o.status IN ('reserved', 'issued') AND o.id IS DISTINCT FROM p_exclude_rental
         AND t.starts_at < p_end AND t.ends_at > p_start
    ) s);
END $$;

-- ─── Odczyt ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION private.rental_default_days(p_start timestamptz, p_end timestamptz)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT greatest(1, ceil(extract(epoch FROM (p_end - p_start)) / 86400.0))::numeric;
$$;

-- Podsumowanie handlowe (netto pozycji po rabatach, rabat na całość, naliczenia, VAT, brutto, kaucja).
CREATE FUNCTION private.rental_totals(p_rental uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH o AS (SELECT * FROM public.rental_orders WHERE id = p_rental),
  lines AS (
    SELECT round(i.unit_price * i.quantity
             * CASE WHEN i.price_mode = 'per_day' THEN coalesce(i.days, private.rental_default_days(o.starts_at, o.ends_at)) ELSE 1 END
             * (1 - i.discount_percent / 100), 2) AS net
      FROM public.rental_order_items i, o WHERE i.rental_id = o.id
  ),
  sums AS (
    SELECT coalesce((SELECT sum(net) FROM lines), 0) AS lines_net,
           coalesce((SELECT sum(c.amount) FROM public.rental_charges c WHERE c.rental_id = p_rental), 0) AS charges_net
  ),
  calc AS (
    SELECT s.lines_net, round(s.lines_net * o.discount_percent / 100, 2) AS discount_amount, s.charges_net, o.vat_rate,
           o.deposit_amount, o.deposit_returned_amount FROM sums s, o
  )
  SELECT jsonb_build_object('lines_net', c.lines_net, 'discount_amount', c.discount_amount,
           'rental_net', c.lines_net - c.discount_amount, 'charges_net', c.charges_net,
           'net', c.lines_net - c.discount_amount + c.charges_net,
           'vat', round((c.lines_net - c.discount_amount + c.charges_net) * c.vat_rate / 100, 2),
           'gross', (c.lines_net - c.discount_amount + c.charges_net) + round((c.lines_net - c.discount_amount + c.charges_net) * c.vat_rate / 100, 2),
           'deposit', c.deposit_amount, 'deposit_returned', c.deposit_returned_amount)
    FROM calc c;
$$;

-- Lista wypożyczeń dostępnych dla osoby. p_filter: status (tablica), q (numer, tytuł, klient), from / to (okres), mine (bool).
CREATE FUNCTION public.rental_list(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  a jsonb; v_actor uuid := public.sales_employee_id(); f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_status text[]; v_q text; v_from timestamptz; v_to timestamptz; v_mine boolean;
BEGIN
  PERFORM private.require_crm_employee();
  a := public.rental_access(NULL);
  IF NOT (coalesce((a->>'sales_view')::boolean, false) OR coalesce((a->>'warehouse_view')::boolean, false)) THEN
    RAISE EXCEPTION 'Nie masz dostępu do wypożyczeń.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(f->'status') = 'array' THEN SELECT array_agg(x) INTO v_status FROM jsonb_array_elements_text(f->'status') x; END IF;
  v_q := nullif(lower(btrim(coalesce(f->>'q', ''))), '');
  v_from := nullif(f->>'from', '')::timestamptz;
  v_to := nullif(f->>'to', '')::timestamptz;
  v_mine := coalesce((f->>'mine')::boolean, false);
  RETURN (
    SELECT coalesce(jsonb_agg(row ORDER BY sort_group, sort_at), '[]'::jsonb) FROM (
      SELECT CASE WHEN o.status IN ('reserved', 'issued') THEN 0 WHEN o.status = 'draft' THEN 1 WHEN o.status = 'returned' THEN 2 ELSE 3 END AS sort_group,
             CASE WHEN o.status IN ('reserved', 'draft') THEN extract(epoch FROM o.starts_at)
                  WHEN o.status = 'issued' THEN extract(epoch FROM o.ends_at) ELSE -extract(epoch FROM o.starts_at) END AS sort_at,
             jsonb_build_object(
               'id', o.id, 'number', o.number, 'status', o.status, 'title', o.title, 'client_name', o.client_name,
               'starts_at', o.starts_at, 'ends_at', o.ends_at, 'handover', o.handover,
               'seller_id', o.seller_id, 'seller_name', private.rental_actor_name(o.seller_id),
               'items_count', (SELECT count(*) FROM public.rental_order_items i WHERE i.rental_id = o.id AND i.kind = 'equipment'),
               'quantity', (SELECT coalesce(sum(i.quantity), 0) FROM public.rental_order_items i WHERE i.rental_id = o.id AND i.kind = 'equipment'),
               'out_qty', (SELECT coalesce(sum(i.issued_qty - i.returned_ok_qty - i.returned_damaged_qty - i.returned_missing_qty), 0)
                             FROM public.rental_order_items i WHERE i.rental_id = o.id),
               'open_issues', (SELECT coalesce(sum((i.returned_damaged_qty - i.damaged_back_qty - i.damaged_out_qty)
                                 + (i.returned_missing_qty - i.missing_back_qty - i.missing_out_qty)), 0)
                                 FROM public.rental_order_items i WHERE i.rental_id = o.id),
               'overdue', o.status = 'issued' AND o.ends_at < now(),
               'sales', CASE WHEN acc.sales THEN jsonb_build_object('totals', private.rental_totals(o.id)) ELSE NULL END
             ) AS row
        FROM public.rental_orders o
        CROSS JOIN LATERAL (SELECT public.rental_access(o.id) AS x) ax
        CROSS JOIN LATERAL (SELECT coalesce((ax.x->>'sales_view')::boolean, false) AS sales,
                                   coalesce((ax.x->>'warehouse_view')::boolean, false) AS warehouse) acc
       WHERE (acc.sales OR acc.warehouse)
         AND (v_status IS NULL OR o.status = ANY (v_status))
         AND (v_q IS NULL OR lower(o.number || ' ' || o.title || ' ' || o.client_name) LIKE '%' || v_q || '%')
         AND (v_from IS NULL OR o.ends_at >= v_from)
         AND (v_to IS NULL OR o.starts_at <= v_to)
         AND (NOT v_mine OR v_actor IN (o.seller_id, o.created_by))
       LIMIT 1000
    ) s);
END $$;

-- Karta wypożyczenia: część magazynowa dla każdego z dostępem, handlowa (`sales`, ceny pozycji) — tylko sprzedaży.
CREATE FUNCTION public.rental_get(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a jsonb; o public.rental_orders%ROWTYPE; v_sales boolean; v_days numeric;
BEGIN
  PERFORM private.require_crm_employee();
  SELECT * INTO o FROM public.rental_orders WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono wypożyczenia.' USING ERRCODE = 'P0002'; END IF;
  a := public.rental_access(p_id);
  v_sales := coalesce((a->>'sales_view')::boolean, false);
  IF NOT (v_sales OR coalesce((a->>'warehouse_view')::boolean, false)) THEN
    RAISE EXCEPTION 'Nie masz dostępu do tego wypożyczenia.' USING ERRCODE = '42501';
  END IF;
  v_days := private.rental_default_days(o.starts_at, o.ends_at);
  RETURN jsonb_build_object(
    'id', o.id, 'number', o.number, 'status', o.status, 'title', o.title, 'client_name', o.client_name,
    'organization_id', o.organization_id, 'contact_id', o.contact_id,
    'organization_name', (SELECT g.name FROM public.organizations g WHERE g.id = o.organization_id),
    'contact_name', (SELECT nullif(btrim(coalesce(c.full_name, concat_ws(' ', c.first_name, c.last_name))), '') FROM public.contacts c WHERE c.id = o.contact_id),
    'recipient_name', o.recipient_name, 'recipient_phone', o.recipient_phone,
    'starts_at', o.starts_at, 'ends_at', o.ends_at, 'default_days', v_days,
    'handover', o.handover, 'delivery_address', o.delivery_address, 'delivery_location_id', o.delivery_location_id,
    'delivery_location_name', (SELECT l.name FROM public.locations l WHERE l.id = o.delivery_location_id),
    'my_company_id', o.my_company_id, 'my_company_name', (SELECT m.name FROM public.my_companies m WHERE m.id = o.my_company_id),
    'seller_id', o.seller_id, 'seller_name', private.rental_actor_name(o.seller_id),
    'created_by', o.created_by, 'created_by_name', private.rental_actor_name(o.created_by),
    'warehouse_note', o.warehouse_note, 'cancel_reason', o.cancel_reason,
    'reserved_at', o.reserved_at, 'issued_at', o.issued_at, 'returned_at', o.returned_at, 'settled_at', o.settled_at,
    'cancelled_at', o.cancelled_at, 'created_at', o.created_at, 'updated_at', o.updated_at,
    'overdue', o.status = 'issued' AND o.ends_at < now(),
    'access', a,
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'position', i.position, 'kind', i.kind, 'equipment_id', i.equipment_id, 'kit_id', i.kit_id,
        'kit_name', (SELECT k.name FROM public.equipment_kits k WHERE k.id = i.kit_id),
        'name', i.name, 'quantity', i.quantity, 'unit', i.unit, 'note', i.note,
        'thumbnail_url', eq.thumbnail_url, 'storage_location', sl.name,
        'has_units', EXISTS (SELECT 1 FROM public.equipment_units u WHERE u.equipment_id = i.equipment_id),
        'issued_qty', i.issued_qty, 'returned_ok_qty', i.returned_ok_qty, 'returned_damaged_qty', i.returned_damaged_qty,
        'returned_missing_qty', i.returned_missing_qty, 'damaged_back_qty', i.damaged_back_qty, 'damaged_out_qty', i.damaged_out_qty,
        'missing_back_qty', i.missing_back_qty, 'missing_out_qty', i.missing_out_qty,
        'out_qty', i.issued_qty - i.returned_ok_qty - i.returned_damaged_qty - i.returned_missing_qty,
        'open_damaged', i.returned_damaged_qty - i.damaged_back_qty - i.damaged_out_qty,
        'open_missing', i.returned_missing_qty - i.missing_back_qty - i.missing_out_qty)
        || CASE WHEN v_sales THEN jsonb_build_object('price_mode', i.price_mode, 'unit_price', i.unit_price, 'days', i.days,
             'discount_percent', i.discount_percent, 'replacement_value', i.replacement_value,
             'line_net', round(i.unit_price * i.quantity * CASE WHEN i.price_mode = 'per_day' THEN coalesce(i.days, v_days) ELSE 1 END
                               * (1 - i.discount_percent / 100), 2))
           ELSE '{}'::jsonb END
        ORDER BY i.position, i.created_at), '[]'::jsonb)
        FROM public.rental_order_items i
        LEFT JOIN public.equipment_items eq ON eq.id = i.equipment_id
        LEFT JOIN public.storage_locations sl ON sl.id = eq.storage_location_id
       WHERE i.rental_id = o.id),
    'trips', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'vehicle_id', t.vehicle_id,
        'vehicle_name', (SELECT concat_ws(' · ', v.name, v.registration_number) FROM public.vehicles v WHERE v.id = t.vehicle_id),
        'driver_id', t.driver_id, 'driver_name', private.rental_actor_name(t.driver_id),
        'starts_at', t.starts_at, 'ends_at', t.ends_at, 'note', t.note) ORDER BY t.starts_at), '[]'::jsonb)
        FROM public.rental_trips t WHERE t.rental_id = o.id),
    'protocols', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'seq', p.seq, 'number', p.number,
        'person_name', p.person_name, 'note', p.note, 'created_at', p.created_at, 'created_by_name', p.created_by_name,
        'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('item_id', l.item_id, 'name', i.name, 'unit', i.unit, 'qty', l.qty,
                    'damaged', l.damaged, 'missing', l.missing, 'note', l.note, 'photos', to_jsonb(l.photos)) ORDER BY i.position, i.created_at), '[]'::jsonb)
                    FROM public.rental_protocol_lines l JOIN public.rental_order_items i ON i.id = l.item_id WHERE l.protocol_id = p.id))
        ORDER BY p.created_at), '[]'::jsonb)
        FROM public.rental_protocols p WHERE p.rental_id = o.id),
    'files', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'protocol_id', f.protocol_id, 'area', f.area, 'kind', f.kind,
        'storage_path', f.storage_path, 'file_name', f.file_name, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes,
        'uploaded_by_name', private.rental_actor_name(f.uploaded_by), 'created_at', f.created_at) ORDER BY f.created_at), '[]'::jsonb)
        FROM public.rental_files f WHERE f.rental_id = o.id AND (f.area = 'warehouse' OR v_sales)),
    'log', (SELECT coalesce(jsonb_agg(jsonb_build_object('area', g.area, 'action', g.action, 'details', g.details, 'note', g.note,
        'actor_name', g.actor_name, 'created_at', g.created_at) ORDER BY g.created_at DESC), '[]'::jsonb)
        FROM (SELECT * FROM public.rental_log g WHERE g.rental_id = o.id AND (g.area = 'warehouse' OR v_sales)
               ORDER BY g.created_at DESC LIMIT 200) g),
    'sales', CASE WHEN v_sales THEN jsonb_build_object(
        'discount_percent', o.discount_percent, 'vat_rate', o.vat_rate, 'deposit_amount', o.deposit_amount,
        'deposit_received_at', o.deposit_received_at, 'deposit_returned_amount', o.deposit_returned_amount,
        'deposit_settled_at', o.deposit_settled_at, 'sales_note', o.sales_note, 'totals', private.rental_totals(o.id),
        'charges', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'item_id', c.item_id, 'kind', c.kind,
            'description', c.description, 'amount', c.amount, 'created_at', c.created_at) ORDER BY c.created_at), '[]'::jsonb)
            FROM public.rental_charges c WHERE c.rental_id = o.id),
        'invoices', (SELECT coalesce(jsonb_agg(jsonb_build_object('invoice_id', ri.invoice_id, 'kind', ri.kind,
            'invoice_number', inv.invoice_number, 'status', inv.status, 'total_gross', inv.total_gross) ORDER BY ri.created_at), '[]'::jsonb)
            FROM public.rental_invoices ri JOIN public.invoices inv ON inv.id = ri.invoice_id WHERE ri.rental_id = o.id))
      ELSE NULL END);
END $$;

-- Egzemplarze sprzętu pozycji (wybór przy „Do serwisu” / „Spisz ze stanu”).
CREATE FUNCTION public.rental_item_units(p_item uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE i public.rental_order_items%ROWTYPE;
BEGIN
  PERFORM private.require_crm_employee();
  SELECT * INTO i FROM public.rental_order_items WHERE id = p_item;
  IF NOT FOUND OR NOT public.rental_can(i.rental_id, 'view') THEN
    RAISE EXCEPTION 'Nie masz dostępu do tego wypożyczenia.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'serial', u.unit_serial_number, 'status', u.status,
            'location', coalesce(sl.name, u.location), 'condition_notes', u.condition_notes) ORDER BY u.unit_serial_number NULLS LAST, u.created_at), '[]'::jsonb)
            FROM public.equipment_units u LEFT JOIN public.storage_locations sl ON sl.id = u.location_id
           WHERE u.equipment_id = i.equipment_id);
END $$;

-- ─── Sprzedaż: wypożyczenie i pozycje ─────────────────────────────────────────────────────────────────────────────────────

-- Nowe (p_id = NULL) albo zmiana nagłówka. Klucze p_data jak kolumny `rental_orders` (przekazane — zmieniane).
-- Szkic i rezerwacja — wszystko; wydane — bez daty wydania i sposobu przekazania; zwrócone — bez terminu.
CREATE FUNCTION public.rental_save(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  d jsonb := coalesce(p_data, '{}'::jsonb); a jsonb; o public.rental_orders%ROWTYPE; n public.rental_orders%ROWTYPE;
  v_actor uuid := public.sales_employee_id(); v_new boolean := p_id IS NULL; v_manager boolean; v_year text; v_seq integer;
  v_short text; v_changed text[];
BEGIN
  PERFORM private.require_crm_employee();
  IF jsonb_typeof(d) <> 'object' THEN RAISE EXCEPTION 'Nieprawidłowe dane wypożyczenia.' USING ERRCODE = '22023'; END IF;
  IF v_new THEN
    a := public.rental_access(NULL);
    IF NOT coalesce((a->>'create')::boolean, false) THEN
      RAISE EXCEPTION 'Nie masz uprawnień do tworzenia wypożyczeń.' USING ERRCODE = '42501';
    END IF;
    n.status := 'draft'; n.seller_id := v_actor; n.created_by := v_actor; n.handover := 'pickup';
    n.discount_percent := 0; n.vat_rate := 23; n.deposit_amount := 0; n.title := '';
    SELECT m.id INTO n.my_company_id FROM public.my_companies m
     WHERE coalesce(m.is_default, false) AND public.employee_can_access_company(v_actor, m.id) LIMIT 1;
  ELSE
    o := private.rental_lock(p_id, 'sales_manage', 'Nie masz uprawnień do zmiany tego wypożyczenia.');
    a := public.rental_access(p_id);
    IF o.status IN ('settled', 'cancelled') THEN
      RAISE EXCEPTION 'Wypożyczenie jest %. Zmiany są zablokowane.', CASE o.status WHEN 'settled' THEN 'rozliczone' ELSE 'anulowane' END
        USING ERRCODE = '22023';
    END IF;
    n := o;
  END IF;
  v_manager := coalesce((a->>'admin')::boolean, false) OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = v_actor
               AND 'offers_manage' = ANY (coalesce(e.permissions, '{}'::text[])));

  IF d ? 'title' THEN n.title := left(btrim(coalesce(d->>'title', '')), 200); END IF;
  IF d ? 'organization_id' THEN n.organization_id := nullif(d->>'organization_id', '')::uuid; END IF;
  IF d ? 'contact_id' THEN n.contact_id := nullif(d->>'contact_id', '')::uuid; END IF;
  IF d ? 'client_name' THEN n.client_name := nullif(btrim(coalesce(d->>'client_name', '')), ''); END IF;
  IF d ? 'recipient_name' THEN n.recipient_name := nullif(btrim(coalesce(d->>'recipient_name', '')), ''); END IF;
  IF d ? 'recipient_phone' THEN n.recipient_phone := nullif(btrim(coalesce(d->>'recipient_phone', '')), ''); END IF;
  IF d ? 'starts_at' THEN n.starts_at := (d->>'starts_at')::timestamptz; END IF;
  IF d ? 'ends_at' THEN n.ends_at := (d->>'ends_at')::timestamptz; END IF;
  IF d ? 'handover' THEN n.handover := coalesce(d->>'handover', 'pickup'); END IF;
  IF d ? 'delivery_address' THEN n.delivery_address := nullif(btrim(coalesce(d->>'delivery_address', '')), ''); END IF;
  IF d ? 'delivery_location_id' THEN n.delivery_location_id := nullif(d->>'delivery_location_id', '')::uuid; END IF;
  IF d ? 'my_company_id' THEN n.my_company_id := nullif(d->>'my_company_id', '')::uuid; END IF;
  IF d ? 'seller_id' THEN n.seller_id := nullif(d->>'seller_id', '')::uuid; END IF;
  IF d ? 'discount_percent' THEN n.discount_percent := coalesce(nullif(d->>'discount_percent', '')::numeric, 0); END IF;
  IF d ? 'vat_rate' THEN n.vat_rate := coalesce(nullif(d->>'vat_rate', '')::numeric, 23); END IF;
  IF d ? 'deposit_amount' THEN n.deposit_amount := coalesce(nullif(d->>'deposit_amount', '')::numeric, 0); END IF;
  IF d ? 'deposit_received_at' THEN n.deposit_received_at := nullif(d->>'deposit_received_at', '')::timestamptz; END IF;
  IF d ? 'deposit_returned_amount' THEN n.deposit_returned_amount := nullif(d->>'deposit_returned_amount', '')::numeric; END IF;
  IF d ? 'deposit_settled_at' THEN n.deposit_settled_at := nullif(d->>'deposit_settled_at', '')::timestamptz; END IF;
  IF d ? 'sales_note' THEN n.sales_note := nullif(btrim(coalesce(d->>'sales_note', '')), ''); END IF;
  IF d ? 'warehouse_note' THEN n.warehouse_note := nullif(btrim(coalesce(d->>'warehouse_note', '')), ''); END IF;

  IF n.starts_at IS NULL OR n.ends_at IS NULL OR n.ends_at <= n.starts_at THEN
    RAISE EXCEPTION 'Podaj termin wydania i zwrotu (zwrot po wydaniu).' USING ERRCODE = '22023';
  END IF;
  IF n.handover NOT IN ('pickup', 'delivery') THEN RAISE EXCEPTION 'Nieprawidłowy sposób przekazania.' USING ERRCODE = '22023'; END IF;
  IF n.organization_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organizations g WHERE g.id = n.organization_id) THEN
    RAISE EXCEPTION 'Nie znaleziono organizacji klienta.' USING ERRCODE = '22023';
  END IF;
  IF n.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = n.contact_id) THEN
    RAISE EXCEPTION 'Nie znaleziono osoby kontaktowej.' USING ERRCODE = '22023';
  END IF;
  IF n.client_name IS NULL THEN
    n.client_name := coalesce((SELECT g.name FROM public.organizations g WHERE g.id = n.organization_id),
      (SELECT nullif(btrim(coalesce(c.full_name, concat_ws(' ', c.first_name, c.last_name))), '') FROM public.contacts c WHERE c.id = n.contact_id));
  END IF;
  IF n.client_name IS NULL THEN RAISE EXCEPTION 'Wskaż klienta wypożyczenia.' USING ERRCODE = '22023'; END IF;
  IF n.my_company_id IS NOT NULL AND NOT public.employee_can_access_company(v_actor, n.my_company_id) THEN
    RAISE EXCEPTION 'Nie masz dostępu do wybranej firmy.' USING ERRCODE = '42501';
  END IF;
  IF n.seller_id IS DISTINCT FROM (CASE WHEN v_new THEN v_actor ELSE o.seller_id END) THEN
    IF NOT v_manager THEN RAISE EXCEPTION 'Opiekuna wypożyczenia zmienia administrator albo osoba zarządzająca ofertami.' USING ERRCODE = '42501'; END IF;
    IF n.seller_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = n.seller_id AND e.is_active) THEN
      RAISE EXCEPTION 'Nie znaleziono pracownika — opiekuna.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NOT v_new THEN
    IF o.status IN ('issued', 'returned') AND (n.starts_at IS DISTINCT FROM o.starts_at OR n.handover IS DISTINCT FROM o.handover) THEN
      RAISE EXCEPTION 'Sprzęt został wydany — data wydania i sposób przekazania są już ustalone.' USING ERRCODE = '22023';
    END IF;
    IF o.status = 'returned' AND n.ends_at IS DISTINCT FROM o.ends_at THEN
      RAISE EXCEPTION 'Sprzęt został zwrócony — termin zwrotu jest już ustalony.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_new THEN
    v_year := to_char(now() AT TIME ZONE 'Europe/Warsaw', 'YYYY');
    PERFORM pg_advisory_xact_lock(hashtext('rental_orders_number'));
    SELECT coalesce(max(substring(r.number FROM '^WYP/\d{4}/(\d+)$')::integer), 0) + 1 INTO v_seq
      FROM public.rental_orders r WHERE r.number LIKE 'WYP/' || v_year || '/%';
    INSERT INTO public.rental_orders(number, status, title, my_company_id, organization_id, contact_id, client_name, recipient_name,
      recipient_phone, starts_at, ends_at, handover, delivery_address, delivery_location_id, seller_id, created_by, discount_percent,
      vat_rate, deposit_amount, deposit_received_at, deposit_returned_amount, deposit_settled_at, sales_note, warehouse_note)
    VALUES (format('WYP/%s/%s', v_year, lpad(v_seq::text, 3, '0')), 'draft', n.title, n.my_company_id, n.organization_id, n.contact_id,
      n.client_name, n.recipient_name, n.recipient_phone, n.starts_at, n.ends_at, n.handover, n.delivery_address, n.delivery_location_id,
      n.seller_id, v_actor, n.discount_percent, n.vat_rate, n.deposit_amount, n.deposit_received_at, n.deposit_returned_amount,
      n.deposit_settled_at, n.sales_note, n.warehouse_note)
    RETURNING id INTO n.id;
    PERFORM private.rental_log(n.id, 'sales', 'created', jsonb_build_object('number', format('WYP/%s/%s', v_year, lpad(v_seq::text, 3, '0'))));
    RETURN n.id;
  END IF;

  UPDATE public.rental_orders SET title = n.title, my_company_id = n.my_company_id, organization_id = n.organization_id,
         contact_id = n.contact_id, client_name = n.client_name, recipient_name = n.recipient_name, recipient_phone = n.recipient_phone,
         starts_at = n.starts_at, ends_at = n.ends_at, handover = n.handover, delivery_address = n.delivery_address,
         delivery_location_id = n.delivery_location_id, seller_id = n.seller_id, discount_percent = n.discount_percent,
         vat_rate = n.vat_rate, deposit_amount = n.deposit_amount, deposit_received_at = n.deposit_received_at,
         deposit_returned_amount = n.deposit_returned_amount, deposit_settled_at = n.deposit_settled_at,
         sales_note = n.sales_note, warehouse_note = n.warehouse_note
   WHERE id = p_id;
  IF o.status IN ('reserved', 'issued') AND (n.starts_at IS DISTINCT FROM o.starts_at OR n.ends_at IS DISTINCT FROM o.ends_at) THEN
    v_short := private.rental_shortage_text(p_id);
    IF v_short <> '' THEN
      RAISE EXCEPTION 'W nowym terminie brakuje sprzętu: %.', v_short USING ERRCODE = '23514';
    END IF;
    PERFORM private.rental_notify(p_id, 'Zmiana terminu wypożyczenia',
      format('wydanie %s, zwrot %s.', to_char(n.starts_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'),
             to_char(n.ends_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI')), 'info', private.rental_people(p_id, ARRAY['warehouse']));
  END IF;
  SELECT array_agg(k) INTO v_changed FROM jsonb_object_keys(d) k;
  PERFORM private.rental_log(p_id, CASE WHEN v_changed <@ ARRAY['warehouse_note'] THEN 'warehouse' ELSE 'sales' END, 'updated',
    jsonb_build_object('fields', to_jsonb(coalesce(v_changed, '{}'::text[]))));
  RETURN p_id;
END $$;

-- Pozycje (pełna lista; pozycja z `id` — zmiana, bez — nowa, pominięta — usunięta). Szkic, rezerwacja i wydane (dowypożyczenie);
-- pozycji wydanej nie da się usunąć ani zmienić jej sprzętu, a ilość nie może spaść poniżej wydanej. Zestaw (`kit_id` bez
-- sprzętu) rozpisuje się na składniki. W rezerwacji i po wydaniu — kontrola dostępności.
CREATE FUNCTION public.rental_set_items(p_id uuid, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  o public.rental_orders%ROWTYPE; x jsonb; c record; v_item public.rental_order_items%ROWTYPE; v_keep uuid[] := '{}';
  v_pos integer := 0; v_kind text; v_eq uuid; v_kit uuid; v_name text; v_qty integer; v_short text; v_item_id uuid;
  v_kits_expanded jsonb := '[]'::jsonb;
BEGIN
  o := private.rental_lock(p_id, 'sales_manage', 'Nie masz uprawnień do zmiany pozycji tego wypożyczenia.');
  IF o.status NOT IN ('draft', 'reserved', 'issued') THEN
    RAISE EXCEPTION 'Pozycje można zmieniać przed zwrotem sprzętu.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista pozycji.' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'Najwyżej 500 pozycji.' USING ERRCODE = '22023'; END IF;

  -- Zestawy rozpisane na składniki (nowe pozycje z kit_id i bez sprzętu).
  FOR x IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF coalesce(x->>'kind', 'equipment') = 'equipment' AND nullif(x->>'equipment_id', '') IS NULL AND nullif(x->>'kit_id', '') IS NOT NULL
       AND nullif(x->>'id', '') IS NULL THEN
      v_kit := (x->>'kit_id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.equipment_kits k WHERE k.id = v_kit AND k.is_active AND k.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Zestaw jest nieaktywny.' USING ERRCODE = '22023';
      END IF;
      FOR c IN SELECT ki.equipment_id, sum(ki.quantity)::integer AS q FROM public.equipment_kit_items ki
                WHERE ki.kit_id = v_kit AND ki.equipment_id IS NOT NULL GROUP BY ki.equipment_id LOOP
        v_kits_expanded := v_kits_expanded || jsonb_build_array(jsonb_build_object('kind', 'equipment', 'equipment_id', c.equipment_id,
          'kit_id', v_kit, 'quantity', c.q * greatest(coalesce((x->>'quantity')::integer, 1), 1), 'price_mode', 'per_day', 'unit_price', 0));
      END LOOP;
    ELSE
      v_kits_expanded := v_kits_expanded || jsonb_build_array(x);
    END IF;
  END LOOP;

  FOR x IN SELECT value FROM jsonb_array_elements(v_kits_expanded) LOOP
    v_pos := v_pos + 1;
    v_kind := coalesce(nullif(x->>'kind', ''), 'equipment');
    IF v_kind NOT IN ('equipment', 'service') THEN RAISE EXCEPTION 'Nieprawidłowy rodzaj pozycji.' USING ERRCODE = '22023'; END IF;
    v_eq := CASE WHEN v_kind = 'equipment' THEN nullif(x->>'equipment_id', '')::uuid END;
    v_qty := coalesce(nullif(x->>'quantity', '')::integer, 0);
    IF v_qty < 1 THEN RAISE EXCEPTION 'Ilość pozycji musi być większa od zera.' USING ERRCODE = '22023'; END IF;
    IF v_kind = 'equipment' THEN
      IF v_eq IS NULL THEN RAISE EXCEPTION 'Wybierz sprzęt z magazynu.' USING ERRCODE = '22023'; END IF;
      SELECT e.name INTO v_name FROM public.equipment_items e WHERE e.id = v_eq AND e.deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono sprzętu w magazynie.' USING ERRCODE = '22023'; END IF;
      v_name := coalesce(nullif(btrim(coalesce(x->>'name', '')), ''), v_name);
    ELSE
      v_name := nullif(btrim(coalesce(x->>'name', '')), '');
      IF v_name IS NULL THEN RAISE EXCEPTION 'Podaj nazwę usługi.' USING ERRCODE = '22023'; END IF;
    END IF;
    v_item_id := nullif(x->>'id', '')::uuid;
    IF v_item_id IS NOT NULL THEN
      SELECT * INTO v_item FROM public.rental_order_items WHERE id = v_item_id AND rental_id = p_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Pozycja nie należy do tego wypożyczenia.' USING ERRCODE = '22023'; END IF;
      IF v_item.issued_qty > 0 AND (v_kind <> v_item.kind OR v_eq IS DISTINCT FROM v_item.equipment_id) THEN
        RAISE EXCEPTION '„%”: sprzęt został wydany — nie można go zamienić.', v_item.name USING ERRCODE = '22023';
      END IF;
      IF v_qty < v_item.issued_qty THEN
        RAISE EXCEPTION '„%”: wydano już % %, ilość nie może być mniejsza.', v_item.name, v_item.issued_qty, v_item.unit USING ERRCODE = '22023';
      END IF;
      UPDATE public.rental_order_items SET position = v_pos, kind = v_kind, equipment_id = v_eq,
             kit_id = CASE WHEN x ? 'kit_id' THEN nullif(x->>'kit_id', '')::uuid ELSE kit_id END, name = left(v_name, 300),
             quantity = v_qty, unit = coalesce(nullif(btrim(coalesce(x->>'unit', '')), ''), unit),
             price_mode = coalesce(nullif(x->>'price_mode', ''), price_mode),
             unit_price = coalesce(nullif(x->>'unit_price', '')::numeric, unit_price),
             days = CASE WHEN x ? 'days' THEN nullif(x->>'days', '')::numeric ELSE days END,
             discount_percent = coalesce(nullif(x->>'discount_percent', '')::numeric, discount_percent),
             replacement_value = CASE WHEN x ? 'replacement_value' THEN nullif(x->>'replacement_value', '')::numeric ELSE replacement_value END,
             note = CASE WHEN x ? 'note' THEN nullif(btrim(coalesce(x->>'note', '')), '') ELSE note END
       WHERE id = v_item_id;
    ELSE
      INSERT INTO public.rental_order_items(rental_id, position, kind, equipment_id, kit_id, name, quantity, unit, price_mode, unit_price,
        days, discount_percent, replacement_value, note)
      SELECT p_id, v_pos, v_kind, v_eq, nullif(x->>'kit_id', '')::uuid, left(v_name, 300), v_qty,
             coalesce(nullif(btrim(coalesce(x->>'unit', '')), ''), 'szt.'),
             coalesce(nullif(x->>'price_mode', ''), CASE WHEN v_kind = 'service' THEN 'flat' ELSE 'per_day' END),
             coalesce(nullif(x->>'unit_price', '')::numeric, e.rental_price_per_day, 0),
             nullif(x->>'days', '')::numeric, coalesce(nullif(x->>'discount_percent', '')::numeric, 0),
             coalesce(nullif(x->>'replacement_value', '')::numeric, e.current_value, e.purchase_price),
             nullif(btrim(coalesce(x->>'note', '')), '')
        FROM (SELECT 1) one LEFT JOIN public.equipment_items e ON e.id = v_eq
      RETURNING id INTO v_item_id;
    END IF;
    v_keep := v_keep || v_item_id;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.rental_order_items i WHERE i.rental_id = p_id AND NOT (i.id = ANY (v_keep)) AND i.issued_qty > 0) THEN
    RAISE EXCEPTION 'Nie można usunąć pozycji, która została wydana.' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.rental_order_items i WHERE i.rental_id = p_id AND NOT (i.id = ANY (v_keep));

  IF o.status IN ('reserved', 'issued') THEN
    v_short := private.rental_shortage_text(p_id);
    IF v_short <> '' THEN RAISE EXCEPTION 'Brakuje sprzętu w terminie wypożyczenia: %.', v_short USING ERRCODE = '23514'; END IF;
  END IF;
  PERFORM private.rental_log(p_id, 'sales', 'items', jsonb_build_object('count', cardinality(v_keep)));
  RETURN public.rental_get(p_id);
END $$;

-- Dostępność sprzętu wypożyczenia w jego terminie (bez niego samego) — ilości, które wypożyczenie trzyma (jak `rental_shortage_text`).
CREATE FUNCTION public.rental_availability(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.rental_orders%ROWTYPE;
BEGIN
  PERFORM private.require_crm_employee();
  SELECT * INTO o FROM public.rental_orders WHERE id = p_id;
  IF NOT FOUND OR NOT public.rental_can(p_id, 'view') THEN RAISE EXCEPTION 'Nie masz dostępu do tego wypożyczenia.' USING ERRCODE = '42501'; END IF;
  RETURN private.rental_availability_json(o.starts_at, o.ends_at,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('equipment_id', i.equipment_id, 'quantity', i.quantity - i.returned_ok_qty
               - i.damaged_back_qty - i.damaged_out_qty - i.missing_back_qty - i.missing_out_qty)), '[]'::jsonb)
       FROM public.rental_order_items i WHERE i.rental_id = p_id AND i.kind = 'equipment'), p_id);
END $$;

-- Zmiana statusu przez sprzedaż: reserved (z draft; kontrola dostępności i pojazdów), draft (cofnięcie rezerwacji), cancelled
-- (przed wydaniem; po rezerwacji z powodem), settled (po zwrocie); returned z settled — administrator (cofnięcie rozliczenia).
CREATE FUNCTION public.rental_set_status(p_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.rental_orders%ROWTYPE; v_actor uuid := public.sales_employee_id(); v_note text := nullif(btrim(p_note), ''); v_short text;
BEGIN
  o := private.rental_lock(p_id, CASE WHEN p_status = 'returned' THEN 'admin' ELSE 'sales_manage' END,
                           'Nie masz uprawnień do zmiany statusu tego wypożyczenia.');
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN RAISE EXCEPTION 'Notatka może mieć najwyżej 1000 znaków.' USING ERRCODE = '22023'; END IF;
  IF p_status = 'reserved' THEN
    IF o.status <> 'draft' THEN RAISE EXCEPTION 'Zarezerwować można szkic wypożyczenia.' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rental_order_items i WHERE i.rental_id = p_id AND i.kind = 'equipment') THEN
      RAISE EXCEPTION 'Dodaj sprzęt do wypożyczenia.' USING ERRCODE = '22023';
    END IF;
    IF o.handover = 'delivery' AND o.delivery_address IS NULL AND o.delivery_location_id IS NULL THEN
      RAISE EXCEPTION 'Podaj adres dostawy.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rental_trips t WHERE t.rental_id = p_id AND t.vehicle_id IS NOT NULL
               AND (public.rental_vehicle_busy(t.vehicle_id, t.starts_at, t.ends_at, p_id)
                    OR NOT coalesce(public.is_vehicle_available(t.vehicle_id, t.starts_at, t.ends_at, NULL), false))) THEN
      RAISE EXCEPTION 'Pojazd dostawy lub odbioru jest zajęty w tym czasie.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.rental_orders SET status = 'reserved', reserved_at = now(), reserved_by = v_actor WHERE id = p_id;
    v_short := private.rental_shortage_text(p_id);
    IF v_short <> '' THEN RAISE EXCEPTION 'Brakuje sprzętu w terminie wypożyczenia: %.', v_short USING ERRCODE = '23514'; END IF;
    PERFORM private.rental_log(p_id, 'warehouse', 'reserved', '{}'::jsonb, v_note);
    PERFORM private.rental_notify(p_id, 'Nowe wypożyczenie do wydania',
      format('%s, wydanie %s, zwrot %s%s.', o.client_name, to_char(o.starts_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'),
             to_char(o.ends_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'), CASE WHEN o.handover = 'delivery' THEN ', z dostawą' ELSE '' END),
      'info', private.rental_people(p_id, ARRAY['warehouse']));
  ELSIF p_status = 'draft' THEN
    IF o.status <> 'reserved' THEN RAISE EXCEPTION 'Cofnąć można tylko rezerwację przed wydaniem.' USING ERRCODE = '22023'; END IF;
    UPDATE public.rental_orders SET status = 'draft', reserved_at = NULL, reserved_by = NULL WHERE id = p_id;
    PERFORM private.rental_log(p_id, 'warehouse', 'unreserved', '{}'::jsonb, v_note);
    PERFORM private.rental_notify(p_id, 'Wycofano rezerwację wypożyczenia', 'sprzęt wraca do dostępnych' || coalesce(' — ' || v_note, '') || '.',
      'info', private.rental_people(p_id, ARRAY['warehouse']));
  ELSIF p_status = 'cancelled' THEN
    IF o.status NOT IN ('draft', 'reserved') THEN RAISE EXCEPTION 'Anulować można wypożyczenie przed wydaniem sprzętu.' USING ERRCODE = '22023'; END IF;
    IF o.status = 'reserved' AND (v_note IS NULL OR length(v_note) < 3) THEN
      RAISE EXCEPTION 'Podaj powód anulowania.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor, cancel_reason = v_note WHERE id = p_id;
    PERFORM private.rental_log(p_id, CASE WHEN o.status = 'reserved' THEN 'warehouse' ELSE 'sales' END, 'cancelled', '{}'::jsonb, v_note);
    IF o.status = 'reserved' THEN
      PERFORM private.rental_notify(p_id, 'Anulowano wypożyczenie', coalesce(v_note, 'anulowane') || '.', 'warning',
        private.rental_people(p_id, ARRAY['warehouse']));
    END IF;
  ELSIF p_status = 'settled' THEN
    IF o.status <> 'returned' THEN RAISE EXCEPTION 'Rozliczyć można wypożyczenie po zwrocie sprzętu.' USING ERRCODE = '22023'; END IF;
    UPDATE public.rental_orders SET status = 'settled', settled_at = now(), settled_by = v_actor WHERE id = p_id;
    PERFORM private.rental_log(p_id, 'sales', 'settled', '{}'::jsonb, v_note);
  ELSIF p_status = 'returned' THEN
    IF o.status <> 'settled' THEN RAISE EXCEPTION 'Cofnąć można rozliczone wypożyczenie.' USING ERRCODE = '22023'; END IF;
    UPDATE public.rental_orders SET status = 'returned', settled_at = NULL, settled_by = NULL WHERE id = p_id;
    PERFORM private.rental_log(p_id, 'sales', 'unsettled', '{}'::jsonb, v_note);
  ELSE
    RAISE EXCEPTION 'Nieprawidłowy status wypożyczenia.' USING ERRCODE = '22023';
  END IF;
  RETURN p_status;
END $$;

-- Przejazdy (pełna lista po rodzaju: delivery, collection; pominięty — usunięty). Sprzedaż albo magazyn, przed zwrotem.
CREATE FUNCTION public.rental_set_trips(p_id uuid, p_trips jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.rental_orders%ROWTYPE; x jsonb; v_kinds text[] := '{}'; v_kind text; v_vehicle uuid; v_driver uuid; v_start timestamptz; v_end timestamptz;
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
  PERFORM private.rental_log(p_id, 'warehouse', 'trips', jsonb_build_object('kinds', to_jsonb(v_kinds)));
  RETURN public.rental_get(p_id);
END $$;

-- Naliczenia (pełna lista) — sprzedaż, od wydania do rozliczenia.
CREATE FUNCTION public.rental_set_charges(p_id uuid, p_charges jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.rental_orders%ROWTYPE; x jsonb; v_count integer := 0;
BEGIN
  o := private.rental_lock(p_id, 'sales_manage', 'Nie masz uprawnień do naliczeń tego wypożyczenia.');
  IF o.status NOT IN ('issued', 'returned') THEN RAISE EXCEPTION 'Naliczenia dodaje się po wydaniu, przed rozliczeniem.' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_charges) <> 'array' OR jsonb_array_length(p_charges) > 200 THEN
    RAISE EXCEPTION 'Nieprawidłowa lista naliczeń.' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.rental_charges WHERE rental_id = p_id;
  FOR x IN SELECT value FROM jsonb_array_elements(p_charges) LOOP
    IF nullif(x->>'item_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rental_order_items i
         WHERE i.id = (x->>'item_id')::uuid AND i.rental_id = p_id) THEN
      RAISE EXCEPTION 'Pozycja naliczenia nie należy do tego wypożyczenia.' USING ERRCODE = '22023';
    END IF;
    IF coalesce(x->>'kind', 'other') NOT IN ('damage', 'missing', 'late', 'cleaning', 'other') THEN
      RAISE EXCEPTION 'Nieprawidłowy rodzaj naliczenia.' USING ERRCODE = '22023';
    END IF;
    IF length(btrim(coalesce(x->>'description', ''))) NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'Opisz naliczenie (do 500 znaków).' USING ERRCODE = '22023';
    END IF;
    IF nullif(x->>'amount', '') IS NULL OR (x->>'amount')::numeric < 0 OR (x->>'amount')::numeric > 10000000 THEN
      RAISE EXCEPTION 'Podaj kwotę naliczenia netto.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.rental_charges(rental_id, item_id, kind, description, amount, created_by)
    VALUES (p_id, nullif(x->>'item_id', '')::uuid, coalesce(x->>'kind', 'other'), btrim(x->>'description'),
            round((x->>'amount')::numeric, 2), public.sales_employee_id());
    v_count := v_count + 1;
  END LOOP;
  PERFORM private.rental_log(p_id, 'sales', 'charges', jsonb_build_object('count', v_count, 'net', (private.rental_totals(p_id)->>'charges_net')::numeric));
  RETURN public.rental_get(p_id);
END $$;

-- Powiązanie faktury z Finansów z wypożyczeniem (p_link = false — odłączenie).
CREATE FUNCTION public.rental_link_invoice(p_id uuid, p_invoice uuid, p_kind text DEFAULT 'rental', p_link boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.rental_orders%ROWTYPE;
BEGIN
  o := private.rental_lock(p_id, 'sales_manage', 'Nie masz uprawnień do faktur tego wypożyczenia.');
  IF p_link THEN
    IF o.status IN ('draft', 'cancelled') THEN RAISE EXCEPTION 'Fakturę dołącza się do zarezerwowanego wypożyczenia.' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = p_invoice) THEN RAISE EXCEPTION 'Nie znaleziono faktury.' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.rental_invoices(rental_id, invoice_id, kind, created_by) VALUES (p_id, p_invoice, coalesce(p_kind, 'rental'), public.sales_employee_id())
    ON CONFLICT (rental_id, invoice_id) DO UPDATE SET kind = EXCLUDED.kind;
  ELSE
    DELETE FROM public.rental_invoices WHERE rental_id = p_id AND invoice_id = p_invoice;
  END IF;
  PERFORM private.rental_log(p_id, 'sales', CASE WHEN p_link THEN 'invoice_linked' ELSE 'invoice_unlinked' END,
    jsonb_build_object('invoice_id', p_invoice, 'number', (SELECT i.invoice_number FROM public.invoices i WHERE i.id = p_invoice)));
  RETURN public.rental_get(p_id);
END $$;

-- ─── Magazyn: wydanie, odbiór, rozbieżności ───────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION private.rental_valid_photos(p_rental uuid, p_photos jsonb)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v text[];
BEGIN
  IF p_photos IS NULL OR jsonb_typeof(p_photos) <> 'array' THEN RETURN '{}'::text[]; END IF;
  SELECT coalesce(array_agg(x), '{}'::text[]) INTO v FROM jsonb_array_elements_text(p_photos) x;
  IF cardinality(v) > 10 THEN RAISE EXCEPTION 'Najwyżej 10 zdjęć na pozycję.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v) ph WHERE ph IS NULL OR ph NOT LIKE p_rental::text || '/warehouse/%' OR ph LIKE '%..%') THEN
    RAISE EXCEPTION 'Nieprawidłowa ścieżka zdjęcia.' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END $$;

-- Protokół wydania (WZ): p_lines [{item_id, qty, note, photos}] — wydawana ilość (najwyżej do ilości pozycji). Wydanie mniejszej
-- ilości niż pozostało wymaga opisu. Pierwsze wydanie zmienia status na „Wydane”.
CREATE FUNCTION public.rental_issue(p_id uuid, p_lines jsonb, p_person text, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  o public.rental_orders%ROWTYPE; x jsonb; i public.rental_order_items%ROWTYPE; v_protocol uuid; v_seq integer; v_qty integer;
  v_lines integer := 0; v_note text := nullif(btrim(p_note), ''); v_actor uuid := public.sales_employee_id(); v_line_note text;
  v_items uuid[] := '{}';
BEGIN
  o := private.rental_lock(p_id, 'warehouse_act', 'Sprzęt wypożyczenia wydaje magazyn.');
  IF o.status NOT IN ('reserved', 'issued') THEN RAISE EXCEPTION 'Wydać można zarezerwowane wypożyczenie.' USING ERRCODE = '22023'; END IF;
  IF length(btrim(coalesce(p_person, ''))) < 2 THEN RAISE EXCEPTION 'Podaj, kto odbiera sprzęt.' USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN RAISE EXCEPTION 'Uwagi mogą mieć najwyżej 2000 znaków.' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista pozycji.' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(max(seq), 0) + 1 INTO v_seq FROM public.rental_protocols WHERE rental_id = p_id AND kind = 'issue';
  INSERT INTO public.rental_protocols(rental_id, kind, seq, number, person_name, note, created_by, created_by_name)
  VALUES (p_id, 'issue', v_seq, o.number || '/WZ' || v_seq, left(btrim(p_person), 200), v_note, v_actor, private.rental_actor_name(v_actor))
  RETURNING id INTO v_protocol;
  FOR x IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_qty := coalesce(nullif(x->>'qty', '')::integer, 0);
    CONTINUE WHEN v_qty = 0;
    SELECT * INTO i FROM public.rental_order_items WHERE id = nullif(x->>'item_id', '')::uuid AND rental_id = p_id FOR UPDATE;
    IF NOT FOUND OR i.kind <> 'equipment' THEN RAISE EXCEPTION 'Pozycja nie należy do sprzętu tego wypożyczenia.' USING ERRCODE = '22023'; END IF;
    IF i.id = ANY (v_items) THEN RAISE EXCEPTION '„%” występuje w protokole dwa razy.', i.name USING ERRCODE = '22023'; END IF;
    v_items := v_items || i.id;
    IF v_qty < 0 OR v_qty > i.quantity - i.issued_qty THEN
      RAISE EXCEPTION '„%”: można wydać najwyżej % %.', i.name, i.quantity - i.issued_qty, i.unit USING ERRCODE = '22023';
    END IF;
    v_line_note := nullif(btrim(coalesce(x->>'note', '')), '');
    IF v_qty < i.quantity - i.issued_qty AND (v_line_note IS NULL OR length(v_line_note) < 3) THEN
      RAISE EXCEPTION '„%”: wydajesz % z % % — opisz brak przy wydaniu.', i.name, v_qty, i.quantity - i.issued_qty, i.unit USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.rental_protocol_lines(protocol_id, item_id, qty, note, photos)
    VALUES (v_protocol, i.id, v_qty, v_line_note, private.rental_valid_photos(p_id, x->'photos'));
    UPDATE public.rental_order_items SET issued_qty = issued_qty + v_qty WHERE id = i.id;
    v_lines := v_lines + 1;
  END LOOP;
  IF v_lines = 0 THEN RAISE EXCEPTION 'Wpisz ilości wydawanego sprzętu.' USING ERRCODE = '22023'; END IF;
  IF o.status = 'reserved' THEN UPDATE public.rental_orders SET status = 'issued', issued_at = now() WHERE id = p_id; END IF;
  PERFORM private.rental_log(p_id, 'warehouse', 'issued', jsonb_build_object('protocol', o.number || '/WZ' || v_seq, 'lines', v_lines), v_note);
  PERFORM private.rental_notify(p_id, 'Wydano sprzęt z wypożyczenia',
    format('protokół %s, odebrał(a) %s.', o.number || '/WZ' || v_seq, btrim(p_person)), 'success', private.rental_people(p_id, ARRAY['sales']));
  RETURN v_protocol;
END $$;

-- Protokół odbioru (PZ): p_lines [{item_id, ok, damaged, missing, note, photos}] — razem najwyżej tyle, ile jest u klienta;
-- uszkodzenia i braki wymagają opisu. Gdy wszystko wróciło (sprawne, uszkodzone albo brak) — status „Zwrócone”.
CREATE FUNCTION public.rental_return(p_id uuid, p_lines jsonb, p_person text, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  o public.rental_orders%ROWTYPE; x jsonb; i public.rental_order_items%ROWTYPE; v_protocol uuid; v_seq integer;
  v_ok integer; v_damaged integer; v_missing integer; v_out integer; v_lines integer := 0; v_issues text[] := '{}';
  v_note text := nullif(btrim(p_note), ''); v_actor uuid := public.sales_employee_id(); v_line_note text; v_items uuid[] := '{}';
  v_done boolean;
BEGIN
  o := private.rental_lock(p_id, 'warehouse_act', 'Zwrot sprzętu przyjmuje magazyn.');
  IF o.status <> 'issued' THEN RAISE EXCEPTION 'Przyjąć zwrot można po wydaniu sprzętu.' USING ERRCODE = '22023'; END IF;
  IF length(btrim(coalesce(p_person, ''))) < 2 THEN RAISE EXCEPTION 'Podaj, kto zwraca sprzęt.' USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN RAISE EXCEPTION 'Uwagi mogą mieć najwyżej 2000 znaków.' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista pozycji.' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(max(seq), 0) + 1 INTO v_seq FROM public.rental_protocols WHERE rental_id = p_id AND kind = 'return';
  INSERT INTO public.rental_protocols(rental_id, kind, seq, number, person_name, note, created_by, created_by_name)
  VALUES (p_id, 'return', v_seq, o.number || '/PZ' || v_seq, left(btrim(p_person), 200), v_note, v_actor, private.rental_actor_name(v_actor))
  RETURNING id INTO v_protocol;
  FOR x IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_ok := coalesce(nullif(x->>'ok', '')::integer, 0);
    v_damaged := coalesce(nullif(x->>'damaged', '')::integer, 0);
    v_missing := coalesce(nullif(x->>'missing', '')::integer, 0);
    CONTINUE WHEN v_ok = 0 AND v_damaged = 0 AND v_missing = 0;
    SELECT * INTO i FROM public.rental_order_items WHERE id = nullif(x->>'item_id', '')::uuid AND rental_id = p_id FOR UPDATE;
    IF NOT FOUND OR i.kind <> 'equipment' THEN RAISE EXCEPTION 'Pozycja nie należy do sprzętu tego wypożyczenia.' USING ERRCODE = '22023'; END IF;
    IF i.id = ANY (v_items) THEN RAISE EXCEPTION '„%” występuje w protokole dwa razy.', i.name USING ERRCODE = '22023'; END IF;
    v_items := v_items || i.id;
    v_out := i.issued_qty - i.returned_ok_qty - i.returned_damaged_qty - i.returned_missing_qty;
    IF v_ok < 0 OR v_damaged < 0 OR v_missing < 0 OR v_ok + v_damaged + v_missing > v_out THEN
      RAISE EXCEPTION '„%”: sprawne, uszkodzone i brakujące razem mogą dać najwyżej % % (tyle jest u klienta).', i.name, v_out, i.unit
        USING ERRCODE = '22023';
    END IF;
    v_line_note := nullif(btrim(coalesce(x->>'note', '')), '');
    IF v_damaged + v_missing > 0 AND (v_line_note IS NULL OR length(v_line_note) < 3) THEN
      RAISE EXCEPTION '„%”: opisz uszkodzenia lub brak (co, ile, co się stało).', i.name USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.rental_protocol_lines(protocol_id, item_id, qty, damaged, missing, note, photos)
    VALUES (v_protocol, i.id, v_ok, v_damaged, v_missing, v_line_note, private.rental_valid_photos(p_id, x->'photos'));
    UPDATE public.rental_order_items SET returned_ok_qty = returned_ok_qty + v_ok, returned_damaged_qty = returned_damaged_qty + v_damaged,
           returned_missing_qty = returned_missing_qty + v_missing WHERE id = i.id;
    IF v_damaged + v_missing > 0 THEN
      v_issues := v_issues || format('%s: %s', i.name, concat_ws(', ', CASE WHEN v_damaged > 0 THEN v_damaged || ' uszk.' END,
                                                              CASE WHEN v_missing > 0 THEN v_missing || ' brak' END));
    END IF;
    v_lines := v_lines + 1;
  END LOOP;
  IF v_lines = 0 THEN RAISE EXCEPTION 'Wpisz ilości zwracanego sprzętu.' USING ERRCODE = '22023'; END IF;
  SELECT NOT EXISTS (SELECT 1 FROM public.rental_order_items i2 WHERE i2.rental_id = p_id
                     AND i2.issued_qty - i2.returned_ok_qty - i2.returned_damaged_qty - i2.returned_missing_qty > 0) INTO v_done;
  IF v_done THEN UPDATE public.rental_orders SET status = 'returned', returned_at = now() WHERE id = p_id; END IF;
  PERFORM private.rental_log(p_id, 'warehouse', CASE WHEN v_done THEN 'returned' ELSE 'returned_partly' END,
    jsonb_build_object('protocol', o.number || '/PZ' || v_seq, 'lines', v_lines, 'issues', to_jsonb(v_issues)), v_note);
  IF cardinality(v_issues) > 0 THEN
    PERFORM private.rental_notify(p_id, 'Rozbieżności w zwrocie wypożyczenia',
      array_to_string(v_issues, '; ') || coalesce('. ' || v_note, '') || '. Zdecyduj o naliczeniach dla klienta.', 'warning',
      private.rental_people(p_id, ARRAY['sales']));
  END IF;
  RETURN v_protocol;
END $$;

-- Rozstrzygnięcie rozbieżności pozycji (magazyn): damaged_back — sprawne po sprawdzeniu / naprawione (wraca na stan),
-- damaged_service — egzemplarze do serwisu (status „Uszkodzony”), damaged_write_off / missing_write_off — spisane ze stanu
-- (egzemplarze „Wycofany”, sprzęt bez egzemplarzy — mniejsza ilość), missing_back — oddane później (wraca na stan).
CREATE FUNCTION public.rental_resolve(p_item uuid, p_action text, p_qty integer, p_unit_ids uuid[] DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  i public.rental_order_items%ROWTYPE; o public.rental_orders%ROWTYPE; v_open integer; v_units boolean; v_note text := nullif(btrim(p_note), '');
  v_actor uuid := public.sales_employee_id(); v_ids uuid[] := coalesce(p_unit_ids, '{}'::uuid[]); v_total integer; v_status text;
BEGIN
  PERFORM private.require_crm_employee();
  SELECT * INTO i FROM public.rental_order_items WHERE id = p_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pozycji wypożyczenia.' USING ERRCODE = 'P0002'; END IF;
  o := private.rental_lock(i.rental_id, 'warehouse_act', 'Rozbieżności rozstrzyga magazyn.');
  SELECT * INTO i FROM public.rental_order_items WHERE id = p_item FOR UPDATE;
  IF o.status NOT IN ('issued', 'returned', 'settled') THEN RAISE EXCEPTION 'Wypożyczenie nie ma rozbieżności do rozstrzygnięcia.' USING ERRCODE = '22023'; END IF;
  IF p_qty IS NULL OR p_qty < 1 THEN RAISE EXCEPTION 'Podaj ilość.' USING ERRCODE = '22023'; END IF;
  IF p_action LIKE 'damaged_%' THEN v_open := i.returned_damaged_qty - i.damaged_back_qty - i.damaged_out_qty;
  ELSIF p_action LIKE 'missing_%' THEN v_open := i.returned_missing_qty - i.missing_back_qty - i.missing_out_qty;
  ELSE RAISE EXCEPTION 'Nieprawidłowa czynność.' USING ERRCODE = '22023'; END IF;
  IF p_action NOT IN ('damaged_back', 'damaged_service', 'damaged_write_off', 'missing_back', 'missing_write_off') THEN
    RAISE EXCEPTION 'Nieprawidłowa czynność.' USING ERRCODE = '22023';
  END IF;
  IF p_qty > v_open THEN RAISE EXCEPTION '„%”: do rozstrzygnięcia zostało % %.', i.name, v_open, i.unit USING ERRCODE = '22023'; END IF;
  IF p_action IN ('damaged_service', 'damaged_write_off', 'missing_write_off') THEN
    IF v_note IS NULL OR length(v_note) < 3 THEN RAISE EXCEPTION 'Opisz decyzję (stan, przyczyna).' USING ERRCODE = '22023'; END IF;
    v_units := EXISTS (SELECT 1 FROM public.equipment_units u WHERE u.equipment_id = i.equipment_id);
    IF v_units THEN
      IF cardinality(v_ids) <> p_qty OR (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> p_qty THEN
        RAISE EXCEPTION 'Wskaż % egzemplarz(e/y).', p_qty USING ERRCODE = '22023';
      END IF;
      IF (SELECT count(*) FROM public.equipment_units u WHERE u.id = ANY (v_ids) AND u.equipment_id = i.equipment_id
            AND u.status IN ('available', 'reserved', 'in_use')) <> p_qty THEN
        RAISE EXCEPTION 'Wskazane egzemplarze nie należą do tego sprzętu albo nie są na stanie.' USING ERRCODE = '22023';
      END IF;
      v_status := CASE WHEN p_action = 'damaged_service' THEN 'damaged' ELSE 'retired' END;
      UPDATE public.equipment_units u SET status = v_status,
             condition_notes = left(concat_ws(E'\n', nullif(u.condition_notes, ''), format('%s — wypożyczenie %s: %s', to_char(now() AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY'), o.number, v_note)), 2000)
       WHERE u.id = ANY (v_ids);
      INSERT INTO public.equipment_unit_events(unit_id, event_type, description, employee_id)
      SELECT x, CASE WHEN p_action = 'damaged_service' THEN 'damage' ELSE 'note' END,
             left(format('Wypożyczenie %s: %s', o.number, v_note), 1000), v_actor FROM unnest(v_ids) x;
    ELSIF p_action = 'damaged_service' THEN
      RAISE EXCEPTION '„%” nie ma egzemplarzy — wybierz „Sprawne” albo „Spisz ze stanu”.', i.name USING ERRCODE = '22023';
    ELSE
      SELECT greatest(coalesce(e.total_quantity, 0), 0) INTO v_total FROM public.equipment_items e WHERE e.id = i.equipment_id FOR UPDATE;
      IF v_total < p_qty THEN RAISE EXCEPTION '„%”: na stanie jest tylko % %.', i.name, v_total, i.unit USING ERRCODE = '22023'; END IF;
      UPDATE public.equipment_items SET total_quantity = v_total - p_qty WHERE id = i.equipment_id;
      INSERT INTO public.equipment_stock_history(equipment_id, change_type, quantity_change, quantity_after, employee_id, notes)
      VALUES (i.equipment_id, 'write_off', -p_qty, v_total - p_qty, v_actor, left(format('Wypożyczenie %s: %s', o.number, v_note), 1000));
    END IF;
  END IF;
  UPDATE public.rental_order_items SET
         damaged_back_qty = damaged_back_qty + CASE WHEN p_action = 'damaged_back' THEN p_qty ELSE 0 END,
         damaged_out_qty = damaged_out_qty + CASE WHEN p_action IN ('damaged_service', 'damaged_write_off') THEN p_qty ELSE 0 END,
         missing_back_qty = missing_back_qty + CASE WHEN p_action = 'missing_back' THEN p_qty ELSE 0 END,
         missing_out_qty = missing_out_qty + CASE WHEN p_action = 'missing_write_off' THEN p_qty ELSE 0 END
   WHERE id = p_item;
  PERFORM private.rental_log(o.id, 'warehouse', p_action, jsonb_build_object('item', i.name, 'qty', p_qty, 'units', to_jsonb(v_ids)), v_note);
  RETURN public.rental_get(o.id);
END $$;

-- Uwagi magazynu (magazyn albo sprzedaż).
CREATE FUNCTION public.rental_set_warehouse_note(p_id uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM private.require_crm_employee();
  IF NOT (public.rental_can(p_id, 'warehouse_act') OR public.rental_can(p_id, 'sales_manage')) THEN
    RAISE EXCEPTION 'Nie masz uprawnień do uwag tego wypożyczenia.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.rental_orders SET warehouse_note = left(nullif(btrim(p_note), ''), 4000) WHERE id = p_id;
  PERFORM private.rental_log(p_id, 'warehouse', 'warehouse_note');
END $$;

-- ─── Pliki ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Ścieżka w buckecie `rental-files`: <wypożyczenie>/<sales|warehouse>/… — odczyt: sprzedaż (sales) albo każdy z dostępem
-- (warehouse); zapis i usuwanie: sprzedaż (oba obszary) albo magazyn (warehouse).
CREATE FUNCTION public.rental_storage_can(p_name text, p_what text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_parts text[] := string_to_array(coalesce(p_name, ''), '/'); v_rental uuid;
BEGIN
  IF cardinality(v_parts) < 3 OR v_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR v_parts[2] NOT IN ('sales', 'warehouse') OR p_name LIKE '%..%' THEN RETURN false; END IF;
  v_rental := v_parts[1]::uuid;
  IF p_what = 'read' THEN
    RETURN CASE WHEN v_parts[2] = 'sales' THEN public.rental_can(v_rental, 'sales_view') ELSE public.rental_can(v_rental, 'view') END;
  END IF;
  RETURN public.rental_can(v_rental, 'sales_manage') OR (v_parts[2] = 'warehouse' AND public.rental_can(v_rental, 'warehouse_act'));
END $$;

-- Plik przesłany do `rental-files` dopisany do wypożyczenia (skan podpisanego protokołu, zdjęcie, dokument).
CREATE FUNCTION public.rental_add_file(p_id uuid, p_path text, p_name text, p_mime text, p_size bigint, p_kind text DEFAULT 'scan', p_protocol uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_area text := split_part(coalesce(p_path, ''), '/', 2); v_id uuid;
BEGIN
  PERFORM private.require_crm_employee();
  IF split_part(coalesce(p_path, ''), '/', 1) <> p_id::text OR NOT public.rental_storage_can(p_path, 'write') THEN
    RAISE EXCEPTION 'Nie masz uprawnień do dodania tego pliku.' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('scan', 'photo', 'document') THEN RAISE EXCEPTION 'Nieprawidłowy rodzaj pliku.' USING ERRCODE = '22023'; END IF;
  IF p_protocol IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rental_protocols p WHERE p.id = p_protocol AND p.rental_id = p_id) THEN
    RAISE EXCEPTION 'Protokół nie należy do tego wypożyczenia.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rental_files(rental_id, protocol_id, area, kind, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  VALUES (p_id, p_protocol, v_area, p_kind, p_path, left(coalesce(nullif(btrim(p_name), ''), 'plik'), 300), p_mime, p_size, public.sales_employee_id())
  RETURNING id INTO v_id;
  PERFORM private.rental_log(p_id, v_area, 'file_added', jsonb_build_object('name', p_name, 'kind', p_kind));
  RETURN v_id;
END $$;

-- Usunięcie wpisu pliku; zwraca ścieżkę do usunięcia z magazynu plików.
CREATE FUNCTION public.rental_remove_file(p_file uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE f public.rental_files%ROWTYPE;
BEGIN
  PERFORM private.require_crm_employee();
  SELECT * INTO f FROM public.rental_files WHERE id = p_file;
  IF NOT FOUND OR NOT public.rental_storage_can(f.storage_path, 'write') THEN
    RAISE EXCEPTION 'Nie masz uprawnień do usunięcia tego pliku.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.rental_files WHERE id = p_file;
  PERFORM private.rental_log(f.rental_id, f.area, 'file_removed', jsonb_build_object('name', f.file_name));
  RETURN f.storage_path;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rental-files', 'rental-files', false, 26214400,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY rental_storage_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rental-files' AND public.rental_storage_can(name, 'read'));
CREATE POLICY rental_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rental-files' AND public.rental_storage_can(name, 'write'));
CREATE POLICY rental_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'rental-files' AND public.rental_storage_can(name, 'write'));

-- ─── RLS i uprawnienia ────────────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.rental_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_protocol_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rental_orders, public.rental_order_items, public.rental_trips, public.rental_protocols, public.rental_protocol_lines,
  public.rental_files, public.rental_charges, public.rental_invoices, public.rental_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rental_orders, public.rental_order_items, public.rental_trips, public.rental_protocols, public.rental_protocol_lines,
  public.rental_files, public.rental_charges, public.rental_invoices, public.rental_log TO authenticated;
GRANT ALL ON public.rental_orders, public.rental_order_items, public.rental_trips, public.rental_protocols, public.rental_protocol_lines,
  public.rental_files, public.rental_charges, public.rental_invoices, public.rental_log TO service_role;

CREATE POLICY rental_orders_read ON public.rental_orders FOR SELECT TO authenticated USING (public.rental_can(id, 'sales_view'));
CREATE POLICY rental_order_items_read ON public.rental_order_items FOR SELECT TO authenticated USING (public.rental_can(rental_id, 'sales_view'));
CREATE POLICY rental_trips_read ON public.rental_trips FOR SELECT TO authenticated USING (public.rental_can(rental_id, 'view'));
CREATE POLICY rental_protocols_read ON public.rental_protocols FOR SELECT TO authenticated USING (public.rental_can(rental_id, 'view'));
CREATE POLICY rental_protocol_lines_read ON public.rental_protocol_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rental_protocols p WHERE p.id = protocol_id AND public.rental_can(p.rental_id, 'view')));
CREATE POLICY rental_files_read ON public.rental_files FOR SELECT TO authenticated
  USING (public.rental_can(rental_id, CASE WHEN area = 'sales' THEN 'sales_view' ELSE 'view' END));
CREATE POLICY rental_charges_read ON public.rental_charges FOR SELECT TO authenticated USING (public.rental_can(rental_id, 'sales_view'));
CREATE POLICY rental_invoices_read ON public.rental_invoices FOR SELECT TO authenticated USING (public.rental_can(rental_id, 'sales_view'));
CREATE POLICY rental_log_read ON public.rental_log FOR SELECT TO authenticated
  USING (public.rental_can(rental_id, CASE WHEN area = 'sales' THEN 'sales_view' ELSE 'view' END));

REVOKE ALL ON private.rental_demand FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  private.rental_lock(uuid, text, text), private.rental_actor_name(uuid), private.rental_log(uuid, text, text, jsonb, text),
  private.rental_people(uuid, text[]), private.rental_notify(uuid, text, text, text, uuid[]), private.rental_event_demand(timestamptz, timestamptz),
  private.rental_availability_json(timestamptz, timestamptz, jsonb, uuid), private.rental_shortage_text(uuid),
  private.rental_default_days(timestamptz, timestamptz), private.rental_totals(uuid), private.rental_valid_photos(uuid, jsonb)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.rental_access(uuid), public.rental_can(uuid, text), public.rental_equipment_demands(timestamptz, timestamptz, uuid),
  public.rental_equipment_demand(uuid, timestamptz, timestamptz, uuid), public.rental_check_availability(timestamptz, timestamptz, jsonb, uuid),
  public.rental_vehicle_busy(uuid, timestamptz, timestamptz, uuid), public.rental_vehicle_conflicts(uuid, timestamptz, timestamptz, uuid),
  public.rental_list(jsonb), public.rental_get(uuid), public.rental_item_units(uuid), public.rental_save(uuid, jsonb),
  public.rental_set_items(uuid, jsonb), public.rental_availability(uuid), public.rental_set_status(uuid, text, text),
  public.rental_set_trips(uuid, jsonb), public.rental_set_charges(uuid, jsonb), public.rental_link_invoice(uuid, uuid, text, boolean),
  public.rental_issue(uuid, jsonb, text, text), public.rental_return(uuid, jsonb, text, text),
  public.rental_resolve(uuid, text, integer, uuid[], text), public.rental_set_warehouse_note(uuid, text),
  public.rental_storage_can(text, text), public.rental_add_file(uuid, text, text, text, bigint, text, uuid), public.rental_remove_file(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.rental_access(uuid), public.rental_can(uuid, text), public.rental_equipment_demands(timestamptz, timestamptz, uuid),
  public.rental_equipment_demand(uuid, timestamptz, timestamptz, uuid), public.rental_check_availability(timestamptz, timestamptz, jsonb, uuid),
  public.rental_vehicle_busy(uuid, timestamptz, timestamptz, uuid), public.rental_vehicle_conflicts(uuid, timestamptz, timestamptz, uuid),
  public.rental_list(jsonb), public.rental_get(uuid), public.rental_item_units(uuid), public.rental_save(uuid, jsonb),
  public.rental_set_items(uuid, jsonb), public.rental_availability(uuid), public.rental_set_status(uuid, text, text),
  public.rental_set_trips(uuid, jsonb), public.rental_set_charges(uuid, jsonb), public.rental_link_invoice(uuid, uuid, text, boolean),
  public.rental_issue(uuid, jsonb, text, text), public.rental_return(uuid, jsonb, text, text),
  public.rental_resolve(uuid, text, integer, uuid[], text), public.rental_set_warehouse_note(uuid, text),
  public.rental_storage_can(text, text), public.rental_add_file(uuid, text, text, text, bigint, text, uuid), public.rental_remove_file(uuid)
TO authenticated, service_role;

-- ─── Wspólna dostępność: eventy, oferty i pojazdy liczą wypożyczenia ──────────────────────────────────────────────────────
-- Zmiana dokładnie jednego fragmentu w aktualnej definicji funkcji (te same atrybuty i uprawnienia); ponowne uruchomienie
-- niczego nie dubluje, a niezgodna definicja zatrzymuje migrację.
CREATE FUNCTION private.rental_patch_function(p_fn regprocedure, p_old text, p_new text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_def text := pg_get_functiondef(p_fn); v_old integer; v_new integer;
BEGIN
  v_new := (length(v_def) - length(replace(v_def, p_new, ''))) / length(p_new);
  IF v_new >= 1 THEN RETURN; END IF;
  v_old := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old <> 1 THEN
    RAISE EXCEPTION 'Rental: nie można bezpiecznie zmienić funkcji % (fragment występuje % razy).', p_fn, v_old;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END $$;

-- Zakładka Sprzęt eventu (CRM, Mac): rezerwacje innych eventów + wypożyczenia.
SELECT private.rental_patch_function('public.check_equipment_inventory_for_event(uuid,timestamp with time zone,timestamp with time zone)',
$old$OVERLAPS (p_start_date,p_end_date)
  ), equipment_stock AS ($old$,
$new$OVERLAPS (p_start_date,p_end_date)
    UNION ALL
    -- Rental: wypożyczenia klientom (rezerwacje, sprzęt u klienta, nierozstrzygnięte uszkodzenia i braki).
    SELECT r.equipment_id, r.qty::numeric FROM public.rental_equipment_demands(p_start_date, p_end_date) r
  ), equipment_stock AS ($new$);

-- Dostępność pojedynczego sprzętu eventu (Mac).
SELECT private.rental_patch_function('public.check_single_equipment_availability_for_event(uuid,uuid,timestamp with time zone,timestamp with time zone)',
$old$SELECT direct.quantity + kit.quantity$old$,
$new$SELECT direct.quantity + kit.quantity + public.rental_equipment_demand(p_equipment_id, p_start_date, p_end_date)$new$);

-- Konflikty sprzętu w kreatorze oferty.
SELECT private.rental_patch_function('public.check_offer_cart_equipment_conflicts_v2(uuid,jsonb,jsonb)',
$old$    v_available := GREATEST(COALESCE(v_total, 0) - COALESCE(v_reserved, 0), 0);$old$,
$new$    -- Rental: wypożyczenia klientom w terminie eventu.
    v_reserved := COALESCE(v_reserved, 0) + public.rental_equipment_demand(v_item_id::uuid, v_start_date, v_end_date);
    v_available := GREATEST(COALESCE(v_total, 0) - COALESCE(v_reserved, 0), 0);$new$);

-- Rezerwacja sprzętu po akceptacji oferty: sprzęt i składniki zestawów.
SELECT private.rental_patch_function('public.get_offer_equipment_for_reservation(uuid,uuid)',
$old$), 0)
      INTO v_item_name, v_total_qty, v_reserved_qty
      FROM public.equipment_items item$old$,
$new$), 0) + public.rental_equipment_demand(item.id, v_start_date, v_end_date)
      INTO v_item_name, v_total_qty, v_reserved_qty
      FROM public.equipment_items item$new$);
SELECT private.rental_patch_function('public.get_offer_equipment_for_reservation(uuid,uuid)',
$old$AND unit.status IN ('available', 'reserved', 'in_use')) AS stock_qty$old$,
$new$AND unit.status IN ('available', 'reserved', 'in_use'))
               - public.rental_equipment_demand(kit_item.equipment_id, v_start_date, v_end_date) AS stock_qty$new$);
SELECT private.rental_patch_function('public.get_offer_equipment_for_reservation(uuid,uuid)',
$old$SELECT min(floor(component.stock_qty::numeric / component.required_qty))::integer$old$,
$new$SELECT greatest(min(floor(component.stock_qty::numeric / component.required_qty)), 0)::integer$new$);

-- Rezerwacja zestawu w evencie: składnik wypożyczony klientowi w terminie eventu.
SELECT private.rental_patch_function('public.validate_event_kit_inventory()',
$old$    ) SELECT coalesce(sum(qty),0) INTO v_total FROM demand;$old$,
$new$      UNION ALL
      -- Rental: składnik wypożyczony klientowi w terminie eventu.
      SELECT public.rental_equipment_demand(v_component.equipment_id, v_event.event_date,
        coalesce(v_event.event_end_date, v_event.event_date+interval '1 day'))::numeric WHERE v_component.equipment_id IS NOT NULL
    ) SELECT coalesce(sum(qty),0) INTO v_total FROM demand;$new$);

-- Pojazd eventu: zajęty przez dostawę lub odbiór wypożyczenia.
SELECT private.rental_patch_function('public.is_vehicle_available(uuid,timestamp with time zone,timestamp with time zone,uuid)',
$old$SELECT COUNT(*) INTO v_conflict_count
FROM maintenance_records mr$old$,
$new$-- Rental: dostawa lub odbiór wypożyczenia.
IF public.rental_vehicle_busy(p_vehicle_id, p_start_date, p_end_date, NULL) THEN
RETURN false;
END IF;

SELECT COUNT(*) INTO v_conflict_count
FROM maintenance_records mr$new$);

DROP FUNCTION private.rental_patch_function(regprocedure, text, text);

COMMIT;
