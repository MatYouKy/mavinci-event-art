BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
-- Keep the optimistic comparison in the POST body, not a JSON URL filter.
CREATE OR REPLACE FUNCTION public.save_offer_recommendations(
 p_offer_id uuid, p_expected_recommendations jsonb, p_recommendations jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE current_recommendations jsonb; saved jsonb;
BEGIN
 IF jsonb_typeof(p_recommendations) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_expected_recommendations) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Nieprawidłowa lista proponowanych produktów.';
 END IF;
 SELECT recommended_items INTO current_recommendations
 FROM public.offers WHERE id=p_offer_id FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Nie znaleziono oferty lub nie masz prawa jej zmieniać.';
 END IF;
 IF current_recommendations IS DISTINCT FROM p_expected_recommendations THEN
   RAISE EXCEPTION 'Propozycje zostały zmienione w innym oknie. Odśwież ofertę przed ponownym zapisem.';
 END IF;
 -- Existing RLS and triggers enforce edit permissions, accepted-offer protection,
 -- duplicates, recalculation and document invalidation in this same transaction.
 UPDATE public.offers SET recommended_items=p_recommendations WHERE id=p_offer_id
 RETURNING jsonb_build_object('id',id,'recommended_items',recommended_items) INTO saved;
 IF NOT FOUND THEN RAISE EXCEPTION 'Brak uprawnień do zapisania propozycji.'; END IF;
 RETURN saved;
END;
$$;
REVOKE ALL ON FUNCTION public.save_offer_recommendations(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_offer_recommendations(uuid,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
