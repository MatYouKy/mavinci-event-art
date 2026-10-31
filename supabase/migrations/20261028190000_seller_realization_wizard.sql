BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL standard_conforming_strings=on;

DO $dependencies$
BEGIN
  IF to_regprocedure('public.seller_arrangements_access(uuid,boolean)') IS NULL
    OR to_regprocedure('public.seller_offer_notification_recipients(uuid,boolean)') IS NULL
    OR to_regclass('public.seller_realization_submissions') IS NULL
    OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='events' AND column_name='seller_schedule_pending') THEN
    RAISE EXCEPTION 'Najpierw zastosuj wcześniejsze migracje realizacji sprzedawców, w tym 20261028170000_seller_acceptance_event_handoff.sql.';
  END IF;
END;
$dependencies$;

-- Structured, versioned preparation. Chat history is not interpreted as consent.
CREATE TABLE public.seller_realization_workflows (
  offer_id uuid PRIMARY KEY REFERENCES public.offers(id),
  event_id uuid NOT NULL REFERENCES public.events(id),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id)
);
CREATE TABLE public.seller_realization_steps (
  offer_id uuid NOT NULL REFERENCES public.seller_realization_workflows(offer_id),
  step_key text NOT NULL CHECK(step_key IN ('contact','organization','materials','plan')),
  revision integer NOT NULL CHECK(revision>0),
  status text NOT NULL CHECK(status IN ('draft','submitted','changes_requested','approved')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(payload)='object'),
  context_key text NOT NULL,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  review_note text NOT NULL DEFAULT '',
  PRIMARY KEY(offer_id,step_key)
);
CREATE TABLE public.seller_realization_step_history (
  request_id uuid PRIMARY KEY,
  offer_id uuid NOT NULL REFERENCES public.seller_realization_workflows(offer_id),
  revision integer NOT NULL,
  step_key text NOT NULL,
  action text NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  request_hash text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(offer_id,revision)
);
ALTER TABLE public.seller_realization_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_realization_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_realization_step_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_realization_workflows,public.seller_realization_steps,public.seller_realization_step_history FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.seller_realization_workflows,public.seller_realization_steps,public.seller_realization_step_history TO service_role;

CREATE FUNCTION public.seller_realization_step_context(p_offer uuid,p_step text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $context$
DECLARE o public.offers%ROWTYPE; a jsonb; e jsonb; context jsonb; upstream jsonb;
  keys text[]:=ARRAY['contact','organization','materials','plan'];
BEGIN
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer;
  SELECT to_jsonb(x) INTO a FROM public.seller_offer_arrangements x WHERE offer_id=o.id;
  SELECT jsonb_build_object('event_date',x.event_date,'event_end_date',x.event_end_date,
    'setup',x.planned_setup_at,'teardown',x.planned_teardown_at,'location',x.location,
    'location_id',x.location_id,'rooms',x.location_room_ids) INTO e FROM public.events x WHERE id=o.event_id;
  context:=jsonb_build_object('event_id',o.event_id,'company_id',o.my_company_id);
  IF p_step='organization' THEN
    context:=context||jsonb_build_object('event',e,'days',a->'event_days','venue',a->'venue_snapshot','room',a->'room');
  ELSIF p_step='materials' THEN
    context:=context||jsonb_build_object('technical',a->'technical_requirements','logistics',a->'logistics_requirements',
      'due',a->'materials_due_date','items',(SELECT jsonb_agg(jsonb_build_object('id',i.id,'quantity',i.quantity,
        'requirements',i.partner_source_snapshot->'additional_requirements',
        'accommodation',i.partner_source_snapshot->'accommodation_note',
        'requires_accommodation',i.partner_source_snapshot->'requires_accommodation',
        'logistics',i.partner_source_snapshot->'logistics_note') ORDER BY i.id) FROM public.offer_items i WHERE i.offer_id=o.id));
  ELSIF p_step='plan' THEN
    -- Hashes only; internal operational records are never returned to the seller.
    context:=context||jsonb_build_object('event',e,
      'phases',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.event_phases x WHERE x.event_id=o.event_id),
      'team',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.employee_assignments x WHERE x.event_id=o.event_id),
      'equipment',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.event_equipment x WHERE x.event_id=o.event_id),
      'vehicles',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.event_vehicles x WHERE x.event_id=o.event_id),
      'agenda',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.event_agendas x WHERE x.event_id=o.event_id),
      'agenda_items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.event_agenda_items x JOIN public.event_agendas ag ON ag.id=x.agenda_id WHERE ag.event_id=o.event_id));
  END IF;
  SELECT jsonb_agg(jsonb_build_object('key',s.step_key,'revision',s.revision,'status',s.status) ORDER BY array_position(keys,s.step_key))
    INTO upstream FROM public.seller_realization_steps s WHERE s.offer_id=o.id AND array_position(keys,s.step_key)<array_position(keys,p_step);
  RETURN md5((context||jsonb_build_object('upstream',upstream))::text);
