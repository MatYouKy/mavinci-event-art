BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.offer_amendments (
 offer_id uuid PRIMARY KEY REFERENCES public.offers(id) ON DELETE CASCADE,
 source_offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(offer_id<>source_offer_id)
);
ALTER TABLE public.offer_amendments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offer_amendments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.offer_amendments TO authenticated;
CREATE POLICY offer_amendments_read ON public.offer_amendments FOR SELECT TO authenticated
 USING(public.sales_can_manage_offer(offer_id));

CREATE FUNCTION public.begin_offer_amendment(p_offer uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE original public.offers; existing uuid; result uuid;
BEGIN
 SELECT * INTO STRICT original FROM public.offers WHERE id=p_offer FOR UPDATE;
 IF NOT public.sales_can_manage_offer(p_offer) THEN RAISE EXCEPTION 'Brak uprawnień do zmiany oferty'; END IF;
 IF original.status<>'accepted' OR original.event_id IS NULL OR original.sales_channel='seller_portal' THEN
  RAISE EXCEPTION 'Zmiana wymaga zaakceptowanej oferty CRM powiązanej z wydarzeniem'; END IF;
 SELECT a.offer_id INTO existing FROM public.offer_amendments a JOIN public.offers o ON o.id=a.offer_id
 WHERE a.source_offer_id=p_offer AND o.status IN ('draft','sent') ORDER BY a.created_at DESC LIMIT 1;
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 PERFORM set_config('mavinci.creating_offer_amendment','yes',true);
 result:=public.duplicate_sales_offer(p_offer,gen_random_uuid());
 INSERT INTO public.offer_amendments(offer_id,source_offer_id) VALUES(result,p_offer);
 UPDATE public.offers SET title=coalesce(original.title,original.offer_number)||' — zmiana' WHERE id=result;
 PERFORM set_config('mavinci.creating_offer_amendment','no',true);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.begin_offer_amendment(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.begin_offer_amendment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.auto_assign_equipment_from_offer_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_event_id uuid;
v_offer_id uuid;
v_product_equipment RECORD;
v_existing_count integer;
v_clean_equipment_id uuid;
v_clean_kit_id uuid;
v_final_equipment_id uuid;
v_substitution RECORD;
BEGIN
-- A proposed amendment must not mutate the currently accepted reservation.
IF current_setting('mavinci.creating_offer_amendment',true)='yes'
 OR EXISTS(SELECT 1 FROM public.offer_amendments WHERE offer_id=NEW.offer_id) THEN RETURN NEW; END IF;
-- Pobierz offer_id i event_id
v_offer_id := NEW.offer_id;

SELECT event_id INTO v_event_id
FROM offers
WHERE id = v_offer_id;

-- Jeśli nie ma powiązanego eventu, zakończ
IF v_event_id IS NULL THEN
RETURN NEW;
END IF;

-- Tylko jeśli offer_item ma product_id
IF NEW.product_id IS NOT NULL AND NEW.product_id::text != '' THEN

-- Iteruj przez wszystkie pozycje sprzętu przypisane do produktu (INCLUDING OPTIONAL)
FOR v_product_equipment IN
SELECT 
equipment_item_id, 
equipment_kit_id,
quantity,
is_optional,
notes
FROM public.resolve_offer_line_equipment(NEW.product_id, NEW.product_variant_id, NEW.pricing_configuration)
LOOP

-- Wyczyść puste stringi do NULL
v_clean_equipment_id := NULLIF(v_product_equipment.equipment_item_id::text, '')::uuid;
v_clean_kit_id := NULLIF(v_product_equipment.equipment_kit_id::text, '')::uuid;

-- 1. OBSŁUGA POJEDYNCZEGO SPRZĘTU (equipment_item_id)
IF v_clean_equipment_id IS NOT NULL THEN

-- SPRAWDŹ CZY JEST SUBSTYTUCJA
v_final_equipment_id := v_clean_equipment_id;

SELECT * INTO v_substitution
FROM offer_equipment_substitutions
WHERE offer_id = v_offer_id
AND from_item_id = v_clean_equipment_id
LIMIT 1;

IF v_substitution.to_item_id IS NOT NULL THEN
v_final_equipment_id := v_substitution.to_item_id;
END IF;

-- Sprawdź czy sprzęt już nie jest przypisany do tego eventu
SELECT COUNT(*) INTO v_existing_count
FROM event_equipment
WHERE event_id = v_event_id
AND equipment_id = v_final_equipment_id;

IF v_existing_count = 0 THEN
INSERT INTO event_equipment (
event_id,
equipment_id,
quantity,
status,
notes,
auto_added,
offer_id,
is_optional
) VALUES (
v_event_id,
v_final_equipment_id,
v_product_equipment.quantity * NEW.quantity,
'reserved',
CASE 
WHEN v_substitution.to_item_id IS NOT NULL 
THEN 'Alternatywa z oferty dla: ' || NEW.name
ELSE 'Z produktu: ' || NEW.name
END,
true,
v_offer_id,
v_product_equipment.is_optional
);
ELSE
UPDATE event_equipment
SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
notes = COALESCE(notes || E'\n', '') || 'Zwiększono z produktu: ' || NEW.name,
is_optional = v_product_equipment.is_optional
WHERE event_id = v_event_id
AND equipment_id = v_final_equipment_id;
END IF;
END IF;

-- 2. OBSŁUGA ZESTAWU (equipment_kit_id)
-- Dodajemy tylko zestaw jako całość, bez rozpakowywania zawartości
-- Rezerwacje zawartości zestawu obsługuje funkcja sync_equipment_bookings_for_event
IF v_clean_kit_id IS NOT NULL THEN
-- Sprawdź czy zestaw już nie jest przypisany do tego eventu
SELECT COUNT(*) INTO v_existing_count
FROM event_equipment
WHERE event_id = v_event_id
AND kit_id = v_clean_kit_id;

IF v_existing_count = 0 THEN
-- Dodaj nowy zestaw
INSERT INTO event_equipment (
event_id,
kit_id,
quantity,
status,
notes,
auto_added,
offer_id,
is_optional
) VALUES (
v_event_id,
v_clean_kit_id,
v_product_equipment.quantity * NEW.quantity,
'reserved',
'Zestaw z produktu: ' || NEW.name,
true,
v_offer_id,
v_product_equipment.is_optional
);
ELSE
-- Zwiększ ilość istniejącego zestawu
UPDATE event_equipment
SET quantity = quantity + (v_product_equipment.quantity * NEW.quantity),
notes = COALESCE(notes || E'\n', '') || 'Zwiększono zestaw z produktu: ' || NEW.name,
is_optional = v_product_equipment.is_optional
WHERE event_id = v_event_id
AND kit_id = v_clean_kit_id;
END IF;
END IF;

END LOOP;

END IF;

RETURN NEW;
EXCEPTION
WHEN OTHERS THEN
RAISE WARNING 'Error in auto_assign_equipment_from_offer_product: % %', SQLERRM, SQLSTATE;
RETURN NEW;
END;
$function$
;


CREATE OR REPLACE FUNCTION public.reserve_selected_equipment(
  p_offer_id uuid,
  p_items jsonb,
  p_accepted_shortages jsonb,
  p_package_id uuid DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_item jsonb;
  v_shortage jsonb;
  v_inserted_count integer := 0;
  v_shortage_count integer := 0;
  v_rejected_count integer := 0;
  v_snapshot jsonb;
  inquiry_uuid uuid; selected_uuid uuid; amendment_source uuid; source_offer public.offers;
BEGIN
  IF NOT public.sales_can_manage_offer(p_offer_id) THEN RAISE EXCEPTION 'Brak uprawnień do akceptacji oferty'; END IF;
  SELECT inquiry_id INTO inquiry_uuid FROM public.offers WHERE id=p_offer_id;
  IF inquiry_uuid IS NOT NULL THEN
    SELECT accepted_offer_id INTO selected_uuid FROM public.tasks WHERE id=inquiry_uuid FOR UPDATE;
    SELECT source_offer_id INTO amendment_source FROM public.offer_amendments WHERE offer_id=p_offer_id;
    IF amendment_source IS NOT NULL AND selected_uuid=amendment_source THEN
      -- The pointer and reservations switch in this same transaction; any error rolls both back.
      UPDATE public.tasks SET accepted_offer_id=p_offer_id WHERE id=inquiry_uuid;
      selected_uuid:=p_offer_id;
    END IF;
    IF selected_uuid IS NOT NULL AND selected_uuid<>p_offer_id THEN RAISE EXCEPTION 'Wybrano inny wariant. Otwórz negocjacje ponownie przed zmianą.'; END IF;
  END IF;
  SELECT source_offer_id INTO amendment_source FROM public.offer_amendments WHERE offer_id=p_offer_id;
  IF amendment_source IS NOT NULL THEN
    SELECT * INTO STRICT source_offer FROM public.offers WHERE id=amendment_source FOR UPDATE;
    IF NOT public.sales_can_manage_offer(amendment_source) THEN RAISE EXCEPTION 'Brak uprawnień do zmiany oferty'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.offers WHERE id=p_offer_id AND status='accepted') THEN
      IF source_offer.status<>'accepted' OR NOT EXISTS(
        SELECT 1 FROM public.offers WHERE id=p_offer_id AND event_id=source_offer.event_id
        AND inquiry_id IS NOT DISTINCT FROM source_offer.inquiry_id
      ) THEN RAISE EXCEPTION 'Poprzednia oferta lub jej powiązanie uległy zmianie. Odśwież ofertę.'; END IF;
      IF EXISTS(SELECT 1 FROM public.event_equipment WHERE offer_id=amendment_source AND reservation_status::text NOT IN ('planned','reserved_pending')) THEN
        RAISE EXCEPTION 'Sprzęt został już przyjęty do przygotowania lub wydany. Uzgodnij zmianę rezerwacji z magazynem.';
      END IF;
    END IF;
  END IF;
  PERFORM 1 FROM public.offers WHERE id=p_offer_id FOR UPDATE;
  PERFORM set_config('mavinci.sales_decision','yes',true);
  SELECT event_id
  INTO v_event_id
  FROM public.offers
  WHERE id = p_offer_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono wydarzenia oferty';
  END IF;

  IF p_package_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.offer_packages
    WHERE id = p_package_id AND offer_id = p_offer_id
  ) THEN
    RAISE EXCEPTION 'Wybrany pakiet nie należy do oferty';
  END IF;

  IF p_package_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'package_id', package.id,
      'package_name', package.name,
      'product_id', item.product_id,
      'product_variant_id', item.product_variant_id,
      'variant_name', variant.name,
      'quantity', item.quantity
    ) ORDER BY item.display_order), '[]'::jsonb)
    INTO v_snapshot
    FROM public.offer_packages package
    JOIN public.offer_package_items item ON item.package_id = package.id
    LEFT JOIN public.offer_product_variants variant ON variant.id = item.product_variant_id
    WHERE package.id = p_package_id;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'offer_item_id', item.id,
      'product_id', item.product_id,
      'product_variant_id', item.product_variant_id,
      'variant_name', variant.name,
      'quantity', item.quantity
    ) ORDER BY item.display_order), '[]'::jsonb)
    INTO v_snapshot
    FROM public.offer_items item
    LEFT JOIN public.offer_product_variants variant ON variant.id = item.product_variant_id
    WHERE item.offer_id = p_offer_id;
  END IF;

  DELETE FROM public.event_equipment
  WHERE event_id = v_event_id AND offer_id = p_offer_id;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    IF v_item->>'item_type' = 'item' THEN
      INSERT INTO public.event_equipment(
        event_id, offer_id, equipment_id, quantity, reservation_status, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_item->>'item_id')::uuid,
        (v_item->>'qty')::integer,
        'reserved_pending',
        true
      );
    ELSE
      INSERT INTO public.event_equipment(
        event_id, offer_id, kit_id, quantity, reservation_status, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_item->>'item_id')::uuid,
        (v_item->>'qty')::integer,
        'reserved_pending',
        true
      );
    END IF;
    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  FOR v_shortage IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_accepted_shortages, '[]'::jsonb))
  LOOP
    IF v_shortage->>'item_type' = 'item' THEN
      INSERT INTO public.event_equipment(
        event_id, offer_id, equipment_id, quantity, reservation_status, is_optional, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_shortage->>'item_id')::uuid,
        (v_shortage->>'shortage_qty')::integer,
        'planned',
        true,
        true
      );
    ELSE
      INSERT INTO public.event_equipment(
        event_id, offer_id, kit_id, quantity, reservation_status, is_optional, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_shortage->>'item_id')::uuid,
        (v_shortage->>'shortage_qty')::integer,
        'planned',
        true,
        true
      );
    END IF;
    v_shortage_count := v_shortage_count + 1;
  END LOOP;

  UPDATE public.offers
  SET status = 'accepted',
      accepted_at = now(),
      accepted_package_id = p_package_id,
      accepted_variant_selections = v_snapshot
  WHERE id = p_offer_id;

  UPDATE public.offers
  SET status = 'rejected'
  WHERE event_id = v_event_id
    AND id <> p_offer_id
    AND status = 'accepted';
  GET DIAGNOSTICS v_rejected_count = ROW_COUNT;

  DELETE FROM public.event_equipment
  WHERE event_id = v_event_id
    AND offer_id IN (
      SELECT id
      FROM public.offers
      WHERE event_id = v_event_id AND status = 'rejected'
    );

  UPDATE public.events
  SET has_equipment_shortage = (v_shortage_count > 0)
  WHERE id = v_event_id;

  IF inquiry_uuid IS NOT NULL THEN
    UPDATE public.tasks SET accepted_offer_id=p_offer_id,inquiry_stage='won',next_action_at=NULL WHERE id=inquiry_uuid;
    PERFORM public.sales_log(inquiry_uuid,'acceptance','Zaakceptowano ofertę i zapisano rezerwacje',jsonb_build_object('offer_id',p_offer_id));
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'reserved_count', v_inserted_count,
    'shortage_count', v_shortage_count,
    'rejected_offers_count', v_rejected_count,
    'accepted_package_id', p_package_id,
    'variant_selections', v_snapshot
  );
END;
$$;



NOTIFY pgrst,'reload schema';
COMMIT;
