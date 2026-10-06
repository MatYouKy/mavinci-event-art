BEGIN;
-- Existing offer users keep their own results; team access is explicitly granted.
UPDATE public.employees SET permissions=array_append(COALESCE(permissions,'{}'::text[]),'offers_brochures_view_own')
WHERE COALESCE(permissions,'{}'::text[]) && ARRAY['offers_view','offers_manage']
AND NOT ('offers_brochures_view_own'=ANY(COALESCE(permissions,'{}'::text[])));
UPDATE public.access_levels SET default_permissions=array_append(COALESCE(default_permissions,'{}'::text[]),'offers_brochures_view_own')
WHERE COALESCE(default_permissions,'{}'::text[]) && ARRAY['offers_view','offers_manage']
AND NOT ('offers_brochures_view_own'=ANY(COALESCE(default_permissions,'{}'::text[])));

CREATE FUNCTION public.can_view_all_brochure_results() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.can_view_sales_brochures() AND NOT public.current_session_is_seller_portal() AND EXISTS(
 SELECT 1 FROM public.employees e WHERE e.id=public.current_brochure_employee_id()
 AND (e.role='admin' OR e.access_level='admin' OR 'offers_brochures_view_all'=ANY(COALESCE(e.permissions,'{}'::text[]))));
$$;
CREATE FUNCTION public.can_view_brochure_employee(p_employee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.can_view_all_brochure_results() OR (
 public.can_view_sales_brochures() AND NOT public.current_session_is_seller_portal()
 AND p_employee=public.current_brochure_employee_id() AND EXISTS(
 SELECT 1 FROM public.employees e WHERE e.id=public.current_brochure_employee_id()
 AND 'offers_brochures_view_own'=ANY(COALESCE(e.permissions,'{}'::text[]))));
$$;
REVOKE ALL ON FUNCTION public.can_view_all_brochure_results(),public.can_view_brochure_employee(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_all_brochure_results(),public.can_view_brochure_employee(uuid) TO authenticated;

ALTER TABLE public.seller_demo_sessions ADD COLUMN employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.seller_demo_generations ADD COLUMN employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;
-- Resolve ownership from the immutable source version, never from an email or form field.
UPDATE public.seller_demo_sessions s SET employee_id=g.created_by
FROM public.sales_brochure_generations g
WHERE g.brochure_id=s.brochure_id AND g.id::text=s.brand_config->'attribution'->>'generationId'
AND g.snapshot->'demoAttribution'->>'sourceId'=s.brand_config->'attribution'->>'sourceId';
UPDATE public.seller_demo_generations g SET employee_id=s.employee_id
FROM public.seller_demo_sessions s WHERE s.id=g.session_id;
CREATE FUNCTION public.assign_seller_demo_session_employee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 NEW.employee_id:=NULL;
 SELECT g.created_by INTO NEW.employee_id FROM public.sales_brochure_generations g
 WHERE g.brochure_id=NEW.brochure_id AND g.id::text=NEW.brand_config->'attribution'->>'generationId'
 AND g.snapshot->'demoAttribution'->>'sourceId'=NEW.brand_config->'attribution'->>'sourceId';
 RETURN NEW;
END; $$;
CREATE TRIGGER seller_demo_session_employee BEFORE INSERT OR UPDATE OF brand_config,brochure_id ON public.seller_demo_sessions
FOR EACH ROW EXECUTE FUNCTION public.assign_seller_demo_session_employee();
CREATE FUNCTION public.assign_seller_demo_document_employee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 SELECT s.employee_id INTO NEW.employee_id FROM public.seller_demo_sessions s WHERE s.id=NEW.session_id;
 RETURN NEW;
END; $$;
CREATE TRIGGER seller_demo_document_employee BEFORE INSERT OR UPDATE OF session_id,snapshot ON public.seller_demo_generations
FOR EACH ROW EXECUTE FUNCTION public.assign_seller_demo_document_employee();
REVOKE ALL ON FUNCTION public.assign_seller_demo_session_employee(),public.assign_seller_demo_document_employee() FROM PUBLIC,anon,authenticated;
CREATE INDEX seller_demo_sessions_employee ON public.seller_demo_sessions(brochure_id,employee_id,updated_at DESC);
CREATE INDEX seller_demo_generations_employee ON public.seller_demo_generations(employee_id,created_at DESC);
CREATE INDEX sales_brochure_generations_employee ON public.sales_brochure_generations(brochure_id,created_by,version DESC);

DROP POLICY seller_demo_sessions_crm ON public.seller_demo_sessions;
CREATE POLICY seller_demo_sessions_crm ON public.seller_demo_sessions FOR SELECT TO authenticated USING(
 public.can_view_brochure_employee(employee_id) AND EXISTS(SELECT 1 FROM public.sales_brochures b WHERE b.id=brochure_id)
);
DROP POLICY seller_demo_generations_crm ON public.seller_demo_generations;
CREATE POLICY seller_demo_generations_crm ON public.seller_demo_generations FOR SELECT TO authenticated USING(
 public.can_view_brochure_employee(employee_id) AND EXISTS(SELECT 1 FROM public.seller_demo_sessions s WHERE s.id=session_id)
);
-- Visit and private demo PDF policies already inherit session/document RLS.
DROP POLICY sales_brochure_generations_read ON public.sales_brochure_generations;
DROP POLICY sales_brochure_generations_manage ON public.sales_brochure_generations;
CREATE POLICY sales_brochure_generations_read ON public.sales_brochure_generations FOR SELECT TO authenticated USING(
 public.can_view_brochure_employee(created_by) AND EXISTS(SELECT 1 FROM public.sales_brochures b WHERE b.id=brochure_id)
);
-- Immutable versions are written by the authenticated server endpoint only.
REVOKE INSERT,UPDATE,DELETE ON public.sales_brochure_generations FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.record_sales_brochure_generation(uuid,text,text,bigint,jsonb,uuid) FROM authenticated;
DROP POLICY generated_brochures_read ON storage.objects;
DROP POLICY generated_brochures_manage ON storage.objects;
CREATE POLICY generated_brochures_read ON storage.objects FOR SELECT TO authenticated USING(
 bucket_id='generated-brochures' AND EXISTS(SELECT 1 FROM public.sales_brochure_generations g WHERE g.pdf_path=name)
);

CREATE FUNCTION public.get_seller_demo_report_scoped(p_brochure uuid,p_offset integer DEFAULT 0,p_all boolean DEFAULT false,p_employee uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE result jsonb; own_id uuid:=public.current_brochure_employee_id(); all_allowed boolean:=public.can_view_all_brochure_results();
BEGIN
 IF NOT COALESCE(public.can_view_brochure_employee(own_id),false)
 OR NOT EXISTS(SELECT 1 FROM public.sales_brochures WHERE id=p_brochure)
 OR (COALESCE(p_all,false) AND NOT all_allowed)
 THEN RAISE EXCEPTION 'Brak dostępu do wyników broszury' USING ERRCODE='42501'; END IF;
 WITH sessions AS MATERIALIZED (
 SELECT s.* FROM public.seller_demo_sessions s WHERE s.brochure_id=p_brochure
 AND (CASE WHEN COALESCE(p_all,false) THEN (p_employee IS NULL OR s.employee_id=p_employee) ELSE s.employee_id=own_id END)
 ), documents AS MATERIALIZED (
 SELECT g.*,COALESCE(NULLIF(concat_ws(' ',e.name,e.surname),''),CASE WHEN g.employee_id IS NULL THEN 'Nieprzypisane' ELSE 'Pracownik' END) AS employee_name
 FROM public.seller_demo_generations g JOIN sessions s ON s.id=g.session_id LEFT JOIN public.employees e ON e.id=g.employee_id
 ), sources AS MATERIALIZED (
 SELECT g.*,COALESCE(NULLIF(concat_ws(' ',e.name,e.surname),''),CASE WHEN g.created_by IS NULL THEN 'Nieprzypisane' ELSE 'Pracownik' END) AS employee_name
 FROM public.sales_brochure_generations g LEFT JOIN public.employees e ON e.id=g.created_by
 WHERE g.brochure_id=p_brochure
 AND (CASE WHEN COALESCE(p_all,false) THEN (p_employee IS NULL OR g.created_by=p_employee) ELSE g.created_by=own_id END)
 )
 SELECT jsonb_build_object(
 'canViewAll',all_allowed,
 'visits',(SELECT count(*) FROM public.seller_demo_visits v JOIN sessions s ON s.id=v.session_id),
 'sessions',(SELECT count(*) FROM sessions),
 'leads',(SELECT count(*) FROM sessions WHERE full_name<>'' OR organization<>'' OR email<>'' OR phone<>''),
 'pdfs',(SELECT count(*) FROM documents WHERE status='ready'),
 'downloads',(SELECT count(*) FROM documents WHERE download_started_at IS NOT NULL),
 'employees',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
 SELECT DISTINCT g.created_by AS id,COALESCE(NULLIF(concat_ws(' ',e.name,e.surname),''),'Pracownik') AS name
 FROM public.sales_brochure_generations g LEFT JOIN public.employees e ON e.id=g.created_by
 WHERE g.brochure_id=p_brochure AND g.created_by IS NOT NULL ORDER BY name,g.created_by
 ) x),'[]'::jsonb),
 'sources',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
 SELECT g.id,g.version,g.pdf_path,g.created_by,g.employee_name,g.created_at,g.snapshot->'demoAttribution' AS attribution,
 COALESCE(g.snapshot->>'demoUrl',(SELECT page->>'linkUrl' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g.snapshot->'decorativePages')='array' THEN g.snapshot->'decorativePages' ELSE '[]'::jsonb END) page
 WHERE page->>'linkUrl' LIKE 'https://mavinci.pl/demo-sprzedawcy/'||p_brochure::text||'?source=%' LIMIT 1)) AS demo_url
 FROM sources g ORDER BY g.version DESC LIMIT 50 OFFSET greatest(p_offset,0)
 ) x),'[]'::jsonb),
 'documents',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
 SELECT id,status,pdf_path,snapshot,created_at,download_started_at,employee_id,employee_name FROM documents ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET greatest(p_offset,0)
 ) x),'[]'::jsonb),
 'people',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
 SELECT s.id,s.full_name,s.organization,s.email,s.phone,s.logo_added,s.brand_config,s.created_at,s.updated_at,s.employee_id,
 COALESCE(NULLIF(concat_ws(' ',e.name,e.surname),''),CASE WHEN s.employee_id IS NULL THEN 'Nieprzypisane' ELSE 'Pracownik' END) AS employee_name,
 (SELECT count(*) FROM public.seller_demo_visits v WHERE v.session_id=s.id) AS visits,
 (SELECT count(*) FROM documents g WHERE g.session_id=s.id AND g.status='ready') AS pdfs,
 (SELECT count(*) FROM documents g WHERE g.session_id=s.id AND g.download_started_at IS NOT NULL) AS downloads
 FROM sessions s LEFT JOIN public.employees e ON e.id=s.employee_id WHERE s.full_name<>'' OR s.organization<>'' OR s.email<>'' OR s.phone<>''
 ORDER BY s.updated_at DESC,s.id DESC LIMIT 50 OFFSET greatest(p_offset,0)
 ) x),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_seller_demo_report_scoped(uuid,integer,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_seller_demo_report_scoped(uuid,integer,boolean,uuid) TO authenticated;
-- Old callers also default to personal results, including administrators.
CREATE OR REPLACE FUNCTION public.get_seller_demo_report(p_brochure uuid,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT public.get_seller_demo_report_scoped(p_brochure,p_offset,false,NULL);
$$;

CREATE OR REPLACE FUNCTION public.create_hotel_brochure_campaign(
  p_brochure_id uuid,
  p_name text DEFAULT NULL,
  p_subject text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brochure public.sales_brochures%ROWTYPE;
  v_generation_id uuid;
  v_campaign_id uuid;
BEGIN
  IF NOT public.can_manage_sales_brochures() OR NOT public.can_manage_marketing_campaigns() THEN
    RAISE EXCEPTION 'Brak uprawnień do utworzenia kampanii';
  END IF;

  SELECT * INTO v_brochure FROM public.sales_brochures WHERE id = p_brochure_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono broszury'; END IF;
  IF v_brochure.current_pdf_version <= 0 OR v_brochure.current_pdf_path IS NULL
     OR v_brochure.modified_after_generation THEN
    RAISE EXCEPTION 'Najpierw wygeneruj aktualny PDF broszury';
  END IF;

  SELECT generation.id INTO v_generation_id
  FROM public.sales_brochure_generations generation
  WHERE generation.brochure_id = v_brochure.id
    AND generation.version = v_brochure.current_pdf_version
    AND generation.created_by=public.current_brochure_employee_id()
    AND public.can_view_brochure_employee(generation.created_by);
  IF v_generation_id IS NULL THEN RAISE EXCEPTION 'Przed utworzeniem kampanii wygeneruj własną aktualną wersję PDF'; END IF;

  INSERT INTO public.mailing_campaigns (
    name, subject, content, preview_text, status, audience_rules,
    brochure_generation_id, created_by, updated_by
  ) VALUES (
    COALESCE(NULLIF(btrim(p_name), ''), 'Broszura dla hoteli — ' || v_brochure.name),
    COALESCE(NULLIF(btrim(p_subject), ''), 'Propozycja współpracy eventowej dla Państwa hotelu'),
    '<div style="font-family:Arial,sans-serif;line-height:1.65;color:#1c1f33">'
      || '<p>Dzień dobry,</p><p>przygotowaliśmy prezentację usług, które możemy realizować wspólnie z Państwa hotelem.</p>'
      || '<p><strong>Broszura PDF jest przypisana do tego szkicu.</strong> Kontrolowany link zostanie udostępniony po aktywacji dystrybucji i ponownej kwalifikacji odbiorców.</p>'
      || '<p>Chętnie porozmawiamy o stałej współpracy oraz obsłudze najbliższych wydarzeń.</p></div>',
    'Technika, produkcja i obsługa wydarzeń dla hoteli',
    'draft',
    jsonb_build_object('business_types', jsonb_build_array('hotel')),
    v_generation_id,
    public.current_marketing_employee_id(),
    public.current_marketing_employee_id()
  ) RETURNING id INTO v_campaign_id;

  RETURN v_campaign_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.guard_campaign_personal_demo_brochure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.role()='authenticated' AND NEW.brochure_generation_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM public.sales_brochure_generations g WHERE g.id=NEW.brochure_generation_id AND public.can_view_brochure_employee(g.created_by))
 THEN RAISE EXCEPTION 'Brak dostępu do tej wersji broszury' USING ERRCODE='42501'; END IF;
 IF NEW.brochure_generation_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.sales_brochure_generations g WHERE g.id=NEW.brochure_generation_id
 AND COALESCE(g.snapshot->'demoAttribution'->>'recipientEmail','')<>'')
 THEN RAISE EXCEPTION 'Ta wersja PDF ma link dla pojedynczego odbiorcy. Do kampanii wygeneruj wersję bez e-maila odbiorcy.'; END IF;
 IF NEW.brochure_generation_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.sales_brochure_generations g WHERE g.id=NEW.brochure_generation_id
 AND NULLIF(g.snapshot->'demoAttribution'->>'campaignId','') IS NOT NULL
 AND g.snapshot->'demoAttribution'->>'campaignId'<>NEW.id::text)
 THEN RAISE EXCEPTION 'PDF jest przypisany do innej kampanii. Najpierw wygeneruj ogólną wersję broszury.'; END IF;
 RETURN NEW;
END;
$$;

COMMIT;