END;
$context$;
REVOKE ALL ON FUNCTION public.seller_realization_step_context(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.validate_seller_realization_step(p_step text,p_payload jsonb,p_submit boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $validation$
DECLARE result jsonb:='{}'::jsonb; key text; value text; fields text[]; required text[]; cap integer;
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>24000 THEN
    RAISE EXCEPTION 'Nieprawidłowe dane kroku.';
  END IF;
  CASE p_step
    WHEN 'contact' THEN fields:=ARRAY['source','name','role','phone','email','note']; required:=ARRAY['source','name','role','phone'];
    WHEN 'organization' THEN fields:=ARRAY['room','access','note']; required:=ARRAY['room','access'];
    WHEN 'materials' THEN fields:=ARRAY['mode','url','technical','logistics','note']; required:=ARRAY['mode','technical','logistics'];
    WHEN 'plan' THEN fields:=ARRAY['summary']; required:=ARRAY['summary'];
    ELSE RAISE EXCEPTION 'Nieznany krok przygotowań.';
  END CASE;
  FOREACH key IN ARRAY fields LOOP
    IF p_payload ? key AND jsonb_typeof(p_payload->key) NOT IN ('string','null') THEN RAISE EXCEPTION 'Pole formularza musi zawierać tekst.'; END IF;
    value:=btrim(COALESCE(p_payload->>key,''));
    cap:=CASE key WHEN 'source' THEN 20 WHEN 'mode' THEN 20 WHEN 'name' THEN 160 WHEN 'role' THEN 100
      WHEN 'phone' THEN 50 WHEN 'email' THEN 254 WHEN 'room' THEN 200 WHEN 'url' THEN 2000 WHEN 'summary' THEN 4000 ELSE 3000 END;
    IF length(value)>cap OR (p_submit AND key=ANY(required) AND value='') THEN
      RAISE EXCEPTION 'Uzupełnij wymagane pola i sprawdź długość danych kroku.';
    END IF;
    result:=result||jsonb_build_object(key,value);
  END LOOP;
  IF p_step='contact' THEN
    IF result->>'source'<>'' AND result->>'source' NOT IN ('seller','client','other') THEN RAISE EXCEPTION 'Wybierz osobę na miejscu.'; END IF;
    IF p_submit AND ((result->>'phone') !~ '^\+?[0-9 ().-]+$'
      OR length(regexp_replace(result->>'phone','[^0-9]','','g')) NOT BETWEEN 7 AND 15) THEN RAISE EXCEPTION 'Podaj poprawny telefon osoby na miejscu.'; END IF;
    IF result->>'email'<>'' AND (result->>'email') !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$' THEN RAISE EXCEPTION 'Popraw e-mail lub pozostaw go pusty.'; END IF;
  ELSIF p_step='organization' THEN
    value:=COALESCE(p_payload->>'participants','');
    IF value<>'' AND (value !~ '^[0-9]{1,7}$') THEN RAISE EXCEPTION 'Podaj liczbę uczestników.'; END IF;
    IF value<>'' AND value::integer NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'Liczba uczestników musi wynosić od 1 do 1000000.'; END IF;
    IF p_submit AND (value='' OR p_payload->'schedule_confirmed' IS DISTINCT FROM 'true'::jsonb) THEN RAISE EXCEPTION 'Podaj liczbę uczestników i potwierdź pokazany termin.'; END IF;
    result:=result||jsonb_build_object('participants',NULLIF(value,'')::integer,'schedule_confirmed',p_payload->'schedule_confirmed'='true'::jsonb);
  ELSIF p_step='materials' THEN
    IF result->>'mode'<>'' AND result->>'mode' NOT IN ('none','provided') THEN RAISE EXCEPTION 'Wybierz sposób przekazania materiałów.'; END IF;
    IF result->>'url'<>'' AND (result->>'url') !~ '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'Podaj pełny link HTTP lub HTTPS.'; END IF;
    IF p_submit AND result->>'mode'='provided' AND result->>'url'='' THEN RAISE EXCEPTION 'Dodaj link do materiałów.'; END IF;
    IF p_submit AND result->>'mode'='none' AND result->>'note'='' THEN RAISE EXCEPTION 'Wyjaśnij, dlaczego materiały nie są potrzebne.'; END IF;
  ELSIF p_step='plan' THEN
    FOREACH key IN ARRAY ARRAY['timeline','team','equipment','agenda','logistics'] LOOP
      IF p_submit AND p_payload->key IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Sprawdź wszystkie elementy planu realizacji.'; END IF;
      result:=result||jsonb_build_object(key,p_payload->key='true'::jsonb);
    END LOOP;
  END IF;
  RETURN result;
END;
$validation$;
REVOKE ALL ON FUNCTION public.validate_seller_realization_step(text,jsonb,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_seller_realization_wizard(p_offer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $state$
DECLARE o public.offers%ROWTYPE; e public.events%ROWTYPE; w public.seller_realization_workflows%ROWTYPE;
  s public.seller_realization_steps%ROWTYPE; key text; effective text; items jsonb:='[]'; prior_done boolean:=true;
  seller boolean; manager boolean; active boolean; current_key text; a jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.seller_arrangements_access(p_offer),false) THEN RAISE EXCEPTION 'Brak dostępu do przygotowań tej oferty.'; END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer AND sales_channel='seller_portal';
  SELECT * INTO e FROM public.events WHERE id=o.event_id AND my_company_id=o.my_company_id;
  SELECT * INTO w FROM public.seller_realization_workflows WHERE offer_id=o.id;
  seller:=COALESCE(public.current_session_is_seller_portal(),false) AND o.sales_partner_id=public.current_sales_partner_id();
  manager:=NOT COALESCE(public.current_session_is_seller_portal(),true) AND COALESCE(public.seller_offer_can_manage(o.id),false)
    AND COALESCE(public.current_employee_can_view_event(e.id),false);
  active:=o.status::text='accepted' AND e.id IS NOT NULL AND e.status::text NOT IN ('completed','invoiced','settled','cancelled')
    AND (w.event_id IS NULL OR w.event_id=e.id);
  FOREACH key IN ARRAY ARRAY['contact','organization','materials','plan'] LOOP
    SELECT * INTO s FROM public.seller_realization_steps WHERE offer_id=o.id AND step_key=key;
    current_key:=public.seller_realization_step_context(o.id,key);
    effective:=COALESCE(s.status,'draft');
    IF effective IN ('submitted','approved') AND s.context_key IS DISTINCT FROM current_key THEN effective:='stale'; END IF;
    items:=items||jsonb_build_array(jsonb_build_object('key',key,'status',effective,'available',prior_done,
      'revision',COALESCE(s.revision,0),'context_key',current_key,'payload',COALESCE(s.payload,'{}'::jsonb),
      'review_note',s.review_note,'submitted_at',s.submitted_at,'reviewed_at',s.reviewed_at,
      'can_submit',active AND prior_done AND effective<>'submitted' AND CASE WHEN key='plan' THEN manager ELSE seller END,
      'can_review',active AND prior_done AND effective='submitted' AND CASE WHEN key='plan' THEN seller ELSE manager END));
    prior_done:=prior_done AND effective='approved';
  END LOOP;
  SELECT to_jsonb(x) INTO a FROM public.seller_offer_arrangements x WHERE offer_id=o.id;
  RETURN jsonb_build_object('offer_id',o.id,'event_id',e.id,'partner_id',o.sales_partner_id,'company_id',o.my_company_id,
    'revision',COALESCE(w.revision,0),'finish_key',md5(items::text),'active',active,'manager',manager,'seller',seller,'steps',items,
    'completed',w.completed_at IS NOT NULL AND prior_done,'completed_at',CASE WHEN prior_done THEN w.completed_at END,
    'can_complete',active AND manager AND prior_done AND NOT e.seller_confirmation_required AND NOT e.seller_schedule_pending,
    'confirmation_required',COALESCE(e.seller_confirmation_required,true),
    'legacy_contact_body',CASE WHEN NOT EXISTS(SELECT 1 FROM public.seller_realization_steps WHERE offer_id=o.id AND step_key='contact') THEN
      (SELECT body FROM public.seller_realization_submissions WHERE offer_id=o.id AND task_key='contact' ORDER BY submitted_at DESC,id DESC LIMIT 1) END,
    'client',jsonb_build_object('name',o.portal_client_name,'company',o.portal_client_company,'phone',o.portal_client_phone,'email',o.portal_client_email),
    'context',jsonb_build_object('location',e.location,'room',a->'room','participants',a->'participant_count',
      'starts_at',CASE WHEN NOT e.seller_schedule_pending THEN to_char(e.event_date AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI') END,
      'ends_at',CASE WHEN NOT e.seller_schedule_pending THEN to_char(e.event_end_date AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI') END,
      'technical',a->'technical_requirements','logistics',a->'logistics_requirements','materials_due',a->'materials_due_date',
      'requirements',(SELECT COALESCE(jsonb_agg(jsonb_build_object('name',i.name,
        'technical',i.partner_source_snapshot->>'additional_requirements',
        'accommodation',CASE WHEN i.partner_source_snapshot->>'requires_accommodation'='true' THEN COALESCE(NULLIF(i.partner_source_snapshot->>'accommodation_note',''),'Wymagany nocleg') END,
        'logistics',i.partner_source_snapshot->>'logistics_note') ORDER BY i.display_order,i.id),'[]'::jsonb)
        FROM public.offer_items i WHERE i.offer_id=o.id)),
    'history',COALESCE((SELECT jsonb_agg(h.value ORDER BY h.revision DESC) FROM (
      SELECT x.revision,jsonb_build_object('revision',x.revision,'step_key',x.step_key,'action',x.action,
        'at',x.created_at,'payload',x.after_value->'payload','review_note',x.after_value->>'review_note') AS value
      FROM public.seller_realization_step_history x WHERE x.offer_id=o.id ORDER BY x.revision DESC LIMIT 30
    ) h),'[]'::jsonb));
END;
$state$;
REVOKE ALL ON FUNCTION public.get_seller_realization_wizard(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_seller_realization_wizard(uuid) TO authenticated;

CREATE FUNCTION public.update_seller_realization_wizard(
  p_offer uuid,p_step text,p_action text,p_revision integer,p_context_key text,p_request uuid,p_payload jsonb DEFAULT '{}',p_note text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $write$
DECLARE o public.offers%ROWTYPE; w public.seller_realization_workflows%ROWTYPE; s public.seller_realization_steps%ROWTYPE;
  previous public.seller_realization_step_history%ROWTYPE; state jsonb; step jsonb; clean jsonb;
  hash text; before_value jsonb; after_value jsonb; next_status text;
  recipients uuid[]; notice uuid; notice_title text; notice_url text; step_title text;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.seller_arrangements_access(p_offer),false) THEN RAISE EXCEPTION 'Brak dostępu do przygotowań.'; END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer AND sales_channel='seller_portal' FOR UPDATE;
  IF p_request IS NULL OR p_action IS NULL OR p_action NOT IN ('save','submit','approve','changes_requested','complete') THEN RAISE EXCEPTION 'Nieprawidłowa akcja.'; END IF;
  hash:=md5(jsonb_build_array(p_offer,p_step,p_action,p_revision,p_context_key,p_payload,p_note)::text);
  SELECT * INTO previous FROM public.seller_realization_step_history WHERE request_id=p_request;
  IF FOUND THEN
    IF previous.offer_id<>o.id OR previous.actor_id<>auth.uid() OR previous.request_hash<>hash THEN RAISE EXCEPTION 'Identyfikator zapisu został już wykorzystany.'; END IF;
    RETURN public.get_seller_realization_wizard(o.id);
  END IF;
  state:=public.get_seller_realization_wizard(o.id);
  IF state->>'active' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Przygotowania nie są aktywne. Wymagana jest zaakceptowana oferta i niezamknięte wydarzenie tej marki.'; END IF;
  INSERT INTO public.seller_realization_workflows(offer_id,event_id) VALUES(o.id,o.event_id) ON CONFLICT(offer_id) DO NOTHING;
  SELECT * INTO STRICT w FROM public.seller_realization_workflows WHERE offer_id=o.id FOR UPDATE;
  IF p_revision IS DISTINCT FROM w.revision THEN RAISE EXCEPTION 'Druga osoba zmieniła przygotowania. Odśwież stan przed zapisem.'; END IF;
  IF w.event_id IS DISTINCT FROM o.event_id THEN RAISE EXCEPTION 'Zmieniło się powiązanie wydarzenia. Przygotowania wymagają sprawdzenia.'; END IF;
  IF p_action='complete' THEN
    IF p_step IS DISTINCT FROM 'finish' OR state->>'can_complete' IS DISTINCT FROM 'true'
      OR p_context_key IS DISTINCT FROM md5((state->'steps')::text) THEN
      RAISE EXCEPTION 'Zatwierdź wszystkie aktualne kroki i osobno potwierdź realizację w CRM.';
    END IF;
    before_value:=to_jsonb(w);
    UPDATE public.seller_realization_workflows SET revision=revision+1,completed_at=now(),completed_by=auth.uid()
      WHERE offer_id=o.id;
    SELECT to_jsonb(x) INTO after_value FROM public.seller_realization_workflows x WHERE offer_id=o.id;
  ELSE
    SELECT value INTO step FROM jsonb_array_elements(state->'steps') WHERE value->>'key'=p_step;
    IF step IS NULL OR step->>'available' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Najpierw zakończ poprzedni krok.'; END IF;
    IF p_context_key IS DISTINCT FROM step->>'context_key' THEN RAISE EXCEPTION 'Zmieniły się dane wydarzenia lub poprzedni krok. Odśwież przygotowania.'; END IF;
    SELECT * INTO s FROM public.seller_realization_steps WHERE offer_id=o.id AND step_key=p_step FOR UPDATE;
    before_value:=to_jsonb(s);
    IF p_action IN ('save','submit') THEN
      IF step->>'can_submit' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Ten krok uzupełnia druga strona.'; END IF;
      clean:=public.validate_seller_realization_step(p_step,p_payload,p_action='submit');
      IF p_step='organization' AND p_action='submit' AND (
        NULLIF(state#>>'{context,starts_at}','') IS NULL OR NULLIF(state#>>'{context,ends_at}','') IS NULL
        OR NULLIF(state#>>'{context,location}','') IS NULL) THEN RAISE EXCEPTION 'Opiekun musi najpierw uzupełnić terminy i miejsce w wydarzeniu CRM.'; END IF;
      next_status:=CASE WHEN p_action='submit' THEN 'submitted' ELSE 'draft' END;
      INSERT INTO public.seller_realization_steps(offer_id,step_key,revision,status,payload,context_key,submitted_at,submitted_by)
      VALUES(o.id,p_step,COALESCE(s.revision,0)+1,next_status,clean,p_context_key,
        CASE WHEN p_action='submit' THEN now() END,CASE WHEN p_action='submit' THEN auth.uid() END)
      ON CONFLICT(offer_id,step_key) DO UPDATE SET revision=EXCLUDED.revision,status=EXCLUDED.status,payload=EXCLUDED.payload,
        context_key=EXCLUDED.context_key,submitted_at=EXCLUDED.submitted_at,submitted_by=EXCLUDED.submitted_by,
        reviewed_at=NULL,reviewed_by=NULL,review_note='';
    ELSE
      IF step->>'can_review' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Brak uprawnień do decyzji lub krok wymaga ponownego przekazania.'; END IF;
      IF length(COALESCE(p_note,''))>3000 OR (p_action='changes_requested' AND btrim(COALESCE(p_note,''))='') THEN RAISE EXCEPTION 'Napisz, co trzeba poprawić (maks. 3000 znaków).'; END IF;
      UPDATE public.seller_realization_steps SET revision=revision+1,status=CASE WHEN p_action='approve' THEN 'approved' ELSE 'changes_requested' END,
        reviewed_at=now(),reviewed_by=auth.uid(),review_note=btrim(COALESCE(p_note,'')) WHERE offer_id=o.id AND step_key=p_step;
    END IF;
    SELECT to_jsonb(x) INTO after_value FROM public.seller_realization_steps x WHERE offer_id=o.id AND step_key=p_step;
    UPDATE public.seller_realization_workflows SET revision=revision+1,completed_at=NULL,completed_by=NULL WHERE offer_id=o.id;
  END IF;
  INSERT INTO public.seller_realization_step_history(request_id,offer_id,revision,step_key,action,actor_id,request_hash,before_value,after_value)
    VALUES(p_request,o.id,w.revision+1,p_step,p_action,auth.uid(),hash,before_value,after_value);
  -- Delivery is atomic with the step. A retry with the same request ID does
  -- not create a second notice. Drafts remain quiet and no chat message is sent.
  IF p_action<>'save' THEN
    step_title:=CASE p_step WHEN 'contact' THEN 'Kontakt na miejscu' WHEN 'organization' THEN 'Miejsce i organizacja'
      WHEN 'materials' THEN 'Materiały i wymagania' WHEN 'plan' THEN 'Plan realizacji' ELSE 'Przygotowanie realizacji' END;
    notice_title:=CASE p_action WHEN 'submit' THEN 'Krok do sprawdzenia: ' WHEN 'approve' THEN 'Zatwierdzono krok: '
      WHEN 'changes_requested' THEN 'Poprawki w kroku: ' ELSE 'Przygotowania zatwierdzone: ' END||step_title;
    IF state->>'seller'='true' THEN
      recipients:=public.seller_offer_notification_recipients(o.id,true);
      notice_url:='/crm/events/'||o.event_id::text||'?tab=seller-arrangements&offer='||o.id::text
        ||'&prepStep='||p_step||'#seller-realization-wizard';
    ELSE
      SELECT array_agg(p.portal_auth_user_id) INTO recipients FROM public.sales_partner_profiles p
      JOIN auth.users u ON u.id=p.portal_auth_user_id
      JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id AND t.my_company_id=o.my_company_id AND t.is_active
      WHERE p.id=o.sales_partner_id AND p.portal_enabled AND p.status='active';
      notice_url:='/seller/realizations/'||o.id::text||'?prepStep='||p_step||'#seller-realization-wizard';
    END IF;
    IF COALESCE(cardinality(recipients),0)=0 THEN
      RAISE EXCEPTION 'Brak aktywnego odbiorcy kroku. Sprawdź opiekuna i dostęp sprzedawcy do tej marki. Nie zapisano przekazania ani decyzji.';
    END IF;
    INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
    VALUES(notice_title,COALESCE(o.offer_number,o.title,'Oferta')||'. Otwórz krok, aby zobaczyć dane i uwagi.',
      'info','offer',notice_url,'offer',o.id,jsonb_build_object(
        'workflow',CASE WHEN state->>'seller'='true' THEN 'seller_offer' ELSE 'seller_review_result' END,
        'event','preparation_step','offer_id',o.id,'sales_partner_id',o.sales_partner_id,
        'my_company_id',o.my_company_id,'step',p_step,'action',p_action,'request_id',p_request))
    RETURNING id INTO notice;
    INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
    SELECT notice,recipient,false FROM unnest(recipients) recipient ON CONFLICT(notification_id,user_id) DO NOTHING;
  END IF;
  UPDATE public.offers SET partner_last_activity_at=now() WHERE id=o.id;
  RETURN public.get_seller_realization_wizard(o.id);
END;
$write$;
REVOKE ALL ON FUNCTION public.update_seller_realization_wizard(uuid,text,text,integer,text,uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_seller_realization_wizard(uuid,text,text,integer,text,uuid,jsonb,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
