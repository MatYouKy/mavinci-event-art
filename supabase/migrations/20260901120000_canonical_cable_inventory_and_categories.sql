-- Kanoniczny model przewodow: klasyfikacja branzowa, historia stanu i
-- dostepnosc uwzgledniajaca rezerwacje wydarzen.

CREATE TABLE IF NOT EXISTS public.cable_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.cable_categories(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  color text NOT NULL DEFAULT '#d3bb73',
  order_index integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.cable_categories (slug, name, description, color, order_index)
VALUES
  ('power', 'Zasilanie', 'Zasilanie urządzeń i dystrybucja energii.', '#ef4444', 10),
  ('audio', 'Audio', 'Analogowe i cyfrowe połączenia dźwiękowe.', '#3b82f6', 20),
  ('video', 'Wizja', 'Transmisja obrazu analogowego i cyfrowego.', '#8b5cf6', 30),
  ('lighting-control', 'Sterowanie oświetleniem', 'DMX oraz pozostałe protokoły sterowania oświetleniem.', '#f59e0b', 40),
  ('data-control', 'Dane i sterowanie', 'Sieci komputerowe, USB, MIDI i przewody sterujące.', '#06b6d4', 50),
  ('fiber', 'Światłowody', 'Połączenia optyczne audio, wideo i danych.', '#22c55e', 60),
  ('communication-rf', 'Komunikacja i RF', 'Interkom, anteny, synchronizacja radiowa i komunikacja techniczna.', '#ec4899', 70),
  ('special', 'Specjalistyczne', 'Multicore, hybrydy, patch i nietypowe przewody.', '#d3bb73', 80)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  color = EXCLUDED.color,
  order_index = EXCLUDED.order_index,
  is_active = true,
  updated_at = now();

WITH definitions(parent_slug, slug, name, description, color, order_index) AS (
  VALUES
    ('power', 'power-mains', 'Zasilające 230/400 V', 'Schuko, CEE i główne przewody zasilające.', '#ef4444', 11),
    ('power', 'power-device', 'Zasilanie urządzeń', 'IEC, PowerCON i przewody zasilające urządzenia.', '#ef4444', 12),
    ('power', 'power-extension', 'Przedłużacze i dystrybucja', 'Przedłużacze, listwy oraz rozdzielnie.', '#ef4444', 13),
    ('audio', 'audio-analog', 'Audio analogowe', 'XLR, Jack, RCA i pozostałe analogowe połączenia audio.', '#3b82f6', 21),
    ('audio', 'audio-digital', 'Audio cyfrowe', 'AES/EBU, S/PDIF, ADAT i cyfrowe połączenia audio.', '#3b82f6', 22),
    ('audio', 'audio-speaker', 'Głośnikowe', 'Speakon i przewody mocy do zestawów głośnikowych.', '#3b82f6', 23),
    ('video', 'video-hdmi-dp', 'HDMI i DisplayPort', 'Cyfrowe połączenia obrazu HDMI i DisplayPort.', '#8b5cf6', 31),
    ('video', 'video-sdi-coax', 'SDI i koncentryczne', 'BNC, SDI oraz pozostałe tory koncentryczne.', '#8b5cf6', 32),
    ('video', 'video-analog', 'Wizja analogowa', 'VGA, component, composite i starsze standardy wizji.', '#8b5cf6', 33),
    ('lighting-control', 'lighting-dmx', 'DMX', 'Przewody DMX 3-pin, 5-pin i ich warianty.', '#f59e0b', 41),
    ('lighting-control', 'lighting-combined', 'Oświetleniowe hybrydowe', 'Połączone zasilanie i sterowanie oświetleniem.', '#f59e0b', 42),
    ('data-control', 'data-network', 'Sieciowe', 'Ethernet, EtherCON i przewody sieciowe.', '#06b6d4', 51),
    ('data-control', 'data-usb', 'USB i sterowanie', 'USB, przewody sterowników i urządzeń peryferyjnych.', '#06b6d4', 52),
    ('data-control', 'data-midi-timecode', 'MIDI i timecode', 'MIDI, LTC, synchronizacja i pozostałe sterowanie.', '#06b6d4', 53),
    ('data-control', 'data-serial-gpio', 'Szeregowe i automatyka', 'RS-232/422/485, GPIO, styki i przewody automatyki.', '#06b6d4', 54),
    ('fiber', 'fiber-data', 'Światłowód danych', 'OpticalCON, LC, SC i transmisja danych.', '#22c55e', 61),
    ('fiber', 'fiber-av', 'Światłowód AV', 'Optyczna transmisja audio i obrazu.', '#22c55e', 62),
    ('communication-rf', 'communication-intercom', 'Interkom i komunikacja', 'Przewody beltpacków, interkomu i komunikacji ekipy.', '#ec4899', 71),
    ('communication-rf', 'communication-antenna', 'Antenowe i RF', 'Przewody antenowe do mikrofonów, IEM, Wi-Fi i systemów radiowych.', '#ec4899', 72),
    ('special', 'special-multicore', 'Multicore i stagebox', 'Wielokanałowe przewody sceniczne i stageboxy.', '#d3bb73', 81),
    ('special', 'special-hybrid', 'Hybrydowe', 'Przewody łączące kilka mediów lub standardów.', '#d3bb73', 82),
    ('special', 'special-adapter-patch', 'Adaptery i patch', 'Krótkie połączenia, przejściówki i przewody krosowe.', '#d3bb73', 83),
    ('special', 'special-charging', 'Ładowanie i akumulatory', 'Przewody ładowarek, zasilaczy bateryjnych i stacji ładowania.', '#d3bb73', 84),
    ('special', 'special-other', 'Pozostałe', 'Przewody, które nie pasują do pozostałych grup.', '#64748b', 89)
)
INSERT INTO public.cable_categories (parent_id, slug, name, description, color, order_index)
SELECT parent.id, definition.slug, definition.name, definition.description, definition.color, definition.order_index
FROM definitions definition
JOIN public.cable_categories parent ON parent.slug = definition.parent_slug
ON CONFLICT (slug) DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  color = EXCLUDED.color,
  order_index = EXCLUDED.order_index,
  is_active = true,
  updated_at = now();

ALTER TABLE public.cables
  ADD COLUMN IF NOT EXISTS cable_category_id uuid REFERENCES public.cable_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tracking_mode text NOT NULL DEFAULT 'quantity',
  ADD COLUMN IF NOT EXISTS stock_unit text NOT NULL DEFAULT 'piece',
  ADD COLUMN IF NOT EXISTS minimum_stock_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_directional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS technical_specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS usage_tags text[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cables_tracking_mode_check') THEN
    ALTER TABLE public.cables ADD CONSTRAINT cables_tracking_mode_check
      CHECK (tracking_mode IN ('quantity', 'individual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cables_stock_unit_check') THEN
    ALTER TABLE public.cables ADD CONSTRAINT cables_stock_unit_check
      CHECK (stock_unit IN ('piece', 'meter'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cables_minimum_stock_check') THEN
    ALTER TABLE public.cables ADD CONSTRAINT cables_minimum_stock_check
      CHECK (minimum_stock_quantity >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cables_category ON public.cables(cable_category_id);

-- Ostrozne przypisanie kategorii istniejacym rekordom. Niczego nie nadpisujemy,
-- gdy uzytkownik ustawil juz kategorie recznie.
WITH cable_text AS (
  SELECT cable.id,
         lower(concat_ws(' ', cable.name, cable.description, input.name, output.name)) AS haystack
  FROM public.cables cable
  LEFT JOIN public.connector_types input ON input.id = cable.connector_in
  LEFT JOIN public.connector_types output ON output.id = cable.connector_out
  WHERE cable.cable_category_id IS NULL
), inferred AS (
  SELECT id,
    CASE
      WHEN haystack ~ 'swiat|fiber|optical|opticon|lc |sc ' THEN 'fiber-data'
      WHEN haystack ~ 'przedluz|rozdziel|listwa' THEN 'power-extension'
      WHEN haystack ~ 'schuko|cee|400 ?v|230 ?v' THEN 'power-mains'
      WHEN haystack ~ 'powercon|iec|zasil' THEN 'power-device'
      WHEN haystack ~ 'interkom|intercom|beltpack|clear.?com' THEN 'communication-intercom'
      WHEN haystack ~ 'anten|rf |coax.*(iem|mikrofon|wifi)' THEN 'communication-antenna'
      WHEN haystack ~ 'hdmi|displayport|dvi|vga' THEN 'video-hdmi-dp'
      WHEN haystack ~ 'sdi|bnc|coax|koncentry' THEN 'video-sdi-coax'
      WHEN haystack ~ 'dmx' THEN 'lighting-dmx'
      WHEN haystack ~ 'speakon|glosnik' THEN 'audio-speaker'
      WHEN haystack ~ 'rj45|ethercon|ethernet|cat[5-8]' THEN 'data-network'
      WHEN haystack ~ 'usb' THEN 'data-usb'
      WHEN haystack ~ 'midi|timecode|ltc' THEN 'data-midi-timecode'
      WHEN haystack ~ 'rs-?232|rs-?422|rs-?485|gpio|automaty' THEN 'data-serial-gpio'
      WHEN haystack ~ 'multicore|stagebox' THEN 'special-multicore'
      WHEN haystack ~ 'hybryd|hybrid|combo' THEN 'special-hybrid'
      WHEN haystack ~ 'ladow|ładow|charger' THEN 'special-charging'
      WHEN haystack ~ 'adapter|przejsci|przejści|patch' THEN 'special-adapter-patch'
      WHEN haystack ~ 'xlr|jack|rca|audio' THEN 'audio-analog'
      ELSE 'special-other'
    END AS category_slug
  FROM cable_text
)
UPDATE public.cables cable
SET cable_category_id = category.id
FROM inferred
JOIN public.cable_categories category ON category.slug = inferred.category_slug
WHERE cable.id = inferred.id
  AND cable.cable_category_id IS NULL;

ALTER TABLE public.equipment_compatible_items
  ADD COLUMN IF NOT EXISTS quantity numeric(10,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quantity_mode text NOT NULL DEFAULT 'per_item';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_compatible_items_quantity_check') THEN
    ALTER TABLE public.equipment_compatible_items ADD CONSTRAINT equipment_compatible_items_quantity_check
      CHECK (quantity > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_compatible_items_quantity_mode_check') THEN
    ALTER TABLE public.equipment_compatible_items ADD CONSTRAINT equipment_compatible_items_quantity_mode_check
      CHECK (quantity_mode IN ('per_item', 'fixed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cable_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cable_id uuid NOT NULL REFERENCES public.cables(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN (
    'opening_balance', 'purchase', 'correction_in', 'correction_out', 'disposal'
  )),
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  storage_location_id uuid REFERENCES public.storage_locations(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cable_stock_movements_cable_created
  ON public.cable_stock_movements(cable_id, created_at DESC);

-- Zapisujemy stan otwarcia przed uruchomieniem automatycznego rejestrowania
-- nowych przewodow, aby nie zmienic istniejacych ilosci.
INSERT INTO public.cable_stock_movements (
  cable_id, movement_type, quantity_delta, balance_after, reason, storage_location_id
)
SELECT cable.id, 'opening_balance', cable.stock_quantity, cable.stock_quantity,
       'Stan otwarcia podczas uporzadkowania ewidencji przewodow', cable.storage_location_id
FROM public.cables cable
WHERE cable.stock_quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.cable_stock_movements movement WHERE movement.cable_id = cable.id
  );

CREATE OR REPLACE FUNCTION public.record_initial_cable_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  employee_id uuid;
BEGIN
  SELECT employee.id INTO employee_id
  FROM public.employees employee
  WHERE employee.id = auth.uid() OR employee.auth_user_id = auth.uid()
  LIMIT 1;

  IF COALESCE(NEW.stock_quantity, 0) > 0 THEN
    INSERT INTO public.cable_stock_movements (
      cable_id, movement_type, quantity_delta, balance_after, reason, storage_location_id, created_by
    ) VALUES (
      NEW.id, 'opening_balance', NEW.stock_quantity, NEW.stock_quantity,
      'Stan początkowy nowego przewodu', NEW.storage_location_id, employee_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_initial_cable_stock_trigger ON public.cables;
CREATE TRIGGER record_initial_cable_stock_trigger
AFTER INSERT ON public.cables
FOR EACH ROW EXECUTE FUNCTION public.record_initial_cable_stock();

CREATE OR REPLACE FUNCTION public.adjust_cable_stock(
  p_cable_id uuid,
  p_new_quantity integer,
  p_reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_quantity integer;
  delta integer;
  employee_id uuid;
BEGIN
  IF p_new_quantity < 0 THEN
    RAISE EXCEPTION 'Stan przewodu nie moze byc ujemny';
  END IF;

  SELECT id INTO employee_id
  FROM public.employees
  WHERE (id = auth.uid() OR auth_user_id = auth.uid())
    AND (
      role = 'admin'
      OR 'equipment_manage' = ANY(COALESCE(permissions, '{}'::text[]))
      OR 'equipment:manage' = ANY(COALESCE(permissions, '{}'::text[]))
    );
  IF employee_id IS NULL THEN
    RAISE EXCEPTION 'Brak uprawnien do zmiany stanu przewodow';
  END IF;

  SELECT stock_quantity INTO current_quantity
  FROM public.cables
  WHERE id = p_cable_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono przewodu';
  END IF;

  delta := p_new_quantity - COALESCE(current_quantity, 0);
  IF delta = 0 THEN
    RETURN p_new_quantity;
  END IF;

  UPDATE public.cables SET stock_quantity = p_new_quantity WHERE id = p_cable_id;
  INSERT INTO public.cable_stock_movements (
    cable_id, movement_type, quantity_delta, balance_after, reason, created_by
  ) VALUES (
    p_cable_id,
    CASE WHEN delta > 0 THEN 'correction_in' ELSE 'correction_out' END,
    delta,
    p_new_quantity,
    COALESCE(NULLIF(trim(p_reason), ''), 'Korekta stanu w karcie przewodu'),
    employee_id
  );
  RETURN p_new_quantity;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cable_availability_for_event(
  p_event_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS TABLE (
  cable_id uuid,
  total_quantity integer,
  reserved_quantity bigint,
  available_quantity bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cable.id,
    COALESCE(cable.stock_quantity, 0) AS total_quantity,
    COALESCE(SUM(reservation.quantity), 0)::bigint AS reserved_quantity,
    GREATEST(
      COALESCE(cable.stock_quantity, 0) - COALESCE(SUM(reservation.quantity), 0),
      0
    )::bigint AS available_quantity
  FROM public.cables cable
  LEFT JOIN (
    SELECT equipment.cable_id, COALESCE(equipment.quantity, 0)::numeric AS quantity
    FROM public.event_equipment equipment
    JOIN public.events event ON event.id = equipment.event_id
    WHERE equipment.cable_id IS NOT NULL
      AND equipment.event_id <> p_event_id
      AND COALESCE(equipment.status, 'reserved') NOT IN ('cancelled', 'returned')
      AND event.event_date IS NOT NULL
      AND event.event_date <= p_end_date
      AND COALESCE(event.event_end_date, event.event_date + interval '1 day') >= p_start_date

    UNION ALL

    SELECT kit_item.cable_id,
           (COALESCE(equipment.quantity, 0) * COALESCE(kit_item.quantity, 0))::numeric AS quantity
    FROM public.event_equipment equipment
    JOIN public.events event ON event.id = equipment.event_id
    JOIN public.equipment_kits kit ON kit.id = equipment.kit_id
    JOIN public.equipment_kit_items kit_item ON kit_item.kit_id = equipment.kit_id
    WHERE equipment.kit_id IS NOT NULL
      AND kit_item.cable_id IS NOT NULL
      AND equipment.event_id <> p_event_id
      AND COALESCE(equipment.status, 'reserved') NOT IN ('cancelled', 'returned')
      AND COALESCE(kit.is_active, true) = true
      AND event.event_date IS NOT NULL
      AND event.event_date <= p_end_date
      AND COALESCE(event.event_end_date, event.event_date + interval '1 day') >= p_start_date
  ) reservation ON reservation.cable_id = cable.id
  WHERE cable.is_active = true AND cable.deleted_at IS NULL
  GROUP BY cable.id, cable.stock_quantity;
$$;

-- Jedna kanoniczna relacja zestawu. Starsza tabela equipment_kit_cables
-- pozostaje tylko dla kompatybilnosci historycznej.
INSERT INTO public.equipment_kit_items (
  kit_id, equipment_id, cable_id, quantity, notes, order_index, created_at
)
SELECT legacy.kit_id, NULL, legacy.cable_id, legacy.quantity, legacy.notes, 0, legacy.created_at
FROM public.equipment_kit_cables legacy
WHERE NOT EXISTS (
  SELECT 1 FROM public.equipment_kit_items item
  WHERE item.kit_id = legacy.kit_id AND item.cable_id = legacy.cable_id
);

COMMENT ON TABLE public.equipment_kit_cables IS
  'Tabela historyczna. Nowe powiazania przewodow z zestawami zapisywane sa w equipment_kit_items.cable_id.';
COMMENT ON COLUMN public.cables.warehouse_category_id IS
  'Kategoria magazynowa/lokalizacyjna. Przeznaczenie techniczne okresla cable_category_id.';
COMMENT ON COLUMN public.cables.cable_category_id IS
  'Branzowa kategoria techniczna przewodu, niezalezna od miejsca skladowania.';
COMMENT ON COLUMN public.cables.tracking_mode IS
  'quantity = ewidencja ilosciowa; individual = opcjonalne sledzenie cennych sztuk w cable_units.';

ALTER TABLE public.cable_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cable_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cables_manage_canonical ON public.cables;
CREATE POLICY cables_manage_canonical ON public.cables
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE (employee.id = auth.uid() OR employee.auth_user_id = auth.uid())
      AND employee.is_active = true
      AND (employee.role = 'admin'
        OR 'equipment_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'equipment:manage' = ANY(COALESCE(employee.permissions, '{}'::text[])))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE (employee.id = auth.uid() OR employee.auth_user_id = auth.uid())
      AND employee.is_active = true
      AND (employee.role = 'admin'
        OR 'equipment_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'equipment:manage' = ANY(COALESCE(employee.permissions, '{}'::text[])))
  ));

DROP POLICY IF EXISTS cable_categories_read ON public.cable_categories;
CREATE POLICY cable_categories_read ON public.cable_categories
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS cable_categories_manage ON public.cable_categories;
CREATE POLICY cable_categories_manage ON public.cable_categories
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE (employee.id = auth.uid() OR employee.auth_user_id = auth.uid())
      AND (employee.role = 'admin'
        OR 'equipment_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'equipment:manage' = ANY(COALESCE(employee.permissions, '{}'::text[])))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE (employee.id = auth.uid() OR employee.auth_user_id = auth.uid())
      AND (employee.role = 'admin'
        OR 'equipment_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'equipment:manage' = ANY(COALESCE(employee.permissions, '{}'::text[])))
  ));

DROP POLICY IF EXISTS cable_stock_movements_read ON public.cable_stock_movements;
CREATE POLICY cable_stock_movements_read ON public.cable_stock_movements
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.cable_categories, public.cable_stock_movements TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_cable_stock(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cable_availability_for_event(uuid, timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
