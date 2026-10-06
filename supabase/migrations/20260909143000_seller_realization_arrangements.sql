BEGIN;

-- Additive feature only. Saving arrangements does NOT change existing offers,
-- reviews, acceptance decisions, reservations or the CRM event calendar.
CREATE TABLE IF NOT EXISTS public.seller_offer_arrangements (
  offer_id uuid PRIMARY KEY REFERENCES public.offers(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  room text NOT NULL DEFAULT '' CHECK (length(room) <= 200),
  participant_count integer CHECK (participant_count BETWEEN 0 AND 1000000),
  setup_at timestamp CHECK (isfinite(setup_at)),
  starts_at timestamp CHECK (isfinite(starts_at)),
  ends_at timestamp CHECK (isfinite(ends_at)),
  teardown_at timestamp CHECK (isfinite(teardown_at)),
  materials_due_date date CHECK (isfinite(materials_due_date)),
  technical_requirements text NOT NULL DEFAULT '' CHECK (length(technical_requirements) <= 3000),
  logistics_requirements text NOT NULL DEFAULT '' CHECK (length(logistics_requirements) <= 3000),
  contacts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(contacts) = 'array' AND jsonb_array_length(contacts) <= 12),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CHECK (setup_at IS NULL OR starts_at IS NULL OR setup_at <= starts_at),
  CHECK (teardown_at IS NULL OR ends_at IS NULL OR teardown_at >= ends_at)
);
COMMENT ON TABLE public.seller_offer_arrangements IS
  'Ustalenia widoczne dla CRM i właściciela oferty. Godziny Europe/Warsaw. Nie zmieniają decyzji ani kalendarza CRM.';
CREATE TABLE IF NOT EXISTS public.seller_offer_arrangement_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  before_values jsonb,
  after_values jsonb NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(offer_id, revision)
);
ALTER TABLE public.seller_offer_arrangements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_offer_arrangement_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_offer_arrangements, public.seller_offer_arrangement_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.seller_offer_arrangements, public.seller_offer_arrangement_audit TO service_role;

CREATE OR REPLACE FUNCTION public.seller_arrangements_access(p_offer uuid, p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.offers o
    WHERE o.id = p_offer AND o.sales_channel = 'seller_portal'
      AND CASE WHEN public.current_session_is_seller_portal() THEN
        o.sales_partner_id = public.current_sales_partner_id()
        AND EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t
          WHERE t.sales_partner_id = o.sales_partner_id AND t.my_company_id = o.my_company_id AND t.is_active)
        AND (NOT p_write OR (o.status::text <> 'accepted' AND NOT EXISTS (
          SELECT 1 FROM public.events e WHERE e.id = o.event_id AND e.my_company_id = o.my_company_id
            AND e.status::text IN ('offer_accepted','in_preparation','in_progress','completed','invoiced','cancelled')
        )))
      ELSE CASE WHEN p_write THEN public.seller_offer_can_manage(o.id)
        ELSE public.seller_workspace_offers_access(o.my_company_id) END
      END
  );
$$;

