BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
-- Share the exact selected-component traversal between pricing and reservations.
-- Existing reservations are not rewritten; acceptance/explicit update uses the new scope.
CREATE OR REPLACE FUNCTION public.warehouse_stage_visit(s jsonb, equipment_id text, q numeric, path text, ancestors text[], state jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n jsonb:=s->'equipment'->equipment_id;p jsonb:=s->'selection';links jsonb;g record;l jsonb;chosen jsonb;selected_id text;required boolean;k text;rate numeric;amount numeric;h numeric;seen jsonb:=state->'seen';total numeric:=(state->>'total')::numeric;visits integer:=(state->>'visits')::integer; resources jsonb:=coalesce(state->'resources','{}'::jsonb);
BEGIN
 visits:=visits+1;
 IF visits>300 OR coalesce(array_length(ancestors,1),0)>=8 OR equipment_id=ANY(ancestors) THEN RAISE EXCEPTION 'Pętla lub zbyt głębokie zależności sprzętu.'; END IF;
 IF n IS NULL THEN RAISE EXCEPTION 'Brakuje sprzętu w kopii konfiguracji. Pobierz dane ponownie.'; END IF;
 IF q<=0 OR q>100000 OR q<>round(q,2) THEN RAISE EXCEPTION 'Podaj poprawną ilość: %.',n->>'name'; END IF;
 -- Missing rental prices contribute zero; malformed or negative prices still fail validation.
 rate:=coalesce(public.modular_numeric(n->'rate',n->>'name',true),0);
 resources:=jsonb_set(resources,ARRAY[equipment_id],to_jsonb(coalesce((resources->>equipment_id)::numeric,0)+q));
 total:=total+round(q*rate,2);h:=(p->>'height')::numeric;
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO links FROM jsonb_array_elements(n->'links') x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s#>'{catalog,roots}') root WHERE root->>'equipment_id'=x->>'equipment_id');
 FOR g IN SELECT CASE WHEN x->>'group' IS NOT NULL THEN 'group:'||(x->>'group') ELSE 'item:'||(x->>'id') END AS key,jsonb_agg(x ORDER BY ord) AS options,bool_or(x->>'type'='required') AS required,bool_or(x->>'group' IS NOT NULL) AS choice FROM jsonb_array_elements(links) WITH ORDINALITY a(x,ord) GROUP BY 1 ORDER BY min(ord) LOOP
  k:=path||'/'||g.key;chosen:='[]'::jsonb;
  IF g.choice THEN
   selected_id:=p->'choices'->>k;
   IF coalesce(selected_id,'')<>'' THEN
    SELECT x INTO l FROM jsonb_array_elements(g.options) x WHERE x->>'id'=selected_id;
    IF l IS NULL THEN RAISE EXCEPTION 'Wybierz aktualny wariant w grupie: %.',substring(g.key from 7); END IF;
    chosen:=jsonb_build_array(l);
   ELSIF g.required THEN RAISE EXCEPTION 'Wybierz jeden wariant: % (%).',substring(g.key from 7),n->>'name'; END IF;
  ELSIF g.required OR p->'enabled'->k='true'::jsonb THEN chosen:=g.options;END IF;
  FOR l IN SELECT value FROM jsonb_array_elements(chosen) LOOP
   IF (l->>'min_height' IS NOT NULL AND h<(l->>'min_height')::numeric) OR (l->>'max_height' IS NOT NULL AND h>(l->>'max_height')::numeric) THEN RAISE EXCEPTION 'Wybrany sprzęt nie pasuje do wysokości % cm: %.',h,s->'equipment'->(l->>'equipment_id')->>'name'; END IF;
   amount:=(l->>'quantity')::numeric;
   IF l->>'mode'='fixed' THEN
    IF seen ? (l->>'id') THEN
     IF (seen->>(l->>'id'))::numeric<>amount THEN RAISE EXCEPTION 'Niespójna stała ilość zależności.'; END IF;
     CONTINUE;
    END IF;
    seen:=seen||jsonb_build_object(l->>'id',amount);
   ELSIF l->>'mode'='per_batch' THEN amount:=amount*ceil(q/public.modular_numeric(l->'per_quantity','liczba sztuk w grupie',false,100000,true));
   ELSE amount:=amount*q;END IF;
   state:=public.warehouse_stage_visit(s,l->>'equipment_id',amount,path||'/'||(l->>'id'),array_append(ancestors,equipment_id),jsonb_build_object('seen',seen,'total',total,'visits',visits,'resources',resources));
   resources:=state->'resources';
   seen:=state->'seen';total:=(state->>'total')::numeric;visits:=(state->>'visits')::integer;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('seen',seen,'total',total,'visits',visits,'resources',resources);
END $function$
;
CREATE OR REPLACE FUNCTION public.warehouse_stage_state(s jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c jsonb:=s->'catalog';p jsonb:=s->'selection';graph jsonb:=s->'equipment';r jsonb;l jsonb;n record;ids text[];q numeric;w numeric;d numeric;h numeric;edge numeric;sides numeric;state jsonb:='{"total":0,"visits":0,"seen":{}}';result numeric;
BEGIN
 IF s->>'version' IS DISTINCT FROM '2' OR s->>'profile' IS DISTINCT FROM 'warehouse_stage' THEN RAISE EXCEPTION 'Nieprawidłowa wersja podestu.'; END IF;
 PERFORM public.validate_warehouse_stage_catalog(c);
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p->'quantities') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'enabled') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'choices') IS DISTINCT FROM 'object' OR coalesce(p->>'skirt','') NOT IN ('front_sides','all') THEN RAISE EXCEPTION 'Uzupełnij ustawienia podestu.';END IF;
 w:=public.modular_numeric(p->'width','szerokość',false,100,true);d:=public.modular_numeric(p->'depth','głębokość',false,100,true);h:=public.modular_numeric(p->'height','wysokość',false,200,true);
 IF w<1 OR d<1 OR h<1 OR (mod(w,2)<>0 AND mod(d,2)<>0) THEN RAISE EXCEPTION 'Podest wymaga pełnych metrów, jednego parzystego boku i dodatniej wysokości.'; END IF;
 sides:=CASE WHEN p->>'skirt'='all' THEN 4 ELSE 3 END;edge:=CASE WHEN sides=4 THEN 2*(w+d) ELSE w+2*d END;
 IF jsonb_typeof(graph) IS DISTINCT FROM 'object' OR jsonb_typeof(s->'loaded_at') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Pobierz sprzęt i ceny rentalne.';END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(graph))>200 THEN RAISE EXCEPTION 'Zbyt wiele elementów sprzętu.';END IF;
 FOR n IN SELECT key,value FROM jsonb_each(graph) LOOP
  r:=n.value;ids:='{}';
  IF n.key!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR r->>'id' IS DISTINCT FROM n.key OR jsonb_typeof(r->'name') IS DISTINCT FROM 'string' OR length(trim(r->>'name')) NOT BETWEEN 1 AND 300 OR jsonb_typeof(r->'name_en') IS DISTINCT FROM 'string' OR length(r->>'name_en')>300 OR jsonb_typeof(r->'links') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Nieprawidłowe dane sprzętu.'; END IF;
  PERFORM public.modular_numeric(r->'rate',r->>'name',true);
  IF jsonb_array_length(r->'links')>50 THEN RAISE EXCEPTION 'Zbyt wiele zależności sprzętu.';END IF;
  FOR l IN SELECT value FROM jsonb_array_elements(r->'links') LOOP
   IF coalesce(l->>'id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR coalesce(l->>'equipment_id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR (l->>'id')=ANY(ids) OR coalesce(l->>'type','') NOT IN ('required','recommended','optional') OR coalesce(l->>'mode','') NOT IN ('per_item','fixed','per_batch') OR (l->'group' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(l->'group') IS DISTINCT FROM 'string' OR length(trim(l->>'group')) NOT BETWEEN 1 AND 100)) THEN RAISE EXCEPTION 'Nieprawidłowe powiązanie sprzętu.';END IF;
   IF l->>'mode'='per_batch' AND public.modular_numeric(l->'per_quantity','liczba sztuk w grupie',false,100000,true)<1 THEN RAISE EXCEPTION 'Podaj dodatnią liczbę sztuk w grupie.'; END IF;
   ids:=array_append(ids,l->>'id');q:=public.modular_numeric(l->'quantity','ilość zależności',false,1000);IF q<=0 THEN RAISE EXCEPTION 'Ilość zależności musi być dodatnia.';END IF;
   q:=public.modular_numeric(l->'min_height','minimalna wysokość',true,200);IF q IS NOT NULL AND q<1 THEN RAISE EXCEPTION 'Minimalna wysokość musi być dodatnia.';END IF;
   q:=public.modular_numeric(l->'max_height','maksymalna wysokość',true,200);IF q IS NOT NULL AND q<1 THEN RAISE EXCEPTION 'Maksymalna wysokość musi być dodatnia.';END IF;
   IF (l->>'min_height')::numeric>(l->>'max_height')::numeric THEN RAISE EXCEPTION 'Nieprawidłowy zakres wysokości.';END IF;
  END LOOP;
 END LOOP;

 IF c ? 'component_groups' THEN
  FOR n IN SELECT key,value FROM jsonb_each(c->'component_groups') LOOP
   IF graph ? n.key THEN
    SELECT coalesce(jsonb_agg(i||jsonb_build_object('type',g->>'requirement','group',trim(g->>'name')) ORDER BY gn,inum),'[]'::jsonb) INTO l
    FROM jsonb_array_elements(n.value) WITH ORDINALITY gg(g,gn)
    CROSS JOIN LATERAL jsonb_array_elements(g->'items') WITH ORDINALITY ii(i,inum);
    IF graph->n.key->'links' IS DISTINCT FROM l THEN RAISE EXCEPTION 'Zmieniono zagnieżdżenia. Pobierz sprzęt ponownie przed zapisem.'; END IF;
   END IF;
  END LOOP;
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(c->'roots') LOOP
  IF r->'required'='true'::jsonb OR p->'enabled'->('root:'||(r->>'id'))='true'::jsonb THEN
   q:=CASE r->>'basis' WHEN 'decks' THEN w*d/2 WHEN 'manual' THEN public.modular_numeric(p->'quantities'->(r->>'id'),'ilość dodatku',false,100000) ELSE (r->>'quantity')::numeric*CASE r->>'basis' WHEN 'area' THEN w*d WHEN 'edge' THEN edge WHEN 'sides' THEN sides ELSE 1 END END;
   state:=public.warehouse_stage_visit(s,r->>'equipment_id',q,r->>'id','{}',state);
  END IF;
 END LOOP;
 result:=round((state->>'total')::numeric*(c->>'multiplier')::numeric,2);IF result>999999999 THEN RAISE EXCEPTION 'Wartość konfiguracji jest zbyt wysoka.';END IF;
 RETURN state;
