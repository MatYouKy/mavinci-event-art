BEGIN;
SET LOCAL lock_timeout='5s';
-- Product-owned dependency batches; no change to warehouse compatibility records.
CREATE OR REPLACE FUNCTION public.validate_product_component_groups(c jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE groups jsonb:=c->'component_groups';parent record;g jsonb;i jsonb;names text[];group_ids text[];item_ids text[];equipment_ids text[];q numeric;lo numeric;hi numeric;count_all integer:=0;count_parent integer;
BEGIN
 IF groups IS NULL THEN RETURN; END IF;
 IF jsonb_typeof(groups) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Nieprawidłowe grupy komponentów.'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(groups))>200 THEN RAISE EXCEPTION 'Zbyt wiele komponentów w drzewie.'; END IF;
 FOR parent IN SELECT key,value FROM jsonb_each(groups) LOOP
  IF parent.key!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR jsonb_typeof(parent.value) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Nieprawidłowy komponent nadrzędny.'; END IF;
  IF jsonb_array_length(parent.value)>25 THEN RAISE EXCEPTION 'Komponent może mieć maksymalnie 25 grup.'; END IF;
  names:='{}';group_ids:='{}';item_ids:='{}';equipment_ids:='{}';count_parent:=0;
  FOR g IN SELECT value FROM jsonb_array_elements(parent.value) LOOP
   IF coalesce(g->>'id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR (g->>'id')=ANY(group_ids) OR jsonb_typeof(g->'name') IS DISTINCT FROM 'string' OR length(trim(g->>'name')) NOT BETWEEN 1 AND 100 OR trim(g->>'name')=ANY(names) OR coalesce(g->>'requirement','') NOT IN ('required','recommended','optional') OR jsonb_typeof(g->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Uzupełnij unikalną nazwę, wymaganie i elementy zagnieżdżenia.'; END IF;
   IF jsonb_array_length(g->'items')<1 THEN RAISE EXCEPTION 'Dodaj przynajmniej jeden element do grupy: %.',g->>'name'; END IF;
   group_ids:=array_append(group_ids,g->>'id');names:=array_append(names,trim(g->>'name'));
   FOR i IN SELECT value FROM jsonb_array_elements(g->'items') LOOP
    count_all:=count_all+1;count_parent:=count_parent+1;
    IF count_all>500 OR count_parent>50 THEN RAISE EXCEPTION 'Zbyt wiele elementów w zagnieżdżeniach.'; END IF;
    IF coalesce(i->>'id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR coalesce(i->>'equipment_id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR (i->>'id')=ANY(item_ids) OR (i->>'equipment_id')=ANY(equipment_ids) OR i->>'equipment_id'=parent.key OR coalesce(i->>'mode','') NOT IN ('per_item','fixed','per_batch') THEN RAISE EXCEPTION 'Nieprawidłowy lub powtórzony element zagnieżdżenia.'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(c->'roots') r WHERE r->>'equipment_id'=i->>'equipment_id') THEN RAISE EXCEPTION 'Element całego produktu nie może być jednocześnie jego zagnieżdżonym składnikiem.'; END IF;
    item_ids:=array_append(item_ids,i->>'id');equipment_ids:=array_append(equipment_ids,i->>'equipment_id');
    q:=public.modular_numeric(i->'quantity','liczba elementów',false,1000);IF q<=0 THEN RAISE EXCEPTION 'Liczba elementów musi być dodatnia.'; END IF;
    IF i->>'mode'='per_batch' AND public.modular_numeric(i->'per_quantity','liczba sztuk w grupie',false,100000,true)<1 THEN RAISE EXCEPTION 'Podaj dodatnią liczbę sztuk w grupie.'; END IF;
    lo:=public.modular_numeric(i->'min_height','minimalna wysokość',true,200,true);hi:=public.modular_numeric(i->'max_height','maksymalna wysokość',true,200,true);
    IF lo<1 OR hi<1 OR lo>hi THEN RAISE EXCEPTION 'Popraw zakres wysokości elementu.'; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 IF EXISTS (
  WITH RECURSIVE edges AS (
   SELECT parent_entry.key AS parent_id, item_entry.item_value->>'equipment_id' AS child_id
   FROM jsonb_each(groups) AS parent_entry
   CROSS JOIN LATERAL jsonb_array_elements(parent_entry.value) AS group_entry(group_value)
   CROSS JOIN LATERAL jsonb_array_elements(group_entry.group_value->'items') AS item_entry(item_value)
  ), walk(id,path,cycle) AS (
   SELECT k,ARRAY[k],false FROM jsonb_object_keys(groups) k
   UNION ALL
   SELECT e.child_id,w.path||e.child_id,e.child_id=ANY(w.path) FROM walk w JOIN edges e ON e.parent_id=w.id WHERE NOT w.cycle AND cardinality(w.path)<=8
  ) SELECT 1 FROM walk WHERE cycle OR cardinality(path)>8
 ) THEN RAISE EXCEPTION 'Drzewo zawiera pętlę lub przekracza 8 poziomów.'; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.warehouse_stage_visit(s jsonb,equipment_id text,q numeric,path text,ancestors text[],state jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE n jsonb:=s->'equipment'->equipment_id;p jsonb:=s->'selection';links jsonb;g record;l jsonb;chosen jsonb;selected_id text;required boolean;k text;rate numeric;amount numeric;h numeric;seen jsonb:=state->'seen';total numeric:=(state->>'total')::numeric;visits integer:=(state->>'visits')::integer;
BEGIN
 visits:=visits+1;
 IF visits>300 OR coalesce(array_length(ancestors,1),0)>=8 OR equipment_id=ANY(ancestors) THEN RAISE EXCEPTION 'Pętla lub zbyt głębokie zależności sprzętu.'; END IF;
 IF n IS NULL THEN RAISE EXCEPTION 'Brakuje sprzętu w kopii konfiguracji. Pobierz dane ponownie.'; END IF;
 IF q<=0 OR q>100000 OR q<>round(q,2) THEN RAISE EXCEPTION 'Podaj poprawną ilość: %.',n->>'name'; END IF;
 -- Missing rental prices contribute zero; malformed or negative prices still fail validation.
 rate:=coalesce(public.modular_numeric(n->'rate',n->>'name',true),0);
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
   state:=public.warehouse_stage_visit(s,l->>'equipment_id',amount,path||'/'||(l->>'id'),array_append(ancestors,equipment_id),jsonb_build_object('seen',seen,'total',total,'visits',visits));
   seen:=state->'seen';total:=(state->>'total')::numeric;visits:=(state->>'visits')::integer;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('seen',seen,'total',total,'visits',visits);
END $$;

CREATE OR REPLACE FUNCTION public.warehouse_stage_total(s jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
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
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.led_warehouse_visit(s jsonb,equipment_id text,q numeric,path text,ancestors text[],state jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE n jsonb:=s->'equipment'->equipment_id;p jsonb:=s->'selection';links jsonb;g record;l jsonb;chosen jsonb;selected_id text;required boolean;k text;rate numeric;amount numeric;h numeric;seen jsonb:=state->'seen';total numeric:=(state->>'total')::numeric;visits integer:=(state->>'visits')::integer;
BEGIN
 visits:=visits+1;
 IF visits>300 OR coalesce(array_length(ancestors,1),0)>=8 OR equipment_id=ANY(ancestors) THEN RAISE EXCEPTION 'Pętla lub zbyt głębokie zależności sprzętu.'; END IF;
 IF n IS NULL THEN RAISE EXCEPTION 'Brakuje sprzętu w kopii konfiguracji. Pobierz dane ponownie.'; END IF;
 IF q<=0 OR q>100000 OR q<>round(q,2) THEN RAISE EXCEPTION 'Podaj poprawną ilość: %.',n->>'name'; END IF;
 rate:=public.modular_numeric(n->'rate',n->>'name',true);
 rate:=coalesce(rate,0);
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
   amount:=(l->>'quantity')::numeric;
   IF l->>'mode'='fixed' THEN
    IF seen ? (l->>'id') THEN
     IF (seen->>(l->>'id'))::numeric<>amount THEN RAISE EXCEPTION 'Niespójna stała ilość zależności.'; END IF;
     CONTINUE;
    END IF;
    seen:=seen||jsonb_build_object(l->>'id',amount);
   ELSIF l->>'mode'='per_batch' THEN amount:=amount*ceil(q/public.modular_numeric(l->'per_quantity','liczba sztuk w grupie',false,100000,true));
   ELSE amount:=amount*q;END IF;
   state:=public.led_warehouse_visit(s,l->>'equipment_id',amount,path||'/'||(l->>'id'),array_append(ancestors,equipment_id),jsonb_build_object('seen',seen,'total',total,'visits',visits));
   seen:=state->'seen';total:=(state->>'total')::numeric;visits:=(state->>'visits')::integer;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('seen',seen,'total',total,'visits',visits);
END $$;

CREATE OR REPLACE FUNCTION public.led_warehouse_total(s jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE c jsonb:=s#>'{catalog,led_tree}';p jsonb;graph jsonb:=s#>'{selection,led_equipment}';original jsonb:=s;section jsonb;section_ids text[]:='{}';modules numeric:=0;cables numeric:=1;cols numeric;rows_count numeric;cable_id text:=s#>>'{catalog,led_cable_root_id}';r jsonb;l jsonb;n record;ids text[];q numeric;w numeric;d numeric;h numeric;edge numeric;sides numeric;state jsonb:='{"total":0,"visits":0,"seen":{}}';result numeric;
BEGIN
 PERFORM public.validate_led_warehouse_catalog(original->'catalog');
 IF jsonb_typeof(original#>'{selection,led_sections}') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Dodaj sekcje LED.'; END IF;
 IF jsonb_array_length(original#>'{selection,led_sections}') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Dodaj od 1 do 30 sekcji LED.'; END IF;
 FOR section IN SELECT value FROM jsonb_array_elements(original#>'{selection,led_sections}') LOOP
  IF jsonb_typeof(section->'id') IS DISTINCT FROM 'string' OR coalesce(section->>'id','')='' OR section->>'id'=ANY(section_ids) OR jsonb_typeof(section->'name') IS DISTINCT FROM 'string' OR length(trim(section->>'name')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Uzupełnij nazwy i unikalne identyfikatory sekcji LED.'; END IF;
  section_ids:=array_append(section_ids,section->>'id');
  cols:=public.modular_numeric(section->'columns','kolumny LED',false,200,true);
  rows_count:=public.modular_numeric(section->'rows','wiersze LED',false,200,true);
  IF cols<1 OR rows_count<1 THEN RAISE EXCEPTION 'Sekcja LED wymaga dodatniej liczby kolumn i wierszy.'; END IF;
  modules:=modules+cols*rows_count;cables:=cables+ceil(cols*rows_count/16);
 END LOOP;
 IF modules>40000 OR public.modular_numeric(original#>'{selection,area}','powierzchnia LED',false,10000)<>modules/4 THEN RAISE EXCEPTION 'Powierzchnia nie odpowiada sekcjom LED.'; END IF;
 p:=jsonb_build_object('quantities',original#>'{selection,quantities}','choices',original#>'{selection,led_choices}','enabled',original#>'{selection,led_enabled}','height',1);
 IF jsonb_typeof(p->'quantities') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'choices') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'enabled') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Uzupełnij wybór komponentów LED.'; END IF;
 s:=jsonb_build_object('catalog',c,'selection',p,'equipment',graph,'loaded_at',original#>'{selection,led_loaded_at}');
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
   q:=CASE WHEN r->>'id'=cable_id THEN cables WHEN r->>'basis'='decks' THEN modules WHEN r->>'basis'='manual' THEN public.modular_numeric(p->'quantities'->(r->>'id'),'ilość dodatku',false,100000) WHEN r->>'basis'='area' THEN (r->>'quantity')::numeric*modules/4 ELSE (r->>'quantity')::numeric END;
   state:=public.led_warehouse_visit(s,r->>'equipment_id',q,r->>'id','{}',state);
  END IF;
 END LOOP;
 result:=round((state->>'total')::numeric*(c->>'multiplier')::numeric,2);IF result>999999999 THEN RAISE EXCEPTION 'Wartość konfiguracji jest zbyt wysoka.';END IF;
 RETURN result;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