CREATE OR REPLACE FUNCTION public.get_seller_offer_arrangements(p_offer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_offer public.offers%ROWTYPE; v_values jsonb; v_event jsonb; v_team jsonb;
BEGIN
  IF NOT public.seller_arrangements_access(p_offer) THEN RAISE EXCEPTION 'Brak dostępu do ustaleń tej oferty i marki'; END IF;
  SELECT * INTO STRICT v_offer FROM public.offers WHERE id = p_offer;
  SELECT to_jsonb(a) - 'offer_id' - 'updated_by' INTO v_values
    FROM public.seller_offer_arrangements a WHERE a.offer_id = p_offer;
  SELECT jsonb_build_object('id',e.id,'name',e.name,'status',e.status,
    'starts_at',to_char(e.event_date AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI'),
    'ends_at',to_char(e.event_end_date AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI'),
    'setup_at',to_char(e.planned_setup_at AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI'),
    'teardown_at',to_char(e.planned_teardown_at AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI'),
    'location',e.location,
    'can_view_crm',CASE WHEN public.current_session_is_seller_portal() THEN false ELSE public.current_employee_can_view_event(e.id) END)
  INTO v_event FROM public.events e WHERE e.id = v_offer.event_id AND e.my_company_id = v_offer.my_company_id;
  -- Only work contact fields of this offer's manager/accepted event team.
  -- No personal_email, phone_private, pay, internal notes or employee directory.
  WITH assigned AS (
    SELECT e.id,e.name,e.surname,e.email,e.phone_number,'Opiekun oferty'::text AS role,0 AS priority
    FROM public.seller_offer_delivery_settings s JOIN public.employees e ON e.id = s.manager_id AND e.is_active
    WHERE s.sales_partner_id = v_offer.sales_partner_id AND s.my_company_id = v_offer.my_company_id
    UNION ALL
    SELECT e.id,e.name,e.surname,e.email,e.phone_number,COALESCE(NULLIF(a.role,''),'Zespół realizacji'),1
    FROM public.employee_assignments a JOIN public.employees e ON e.id = a.employee_id AND e.is_active
    JOIN public.events event ON event.id = a.event_id AND event.my_company_id = v_offer.my_company_id
    WHERE a.event_id = v_offer.event_id AND a.status::text = 'accepted' AND event.status::text <> 'cancelled'
  ), people AS (SELECT DISTINCT ON (id) * FROM assigned ORDER BY id,priority,role)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',btrim(concat_ws(' ',name,surname)),
    'role',role,'email',email,'phone',phone_number) ORDER BY priority,surname,name,id),'[]'::jsonb) INTO v_team FROM people;
  RETURN jsonb_build_object('can_edit',public.seller_arrangements_access(p_offer,true),'values',COALESCE(v_values,'{"revision":0}'::jsonb),
    'offer',jsonb_build_object('id',v_offer.id,'title',v_offer.title,'event_date',v_offer.event_date,
      'location',v_offer.event_location,'status',v_offer.status,'base_net',v_offer.partner_base_net,'client_net',v_offer.client_total_net),
    'client',jsonb_build_object('name',v_offer.portal_client_name,'company',v_offer.portal_client_company,
      'email',v_offer.portal_client_email,'phone',v_offer.portal_client_phone),
    'event',v_event,'team',v_team);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_seller_offer_arrangements(p_offer uuid, p_revision integer, p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old public.seller_offer_arrangements%ROWTYPE; v_next public.seller_offer_arrangements%ROWTYPE;
  v_person jsonb; v_contacts jsonb := '[]'::jsonb; v_key text; v_text text;
BEGIN
  PERFORM 1 FROM public.offers WHERE id = p_offer FOR UPDATE;
  IF NOT public.seller_arrangements_access(p_offer,true) THEN RAISE EXCEPTION 'Nie możesz zmieniać tych ustaleń. Zmiany potwierdzonej realizacji omów z opiekunem na czacie.'; END IF;
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Nieprawidłowe dane ustaleń'; END IF;
  SELECT * INTO v_old FROM public.seller_offer_arrangements WHERE offer_id = p_offer FOR UPDATE;
  IF p_revision IS DISTINCT FROM COALESCE(v_old.revision,0) THEN RAISE EXCEPTION 'Ustalenia zmieniła inna osoba. Wczytaj aktualne dane przed zapisem.'; END IF;
  FOREACH v_key IN ARRAY ARRAY['setup_at','starts_at','ends_at','teardown_at'] LOOP
    v_text := NULLIF(btrim(p_values->>v_key),'');
    IF v_text IS NOT NULL AND v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' THEN
      RAISE EXCEPTION 'Uzupełnij poprawną datę i godzinę harmonogramu';
    END IF;
  END LOOP;
  IF NULLIF(p_values->>'materials_due_date','') IS NOT NULL AND (p_values->>'materials_due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Nieprawidłowy termin przekazania materiałów';
  END IF;
  IF jsonb_typeof(COALESCE(p_values->'contacts','[]'::jsonb)) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista kontaktów'; END IF;
  IF jsonb_array_length(COALESCE(p_values->'contacts','[]'::jsonb)) > 12 THEN RAISE EXCEPTION 'Możesz dodać do 12 kontaktów organizacyjnych'; END IF;
  FOR v_person IN SELECT value FROM jsonb_array_elements(COALESCE(p_values->'contacts','[]'::jsonb)) LOOP
    IF jsonb_typeof(v_person) <> 'object' OR COALESCE(length(btrim(v_person->>'name')),0) NOT BETWEEN 1 AND 160
      OR length(COALESCE(v_person->>'role','')) > 100 OR length(COALESCE(v_person->>'phone','')) > 50
      OR length(COALESCE(v_person->>'email','')) > 254 THEN RAISE EXCEPTION 'Uzupełnij imię i nazwisko oraz sprawdź długość danych kontaktowych'; END IF;
    IF NULLIF(btrim(v_person->>'email'),'') IS NOT NULL AND (v_person->>'email') !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$' THEN RAISE EXCEPTION 'Nieprawidłowy e-mail kontaktu'; END IF;
    v_contacts := v_contacts || jsonb_build_array(jsonb_build_object('name',btrim(v_person->>'name'),
      'role',btrim(COALESCE(v_person->>'role','')),'email',btrim(COALESCE(v_person->>'email','')),'phone',btrim(COALESCE(v_person->>'phone',''))));
  END LOOP;
  v_next.offer_id := p_offer;
  v_next.revision := COALESCE(v_old.revision,0) + 1;
  v_next.room := btrim(COALESCE(p_values->>'room',''));
  v_next.participant_count := NULLIF(p_values->>'participant_count','')::integer;
  v_next.setup_at := NULLIF(p_values->>'setup_at','')::timestamp;
  v_next.starts_at := NULLIF(p_values->>'starts_at','')::timestamp;
  v_next.ends_at := NULLIF(p_values->>'ends_at','')::timestamp;
  v_next.teardown_at := NULLIF(p_values->>'teardown_at','')::timestamp;
  v_next.materials_due_date := NULLIF(p_values->>'materials_due_date','')::date;
  v_next.technical_requirements := btrim(COALESCE(p_values->>'technical_requirements',''));
  v_next.logistics_requirements := btrim(COALESCE(p_values->>'logistics_requirements',''));
  v_next.contacts := v_contacts; v_next.updated_at := now(); v_next.updated_by := auth.uid();
  IF v_old.offer_id IS NOT NULL AND (to_jsonb(v_old)-'revision'-'updated_at'-'updated_by') = (to_jsonb(v_next)-'revision'-'updated_at'-'updated_by') THEN
    RETURN public.get_seller_offer_arrangements(p_offer);
  END IF;
  INSERT INTO public.seller_offer_arrangements SELECT (v_next).*
  ON CONFLICT(offer_id) DO UPDATE SET revision=EXCLUDED.revision,room=EXCLUDED.room,participant_count=EXCLUDED.participant_count,
    setup_at=EXCLUDED.setup_at,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,teardown_at=EXCLUDED.teardown_at,
    materials_due_date=EXCLUDED.materials_due_date,technical_requirements=EXCLUDED.technical_requirements,
    logistics_requirements=EXCLUDED.logistics_requirements,contacts=EXCLUDED.contacts,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
  INSERT INTO public.seller_offer_arrangement_audit(offer_id,revision,before_values,after_values,actor_id)
    VALUES(p_offer,v_next.revision,CASE WHEN v_old.offer_id IS NOT NULL THEN to_jsonb(v_old) END,to_jsonb(v_next),auth.uid());
  RETURN public.get_seller_offer_arrangements(p_offer);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_realizations(p_include_past boolean DEFAULT false,p_search text DEFAULT '',p_offset integer DEFAULT 0,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_partner uuid := public.current_sales_partner_id(); v_result jsonb;
BEGIN
  IF v_partner IS NULL THEN RAISE EXCEPTION 'Brak dostępu do realizacji sprzedawcy'; END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_offset>100000 OR p_limit IS NULL OR p_limit<1 OR p_limit>100 OR length(COALESCE(p_search,''))>200 THEN RAISE EXCEPTION 'Nieprawidłowe parametry listy'; END IF;
  WITH candidates AS (
    SELECT COALESCE(e.id,o.id) AS id,e.id AS event_id,o.id AS offer_id,o.offer_number,
      COALESCE(e.name,NULLIF(o.title,''),o.offer_number,'Realizacja') AS name,
      COALESCE(e.event_date,o.event_date::timestamptz,a.starts_at AT TIME ZONE 'Europe/Warsaw') AS starts_at,
      COALESCE(e.event_end_date,e.event_date,a.ends_at AT TIME ZONE 'Europe/Warsaw',o.event_date::timestamptz) AS ends_at,
      COALESCE(NULLIF(e.location,''),o.event_location) AS location,
      COALESCE(e.status::text,'awaiting_event') AS status,
      b.name AS brand_name,COALESCE(NULLIF(o.portal_client_company,''),o.portal_client_name) AS client_name,
      o.client_total_net AS client_net,o.status::text='accepted' AS accepted_offer,o.updated_at
    FROM public.offers o JOIN public.sales_partner_brand_terms t
      ON t.sales_partner_id=o.sales_partner_id AND t.my_company_id=o.my_company_id AND t.is_active
    JOIN public.my_companies b ON b.id=o.my_company_id
    LEFT JOIN public.events e ON e.id=o.event_id AND e.my_company_id=o.my_company_id
    LEFT JOIN public.seller_offer_arrangements a ON a.offer_id=o.id
    WHERE o.sales_partner_id=v_partner AND o.sales_channel='seller_portal'
      AND o.status::text <> 'rejected' AND (e.id IS NULL OR e.status::text<>'cancelled')
      AND (o.event_id IS NULL OR e.id IS NOT NULL)
      AND (o.status::text='accepted' OR e.status::text IN ('offer_accepted','in_preparation','in_progress','completed','invoiced'))
  ), chosen AS (
    SELECT DISTINCT ON(id) * FROM candidates ORDER BY id,accepted_offer DESC,updated_at DESC NULLS LAST,offer_id
  ), classified AS (
    SELECT *,CASE WHEN status='in_progress' THEN false WHEN status IN ('completed','invoiced') THEN true
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
$$;

REVOKE ALL ON FUNCTION public.seller_arrangements_access(uuid,boolean),public.get_seller_offer_arrangements(uuid),
  public.save_seller_offer_arrangements(uuid,integer,jsonb),public.get_seller_realizations(boolean,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.seller_arrangements_access(uuid,boolean),public.get_seller_offer_arrangements(uuid),
  public.save_seller_offer_arrangements(uuid,integer,jsonb),public.get_seller_realizations(boolean,text,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
