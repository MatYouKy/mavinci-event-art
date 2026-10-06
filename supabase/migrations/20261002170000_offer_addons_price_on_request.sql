BEGIN;
CREATE OR REPLACE FUNCTION public.offer_configuration_total(c jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE a jsonb; result numeric; qty numeric;
BEGIN
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR c->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(c->'base_unit_price') IS DISTINCT FROM 'number' OR NOT public.offer_addons_valid(c->'addons') THEN RAISE EXCEPTION 'Nieprawidłowa konfiguracja dodatków.'; END IF;
 result:=(c->>'base_unit_price')::numeric;
 IF result<0 OR result>999999999 OR result<>round(result,2) THEN RAISE EXCEPTION 'Nieprawidłowa cena bazowa.'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(c->'addons') LOOP
  qty:=CASE a->>'kind' WHEN 'optional' THEN CASE WHEN (a->>'enabled')::boolean THEN 1 ELSE 0 END WHEN 'over_limit' THEN greatest(0,(a->>'quantity')::numeric-(a->>'included_quantity')::numeric) ELSE (a->>'quantity')::numeric END;
  IF coalesce((a->>'price_on_request')::boolean,false) AND qty>0 AND (a->>'unit_price')::numeric<=0 THEN RAISE EXCEPTION 'Podaj uzgodnioną cenę dodatku: %',a->>'name'; END IF;
  result:=result+round(qty*(a->>'unit_price')::numeric,2);
 END LOOP;
 IF result>999999999 THEN RAISE EXCEPTION 'Wartość konfiguracji jest zbyt wysoka.'; END IF;
 RETURN round(result,2);
END $$;


NOTIFY pgrst,'reload schema';
COMMIT;
