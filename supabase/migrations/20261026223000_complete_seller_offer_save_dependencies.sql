-- Consolidated repair for partially updated seller-offer databases.
-- Run this entire file once in the Supabase SQL Editor. It includes the
-- 20261026200000 daily-schedule changes and 20261026210000 presentation changes;
-- the separate 20261026220000 wrapper repair is not required beforehand.
-- This is not a fresh-install bootstrap: the existing seller portal is required.
-- Existing offers, prices, documents and acceptances are not rewritten.
-- Authentication, ownership, revision checks and the save ledger are preserved.
-- All changes commit together; an error leaves the previous schema unchanged.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Part 1: daily schedule, validated arrangements and save entry points v3/v4.
-- Additive: legacy rows retain their original start/end, without inventing a
-- daily programme. Uses existing ownership, revision checks, audit and workflow.
ALTER TABLE public.seller_offer_arrangements ADD COLUMN IF NOT EXISTS event_days jsonb;
ALTER TABLE public.seller_offer_arrangements DROP CONSTRAINT IF EXISTS seller_offer_arrangements_event_days_shape;
ALTER TABLE public.seller_offer_arrangements ADD CONSTRAINT seller_offer_arrangements_event_days_shape
  CHECK (event_days IS NULL OR (jsonb_typeof(event_days)='array' AND jsonb_array_length(event_days)<=31));
COMMENT ON COLUMN public.seller_offer_arrangements.event_days IS
  'Local Europe/Warsaw dates and per-day start/end times. End earlier than start means the following calendar day. NULL keeps a legacy overall time range.';

