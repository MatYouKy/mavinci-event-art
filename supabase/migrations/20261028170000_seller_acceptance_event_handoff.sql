BEGIN;
SET LOCAL lock_timeout = '5s';

-- Existing confirmed events remain unchanged. New acceptances create an event
-- in the existing commercial stage, explicitly awaiting CRM confirmation.
DO $dependencies$ BEGIN
  IF to_regprocedure('public.seller_offer_handoff_version()') IS NULL
    OR to_regprocedure('public.normalize_seller_event_days(jsonb)') IS NULL
    OR to_regprocedure('public.sync_event_billing_seller_commissions(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw wdroż obsługę ofert sprzedawcy, harmonogramu dni i prowizji (20260917170000, 20261026200000, 20260911203000).';
  END IF;
END $dependencies$;
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS seller_confirmation_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seller_schedule_pending boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.events.seller_confirmation_required IS
  'Seller offer accepted; event exists for planning but is not yet confirmed. Legacy events keep false.';
COMMENT ON COLUMN public.events.seller_schedule_pending IS
  'Calendar date is known, but precise hours still require CRM confirmation. Midnight is not a confirmed start time.';

-- Recognize pending events in every seller-facing view without adding a new
-- global event enum or changing unrelated CRM workflows.
CREATE OR REPLACE FUNCTION public.get_seller_offer_arrangements(p_offer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer public.offers%ROWTYPE; v_values jsonb; v_event jsonb; v_team jsonb;
BEGIN
  IF NOT COALESCE(public.seller_arrangements_access(p_offer),false) THEN RAISE EXCEPTION 'Brak dostępu do ustaleń tej oferty i marki'; END IF;
  SELECT * INTO STRICT v_offer FROM public.offers WHERE id=p_offer;
  SELECT to_jsonb(a)-'offer_id'-'updated_by' INTO v_values FROM public.seller_offer_arrangements a WHERE a.offer_id=p_offer;
  SELECT jsonb_build_object('id',e.id,'name',e.name,'status',CASE WHEN e.seller_confirmation_required AND e.status::text<>'cancelled' THEN 'awaiting_crm_confirmation' ELSE e.status::text END,
    'starts_at',CASE WHEN e.seller_schedule_pending THEN NULL ELSE to_char(e.event_date AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI') END,
    'ends_at',CASE WHEN e.seller_schedule_pending THEN NULL ELSE to_char(e.event_end_date AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI') END,
    'setup_at',to_char(e.planned_setup_at AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI'),
    'teardown_at',to_char(e.planned_teardown_at AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI'),
    'location',e.location,'can_view_crm',CASE WHEN public.current_session_is_seller_portal() THEN false ELSE public.current_employee_can_view_event(e.id) END)
  INTO v_event FROM public.events e WHERE e.id=v_offer.event_id AND e.my_company_id=v_offer.my_company_id;
  WITH assigned AS (
    SELECT e.id,e.name,e.surname,e.email,e.phone_number,'Opiekun sprzedawcy'::text AS role,0 AS priority
    FROM public.employees e
    WHERE e.id=public.seller_partner_manager_id(v_offer.sales_partner_id,v_offer.my_company_id)
      AND e.is_active AND public.employee_can_access_company(e.id,v_offer.my_company_id)
    UNION ALL
    SELECT e.id,e.name,e.surname,e.email,e.phone_number,COALESCE(NULLIF(a.role,''),'Zespół realizacji'),1
    FROM public.employee_assignments a JOIN public.employees e ON e.id=a.employee_id AND e.is_active
    JOIN public.events event ON event.id=a.event_id AND event.my_company_id=v_offer.my_company_id
    WHERE a.event_id=v_offer.event_id AND a.status::text='accepted' AND event.status::text<>'cancelled'
  ), people AS (SELECT DISTINCT ON(id) * FROM assigned ORDER BY id,priority,role)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',btrim(concat_ws(' ',name,surname)),
    'role',role,'email',email,'phone',phone_number) ORDER BY priority,surname,name,id),'[]'::jsonb) INTO v_team FROM people;
  RETURN jsonb_build_object('can_edit',public.seller_arrangements_access(p_offer,true),'values',COALESCE(v_values,'{"revision":0}'::jsonb),
    'offer',jsonb_build_object('id',v_offer.id,'title',v_offer.title,'event_date',v_offer.event_date,
      'location',v_offer.event_location,'status',v_offer.status,'base_net',v_offer.partner_base_net,'client_net',v_offer.client_total_net),
    'client',jsonb_build_object('name',v_offer.portal_client_name,'company',v_offer.portal_client_company,
      'email',v_offer.portal_client_email,'phone',v_offer.portal_client_phone),'event',v_event,'team',v_team);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_realizations(p_include_past boolean DEFAULT false,p_search text DEFAULT '',p_offset integer DEFAULT 0,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $delivery_list$
DECLARE v_partner uuid := public.current_sales_partner_id(); v_result jsonb;
BEGIN
  IF v_partner IS NULL THEN RAISE EXCEPTION 'Brak dostępu do realizacji sprzedawcy'; END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_offset>100000 OR p_limit IS NULL OR p_limit<1 OR p_limit>100
    OR length(COALESCE(p_search,''))>200 THEN RAISE EXCEPTION 'Nieprawidłowe parametry listy'; END IF;
  WITH candidates AS (
    SELECT COALESCE(e.id,o.id) AS id,e.id AS event_id,o.id AS offer_id,o.offer_number,
      COALESCE(e.name,NULLIF(o.title,''),o.offer_number,'Realizacja') AS name,
      COALESCE(e.event_date,a.starts_at AT TIME ZONE 'Europe/Warsaw',o.event_date::timestamp AT TIME ZONE 'Europe/Warsaw') AS starts_at,
      COALESCE(e.event_end_date,e.event_date,a.ends_at AT TIME ZONE 'Europe/Warsaw',o.event_date::timestamp AT TIME ZONE 'Europe/Warsaw') AS ends_at,
      COALESCE(NULLIF(e.location,''),o.event_location) AS location,
      CASE WHEN e.seller_confirmation_required AND e.status::text<>'cancelled' THEN 'awaiting_crm_confirmation' ELSE COALESCE(e.status::text,'awaiting_event') END AS status,
      b.name AS brand_name,COALESCE(NULLIF(o.portal_client_company,''),o.portal_client_name) AS client_name,
      o.client_total_net AS client_net,o.status::text='accepted' AS accepted_offer,o.updated_at
    FROM public.offers o JOIN public.sales_partner_brand_terms t
      ON t.sales_partner_id=o.sales_partner_id AND t.my_company_id=o.my_company_id AND t.is_active
    JOIN public.my_companies b ON b.id=o.my_company_id
    LEFT JOIN public.events e ON e.id=o.event_id AND e.my_company_id=o.my_company_id
    LEFT JOIN public.seller_offer_arrangements a ON a.offer_id=o.id
    WHERE o.sales_partner_id=v_partner AND o.sales_channel='seller_portal' AND o.status::text<>'rejected'
      AND (o.event_id IS NULL OR e.id IS NOT NULL)
      AND (o.status::text='accepted' OR e.status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled','cancelled'))
  ), chosen AS (
    SELECT DISTINCT ON(id) * FROM candidates ORDER BY id,accepted_offer DESC,updated_at DESC NULLS LAST,offer_id
  ), classified AS (
    SELECT *,CASE WHEN status='in_progress' THEN false WHEN status IN ('completed','invoiced','settled','cancelled') THEN true
      ELSE COALESCE((COALESCE(ends_at,starts_at) AT TIME ZONE 'Europe/Warsaw')::date < (now() AT TIME ZONE 'Europe/Warsaw')::date,false) END AS is_past
    FROM chosen
  ), filtered AS (
    SELECT * FROM classified WHERE (COALESCE(p_include_past,false) OR NOT is_past)
      AND (COALESCE(btrim(p_search),'')='' OR concat_ws(' ',name,offer_number,location,brand_name,client_name) ILIKE '%'||btrim(p_search)||'%')
  ), page AS (
    SELECT * FROM filtered ORDER BY is_past,
      CASE WHEN NOT is_past THEN starts_at END ASC NULLS LAST,
      CASE WHEN is_past THEN starts_at END DESC NULLS LAST,id OFFSET p_offset LIMIT p_limit
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'has_more',p_offset+(SELECT count(*) FROM page)<(SELECT count(*) FROM filtered),
    'items',COALESCE((SELECT jsonb_agg(to_jsonb(p)-'accepted_offer'-'updated_at' ORDER BY is_past,
      CASE WHEN NOT is_past THEN starts_at END ASC NULLS LAST,CASE WHEN is_past THEN starts_at END DESC NULLS LAST,id) FROM page p),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END;
$delivery_list$;

CREATE OR REPLACE FUNCTION public.notify_seller_realization_acceptance(p_offer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o record; v_notice uuid; v_key text; v_confirmed boolean; v_stage text;
BEGIN
  SELECT x.id,x.sales_partner_id,x.my_company_id,x.offer_number,x.title,x.event_id,
    p.portal_auth_user_id,r.reviewed_at,b.name AS brand_name,e.status::text AS event_status,e.seller_confirmation_required INTO o
  FROM public.offers x
  JOIN public.sales_partner_profiles p ON p.id=x.sales_partner_id AND p.portal_enabled AND p.status='active'
  JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id AND t.my_company_id=x.my_company_id AND t.is_active
  JOIN public.seller_offer_reviews r ON r.offer_id=x.id AND r.status='approved'
  JOIN public.my_companies b ON b.id=x.my_company_id
  JOIN auth.users u ON u.id=p.portal_auth_user_id
  LEFT JOIN public.events e ON e.id=x.event_id AND e.my_company_id=x.my_company_id
  WHERE x.id=p_offer_id AND x.sales_channel='seller_portal' AND x.status::text='accepted';
  IF NOT FOUND OR o.event_status='cancelled' THEN RETURN; END IF;
  v_confirmed:=NOT COALESCE(o.seller_confirmation_required,false) AND COALESCE(o.event_status IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled'),false);
  v_stage:=CASE WHEN v_confirmed THEN 'realization_confirmed' ELSE 'realization_accepted' END;
  v_key:=o.id::text||':'||o.portal_auth_user_id::text||':'||v_stage||':'||
    CASE WHEN v_confirmed THEN o.event_id::text ELSE COALESCE(extract(epoch FROM o.reviewed_at)::text,'accepted') END;
  INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
    VALUES(CASE WHEN v_confirmed THEN 'Realizacja potwierdzona przez CRM' ELSE 'Oferta zaakceptowana — realizacja oczekuje na potwierdzenie CRM' END,
      concat_ws(' · ',COALESCE(o.offer_number,o.title,'Oferta'),o.brand_name)||
        CASE WHEN v_confirmed THEN '. CRM potwierdził wydarzenie. Otwórz ustalenia i rozmowę.'
          ELSE '. Oferta trafiła do Realizacji. To jeszcze nie jest potwierdzenie wydarzenia.' END,
      'info','offer','/seller/realizations/'||o.id::text||'#seller-offer-review','offer',o.id,
      jsonb_build_object('workflow','seller_review_result','event',v_stage,'decision','approved',
        'offer_id',o.id,'sales_partner_id',o.sales_partner_id,'my_company_id',o.my_company_id,
        'reviewed_at',o.reviewed_at,'seller_realization_key',v_key))
    ON CONFLICT DO NOTHING RETURNING id INTO v_notice;
  IF v_notice IS NOT NULL THEN
    INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
      VALUES(v_notice,o.portal_auth_user_id,false) ON CONFLICT(notification_id,user_id) DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_event_referring_sales_partner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  partner_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.referring_sales_partner_id IS NOT DISTINCT FROM OLD.referring_sales_partner_id THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.referring_sales_partner_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF coalesce(public.current_session_is_seller_portal(), true) THEN
      RAISE EXCEPTION 'Polecającego sprzedawcę przypisuje pracownik CRM, nie portal sprzedawcy';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF NOT coalesce(public.can_view_event_commercials(NEW.id, true), false)
         OR NOT coalesce(public.current_employee_can_access_event_company(NEW.id), false) THEN
        IF OLD.referring_sales_partner_id IS NULL AND NEW.referring_sales_partner_id IS NOT NULL
          AND EXISTS(SELECT 1 FROM public.offers o WHERE o.event_id=NEW.id AND o.sales_channel='seller_portal'
            AND o.status::text='accepted' AND o.sales_partner_id=NEW.referring_sales_partner_id
            AND o.my_company_id=NEW.my_company_id AND public.seller_offer_can_create_event(o.id)) THEN
          NULL;
        ELSE
        RAISE EXCEPTION 'Brak uprawnień do zmiany sprzedawcy polecającego to wydarzenie';
        END IF;
      END IF;
    ELSIF NOT coalesce(public.finance_can_manage(), false) THEN
      RAISE EXCEPTION 'Brak uprawnień do przypisania prowizji przy tworzeniu wydarzenia';
    END IF;
    IF NEW.my_company_id IS NOT NULL
       AND NOT coalesce(public.current_employee_can_access_company(NEW.my_company_id), false) THEN
      RAISE EXCEPTION 'Brak dostępu do marki wydarzenia';
    END IF;
  ELSIF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Zaloguj się, aby przypisać sprzedawcę polecającego';
  END IF;

  IF NEW.referring_sales_partner_id IS NULL THEN RETURN NEW; END IF;

  -- FOR SHARE chroni przed równoczesnym wyłączeniem profilu podczas przypisania.
  SELECT p.status INTO partner_status FROM public.sales_partner_profiles p
  WHERE p.id = NEW.referring_sales_partner_id FOR SHARE;
  IF NOT FOUND OR partner_status <> 'active' THEN
    RAISE EXCEPTION 'Sprzedawca nie istnieje albo jest nieaktywny. Odśwież listę i wybierz aktywny profil';
  END IF;
  -- Brak warunków marki nie zabrania zapisania polecenia; blokuje naliczenie.
  RETURN NEW;
END;
$$;

-- Internal transaction helper. The offer row serializes simultaneous approvals;
-- a retry returns the existing event without resetting any operational work.
CREATE OR REPLACE FUNCTION public.ensure_seller_offer_event(p_offer_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $ensure$
DECLARE o public.offers%ROWTYPE; a public.seller_offer_arrangements%ROWTYPE;
  r public.seller_offer_reviews%ROWTYPE; e public.events%ROWTYPE;
  v_event_id uuid; v_location_id uuid; v_room_id uuid; description text;
  starts timestamp; ends timestamp; calendar_day date; normalized jsonb; d jsonb;
  phase_type uuid; phase_start timestamp; phase_end timestamp; n integer:=0;
  equipment record;
  agenda_start_type oid; agenda_end_type oid;
BEGIN
  IF NOT COALESCE(public.seller_offer_can_create_event(p_offer_id),false) THEN
    RAISE EXCEPTION 'Akceptacja tworzy wydarzenie. Wymagane są uprawnienia do ofert i wydarzeń tej marki.';
  END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal' FOR UPDATE;
  SELECT * INTO r FROM public.seller_offer_reviews WHERE offer_id=p_offer_id FOR UPDATE;
  IF o.status::text<>'accepted' OR r.status IS DISTINCT FROM 'approved'
    OR r.source_key IS DISTINCT FROM public.seller_offer_source_key(p_offer_id) THEN
    RAISE EXCEPTION 'Najpierw zaakceptuj aktualną wersję oferty.';
  END IF;
  IF o.event_id IS NOT NULL THEN
    SELECT * INTO STRICT e FROM public.events WHERE id=o.event_id FOR UPDATE;
    IF e.my_company_id IS DISTINCT FROM o.my_company_id OR NOT COALESCE(public.current_employee_can_view_event(e.id),false) THEN
      RAISE EXCEPTION 'Brak dostępu do powiązanego wydarzenia tej marki.';
    END IF;
    IF e.status::text='cancelled' THEN RAISE EXCEPTION 'Wydarzenie jest anulowane. Nie zostanie utworzone ponownie.'; END IF;
    RETURN e.id;
  END IF;
  SELECT * INTO a FROM public.seller_offer_arrangements WHERE offer_id=p_offer_id FOR UPDATE;
  starts:=a.starts_at; ends:=a.ends_at;
  IF COALESCE(jsonb_array_length(a.event_days),0)>0 THEN
    normalized:=public.normalize_seller_event_days(a.event_days);
    starts:=NULLIF(normalized->>'starts_at','')::timestamp;
    ends:=NULLIF(normalized->>'ends_at','')::timestamp;
    calendar_day:=(normalized#>>'{days,0,date}')::date;
  ELSE calendar_day:=COALESCE(starts::date,(o.event_date AT TIME ZONE 'Europe/Warsaw')::date);
  END IF;
  IF calendar_day IS NULL THEN RAISE EXCEPTION 'Uzupełnij datę wydarzenia w ofercie przed akceptacją.'; END IF;
  IF starts IS NOT NULL AND (starts AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw'<>starts
    OR ends IS NOT NULL AND (ends AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw'<>ends THEN
    RAISE EXCEPTION 'Godzina wydarzenia nie istnieje w strefie Europe/Warsaw. Poproś o poprawienie terminu.';
  END IF;
  IF starts IS NOT NULL AND ends IS NOT NULL AND ends<=starts THEN RAISE EXCEPTION 'Koniec wydarzenia musi być późniejszy niż początek.'; END IF;

  -- Only verified IDs are inherited; never match customers by a similar name
  -- or treat the seller's hotel as the end customer / invoice recipient.
  SELECT l.id INTO v_location_id FROM public.locations l
    WHERE l.id::text=a.venue_snapshot->>'location_id';
  IF v_location_id IS NOT NULL THEN
    SELECT (room->>'id')::uuid INTO v_room_id FROM public.locations l
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.rooms,'[]'::jsonb)) room
      WHERE l.id=v_location_id AND room->>'id'=a.venue_snapshot#>>'{room,id}' LIMIT 1;
  END IF;
  description:=concat_ws(E'\n\n',NULLIF(o.description,''),
    'Źródło: oferta sprzedawcy '||COALESCE(o.offer_number,o.id::text),
    'Klient: '||concat_ws(' · ',NULLIF(o.portal_client_company,''),NULLIF(o.portal_client_name,''),
      NULLIF(o.portal_client_email,''),NULLIF(o.portal_client_phone,'')),
    CASE WHEN a.room<>'' THEN 'Sala / przestrzeń: '||a.room END,
    CASE WHEN a.participant_count IS NOT NULL THEN 'Liczba uczestników: '||a.participant_count END,
    CASE WHEN a.technical_requirements<>'' THEN 'Wymagania techniczne: '||a.technical_requirements END,
    CASE WHEN a.logistics_requirements<>'' THEN 'Logistyka: '||a.logistics_requirements END,
    CASE WHEN a.materials_due_date IS NOT NULL THEN 'Materiały do: '||to_char(a.materials_due_date,'DD.MM.YYYY') END,
    (SELECT string_agg(concat_ws(' · ',c->>'name',NULLIF(c->>'role',''),NULLIF(c->>'email',''),NULLIF(c->>'phone','')),E'\n')
      FROM jsonb_array_elements(COALESCE(a.contacts,'[]'::jsonb)) c),
    CASE WHEN starts IS NULL OR ends IS NULL THEN 'Godziny wydarzenia są do ustalenia. Data kalendarzowa nie potwierdza godziny rozpoczęcia.' END);
  INSERT INTO public.events(name,description,event_date,event_end_date,planned_setup_at,planned_teardown_at,
    location,location_id,location_room_ids,organization_id,contact_person_id,
    status,my_company_id,created_by,seller_confirmation_required,seller_schedule_pending)
  VALUES(COALESCE(NULLIF(btrim(o.title),''),'Realizacja '||o.offer_number),description,
    COALESCE(starts,calendar_day::timestamp) AT TIME ZONE 'Europe/Warsaw',ends AT TIME ZONE 'Europe/Warsaw',
    a.setup_at AT TIME ZONE 'Europe/Warsaw',a.teardown_at AT TIME ZONE 'Europe/Warsaw',
    NULLIF(o.event_location,''),v_location_id,CASE WHEN v_room_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[v_room_id] END,
    o.organization_id,o.contact_id,'offer_accepted',o.my_company_id,public.current_employee_id(),true,starts IS NULL OR ends IS NULL)
  RETURNING id INTO v_event_id;
  -- Include status in the SET list to run the normal accepted-offer budget sync.
  UPDATE public.offers SET event_id=v_event_id,status='accepted' WHERE id=p_offer_id;
  UPDATE public.events SET referring_sales_partner_id=o.sales_partner_id WHERE id=v_event_id;
  -- The existing billing trigger books a planned commission exactly once,
  -- honors brand terms / markup mode and never approves or pays it.

  -- Reuse the same product / variant / configurator resolver as reservations.
  -- These are planning lines, NOT confirmed reservations or assigned units.
  FOR equipment IN SELECT * FROM public.get_offer_selected_equipment(p_offer_id,o.accepted_package_id) LOOP
    IF equipment.qty>0 THEN
      INSERT INTO public.event_equipment(event_id,offer_id,equipment_id,kit_id,quantity,status,reservation_status,is_optional,auto_added)
      VALUES(v_event_id,p_offer_id,CASE WHEN equipment.item_type='item' THEN equipment.item_id END,
        CASE WHEN equipment.item_type='kit' THEN equipment.item_id END,equipment.qty,'draft','planned',false,true);
    END IF;
  END LOOP;
  -- Start the existing Timeline only from actual agreed times. No guessed
  -- setup/travel durations, staff or vehicles and no automatic invitations.
  SELECT t.id INTO phase_type FROM public.event_phase_types t
    WHERE t.is_active AND t.name='Realizacja' ORDER BY t.sequence_priority,t.id LIMIT 1;
  IF phase_type IS NOT NULL THEN
    IF normalized IS NULL AND starts IS NOT NULL AND ends>starts THEN
      INSERT INTO public.event_phases(event_id,phase_type_id,name,start_time,end_time,sequence_order,created_by)
      VALUES(v_event_id,phase_type,'Realizacja',starts AT TIME ZONE 'Europe/Warsaw',ends AT TIME ZONE 'Europe/Warsaw',1,public.current_employee_id());
    ELSE
      FOR d IN SELECT value FROM jsonb_array_elements(COALESCE(normalized->'days','[]'::jsonb)) LOOP
        n:=n+1;
        IF NULLIF(d->>'start_time','') IS NULL OR NULLIF(d->>'end_time','') IS NULL THEN CONTINUE; END IF;
        phase_start:=(d->>'date')::date+(d->>'start_time')::time;
        phase_end:=(d->>'date')::date+(d->>'end_time')::time
          + CASE WHEN d->>'end_time'<d->>'start_time' THEN interval '1 day' ELSE interval '0 days' END;
        IF (phase_start AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw'<>phase_start
          OR (phase_end AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw'<>phase_end THEN
          RAISE EXCEPTION 'Dzień %: nieprawidłowa godzina przy zmianie czasu.',n;
        END IF;
        INSERT INTO public.event_phases(event_id,phase_type_id,name,start_time,end_time,sequence_order,created_by)
        VALUES(v_event_id,phase_type,'Realizacja · dzień '||n,phase_start AT TIME ZONE 'Europe/Warsaw',
          phase_end AT TIME ZONE 'Europe/Warsaw',n,public.current_employee_id());
      END LOOP;
    END IF;
  END IF;
  -- Deployed agendas use timestamptz, while the original agenda migration
  -- created time columns. Keep both installations supported without altering
  -- historical agenda data or relying on the database session's time zone.
  SELECT start_column.atttypid,end_column.atttypid INTO agenda_start_type,agenda_end_type
  FROM pg_catalog.pg_attribute start_column
  JOIN pg_catalog.pg_attribute end_column ON end_column.attrelid=start_column.attrelid
    AND end_column.attname='end_time' AND NOT end_column.attisdropped
  WHERE start_column.attrelid='public.event_agendas'::regclass
    AND start_column.attname='start_time' AND NOT start_column.attisdropped;

  IF agenda_start_type='timestamptz'::regtype AND agenda_end_type='timestamptz'::regtype THEN
    INSERT INTO public.event_agendas(event_id,event_name,event_date,start_time,end_time,client_contact,created_by)
    VALUES(v_event_id,COALESCE(NULLIF(o.title,''),'Realizacja '||o.offer_number),calendar_day,
      starts AT TIME ZONE 'Europe/Warsaw',ends AT TIME ZONE 'Europe/Warsaw',
      concat_ws(' · ',o.portal_client_name,o.portal_client_email,o.portal_client_phone),public.current_employee_id())
    ON CONFLICT(event_id) DO NOTHING;
  ELSIF agenda_start_type='time'::regtype AND agenda_end_type='time'::regtype THEN
    INSERT INTO public.event_agendas(event_id,event_name,event_date,start_time,end_time,client_contact,created_by)
    VALUES(v_event_id,COALESCE(NULLIF(o.title,''),'Realizacja '||o.offer_number),calendar_day,starts::time,ends::time,
      concat_ws(' · ',o.portal_client_name,o.portal_client_email,o.portal_client_phone),public.current_employee_id())
    ON CONFLICT(event_id) DO NOTHING;
  ELSE
    RAISE EXCEPTION 'Nieobsługiwany format godzin agendy. Administrator musi sprawdzić typy pól start_time i end_time w event_agendas.';
  END IF;
  INSERT INTO public.partner_offer_activities(offer_id,sales_partner_id,activity_type,metadata)
    VALUES(p_offer_id,o.sales_partner_id,'accepted',jsonb_build_object('source','crm_pending_event_created',
      'event_id',v_event_id,'document_id',r.document_id,'arrangements_revision',COALESCE(a.revision,0),'actor',auth.uid()));
  RETURN v_event_id;
END;
$ensure$;
REVOKE ALL ON FUNCTION public.ensure_seller_offer_event(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.accept_seller_offer_review(p_offer_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.offers%ROWTYPE; r public.seller_offer_reviews%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(public.current_session_is_seller_portal(),true)
    OR NOT COALESCE(public.seller_offer_can_manage(p_offer_id),false) THEN RAISE EXCEPTION 'Brak uprawnień do akceptacji oferty'; END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal' FOR UPDATE;
  SELECT * INTO r FROM public.seller_offer_reviews WHERE offer_id=p_offer_id FOR UPDATE;
  IF r.status IS DISTINCT FROM 'approved' OR r.document_id IS DISTINCT FROM p_document_id
    OR r.source_key IS DISTINCT FROM public.seller_offer_source_key(p_offer_id) THEN
    RAISE EXCEPTION 'Decyzja nie dotyczy aktualnej oferty. Wczytaj i rozpatrz aktualną wersję.';
  END IF;
  IF o.status::text NOT IN ('draft','sent','viewed','accepted') THEN
    RAISE EXCEPTION 'Nie można zaakceptować odrzuconej, anulowanej lub wygasłej oferty.';
  END IF;
  IF o.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.events e
    WHERE e.id=o.event_id AND e.my_company_id=o.my_company_id AND e.status::text<>'cancelled') THEN
    RAISE EXCEPTION 'Powiązane wydarzenie jest anulowane lub ma niezgodną markę.';
  END IF;
  IF o.status::text<>'accepted' THEN
    UPDATE public.offers SET status='accepted',accepted_at=COALESCE(accepted_at,now()),partner_last_activity_at=now()
      WHERE id=p_offer_id;
    INSERT INTO public.partner_offer_activities(offer_id,sales_partner_id,activity_type,metadata)
      VALUES(p_offer_id,o.sales_partner_id,'accepted',jsonb_build_object(
        'source','crm_offer_acceptance','document_id',p_document_id,'actor',auth.uid(),
        'next_step','crm_realization_confirmation'));
  END IF;
  o.event_id:=public.ensure_seller_offer_event(p_offer_id);
  RETURN jsonb_build_object('offer_status','accepted','event_id',o.event_id,'stage',
    CASE WHEN EXISTS(SELECT 1 FROM public.events e WHERE e.id=o.event_id AND NOT e.seller_confirmation_required
      AND e.status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled'))
      THEN 'confirmed' ELSE 'awaiting_crm_confirmation' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_seller_offer_realization(p_offer_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.offers%ROWTYPE; r public.seller_offer_reviews%ROWTYPE; e public.events%ROWTYPE;
BEGIN
  IF NOT COALESCE(public.seller_offer_can_create_event(p_offer_id),false) THEN
    RAISE EXCEPTION 'Potwierdzenie realizacji wymaga uprawnień do ofert i wydarzeń tej marki';
  END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal' FOR UPDATE;
  SELECT * INTO r FROM public.seller_offer_reviews WHERE offer_id=p_offer_id FOR UPDATE;
  IF o.status::text<>'accepted' OR r.status IS DISTINCT FROM 'approved'
    OR r.document_id IS DISTINCT FROM p_document_id OR r.source_key IS DISTINCT FROM public.seller_offer_source_key(p_offer_id) THEN
    RAISE EXCEPTION 'Najpierw zaakceptuj aktualną ofertę.';
  END IF;
  IF o.event_id IS NULL THEN RAISE EXCEPTION 'Otwórz formularz wydarzenia, uzupełnij dane i osobno potwierdź realizację.'; END IF;
  SELECT * INTO STRICT e FROM public.events WHERE id=o.event_id FOR UPDATE;
  IF e.my_company_id IS DISTINCT FROM o.my_company_id OR NOT COALESCE(public.current_employee_can_view_event(e.id),false) THEN
    RAISE EXCEPTION 'Brak dostępu do powiązanego wydarzenia tej marki';
  END IF;
  IF e.status::text NOT IN ('inquiry','offer_to_send','offer_sent','offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled') THEN
    RAISE EXCEPTION 'Nie można potwierdzić wydarzenia w tym statusie. Anulowane wydarzenie nie zostanie przywrócone.';
  END IF;
  IF e.seller_schedule_pending THEN
    RAISE EXCEPTION 'Uzupełnij godziny w formularzu potwierdzenia realizacji.';
  END IF;
  IF e.seller_confirmation_required OR e.status::text IN ('inquiry','offer_to_send','offer_sent') THEN
    UPDATE public.events SET status='offer_accepted',seller_confirmation_required=false,updated_at=now() WHERE id=e.id;
    UPDATE public.offers SET partner_last_activity_at=now(),updated_at=now() WHERE id=p_offer_id;
    INSERT INTO public.partner_offer_activities(offer_id,sales_partner_id,activity_type,metadata)
      VALUES(p_offer_id,o.sales_partner_id,'accepted',jsonb_build_object(
        'source','crm_realization_confirmation','event_id',e.id,'document_id',p_document_id,'actor',auth.uid()));
  END IF;
  PERFORM public.notify_seller_realization_acceptance(p_offer_id);
  RETURN jsonb_build_object('offer_status','accepted','event_id',e.id,'stage','confirmed');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_event_draft(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer public.offers%ROWTYPE; v_values public.seller_offer_arrangements%ROWTYPE; e public.events%ROWTYPE;
BEGIN
  IF NOT COALESCE(public.seller_offer_can_create_event(p_offer_id),false) THEN
    RAISE EXCEPTION 'Utworzenie wydarzenia wymaga uprawnień do ofert i wydarzeń tej marki';
  END IF;
  SELECT * INTO STRICT v_offer FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal';
  IF v_offer.status::text<>'accepted' THEN RAISE EXCEPTION 'Najpierw zaakceptuj ofertę'; END IF;
  IF v_offer.event_id IS NOT NULL AND NOT COALESCE(public.current_employee_can_view_event(v_offer.event_id),false) THEN
    RAISE EXCEPTION 'Brak dostępu do powiązanego wydarzenia';
  END IF;
  SELECT * INTO e FROM public.events WHERE id=v_offer.event_id AND my_company_id=v_offer.my_company_id;
  SELECT * INTO v_values FROM public.seller_offer_arrangements WHERE offer_id=p_offer_id;
  RETURN jsonb_build_object('event_id',v_offer.event_id,'confirmation_required',e.seller_confirmation_required,'event_updated_at',e.updated_at,
    'location_id',e.location_id,'source_key',public.seller_offer_source_key(p_offer_id),
    'revision',COALESCE(v_values.revision,0),'brand_name',(SELECT name FROM public.my_companies WHERE id=v_offer.my_company_id),
    'offer_number',v_offer.offer_number,'name',COALESCE(NULLIF(e.name,''),NULLIF(v_offer.title,''),'Realizacja '||v_offer.offer_number),
    'category_id',e.category_id,'location',COALESCE(e.location,v_offer.event_location,''),'description',COALESCE(e.description,v_offer.description,''),
    'setup_at',CASE WHEN e.id IS NOT NULL THEN to_char(e.planned_setup_at AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI') ELSE to_char(v_values.setup_at,'YYYY-MM-DD"T"HH24:MI') END,
    'starts_at',CASE WHEN e.id IS NOT NULL AND NOT e.seller_schedule_pending THEN to_char(e.event_date AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI') ELSE COALESCE(to_char(v_values.starts_at,'YYYY-MM-DD"T"HH24:MI'),to_char(v_offer.event_date AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD')) END,
    'ends_at',CASE WHEN e.id IS NOT NULL AND NOT e.seller_schedule_pending THEN to_char(e.event_end_date AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI') ELSE to_char(v_values.ends_at,'YYYY-MM-DD"T"HH24:MI') END,
    'teardown_at',CASE WHEN e.id IS NOT NULL THEN to_char(e.planned_teardown_at AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI') ELSE to_char(v_values.teardown_at,'YYYY-MM-DD"T"HH24:MI') END,
    'client',jsonb_build_object('name',v_offer.portal_client_name,'company',v_offer.portal_client_company,
      'email',v_offer.portal_client_email,'phone',v_offer.portal_client_phone),
    'arrangements',COALESCE(to_jsonb(v_values)-'updated_by','{}'::jsonb),
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'quantity',i.quantity,'unit',i.unit)
      ORDER BY i.display_order,i.id) FROM public.offer_items i WHERE i.offer_id=p_offer_id),'[]'::jsonb));
END;
$$;

-- Confirm the SAME event after planning, with optimistic concurrency checks.
CREATE OR REPLACE FUNCTION public.complete_seller_event_handoff(p_offer_id uuid,p_source_key text,p_revision integer,p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $complete$
DECLARE o public.offers%ROWTYPE; a public.seller_offer_arrangements%ROWTYPE; e public.events%ROWTYPE;
  r public.seller_offer_reviews%ROWTYPE; v_event uuid; v_key text; v_text text;
  v_local timestamp; v_dates jsonb:='{}'::jsonb; v_start timestamptz; v_end timestamptz;
  v_setup timestamptz; v_teardown timestamptz; v_location uuid; v_category uuid;
BEGIN
  IF NOT COALESCE(public.seller_offer_can_create_event(p_offer_id),false) THEN RAISE EXCEPTION 'Brak uprawnień do wydarzenia tej marki'; END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal' FOR UPDATE;
  SELECT * INTO r FROM public.seller_offer_reviews WHERE offer_id=p_offer_id FOR UPDATE;
  IF o.status::text<>'accepted' OR r.status IS DISTINCT FROM 'approved'
    OR r.source_key IS DISTINCT FROM public.seller_offer_source_key(p_offer_id) THEN
    RAISE EXCEPTION 'Najpierw zaakceptuj aktualną ofertę.';
  END IF;
  v_event:=public.ensure_seller_offer_event(p_offer_id);
  SELECT * INTO STRICT e FROM public.events WHERE id=v_event FOR UPDATE;
  -- A successful repeated confirmation cannot overwrite later operational edits.
  IF NOT e.seller_confirmation_required AND e.status::text IN
    ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled') THEN
    RETURN jsonb_build_object('event_id',v_event,'already_created',true,'stage','confirmed');
  END IF;
  SELECT * INTO a FROM public.seller_offer_arrangements WHERE offer_id=p_offer_id FOR UPDATE;
  IF p_source_key IS DISTINCT FROM public.seller_offer_source_key(p_offer_id)
    OR p_revision IS DISTINCT FROM COALESCE(a.revision,0)
    OR (o.event_id IS NOT NULL AND NULLIF(p_values->>'event_updated_at','')::timestamptz IS DISTINCT FROM e.updated_at) THEN
    RAISE EXCEPTION 'Wydarzenie, oferta lub ustalenia zmieniły się. Zamknij formularz i wczytaj aktualne dane.';
  END IF;
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object'
    OR COALESCE(length(btrim(p_values->>'name')),0) NOT BETWEEN 1 AND 250
    OR length(COALESCE(p_values->>'location',''))>1000
    OR length(COALESCE(p_values->>'description',''))>greatest(10000,length(COALESCE(e.description,''))) THEN RAISE EXCEPTION 'Sprawdź nazwę, miejsce i opis wydarzenia'; END IF;
  FOREACH v_key IN ARRAY ARRAY['setup_at','starts_at','ends_at','teardown_at'] LOOP
    v_text:=NULLIF(btrim(p_values->>v_key),'');
    IF v_text IS NOT NULL THEN
      IF v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' THEN RAISE EXCEPTION 'Podaj poprawną datę i godzinę'; END IF;
      v_local:=v_text::timestamp;
      IF NOT isfinite(v_local) OR (v_local AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw'<>v_local THEN
        RAISE EXCEPTION 'Nieprawidłowa godzina w strefie Europe/Warsaw';
      END IF;
      v_dates:=v_dates||jsonb_build_object(v_key,v_local AT TIME ZONE 'Europe/Warsaw');
    END IF;
  END LOOP;
  v_start:=(v_dates->>'starts_at')::timestamptz; v_end:=(v_dates->>'ends_at')::timestamptz;
  v_setup:=(v_dates->>'setup_at')::timestamptz; v_teardown:=(v_dates->>'teardown_at')::timestamptz;
  IF v_start IS NULL OR v_end IS NULL OR v_end<=v_start THEN RAISE EXCEPTION 'Uzupełnij początek i koniec wydarzenia w poprawnej kolejności'; END IF;
  IF v_setup>v_start OR v_teardown<v_end THEN RAISE EXCEPTION 'Sprawdź kolejność montażu, wydarzenia i demontażu'; END IF;
  v_category:=NULLIF(p_values->>'category_id','')::uuid;
  IF v_category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_categories WHERE id=v_category AND is_active) THEN
    RAISE EXCEPTION 'Wybrana kategoria nie jest aktywna';
  END IF;
  v_location:=NULLIF(p_values->>'location_id','')::uuid;
  IF v_location IS DISTINCT FROM e.location_id AND v_location IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.employees employee WHERE employee.id=public.current_employee_id() AND employee.is_active
      AND (employee.role::text='admin' OR employee.access_level::text='admin'
        OR COALESCE(employee.permissions,'{}'::text[]) && ARRAY['admin','locations_view','locations_manage','calendar_view','calendar_manage']::text[])
  ) THEN RAISE EXCEPTION 'Brak uprawnień do zmiany powiązania z bazą lokalizacji'; END IF;
  IF v_location IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.locations WHERE id=v_location) THEN
    RAISE EXCEPTION 'Wybrana lokalizacja nie istnieje';
  END IF;
  UPDATE public.events SET name=btrim(p_values->>'name'),description=COALESCE(p_values->>'description',''),
    location=NULLIF(btrim(p_values->>'location'),''),location_id=v_location,category_id=v_category,
    location_room_ids=CASE WHEN v_location IS NOT DISTINCT FROM e.location_id THEN e.location_room_ids ELSE '{}'::uuid[] END,
    event_date=v_start,event_end_date=v_end,planned_setup_at=v_setup,planned_teardown_at=v_teardown,
    seller_schedule_pending=false,updated_at=now() WHERE id=v_event;
  PERFORM public.confirm_seller_offer_realization(p_offer_id,r.document_id);
  RETURN jsonb_build_object('event_id',v_event,'already_created',o.event_id IS NOT NULL,'stage','confirmed');
END;
$complete$;
REVOKE ALL ON FUNCTION public.complete_seller_event_handoff(uuid,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_seller_event_handoff(uuid,text,integer,jsonb) TO authenticated;

-- Old open clients also complete the same event, never create a duplicate.
CREATE OR REPLACE FUNCTION public.create_event_from_seller_offer(p_offer_id uuid,p_source_key text,p_revision integer,p_values jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT public.complete_seller_event_handoff(p_offer_id,p_source_key,p_revision,p_values);
$$;
CREATE OR REPLACE FUNCTION public.create_event_from_seller_offer_at_location(p_offer_id uuid,p_source_key text,p_revision integer,p_values jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT public.complete_seller_event_handoff(p_offer_id,p_source_key,p_revision,p_values);
$$;

-- A pending seller event cannot bypass the separate confirmation by changing
-- its operational status. Cancellation remains possible through existing CRM.
CREATE OR REPLACE FUNCTION public.guard_pending_seller_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $guard$
BEGIN
  IF OLD.seller_confirmation_required AND NEW.seller_confirmation_required
    AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text<>'cancelled' THEN
    RAISE EXCEPTION 'Najpierw potwierdź realizację w sekcji Ustalenia ze sprzedawcą. Wydarzenie już istnieje.';
  END IF;
  IF OLD.seller_confirmation_required AND NOT NEW.seller_confirmation_required THEN
    IF NOT EXISTS(SELECT 1 FROM public.offers o JOIN public.seller_offer_reviews r ON r.offer_id=o.id
      WHERE o.event_id=NEW.id AND o.my_company_id=NEW.my_company_id AND o.sales_channel='seller_portal'
        AND o.status::text='accepted' AND r.status='approved' AND r.source_key=public.seller_offer_source_key(o.id)
        AND public.seller_offer_can_create_event(o.id)) THEN
      RAISE EXCEPTION 'Brak aktualnej akceptacji lub uprawnień do potwierdzenia realizacji.';
    END IF;
    IF NEW.seller_schedule_pending OR NEW.event_end_date IS NULL OR NEW.event_end_date<=NEW.event_date THEN
      RAISE EXCEPTION 'Przed potwierdzeniem uzupełnij godziny wydarzenia.';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.guard_pending_seller_event() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_pending_seller_event ON public.events;
CREATE TRIGGER guard_pending_seller_event BEFORE UPDATE OF status,seller_confirmation_required ON public.events
FOR EACH ROW EXECUTE FUNCTION public.guard_pending_seller_event();

CREATE OR REPLACE FUNCTION public.get_event_responsibility_team(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT (public.current_employee_can_view_event(p_event_id) OR public.is_realization_manager(p_event_id) OR public.can_direct_realization(p_event_id)) THEN
  RAISE EXCEPTION 'Brak dostępu do zespołu wydarzenia.' USING ERRCODE='42501';
 END IF;
 RETURN (
 WITH responsibilities AS (
  SELECT employee.id employee_id,'Autor / opiekun wydarzenia' label,'accepted' status
  FROM public.events ev JOIN public.employees employee ON ev.created_by IN (employee.id,employee.auth_user_id) WHERE ev.id=p_event_id
  UNION ALL
  SELECT employee.id,'Sprzedawca','accepted' FROM public.offers o JOIN public.employees employee ON o.created_by IN (employee.id,employee.auth_user_id)
  WHERE o.event_id=p_event_id AND o.status::text='accepted'
  UNION ALL
  SELECT p.employee_id,'Sprzedawca polecający','accepted' FROM public.events ev JOIN public.sales_partner_profiles p ON p.id=ev.referring_sales_partner_id WHERE ev.id=p_event_id AND p.employee_id IS NOT NULL
  UNION ALL
  SELECT public.seller_partner_manager_id(o.sales_partner_id,o.my_company_id),'Opiekun sprzedawcy','accepted'
  FROM public.offers o JOIN public.employees manager
    ON manager.id=public.seller_partner_manager_id(o.sales_partner_id,o.my_company_id)
  WHERE o.event_id=p_event_id AND o.sales_channel='seller_portal' AND o.status::text='accepted'
    AND manager.is_active AND public.employee_can_access_company(manager.id,o.my_company_id)
  UNION ALL
  SELECT accepted_by,'Przygotowanie magazynu','accepted' FROM public.event_warehouse_handoffs WHERE event_id=p_event_id AND accepted_at IS NOT NULL
  UNION ALL
  SELECT manager_id,'Kierownik realizacji','accepted' FROM public.event_realizations WHERE event_id=p_event_id
  UNION ALL
  SELECT driver_id,'Kierowca',coalesce(invitation_status,'pending') FROM public.event_vehicles WHERE event_id=p_event_id AND coalesce(status,'planned')<>'cancelled' AND driver_id IS NOT NULL AND coalesce(invitation_status,'pending')<>'rejected'
 ), grouped AS (
 SELECT employee_id,array_agg(DISTINCT label ORDER BY label) roles,
 CASE WHEN bool_and(status='accepted') THEN 'accepted' ELSE 'pending' END status
 FROM responsibilities WHERE employee_id IS NOT NULL GROUP BY employee_id
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('id','responsibility-'||employee.id,'employee_id',employee.id,'status',g.status,
 'responsibility_roles',g.roles,'automatic_member',true,
 'employee',jsonb_build_object('id',employee.id,'name',employee.name,'surname',employee.surname,'phone_number',employee.phone_number,'email',employee.email)
 ) ORDER BY employee.surname,employee.name),'[]'::jsonb)
 FROM grouped g JOIN public.employees employee ON employee.id=g.employee_id WHERE employee.is_active
 );
END $$;


CREATE OR REPLACE FUNCTION public.notify_seller_confirmed_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $notice$
DECLARE v_offer uuid;
BEGIN
  IF NOT NEW.seller_confirmation_required
    AND (OLD.seller_confirmation_required OR OLD.status::text NOT IN
      ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled'))
    AND NEW.status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled') THEN
    FOR v_offer IN SELECT id FROM public.offers WHERE event_id=NEW.id AND my_company_id=NEW.my_company_id
      AND sales_channel='seller_portal' AND status::text='accepted' LOOP
      PERFORM public.notify_seller_realization_acceptance(v_offer);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$notice$;
DROP TRIGGER IF EXISTS seller_event_confirmation_notification ON public.events;
CREATE TRIGGER seller_event_confirmation_notification AFTER UPDATE OF status,seller_confirmation_required ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.notify_seller_confirmed_event();

CREATE OR REPLACE FUNCTION public.seller_offer_handoff_version()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 4; $$;

NOTIFY pgrst,'reload schema';
COMMIT;
