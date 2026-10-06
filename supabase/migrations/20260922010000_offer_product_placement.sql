BEGIN;
CREATE FUNCTION public.add_offer_item_without_duplicate(p_offer_id uuid,p_item jsonb,p_move_recommendation boolean,p_expected_recommendations jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE proposals jsonb; item public.offer_items; result_id uuid; has_proposal boolean;
BEGIN
 SELECT recommended_items INTO proposals FROM public.offers WHERE id=p_offer_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono oferty lub nie masz prawa jej zmieniać.'; END IF;
 item:=jsonb_populate_record(NULL::public.offer_items,p_item);
 IF item.product_id IS NULL THEN RAISE EXCEPTION 'Wybierz produkt.'; END IF;
 IF EXISTS(SELECT 1 FROM public.offer_items WHERE offer_id=p_offer_id AND product_id=item.product_id) THEN RAISE EXCEPTION 'Ten produkt jest już w głównej ofercie. Zmień ilość istniejącej pozycji.'; END IF;
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(proposals) r WHERE r->>'product_id'=item.product_id::text) INTO has_proposal;
 IF has_proposal THEN
  IF NOT p_move_recommendation THEN RAISE EXCEPTION 'Produkt jest w propozycjach. Otwórz ponownie dodawanie i potwierdź przeniesienie.'; END IF;
  IF proposals IS DISTINCT FROM p_expected_recommendations THEN RAISE EXCEPTION 'Propozycje zostały zmienione. Otwórz ponownie dodawanie produktu.'; END IF;
  UPDATE public.offers SET recommended_items=(SELECT coalesce(jsonb_agg(r ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(proposals) WITH ORDINALITY a(r,ordinal) WHERE r->>'product_id' IS DISTINCT FROM item.product_id::text) WHERE id=p_offer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brak uprawnień do przeniesienia produktu.'; END IF;
 ELSIF p_move_recommendation THEN RAISE EXCEPTION 'Propozycja została już zmieniona lub usunięta. Odśwież ofertę.';
 END IF;
 INSERT INTO public.offer_items(offer_id,product_id,product_variant_id,variant_prices_net,show_variant_prices_in_pdf,show_product_variants_in_pdf,name,description,quantity,unit,unit_price,unit_cost,discount_percent,discount_amount,transport_cost,logistics_cost,display_order,notes)
 VALUES(p_offer_id,item.product_id,item.product_variant_id,item.variant_prices_net,item.show_variant_prices_in_pdf,item.show_product_variants_in_pdf,item.name,item.description,item.quantity,item.unit,item.unit_price,item.unit_cost,item.discount_percent,item.discount_amount,item.transport_cost,item.logistics_cost,item.display_order,item.notes) RETURNING id INTO result_id;
 RETURN result_id;
END $$;
REVOKE ALL ON FUNCTION public.add_offer_item_without_duplicate(uuid,jsonb,boolean,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_offer_item_without_duplicate(uuid,jsonb,boolean,jsonb) TO authenticated;
CREATE FUNCTION public.guard_offer_recommendation_products() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.recommended_items IS NOT DISTINCT FROM OLD.recommended_items THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.recommended_items) r JOIN public.offer_items i ON i.offer_id=NEW.id AND i.product_id::text=r->>'product_id') THEN RAISE EXCEPTION 'Produkt z propozycji jest już w głównej ofercie.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.recommended_items) r WHERE nullif(r->>'product_id','') IS NOT NULL GROUP BY r->>'product_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Produkt może wystąpić na liście propozycji tylko raz.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_offer_recommendation_products BEFORE INSERT OR UPDATE OF recommended_items ON public.offers FOR EACH ROW EXECUTE FUNCTION public.guard_offer_recommendation_products();
REVOKE ALL ON FUNCTION public.guard_offer_recommendation_products() FROM PUBLIC;
NOTIFY pgrst,'reload schema';
COMMIT;
