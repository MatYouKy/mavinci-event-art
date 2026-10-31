BEGIN;
SET LOCAL lock_timeout = '5s';

-- Forward fix for databases where the acceptance handoff is already installed.
-- Replaces only the internal creation function: no event/agenda backfill,
-- schema conversion, acceptance, reservation or commission recalculation.
DO $dependency$
BEGIN
  IF to_regprocedure('public.ensure_seller_offer_event(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw wdroż migrację 20261028170000_seller_acceptance_event_handoff.sql.';
  END IF;
END;
$dependency$;

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

NOTIFY pgrst,'reload schema';
COMMIT;
