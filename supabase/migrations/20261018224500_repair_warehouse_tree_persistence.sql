BEGIN;
SET LOCAL lock_timeout='5s';
-- Support the warehouse tree without reseeding any existing catalog data.
ALTER TABLE public.equipment_compatible_items ADD COLUMN IF NOT EXISTS min_height_cm numeric;
ALTER TABLE public.equipment_compatible_items ADD COLUMN IF NOT EXISTS max_height_cm numeric;

CREATE OR REPLACE FUNCTION public.validate_product_component_groups(c jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
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
    IF coalesce(i->>'id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR coalesce(i->>'equipment_id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR (i->>'id')=ANY(item_ids) OR (i->>'equipment_id')=ANY(equipment_ids) OR i->>'equipment_id'=parent.key OR coalesce(i->>'mode','') NOT IN ('per_item','fixed') THEN RAISE EXCEPTION 'Nieprawidłowy lub powtórzony element zagnieżdżenia.'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(c->'roots') r WHERE r->>'equipment_id'=i->>'equipment_id') THEN RAISE EXCEPTION 'Element całego produktu nie może być jednocześnie jego zagnieżdżonym składnikiem.'; END IF;
    item_ids:=array_append(item_ids,i->>'id');equipment_ids:=array_append(equipment_ids,i->>'equipment_id');
    q:=public.modular_numeric(i->'quantity','liczba elementów',false,1000);IF q<=0 THEN RAISE EXCEPTION 'Liczba elementów musi być dodatnia.'; END IF;
    lo:=public.modular_numeric(i->'min_height','minimalna wysokość',true,200,true);hi:=public.modular_numeric(i->'max_height','maksymalna wysokość',true,200,true);
    IF lo<1 OR hi<1 OR lo>hi THEN RAISE EXCEPTION 'Popraw zakres wysokości elementu.'; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 IF EXISTS (
  WITH RECURSIVE edges AS (
   SELECT p.key AS parent_id,i->>'equipment_id' AS child_id FROM jsonb_each(groups) p CROSS JOIN LATERAL jsonb_array_elements(p.value) g CROSS JOIN LATERAL jsonb_array_elements(g->'items') i
  ), walk(id,path,cycle) AS (
   SELECT k,ARRAY[k],false FROM jsonb_object_keys(groups) k
   UNION ALL
   SELECT e.child_id,w.path||e.child_id,e.child_id=ANY(w.path) FROM walk w JOIN edges e ON e.parent_id=w.id WHERE NOT w.cycle AND cardinality(w.path)<=8
  ) SELECT 1 FROM walk WHERE cycle OR cardinality(path)>8
 ) THEN RAISE EXCEPTION 'Drzewo zawiera pętlę lub przekracza 8 poziomów.'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.validate_warehouse_stage_catalog(c jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE r jsonb; ids text[]:='{}'; equipment_ids text[]:='{}'; main_count integer:=0; q numeric; m numeric;
BEGIN
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR c->>'version' IS DISTINCT FROM '2' OR c->>'profile' IS DISTINCT FROM 'warehouse_stage' OR jsonb_typeof(c->'roots') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Nieprawidłowy konfigurator magazynowy podestu.'; END IF;
 IF jsonb_array_length(c->'roots') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Wybierz blat i maksymalnie 29 dodatków.'; END IF;
 m:=public.modular_numeric(c->'multiplier','mnożnik',false,100);IF m<=0 THEN RAISE EXCEPTION 'Mnożnik musi być dodatni.'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(c->'roots') LOOP
  IF coalesce(r->>'id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR coalesce(r->>'equipment_id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR (r->>'id')=ANY(ids) OR (r->>'equipment_id')=ANY(equipment_ids) OR coalesce(r->>'basis','') NOT IN ('decks','manual','fixed','area','edge','sides') OR jsonb_typeof(r->'required') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Sprawdź pozycje sprzętu i usuń powtórzenia na poziomie podestu.'; END IF;
  ids:=array_append(ids,r->>'id');equipment_ids:=array_append(equipment_ids,r->>'equipment_id');
  q:=public.modular_numeric(r->'quantity','przelicznik ilości',false,1000);IF q<=0 THEN RAISE EXCEPTION 'Przelicznik musi być dodatni.'; END IF;
  IF r->>'basis'='decks' THEN main_count:=main_count+1;IF r->'required' IS DISTINCT FROM 'true'::jsonb OR q<>1 THEN RAISE EXCEPTION 'Blat 1 × 2 m musi być wymaganym komponentem głównym.'; END IF;END IF;
 END LOOP;
 IF main_count<>1 THEN RAISE EXCEPTION 'Wybierz dokładnie jeden główny blat 1 × 2 m.';END IF;
 PERFORM public.validate_product_component_groups(c);
END $$;

CREATE OR REPLACE FUNCTION public.warehouse_stage_visit(s jsonb,equipment_id text,q numeric,path text,ancestors text[],state jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE n jsonb:=s->'equipment'->equipment_id;p jsonb:=s->'selection';links jsonb;g record;l jsonb;chosen jsonb;selected_id text;required boolean;k text;rate numeric;amount numeric;h numeric;seen jsonb:=state->'seen';total numeric:=(state->>'total')::numeric;visits integer:=(state->>'visits')::integer;
BEGIN
 visits:=visits+1;
 IF visits>300 OR coalesce(array_length(ancestors,1),0)>=8 OR equipment_id=ANY(ancestors) THEN RAISE EXCEPTION 'Pętla lub zbyt głębokie zależności sprzętu.'; END IF;
 IF n IS NULL THEN RAISE EXCEPTION 'Brakuje sprzętu w kopii konfiguracji. Pobierz dane ponownie.'; END IF;
 IF q<=0 OR q>100000 OR q<>round(q,2) THEN RAISE EXCEPTION 'Podaj poprawną ilość: %.',n->>'name'; END IF;
 rate:=public.modular_numeric(n->'rate',n->>'name',true);
 IF rate IS NULL THEN RAISE EXCEPTION 'Brak ceny rentalnej w magazynie: %.',n->>'name';END IF;
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
   IF coalesce(l->>'id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR coalesce(l->>'equipment_id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR (l->>'id')=ANY(ids) OR coalesce(l->>'type','') NOT IN ('required','recommended','optional') OR coalesce(l->>'mode','') NOT IN ('per_item','fixed') OR (l->'group' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(l->'group') IS DISTINCT FROM 'string' OR length(trim(l->>'group')) NOT BETWEEN 1 AND 100)) THEN RAISE EXCEPTION 'Nieprawidłowe powiązanie sprzętu.';END IF;
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

CREATE OR REPLACE FUNCTION public.modular_product_total(s jsonb, allow_unpriced boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE c jsonb:=s->'catalog'; p jsonb:=s->'selection'; profile text:=s->>'profile'; r jsonb; parent jsonb;
 rate numeric; qty numeric; subtotal numeric:=0; multiplier numeric; w numeric; d numeric; h numeric; area numeric;
 decks numeric; legs numeric; leg_rate numeric; side_count integer; edge numeric; stairs numeric;
 selected_height boolean:=false; ids text[]:='{}'; heights numeric[]:='{}'; rows_found integer:=0; k text;
BEGIN
 IF s->>'profile'='warehouse_stage' THEN
  IF allow_unpriced THEN PERFORM public.validate_warehouse_stage_catalog(s->'catalog');RETURN 0;END IF;
  RETURN public.warehouse_stage_total(s);
 END IF;
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR s->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(c) IS DISTINCT FROM 'object' OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR c->>'version' IS DISTINCT FROM '1' OR c->>'profile' IS DISTINCT FROM profile OR profile NOT IN ('stage','led','sound','microphones') OR profile IS NULL THEN RAISE EXCEPTION 'Nieprawidłowy profil konfiguracji.'; END IF;
 multiplier:=public.modular_numeric(c->'multiplier','mnożnik',false,100);
 IF multiplier<=0 THEN RAISE EXCEPTION 'Mnożnik musi być większy od zera.'; END IF;
 IF profile='stage' THEN
  w:=public.modular_numeric(p->'width','szerokość',false,100,true); d:=public.modular_numeric(p->'depth','głębokość',false,100,true);
  IF w<1 OR d<1 OR (mod(w,2)<>0 AND mod(d,2)<>0) THEN RAISE EXCEPTION 'Podest z blatów 1 × 2 m wymaga pełnych metrów i jednego parzystego boku.'; END IF;
  area:=w*d; decks:=area/2;
  rate:=public.modular_numeric(c->'deck_rate','stawka blatu'); subtotal:=round(decks*rate,2);
  legs:=public.modular_numeric(c->'legs_per_deck','nogi na blat',false,8,true); IF legs<1 THEN RAISE EXCEPTION 'Podaj liczbę nóg na blat.'; END IF;
  h:=public.modular_numeric(p->'height','wysokość',false,200,true);
  IF jsonb_typeof(c->'heights') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'heights') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Uzupełnij wysokości podestu.'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(c->'heights') LOOP
   qty:=public.modular_numeric(r->'cm','wysokość nóg',false,200,true); IF qty<1 OR qty=ANY(heights) THEN RAISE EXCEPTION 'Wysokości nóg muszą być dodatnie i unikalne.'; END IF;
   heights:=array_append(heights,qty); rate:=public.modular_numeric(r->'leg_rate','stawka nogi',true);
   IF qty=h THEN selected_height:=true; leg_rate:=rate; END IF;
  END LOOP;
  IF NOT selected_height THEN RAISE EXCEPTION 'Wybierz wysokość z cennika nóg.'; END IF;
  IF leg_rate IS NULL AND NOT allow_unpriced THEN RAISE EXCEPTION 'Uzupełnij stawkę nóg dla wybranej wysokości.'; END IF;
  subtotal:=subtotal+round(decks*legs*coalesce(leg_rate,0),2);
  IF coalesce(p->>'skirt','') NOT IN ('none','front_sides','all') OR coalesce(c->>'skirt_basis','') NOT IN ('set','metre') OR jsonb_typeof(p->'carpet') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Wybierz wysłonę, jej jednostkę i dywan.'; END IF;
  side_count:=CASE p->>'skirt' WHEN 'none' THEN 0 WHEN 'all' THEN 4 ELSE 3 END;
  edge:=CASE WHEN side_count=0 THEN 0 WHEN side_count=4 THEN 2*(w+d) ELSE w+2*d END;
  stairs:=public.modular_numeric(p->'stairs','ilość schodów',false,20,true);
  FOREACH k IN ARRAY ARRAY['fascia_rate','skirt_rate','carpet_rate','stairs_rate'] LOOP
   rate:=public.modular_numeric(c->k,k,true);
   qty:=CASE k WHEN 'fascia_rate' THEN side_count WHEN 'skirt_rate' THEN CASE WHEN side_count=0 THEN 0 WHEN c->>'skirt_basis'='metre' THEN edge ELSE 1 END WHEN 'carpet_rate' THEN CASE WHEN (p->>'carpet')::boolean THEN area ELSE 0 END ELSE stairs END;
   IF qty>0 AND rate IS NULL AND NOT allow_unpriced THEN RAISE EXCEPTION 'Uzupełnij stawkę: %.',CASE k WHEN 'fascia_rate' THEN 'blendy i mocowanie' WHEN 'skirt_rate' THEN 'wysłona' WHEN 'carpet_rate' THEN 'dywan' ELSE 'schody' END; END IF;
   subtotal:=subtotal+round(qty*coalesce(rate,0),2);
  END LOOP;
  IF jsonb_typeof(p->'accessories') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'accessories')>8 THEN RAISE EXCEPTION 'Dopuszczalne jest do 8 akcesoriów podestu.'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p->'accessories') LOOP
   IF coalesce(r->>'id','')='' OR (r->>'id')=ANY(ids) OR length(trim(coalesce(r->>'name',''))) NOT BETWEEN 1 AND 100 OR jsonb_typeof(r->'name_en') IS DISTINCT FROM 'string' OR length(r->>'name_en')>100 THEN RAISE EXCEPTION 'Uzupełnij nazwy akcesoriów i unikalne identyfikatory.'; END IF;
   ids:=array_append(ids,r->>'id'); qty:=public.modular_numeric(r->'quantity','ilość akcesoriów',false,1000,true); rate:=public.modular_numeric(r->'rate','stawka akcesorium',true);
   IF qty<1 THEN RAISE EXCEPTION 'Ilość akcesorium musi być dodatnia.'; END IF;
   IF rate IS NULL AND NOT allow_unpriced THEN RAISE EXCEPTION 'Uzupełnij cenę: %.',r->>'name'; END IF;
   subtotal:=subtotal+round(qty*coalesce(rate,0),2);
  END LOOP;
 ELSE
  IF jsonb_typeof(c->'components') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'components') NOT BETWEEN 1 AND 12 OR jsonb_typeof(p->'quantities') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dodaj od 1 do 12 składników zestawu.'; END IF;
  IF profile='led' THEN
   area:=public.modular_numeric(p->'area','powierzchnia ekranu',false,10000); IF area<=0 THEN RAISE EXCEPTION 'Powierzchnia LED musi być dodatnia.'; END IF;
   FOREACH k IN ARRAY ARRAY['display','support','processor'] LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c->'components') x WHERE x->>'role'=k AND x->'required'='true') THEN RAISE EXCEPTION 'LED wymaga powierzchni ekranu, konstrukcji i procesora obrazu.'; END IF;
   END LOOP;
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(c->'components') LOOP
   IF coalesce(r->>'id','')='' OR (r->>'id')=ANY(ids) OR length(trim(coalesce(r->>'name',''))) NOT BETWEEN 1 AND 100 OR jsonb_typeof(r->'name_en') IS DISTINCT FROM 'string' OR length(r->>'name_en')>100 OR coalesce(r->>'role','') NOT IN ('display','support','processor','equipment') OR coalesce(r->>'basis','') NOT IN ('area','manual','fixed','parent') OR jsonb_typeof(r->'required') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Nieprawidłowy składnik zestawu.'; END IF;
   ids:=array_append(ids,r->>'id'); qty:=public.modular_numeric(r->'quantity','ilość domyślna',false,1000,true);
   IF (r->>'required')::boolean AND qty<1 THEN RAISE EXCEPTION 'Wymagany składnik musi mieć dodatnią ilość domyślną.'; END IF;
   IF r->>'basis'='area' THEN
    IF profile<>'led' THEN RAISE EXCEPTION 'Przelicznik powierzchni dotyczy LED.'; END IF;
    qty:=qty*area;
   ELSIF r->>'basis'='manual' THEN qty:=public.modular_numeric(p->'quantities'->(r->>'id'),r->>'name',false,100000,true);
   ELSIF r->>'basis'='parent' THEN
    SELECT x INTO parent FROM jsonb_array_elements(c->'components') x WHERE x->>'id'=r->>'parent_id' AND x->>'basis'='manual' AND x->>'id'<>r->>'id' LIMIT 1;
    IF parent IS NULL OR qty<1 THEN RAISE EXCEPTION 'Akcesorium wymaga komponentu głównego i dodatniego przelicznika.'; END IF;
    qty:=qty*public.modular_numeric(p->'quantities'->(parent->>'id'),'ilość komponentu głównego',false,100000,true);
   END IF;
   IF qty>100000 OR (r->>'basis'<>'parent' AND (r->>'required')::boolean AND qty<=0) THEN RAISE EXCEPTION 'Nieprawidłowa ilość składnika: %.',r->>'name'; END IF;
   rate:=public.modular_numeric(r->'rate',r->>'name',true);
   IF qty>0 THEN
    rows_found:=rows_found+1;
    IF rate IS NULL AND NOT allow_unpriced THEN RAISE EXCEPTION 'Uzupełnij cenę: %.',r->>'name'; END IF;
    subtotal:=subtotal+round(qty*coalesce(rate,0),2);
   END IF;
  END LOOP;
  IF rows_found=0 AND NOT allow_unpriced THEN RAISE EXCEPTION 'Wybierz co najmniej jeden składnik zestawu.'; END IF;
 END IF;
 subtotal:=round(subtotal*multiplier,2); IF subtotal>999999999 THEN RAISE EXCEPTION 'Wartość konfiguracji jest zbyt wysoka.'; END IF;
 RETURN subtotal;
END $$;

CREATE OR REPLACE FUNCTION public.validate_product_configurator()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE c jsonb:=NEW.configuration_schema; selection jsonb; quantities jsonb;
BEGIN
 IF c IS NULL THEN RETURN NEW; END IF;
 IF c->>'profile'='warehouse_stage' THEN PERFORM public.validate_warehouse_stage_catalog(c);RETURN NEW;END IF;
 IF c->>'profile'='stage' THEN
  selection:=jsonb_build_object('width',4,'depth',2,'height',c#>'{heights,0,cm}','skirt','none','carpet',false,'stairs',0,'accessories','[]'::jsonb);
 ELSE
  IF jsonb_typeof(c->'components') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Uzupełnij składniki konfiguratora.'; END IF;
  SELECT coalesce(jsonb_object_agg(x->>'id',x->'quantity'),'{}'::jsonb) INTO quantities FROM jsonb_array_elements(c->'components') x;
  selection:=jsonb_build_object('area',6,'quantities',quantities);
 END IF;
 PERFORM public.modular_product_total(jsonb_build_object('version',1,'profile',c->>'profile','catalog',c,'selection',selection),true);
 RETURN NEW;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