-- Times are Polish local wall-clock values. No UTC conversion or invented hours.
CREATE OR REPLACE FUNCTION public.normalize_seller_event_days(p_days jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $days$
DECLARE d jsonb; normalized jsonb:='[]'::jsonb; day date; previous_day date; end_day date;
  from_time text; to_time text; starts timestamp; ends timestamp; previous_end timestamp;
  first_start timestamp; last_end timestamp; day_number integer:=0;
BEGIN
  IF jsonb_typeof(p_days) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista dni wydarzenia'; END IF;
  IF jsonb_array_length(p_days)>31 THEN RAISE EXCEPTION 'Możesz dodać do 31 dni wydarzenia'; END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    day_number:=day_number+1;
    IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR COALESCE(d->>'date','') !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Dzień %: wpisz poprawną datę wydarzenia',day_number;
    END IF;
    BEGIN
      day:=(d->>'date')::date;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
      RAISE EXCEPTION 'Dzień %: wpisz poprawną datę wydarzenia',day_number;
    END;
    IF previous_day IS NOT NULL AND day<=previous_day THEN RAISE EXCEPTION 'Dni wydarzenia muszą mieć różne daty i być ułożone chronologicznie'; END IF;
    from_time:=NULLIF(btrim(d->>'start_time'),''); to_time:=NULLIF(btrim(d->>'end_time'),'');
    IF (from_time IS NULL) IS DISTINCT FROM (to_time IS NULL) THEN RAISE EXCEPTION 'Dzień %: uzupełnij obie godziny albo pozostaw obie do ustalenia',day_number; END IF;
    IF from_time IS NOT NULL AND (from_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR to_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN
      RAISE EXCEPTION 'Dzień %: wpisz poprawne godziny HH:MM',day_number;
    END IF;
    IF from_time IS NOT NULL AND from_time=to_time THEN RAISE EXCEPTION 'Dzień %: godzina zakończenia musi różnić się od rozpoczęcia',day_number; END IF;
    end_day:=day+CASE WHEN to_time<from_time THEN 1 ELSE 0 END;
    IF end_day>DATE '9999-12-31' THEN RAISE EXCEPTION 'Data zakończenia wykracza poza obsługiwany zakres'; END IF;
    starts:=CASE WHEN from_time IS NOT NULL THEN day+from_time::time END;
    ends:=CASE WHEN to_time IS NOT NULL THEN end_day+to_time::time END;
    IF previous_end IS NOT NULL AND starts<previous_end THEN RAISE EXCEPTION 'Dzień %: godziny nakładają się na poprzedni dzień wydarzenia',day_number; END IF;
    IF day_number=1 THEN first_start:=starts; END IF;
    last_end:=ends;
    previous_day:=day;
    IF ends IS NOT NULL THEN previous_end:=ends; END IF;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('date',to_char(day,'YYYY-MM-DD'),
      'start_time',COALESCE(from_time,''),'end_time',COALESCE(to_time,'')));
  END LOOP;
  RETURN jsonb_build_object('days',normalized,'starts_at',to_char(first_start,'YYYY-MM-DD"T"HH24:MI'),
    'ends_at',to_char(last_end,'YYYY-MM-DD"T"HH24:MI'));
END; $days$;
REVOKE ALL ON FUNCTION public.normalize_seller_event_days(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_seller_offer_arrangements(p_offer uuid,p_revision integer,p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_old public.seller_offer_arrangements%ROWTYPE; v_next public.seller_offer_arrangements%ROWTYPE;
  v_person jsonb; v_contacts jsonb:='[]'::jsonb; v_key text; v_text text;
  v_hotel jsonb; v_room jsonb; v_snapshot jsonb; v_schedule jsonb;
BEGIN
  PERFORM 1 FROM public.offers WHERE id=p_offer FOR UPDATE;
  IF NOT COALESCE(public.seller_arrangements_access(p_offer,true),false) THEN RAISE EXCEPTION 'Nie możesz zmieniać tych ustaleń. Zmiany potwierdzonej realizacji omów z opiekunem na czacie.'; END IF;
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Nieprawidłowe dane ustaleń'; END IF;
  SELECT * INTO v_old FROM public.seller_offer_arrangements WHERE offer_id=p_offer FOR UPDATE;
  IF p_revision IS DISTINCT FROM COALESCE(v_old.revision,0) THEN RAISE EXCEPTION 'Ustalenia zmieniła inna osoba. Wczytaj aktualne dane przed zapisem.'; END IF;
  FOREACH v_key IN ARRAY ARRAY['setup_at','starts_at','ends_at','teardown_at'] LOOP
    v_text:=NULLIF(btrim(p_values->>v_key),'');
    IF v_text IS NOT NULL AND v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' THEN RAISE EXCEPTION 'Uzupełnij poprawną datę i godzinę harmonogramu'; END IF;
  END LOOP;
  IF NULLIF(p_values->>'materials_due_date','') IS NOT NULL AND (p_values->>'materials_due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Nieprawidłowy termin przekazania materiałów'; END IF;
  IF jsonb_typeof(COALESCE(p_values->'contacts','[]'::jsonb)) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista kontaktów'; END IF;
  IF jsonb_array_length(COALESCE(p_values->'contacts','[]'::jsonb))>12 THEN RAISE EXCEPTION 'Możesz dodać do 12 kontaktów organizacyjnych'; END IF;
  FOR v_person IN SELECT value FROM jsonb_array_elements(COALESCE(p_values->'contacts','[]'::jsonb)) LOOP
    IF jsonb_typeof(v_person)<>'object' OR COALESCE(length(btrim(v_person->>'name')),0) NOT BETWEEN 1 AND 160
      OR length(COALESCE(v_person->>'role',''))>100 OR length(COALESCE(v_person->>'phone',''))>50 OR length(COALESCE(v_person->>'email',''))>254 THEN
      RAISE EXCEPTION 'Uzupełnij imię i nazwisko oraz sprawdź długość danych kontaktowych';
    END IF;
    IF NULLIF(btrim(v_person->>'email'),'') IS NOT NULL AND (v_person->>'email') !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$' THEN RAISE EXCEPTION 'Nieprawidłowy e-mail kontaktu'; END IF;
    v_contacts:=v_contacts||jsonb_build_array(jsonb_build_object('name',btrim(v_person->>'name'),
      'role',btrim(COALESCE(v_person->>'role','')),'email',btrim(COALESCE(v_person->>'email','')),'phone',btrim(COALESCE(v_person->>'phone',''))));
  END LOOP;
  v_next.offer_id:=p_offer; v_next.revision:=COALESCE(v_old.revision,0)+1;
  v_next.room:=btrim(COALESCE(p_values->>'room',''));
  v_snapshot:=CASE WHEN p_values ? 'venue_snapshot' THEN NULLIF(p_values->'venue_snapshot','null'::jsonb)
    WHEN v_next.room=v_old.room THEN v_old.venue_snapshot ELSE NULL END;
  IF v_snapshot IS NOT NULL AND v_snapshot IS DISTINCT FROM v_old.venue_snapshot THEN
    IF jsonb_typeof(v_snapshot) IS DISTINCT FROM 'object'
      OR COALESCE(v_snapshot->>'organization_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'Wybierz przestrzeń z bazy hotelu';
    END IF;
    v_hotel:=public.get_seller_hotel_context(p_offer,(v_snapshot->>'organization_id')::uuid);
    IF v_hotel->>'available' IS DISTINCT FROM 'true'
      OR v_snapshot->>'organization_id' IS DISTINCT FROM v_hotel#>>'{organization,id}'
      OR v_snapshot->>'location_id' IS DISTINCT FROM v_hotel#>>'{location,id}' THEN
      RAISE EXCEPTION 'Wybrana przestrzeń nie należy do hotelu sprzedawcy. Wybierz ją ponownie.';
    END IF;
    SELECT value INTO v_room FROM jsonb_array_elements(v_hotel#>'{location,rooms}') WHERE value->>'id'=v_snapshot#>>'{room,id}';
    IF v_room IS NULL THEN RAISE EXCEPTION 'Sala nie jest już dostępna w bazie hotelu. Wybierz inną przestrzeń.'; END IF;
    v_snapshot:=jsonb_build_object('organization_id',v_hotel#>>'{organization,id}',
      'organization_name',v_hotel#>>'{organization,name}','location_id',v_hotel#>>'{location,id}',
      'location_name',v_hotel#>>'{location,name}','room',v_room,'technical_details',v_hotel#>'{location,technical_details}');
  END IF;
  v_next.venue_snapshot:=v_snapshot;
  IF v_snapshot IS NOT NULL THEN v_next.room:=v_snapshot#>>'{room,name}'; END IF;
  v_next.participant_count:=NULLIF(p_values->>'participant_count','')::integer;
  v_next.setup_at:=NULLIF(p_values->>'setup_at','')::timestamp;
  v_next.starts_at:=NULLIF(p_values->>'starts_at','')::timestamp;
  v_next.ends_at:=NULLIF(p_values->>'ends_at','')::timestamp;
  v_next.teardown_at:=NULLIF(p_values->>'teardown_at','')::timestamp;
  v_next.event_days:=v_old.event_days;
  IF p_values ? 'event_days' AND p_values->'event_days' IS DISTINCT FROM 'null'::jsonb THEN
    v_schedule:=public.normalize_seller_event_days(p_values->'event_days');
    v_next.event_days:=v_schedule->'days';
    v_next.starts_at:=NULLIF(v_schedule->>'starts_at','')::timestamp;
    v_next.ends_at:=NULLIF(v_schedule->>'ends_at','')::timestamp;
  ELSIF COALESCE(jsonb_array_length(v_old.event_days),0)>0
    AND (v_next.starts_at IS DISTINCT FROM v_old.starts_at OR v_next.ends_at IS DISTINCT FROM v_old.ends_at) THEN
    RAISE EXCEPTION 'Oferta ma harmonogram poszczególnych dni. Odśwież stronę i zmień godziny w sekcji Termin i godziny wydarzenia.';
  END IF;
  IF (v_next.setup_at IS NOT NULL AND v_next.starts_at IS NOT NULL AND v_next.setup_at>v_next.starts_at)
    OR (v_next.teardown_at IS NOT NULL AND v_next.ends_at IS NOT NULL AND v_next.teardown_at<v_next.ends_at) THEN
    RAISE EXCEPTION 'Godziny wydarzenia kolidują z montażem lub demontażem. Popraw harmonogram w ustaleniach realizacji.';
  END IF;
  v_next.materials_due_date:=NULLIF(p_values->>'materials_due_date','')::date;
  v_next.technical_requirements:=btrim(COALESCE(p_values->>'technical_requirements',''));
  v_next.logistics_requirements:=btrim(COALESCE(p_values->>'logistics_requirements',''));
  v_next.contacts:=v_contacts; v_next.updated_at:=now(); v_next.updated_by:=auth.uid();
  IF v_old.offer_id IS NOT NULL AND (to_jsonb(v_old)-'revision'-'updated_at'-'updated_by')=(to_jsonb(v_next)-'revision'-'updated_at'-'updated_by') THEN
    RETURN public.get_seller_offer_arrangements(p_offer);
  END IF;
  INSERT INTO public.seller_offer_arrangements SELECT (v_next).*
  ON CONFLICT(offer_id) DO UPDATE SET revision=EXCLUDED.revision,room=EXCLUDED.room,venue_snapshot=EXCLUDED.venue_snapshot,participant_count=EXCLUDED.participant_count,
    event_days=EXCLUDED.event_days,setup_at=EXCLUDED.setup_at,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,teardown_at=EXCLUDED.teardown_at,
    materials_due_date=EXCLUDED.materials_due_date,technical_requirements=EXCLUDED.technical_requirements,
    logistics_requirements=EXCLUDED.logistics_requirements,contacts=EXCLUDED.contacts,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
  INSERT INTO public.seller_offer_arrangement_audit(offer_id,revision,before_values,after_values,actor_id)
    VALUES(p_offer,v_next.revision,CASE WHEN v_old.offer_id IS NOT NULL THEN to_jsonb(v_old) END,to_jsonb(v_next),auth.uid());
  RETURN public.get_seller_offer_arrangements(p_offer);
END; $$;

CREATE OR REPLACE FUNCTION public.save_seller_portal_offer_v3(p_request_id uuid,p_offer jsonb,p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  partner uuid:=public.current_sales_partner_id();
  offer_id uuid; saved_hash text; editor jsonb; venue jsonb; hotel jsonb; room jsonb; values_before jsonb; schedule jsonb; saved_revision integer;
BEGIN
  IF partner IS NULL OR p_request_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.sales_partner_profiles WHERE id=partner AND portal_enabled AND status='active'
  ) THEN RAISE EXCEPTION 'Brak dostępu do portalu' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_offer) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Nieprawidłowe dane oferty'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(partner::text||p_request_id::text,0));
  SELECT r.offer_id,r.request_hash INTO offer_id,saved_hash FROM public.seller_offer_save_requests r
    WHERE r.sales_partner_id=partner AND r.request_id=p_request_id;
  IF FOUND THEN
    IF saved_hash IS DISTINCT FROM md5(p_offer::text||p_items::text) THEN RAISE EXCEPTION 'Poprzedni zapis się zakończył. Otwórz zapisaną ofertę.'; END IF;
    RETURN offer_id;
  END IF;
  IF NULLIF(p_offer->>'id','') IS NOT NULL THEN
    PERFORM 1 FROM public.offers WHERE id=(p_offer->>'id')::uuid AND sales_partner_id=partner FOR UPDATE;
  END IF;
  editor:=public.get_seller_offer_editor_context(NULLIF(p_offer->>'id','')::uuid);
  IF NULLIF(p_offer->>'my_company_id','') IS DISTINCT FROM editor->>'company_id'
    OR NULLIF(p_offer->>'organization_id','') IS DISTINCT FROM editor->>'organization_id' THEN
    RAISE EXCEPTION 'Ustawienia organizacji lub cennika zmienił opiekun. Otwórz ponownie kreator oferty.';
  END IF;
  offer_id:=public.save_seller_portal_offer_v2(p_request_id,p_offer,p_items);
  IF p_offer ? 'venue_selection' OR p_offer ? 'event_schedule' THEN
    values_before:=public.get_seller_offer_arrangements(offer_id)->'values';
    saved_revision:=COALESCE((values_before->>'revision')::integer,0);
  IF p_offer ? 'venue_selection' THEN
    venue:=p_offer->'venue_selection';
    IF jsonb_typeof(venue) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Wybierz przestrzeń z bazy hotelu'; END IF;
    IF (venue->>'revision')::integer IS DISTINCT FROM COALESCE((values_before->>'revision')::integer,0) THEN
      RAISE EXCEPTION 'Ustalenia zmieniła inna osoba. Wczytaj ponownie ofertę przed zmianą przestrzeni.';
    END IF;
    IF NULLIF(venue->>'room_id','') IS NOT NULL THEN
      hotel:=public.get_seller_hotel_context(offer_id,(editor->>'organization_id')::uuid);
      SELECT value INTO room FROM jsonb_array_elements(COALESCE(hotel#>'{location,rooms}','[]'::jsonb))
        WHERE value->>'id'=venue->>'room_id';
      IF room IS NULL THEN RAISE EXCEPTION 'Przestrzeń nie jest już dostępna. Wczytaj ponownie listę hotelu.'; END IF;
      values_before:=COALESCE(values_before,'{}'::jsonb)||jsonb_build_object('room',room->>'name','venue_snapshot',
        jsonb_build_object('organization_id',hotel#>>'{organization,id}','location_id',hotel#>>'{location,id}','room',room));
    ELSE
      values_before:=COALESCE(values_before,'{}'::jsonb)||jsonb_build_object('room','','venue_snapshot',NULL);
    END IF;
  END IF;
    IF p_offer ? 'event_schedule' THEN
      schedule:=p_offer->'event_schedule';
      IF jsonb_typeof(schedule) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Nieprawidłowy harmonogram wydarzenia'; END IF;
      IF (schedule->>'revision')::integer IS DISTINCT FROM saved_revision THEN
        RAISE EXCEPTION 'Ustalenia zmieniła inna osoba. Wczytaj ponownie ofertę przed zmianą godzin.';
      END IF;
      schedule:=public.normalize_seller_event_days(schedule->'days');
      IF jsonb_array_length(schedule->'days')>0
        AND schedule#>>'{days,0,date}' IS DISTINCT FROM NULLIF(p_offer->>'event_date','') THEN
        RAISE EXCEPTION 'Data oferty musi być datą pierwszego dnia wydarzenia';
      END IF;
      values_before:=COALESCE(values_before,'{}'::jsonb)||jsonb_build_object('event_days',schedule->'days');
    END IF;
    PERFORM public.save_seller_offer_arrangements(offer_id,saved_revision,values_before);
  END IF;
  RETURN offer_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_seller_portal_offer_v3(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_offer_v3(uuid,jsonb,jsonb) TO authenticated;


-- Return the exact committed revision so a PDF retry followed by editing cannot
-- reuse an obsolete revision. The same idempotency ledger still protects saves.
CREATE OR REPLACE FUNCTION public.save_seller_portal_offer_v4(p_request_id uuid,p_offer jsonb,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $save$
DECLARE id uuid;
BEGIN
  id:=public.save_seller_portal_offer_v3(p_request_id,p_offer,p_items);
  RETURN jsonb_build_object('offer_id',id,'arrangements',public.get_seller_offer_arrangements(id));
END; $save$;
REVOKE ALL ON FUNCTION public.save_seller_portal_offer_v4(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_offer_v4(uuid,jsonb,jsonb) TO authenticated;

-- Part 2: item presentation and the v5 entry point used by the current portal.
-- No existing quotes, documents, rates or acceptances are rewritten.
-- LED package prices use the existing per-seller component price table.
CREATE OR REPLACE FUNCTION public.apply_offer_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE addons jsonb; channel text; extras numeric; v_offer record; v_quote public.seller_configuration_quotes; v_item jsonb; v_layout text; v_profile text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at'])
     IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['display_order','offer_page_variant_override','show_variant_prices_in_pdf','show_product_variants_in_pdf','updated_at']) THEN
   RETURN NEW;
  END IF;
 END IF;

 SELECT sales_channel INTO channel FROM public.offers WHERE id=NEW.offer_id;
 -- Seller prices are governed by an individual price list. Do not bypass that contract.
 IF channel='seller_portal' THEN
  SELECT sales_partner_id,my_company_id,commercial_model INTO v_offer FROM public.offers WHERE id=NEW.offer_id;
  IF TG_OP='INSERT' AND nullif(current_setting('app.seller_configuration_items',true),'') IS NOT NULL THEN
    SELECT value INTO v_item FROM jsonb_array_elements(current_setting('app.seller_configuration_items')::jsonb)
      WHERE (value->>'display_order')::integer=NEW.display_order;
    NEW.seller_configuration_quote_id:=nullif(v_item->>'configuration_quote_id','')::uuid;
    NEW.days:=coalesce(nullif(v_item->>'days','')::integer,1);
  END IF;
  IF NEW.seller_configuration_quote_id IS NOT NULL THEN
    IF TG_OP='UPDATE' AND NEW.seller_configuration_quote_id IS NOT DISTINCT FROM OLD.seller_configuration_quote_id
      AND NEW.pricing_configuration IS DISTINCT FROM OLD.pricing_configuration THEN
      RAISE EXCEPTION 'Zmień konfigurację w portalu sprzedawcy i zapisz nową wycenę. Zapisana konfiguracja nie może być nadpisana bez ponownej wyceny.';
    END IF;
    SELECT * INTO v_quote FROM public.seller_configuration_quotes WHERE id=NEW.seller_configuration_quote_id FOR UPDATE;
    IF NOT FOUND OR v_quote.sales_partner_id IS DISTINCT FROM v_offer.sales_partner_id
      OR v_quote.my_company_id IS DISTINCT FROM v_offer.my_company_id OR v_quote.product_id IS DISTINCT FROM NEW.product_id
      OR NEW.is_partner_custom OR NEW.product_variant_id IS NOT NULL
      OR (v_quote.offer_id IS NOT NULL AND v_quote.offer_id<>NEW.offer_id)
      OR (v_quote.offer_id IS NULL AND v_quote.expires_at<now()) THEN
      RAISE EXCEPTION 'Wycena konfiguracji jest niedostępna lub wygasła. Otwórz ponownie konfigurator produktu.';
    END IF;
    UPDATE public.seller_configuration_quotes SET offer_id=NEW.offer_id WHERE id=v_quote.id AND offer_id IS NULL;
    NEW.pricing_configuration:=v_quote.configuration;
    NEW.base_partner_unit_price:=v_quote.price_net;
    NEW.unit_cost:=v_quote.price_net;
    IF v_offer.commercial_model='commission' THEN NEW.client_unit_price:=v_quote.price_net; END IF;
    IF NEW.client_unit_price IS NULL OR NEW.client_unit_price<0 OR NEW.client_unit_price>999999999
       OR NEW.client_unit_price::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Nieprawidłowa cena klienta.'; END IF;
    NEW.unit_price:=NEW.client_unit_price;
    NEW.partner_margin_amount:=round((NEW.client_unit_price-v_quote.price_net)*NEW.quantity*NEW.days,2);
    NEW.requires_internal_approval:=NEW.client_unit_price<v_quote.price_net;
    NEW.name:=v_quote.name;
    NEW.description:=v_quote.description;
    NEW.unit:='zestaw';
    NEW.offer_page_variant_override:='default';
    NEW.show_product_variants_in_pdf:=false;
    NEW.show_variant_prices_in_pdf:=false;
    NEW.partner_source_snapshot:=coalesce(NEW.partner_source_snapshot,'{}')||jsonb_build_object(
      'seller_price_net',v_quote.price_net,'seller_price_source','configuration_snapshot',
      'configuration_quote_id',v_quote.id);
  ELSE
    IF NEW.pricing_configuration IS NOT NULL THEN RAISE EXCEPTION 'Zapisz konfigurację przez kalkulator sprzedawcy.'; END IF;
    IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.offer_products WHERE id=NEW.product_id
      AND (configuration_schema IS NOT NULL OR coalesce(jsonb_array_length(pricing_addons),0)>0)) THEN
      RAISE EXCEPTION 'Ta usługa wymaga konfiguracji produktu i indywidualnej wyceny.';
    END IF;
    NEW.pricing_configuration:=NULL;
  END IF;
  -- Only presentation is accepted from the browser. The price/configuration
  -- above still comes exclusively from the authenticated saved quote.
  IF TG_OP='INSERT' AND v_item ? 'page_layout' THEN
    v_layout:=v_item->>'page_layout';
    v_profile:=NEW.pricing_configuration#>>'{modular,profile}';
    IF v_layout IS NULL OR v_layout NOT IN ('compact','default','visual') THEN
      RAISE EXCEPTION 'Wybierz poprawny układ pozycji w PDF.';
    END IF;
    IF v_layout<>'default' AND NOT coalesce((
      (v_profile IS NULL AND coalesce(jsonb_array_length(NEW.pricing_configuration->'addons'),0)=0)
      OR (v_layout='compact' AND (v_profile IN ('stage','warehouse_stage')
        OR (v_profile='led' AND NEW.pricing_configuration#>'{modular,selection,led_sections}' IS NOT NULL)))
    ),false) THEN RAISE EXCEPTION 'Ten układ nie obsługuje pełnego zakresu konfiguracji. Wybierz osobną stronę.'; END IF;
    NEW.offer_page_variant_override:=v_layout;
    NEW.partner_source_snapshot:=coalesce(NEW.partner_source_snapshot,'{}'::jsonb)||jsonb_build_object('seller_presentation',1);
  END IF;
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
END $function$;

-- Old fingerprints remain unchanged until the seller explicitly saves the
-- new presentation settings. Order is already part of the ordered item hash.
CREATE OR REPLACE FUNCTION public.seller_offer_source_key(p_offer_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT md5((jsonb_build_object(
    'title',o.title,'description',o.description,'event_date',o.event_date,
    'event_location',o.event_location,'valid_until',o.valid_until,
    'client_name',o.portal_client_name,'client_company',o.portal_client_company,
    'client_email',o.portal_client_email,'client_phone',o.portal_client_phone,
    'approval',o.partner_approval_status,'company',o.my_company_id,'branding',o.partner_branding_snapshot,'tax',o.tax_percent,
    'items',(SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'description',i.description,
      'unit',i.unit,'quantity',i.quantity,'price',i.client_unit_price,'image',i.partner_source_snapshot->'image_path') || CASE WHEN i.pricing_configuration IS NOT NULL OR i.days<>1 THEN jsonb_build_object('configuration',i.pricing_configuration,'days',i.days) ELSE '{}'::jsonb END
      || CASE WHEN i.partner_source_snapshot ? 'seller_presentation' THEN
        jsonb_build_object('page_layout',coalesce(i.offer_page_variant_override,'default')) ELSE '{}'::jsonb END
      ORDER BY i.display_order,i.id) FROM public.offer_items i WHERE i.offer_id=o.id)
  ) || CASE WHEN COALESCE(jsonb_array_length(o.recommended_items),0)>0
    THEN jsonb_build_object('recommendations',o.recommended_items) ELSE '{}'::jsonb END)::text) FROM public.offers o WHERE o.id=p_offer_id AND o.sales_channel='seller_portal';
$$;
REVOKE ALL ON FUNCTION public.seller_offer_source_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_offer_source_key(uuid) TO service_role;

-- A versioned entry point prevents an older database silently dropping layout.
CREATE OR REPLACE FUNCTION public.save_seller_portal_offer_v5(p_request_id uuid,p_offer jsonb,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $save$
BEGIN
  RETURN public.save_seller_portal_offer_v4(p_request_id,p_offer,p_items);
END; $save$;
REVOKE ALL ON FUNCTION public.save_seller_portal_offer_v5(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_offer_v5(uuid,jsonb,jsonb) TO authenticated;

-- Refresh the API metadata only after the entire repair commits successfully.
NOTIFY pgrst, 'reload schema';
COMMIT;