END $function$
;
CREATE OR REPLACE FUNCTION public.warehouse_stage_total(s jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT round((public.warehouse_stage_state(s)->>'total')::numeric * (s#>>'{catalog,multiplier}')::numeric,2);
$$;
;
CREATE OR REPLACE FUNCTION public.resolve_offer_line_equipment(p_product_id uuid, p_variant_id uuid, p_configuration jsonb)
 RETURNS TABLE(equipment_item_id uuid, equipment_kit_id uuid, quantity integer, is_optional boolean, notes text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  chosen jsonb;
  resources jsonb;
  row_data jsonb;
  item_id uuid;
  kit_id uuid;
  row_quantity numeric;
BEGIN
  IF p_configuration#>>'{modular,profile}'='warehouse_stage' THEN
    -- Saved choices, not the current catalog recipe, define this offer's equipment.
    resources:=public.warehouse_stage_state(p_configuration->'modular')->'resources';
    FOR row_data IN SELECT jsonb_build_object('id',e.key,'qty',e.value) FROM jsonb_each(resources) e LOOP
      item_id:=(row_data->>'id')::uuid;
      row_quantity:=(row_data->>'qty')::numeric;
      IF row_quantity IS NULL OR row_quantity<=0 OR row_quantity>2147483647 OR row_quantity<>trunc(row_quantity) THEN
        RAISE EXCEPTION 'Ilość sprzętu w rezerwacji musi być całkowita. Sprawdź przelicznik składnika podestu: %.',p_configuration->'modular'->'equipment'->(item_id::text)->>'name';
      END IF;
      IF NOT EXISTS(SELECT 1 FROM public.equipment_items e WHERE e.id=item_id) THEN
        RAISE EXCEPTION 'Składnik podestu nie istnieje już w magazynie. Zaktualizuj konfigurację pozycji oferty.';
      END IF;
      -- Optional components selected in the offer are now part of its required scope.
      RETURN QUERY SELECT item_id,NULL::uuid,row_quantity::integer,false,'Składnik zapisanej konfiguracji podestu'::text;
    END LOOP;
    RETURN;
  END IF;
  IF NULLIF(p_configuration->'product_package', 'null'::jsonb) IS NOT NULL THEN
    SELECT option INTO chosen
    FROM jsonb_array_elements(p_configuration#>'{product_package,options}') option
    WHERE option->>'id' = p_configuration#>>'{product_package,selected_id}' LIMIT 1;
    resources := chosen->'resources';
    IF chosen IS NULL OR resources IS NULL OR resources = 'null'::jsonb
      OR jsonb_typeof(resources->'equipment') IS DISTINCT FROM 'array'
      OR jsonb_typeof(resources->'staff') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Uzupełnij sprzęt i obsadę wybranego pakietu w pozycji oferty przed sprawdzeniem dostępności lub rezerwacją.';
    END IF;
    FOR row_data IN SELECT value FROM jsonb_array_elements(resources->'equipment') LOOP
      item_id := NULLIF(row_data->>'equipment_item_id','')::uuid;
      kit_id := NULLIF(row_data->>'equipment_kit_id','')::uuid;
      row_quantity := (row_data->>'quantity')::numeric;
      IF (item_id IS NULL) = (kit_id IS NULL) OR row_quantity IS NULL OR row_quantity < 1 OR row_quantity > 10000 OR trunc(row_quantity) <> row_quantity THEN
        RAISE EXCEPTION 'Nieprawidłowy sprzęt lub ilość w konfiguracji pakietu.';
      END IF;
      IF (item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.equipment_items e WHERE e.id = item_id))
         OR (kit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.equipment_kits k WHERE k.id = kit_id)) THEN
        RAISE EXCEPTION 'Sprzęt pakietu nie istnieje już w katalogu. Zaktualizuj zasoby pozycji oferty.';
      END IF;
      RETURN QUERY SELECT item_id, kit_id, row_quantity::integer, COALESCE((row_data->>'is_optional')::boolean,false), row_data->>'notes';
    END LOOP;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT e.equipment_item_id, e.equipment_kit_id, COALESCE(e.quantity,1), COALESCE(e.is_optional,false), e.notes
    FROM public.offer_product_equipment e
    LEFT JOIN public.offer_product_variants v ON v.id = p_variant_id AND v.product_id = p_product_id
    WHERE e.product_id = p_product_id AND e.replaced_by_rental_id IS NULL
      AND ((COALESCE(v.overrides_equipment,false) AND e.product_variant_id = p_variant_id)
        OR (NOT COALESCE(v.overrides_equipment,false) AND e.product_variant_id IS NULL));
END;
$function$
;
NOTIFY pgrst,'reload schema';
COMMIT;
