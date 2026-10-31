BEGIN;
SET LOCAL lock_timeout = '5s';

-- Only the authorized, atomic update below can bypass the accepted-content guard.
DO $migration$
DECLARE definition text;
BEGIN
 definition := pg_get_functiondef('public.guard_accepted_offer_content()'::regprocedure);
 definition := replace(definition, 'IF EXISTS(SELECT 1 FROM public.offers WHERE id=offer_uuid',
  'IF current_setting(''mavinci.updating_accepted_offer'',true) IS DISTINCT FROM offer_uuid::text AND EXISTS(SELECT 1 FROM public.offers WHERE id=offer_uuid');
 IF position('mavinci.updating_accepted_offer' in definition)=0 THEN RAISE EXCEPTION 'Nieznana wersja blokady edycji oferty'; END IF;
 EXECUTE definition;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.update_accepted_offer_items(p_offer uuid, p_expected_revision integer, p_items jsonb, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE original public.offers; item public.offer_items; row_value jsonb; qty numeric; duration integer;
 price numeric; discount numeric; before_items jsonb; after_items jsonb; resources jsonb; reservation_items jsonb;
 actor uuid; changes text := ''; changed_count integer := 0; saved_at timestamptz := now();
BEGIN
 IF auth.uid() IS NULL OR NOT public.sales_can_manage_offer(p_offer) THEN RAISE EXCEPTION 'Brak uprawnień do aktualizacji oferty'; END IF;
 SELECT * INTO STRICT original FROM public.offers WHERE id=p_offer FOR UPDATE;
 IF original.status<>'accepted' OR original.sales_channel='seller_portal' THEN RAISE EXCEPTION 'Wybierz zaakceptowaną ofertę CRM'; END IF;
 IF p_expected_revision IS NULL OR original.content_revision<>p_expected_revision THEN RAISE EXCEPTION 'Oferta została zmieniona. Odśwież ją i otwórz aktualizację ponownie.'; END IF;
 IF original.pricing_source='calculation' OR original.accepted_package_id IS NOT NULL THEN
  RAISE EXCEPTION 'Ta wycena pochodzi z kalkulacji lub wybranego pakietu. Aktualizacja samych pozycji nie zmieni jej źródła.';
 END IF;
 IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Podaj powód aktualizacji (3–2000 znaków).'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>500 THEN RAISE EXCEPTION 'Nieprawidłowa lista pozycji'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x GROUP BY x->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Powtórzone pozycje'; END IF;
 SELECT public.sales_employee_id() INTO actor;
 IF actor IS NULL THEN RAISE EXCEPTION 'Brak profilu pracownika'; END IF;
 SELECT jsonb_agg(to_jsonb(i) ORDER BY i.display_order,i.id) INTO before_items FROM public.offer_items i WHERE offer_id=p_offer;
 IF original.event_id IS NOT NULL THEN
  -- Serialize reservation changes, including concurrent reservations made through other flows.
  LOCK TABLE public.event_equipment IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM public.event_equipment WHERE offer_id=p_offer AND (NOT coalesce(auto_added,false) OR reservation_status::text NOT IN ('planned','reserved_pending'))) THEN
   RAISE EXCEPTION 'Sprzęt jest już przygotowywany lub wydany. Uzgodnij zmianę rezerwacji z magazynem.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.offers WHERE event_id=original.event_id AND status='accepted' AND id<>p_offer) THEN RAISE EXCEPTION 'Wydarzenie ma inną zaakceptowaną ofertę. Najpierw uporządkuj powiązania.'; END IF;
 END IF;
 PERFORM set_config('mavinci.updating_accepted_offer',p_offer::text,true);
 PERFORM set_config('mavinci.sales_decision','yes',true);
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO item FROM public.offer_items WHERE id=(row_value->>'id')::uuid AND offer_id=p_offer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pozycja nie należy do oferty'; END IF;
  qty := (row_value->>'quantity')::numeric; duration := (row_value->>'days')::integer;
  price := (row_value->>'unit_price')::numeric; discount := (row_value->>'discount_percent')::numeric;
  IF qty IS NULL OR qty<=0 OR qty>999999 OR qty<>round(qty,2) OR duration IS NULL OR duration NOT BETWEEN 1 AND 3650
   OR price IS NULL OR price<0 OR price>99999999 OR price<>round(price,2) OR discount IS NULL OR discount<0 OR discount>100 THEN
   RAISE EXCEPTION 'Nieprawidłowa ilość, liczba dni, cena lub rabat';
  END IF;
  IF item.pricing_configuration IS NOT NULL AND item.unit_price IS DISTINCT FROM price THEN
   RAISE EXCEPTION 'Cena pozycji z dodatkami wynika z konfiguracji. W tej aktualizacji możesz zmienić jej ilość, dni i rabat.';
  END IF;
  IF ROW(item.quantity,item.days,item.unit_price,coalesce(item.discount_percent,0)) IS DISTINCT FROM ROW(qty,duration,price,discount) THEN
   UPDATE public.offer_items SET quantity=qty,days=duration,unit_price=price,discount_percent=discount WHERE id=item.id;
   changes := changes || format(E'\n• %s: ilość %s → %s; dni %s → %s; cena netto %s → %s; rabat %s%% → %s%%.',item.name,item.quantity,qty,item.days,duration,item.unit_price,price,item.discount_percent,discount);
   changed_count := changed_count+1;
  END IF;
 END LOOP;
 IF changed_count=0 THEN RAISE EXCEPTION 'Nie wprowadzono zmian'; END IF;
 IF original.event_id IS NOT NULL THEN
  resources := public.get_offer_equipment_for_reservation(p_offer,NULL);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(resources) x WHERE coalesce((x->>'has_conflict')::boolean,false)) THEN
   RAISE EXCEPTION 'Brakuje sprzętu na ten termin. Aktualizacja nie została zapisana; uzgodnij dostępność lub zamienniki.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.event_equipment e JOIN jsonb_array_elements(resources) x ON
    (x->>'item_type'='item' AND e.equipment_id=(x->>'item_id')::uuid) OR (x->>'item_type'='kit' AND e.kit_id=(x->>'item_id')::uuid)
    WHERE e.event_id=original.event_id AND e.offer_id IS DISTINCT FROM p_offer) THEN
   RAISE EXCEPTION 'Ten sprzęt ma także osobne rezerwacje w wydarzeniu. Uzgodnij ich zakres przed aktualizacją.';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('item_type',x->>'item_type','item_id',x->>'item_id','qty',x->'required_qty')),'[]'::jsonb)
   INTO reservation_items FROM jsonb_array_elements(resources) x;
  PERFORM public.reserve_selected_equipment(p_offer,reservation_items,'[]'::jsonb,NULL);
 END IF;
 UPDATE public.offers SET accepted_at=original.accepted_at, modified_after_generation=true, updated_at=saved_at WHERE id=p_offer;
 SELECT jsonb_agg(to_jsonb(i) ORDER BY i.display_order,i.id) INTO after_items FROM public.offer_items i WHERE offer_id=p_offer;
 INSERT INTO public.offer_history(offer_id,changed_by,change_type,change_description,old_values,new_values)
 VALUES(p_offer,actor,'updated','Aktualizacja zaakceptowanej oferty: '||trim(p_reason)||changes,
  jsonb_build_object('items',before_items,'offer',to_jsonb(original)),
  jsonb_build_object('in_place_update',true,'items',after_items,'reason',trim(p_reason)));
 PERFORM set_config('mavinci.updating_accepted_offer','',true);
 PERFORM set_config('mavinci.sales_decision','',true);
 RETURN jsonb_build_object('offer_id',p_offer,'updated_at',saved_at,'changed_items',changed_count);
END;
$$;
REVOKE ALL ON FUNCTION public.update_accepted_offer_items(uuid,integer,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_accepted_offer_items(uuid,integer,jsonb,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
