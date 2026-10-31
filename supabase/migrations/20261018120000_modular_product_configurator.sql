BEGIN;
ALTER TABLE public.offer_products ADD COLUMN IF NOT EXISTS configuration_schema jsonb;
COMMENT ON COLUMN public.offer_products.configuration_schema IS 'Versioned configurable product profile and net sales rates. Offer pricing_configuration.modular owns a separate snapshot.';

CREATE OR REPLACE FUNCTION public.modular_numeric(v jsonb, label text, nullable boolean DEFAULT false, max_value numeric DEFAULT 9999999, integral boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE n numeric;
BEGIN
 IF nullable AND v='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Uzupełnij poprawną wartość: %.',label; END IF;
 n:=(v#>>'{}')::numeric;
 IF n<0 OR n>max_value OR n<>round(n,CASE WHEN integral THEN 0 ELSE 2 END) THEN RAISE EXCEPTION 'Nieprawidłowa wartość: %.',label; END IF;
 RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.modular_product_total(s jsonb, allow_unpriced boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE c jsonb:=s->'catalog'; p jsonb:=s->'selection'; profile text:=s->>'profile'; r jsonb; parent jsonb;
 rate numeric; qty numeric; subtotal numeric:=0; multiplier numeric; w numeric; d numeric; h numeric; area numeric;
 decks numeric; legs numeric; leg_rate numeric; side_count integer; edge numeric; stairs numeric;
 selected_height boolean:=false; ids text[]:='{}'; heights numeric[]:='{}'; rows_found integer:=0; k text;
BEGIN
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
DROP TRIGGER IF EXISTS validate_product_configurator ON public.offer_products;
CREATE TRIGGER validate_product_configurator BEFORE INSERT OR UPDATE OF configuration_schema ON public.offer_products FOR EACH ROW EXECUTE FUNCTION public.validate_product_configurator();

CREATE OR REPLACE FUNCTION public.offer_configuration_total(c jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE a jsonb; result numeric; qty numeric;
BEGIN
 IF c ? 'modular' THEN
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR c->>'version' IS DISTINCT FROM '1' OR c->'addons' IS DISTINCT FROM '[]'::jsonb OR c ? 'product_package' OR coalesce(c->>'quantity_source','manual')<>'manual' THEN RAISE EXCEPTION 'Konfigurator zastępuje pakiety i dodatki tej pozycji.'; END IF;
  RETURN public.modular_product_total(c->'modular');
 END IF;
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
END $function$
;

CREATE OR REPLACE FUNCTION public.apply_offer_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE addons jsonb; channel text; extras numeric;
BEGIN
 SELECT sales_channel INTO channel FROM public.offers WHERE id=NEW.offer_id;
 -- Seller prices are governed by an individual price list. Do not bypass that contract.
 IF channel='seller_portal' THEN
  IF NEW.pricing_configuration ? 'modular' THEN RAISE EXCEPTION 'Produkt konfigurowalny wymaga oferty CRM.'; END IF;
  IF coalesce(jsonb_array_length(NEW.pricing_configuration->'addons'),0)>0 THEN RAISE EXCEPTION 'Konfiguracja dodatków wymaga oferty CRM. Ceny portalu pochodzą z indywidualnego cennika.'; END IF;
  NEW.pricing_configuration:=NULL;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' AND NEW.pricing_configuration IS NULL AND NEW.product_id IS NOT NULL THEN
  SELECT pricing_addons INTO addons FROM public.offer_products WHERE id=NEW.product_id;
  IF coalesce(jsonb_array_length(addons),0)>0 THEN
   NEW.pricing_configuration:=jsonb_build_object('version',1,'base_unit_price',NEW.unit_price,'addons',addons);
  END IF;
 END IF;
 IF TG_OP='INSERT' AND NOT coalesce(NEW.pricing_configuration ? 'modular',false) AND EXISTS(SELECT 1 FROM public.offer_products WHERE id=NEW.product_id AND configuration_schema IS NOT NULL) THEN
  RAISE EXCEPTION 'Ten produkt wymaga konfiguracji wymiarów lub składników w ofercie.';
 END IF;
 IF NEW.pricing_configuration ? 'modular' THEN
  NEW.unit_price:=public.offer_configuration_total(NEW.pricing_configuration);
  NEW.pricing_configuration:=jsonb_set(NEW.pricing_configuration,'{base_unit_price}',to_jsonb(NEW.unit_price));
  NEW.offer_page_variant_override:='default'; NEW.show_product_variants_in_pdf:=false; NEW.show_variant_prices_in_pdf:=false; NEW.product_variant_id:=NULL; NEW.unit:='zestaw';
 END IF;
 IF NEW.pricing_configuration IS NOT NULL THEN
  IF NOT (NEW.pricing_configuration ? 'modular') AND TG_OP='UPDATE' AND NEW.pricing_configuration IS NOT DISTINCT FROM OLD.pricing_configuration AND NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
   extras:=public.offer_configuration_total(NEW.pricing_configuration)-(NEW.pricing_configuration->>'base_unit_price')::numeric;
   NEW.pricing_configuration:=jsonb_set(NEW.pricing_configuration,'{base_unit_price}',to_jsonb(NEW.unit_price-extras));
  END IF;
  NEW.unit_price:=public.offer_configuration_total(NEW.pricing_configuration);
  IF jsonb_array_length(NEW.pricing_configuration->'addons')>0 THEN NEW.offer_page_variant_override:='default'; END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent THEN
  IF NEW.quantity<=0 OR coalesce(NEW.discount_percent,0)<0 OR coalesce(NEW.discount_percent,0)>100 THEN RAISE EXCEPTION 'Nieprawidłowa ilość lub rabat pozycji.'; END IF;
  NEW.discount_amount:=round(NEW.unit_price*NEW.quantity*coalesce(NEW.discount_percent,0)/100,2);
 END IF;
 RETURN NEW;
END $function$
;

UPDATE public.offer_products SET configuration_schema='{"version":1,"profile":"stage","deck_rate":150,"legs_per_deck":4,"heights":[{"cm":30,"leg_rate":12.5},{"cm":40,"leg_rate":null},{"cm":50,"leg_rate":null}],"fascia_rate":0,"skirt_rate":50,"skirt_basis":"set","carpet_rate":100,"stairs_rate":null,"multiplier":1}'::jsonb
WHERE id='be81ab60-9ca7-4429-af94-b7068f8e9530' AND configuration_schema IS NULL;
NOTIFY pgrst,'reload schema';
COMMIT;
