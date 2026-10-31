BEGIN;
SET LOCAL lock_timeout='5s';
-- Add LED-only section and cable validation; keep existing profiles and prices unchanged.
CREATE OR REPLACE FUNCTION public.modular_product_total(s jsonb, allow_unpriced boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE c jsonb:=s->'catalog'; p jsonb:=s->'selection'; profile text:=s->>'profile'; r jsonb; parent jsonb;
 rate numeric; qty numeric; subtotal numeric:=0; multiplier numeric; w numeric; d numeric; h numeric; area numeric;
 decks numeric; legs numeric; leg_rate numeric; side_count integer; edge numeric; stairs numeric;
 section jsonb; section_ids text[]:='{}'; section_columns numeric; section_rows numeric; led_modules numeric:=0; led_cables numeric:=1;
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
   IF c->>'led_layout'='sections' AND (coalesce(c->>'led_equipment_id','')='' OR coalesce(c->>'led_cable_component_id','')='') THEN RAISE EXCEPTION 'Powiąż moduł LED i skrętki w konfiguracji produktu.'; END IF;
   IF coalesce(c->>'led_cable_component_id','')<>'' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c->'components') x WHERE x->>'id'=c->>'led_cable_component_id' AND x->>'basis'='manual' AND x->'required'='true') THEN RAISE EXCEPTION 'Skrętki muszą być wymaganym składnikiem z ilością wybieraną w ofercie.'; END IF;
   IF NOT allow_unpriced AND c->>'led_layout'='sections' AND NOT (p ? 'led_sections') THEN RAISE EXCEPTION 'Dodaj sekcje ekranu LED.'; END IF;
   IF p ? 'led_sections' THEN
    IF jsonb_typeof(p->'led_sections') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Nieprawidłowe sekcje LED.'; END IF;
    IF jsonb_array_length(p->'led_sections') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Dodaj od 1 do 30 sekcji ekranu.'; END IF;
    FOR section IN SELECT value FROM jsonb_array_elements(p->'led_sections') LOOP
     IF jsonb_typeof(section->'id') IS DISTINCT FROM 'string' OR coalesce(section->>'id','')='' OR section->>'id'=ANY(section_ids) OR jsonb_typeof(section->'name') IS DISTINCT FROM 'string' OR length(trim(section->>'name')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Uzupełnij nazwy i unikalne identyfikatory sekcji LED.'; END IF;
     section_ids:=array_append(section_ids,section->>'id');
     section_columns:=public.modular_numeric(section->'columns','kolumny LED',false,200,true);
     section_rows:=public.modular_numeric(section->'rows','wiersze LED',false,200,true);
     IF section_columns<1 OR section_rows<1 THEN RAISE EXCEPTION 'Każda sekcja wymaga co najmniej jednej kolumny i wiersza.'; END IF;
     led_modules:=led_modules+section_columns*section_rows;
     led_cables:=led_cables+ceil(section_columns*section_rows/16);
    END LOOP;
    IF led_modules>40000 OR area<>led_modules/4 THEN RAISE EXCEPTION 'Powierzchnia nie odpowiada sekcjom ekranu.'; END IF;
    IF coalesce(c->>'led_cable_component_id','')<>'' AND public.modular_numeric(p->'quantities'->(c->>'led_cable_component_id'),'liczba skrętek',false,100000,true)<>led_cables THEN RAISE EXCEPTION 'Liczba skrętek nie odpowiada sekcjom ekranu.'; END IF;
   END IF;
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


COMMIT;
