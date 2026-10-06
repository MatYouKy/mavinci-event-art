BEGIN;
CREATE TABLE public.sales_brochure_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL,
 brochure_id uuid NOT NULL REFERENCES public.sales_brochures(id) ON DELETE CASCADE,
 generation_id uuid NOT NULL UNIQUE REFERENCES public.sales_brochure_generations(id) ON DELETE RESTRICT,
 employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
 contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
 organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
 recipient_email text NOT NULL CHECK(length(recipient_email)<=200),
 recipient_name text NOT NULL DEFAULT '',
 email_account_id uuid NOT NULL REFERENCES public.employee_email_accounts(id) ON DELETE RESTRICT,
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 250),
 body_html text NOT NULL,
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','sending','sent','failed','uncertain')),
 error_message text,
 message_id text,
 sent_email_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 attempted_at timestamptz,
 sent_at timestamptz,
 UNIQUE(batch_id,recipient_email)
);
CREATE INDEX brochure_deliveries_owner ON public.sales_brochure_deliveries(brochure_id,employee_id,created_at DESC);
CREATE INDEX brochure_deliveries_contact ON public.sales_brochure_deliveries(contact_id,created_at DESC);
CREATE INDEX brochure_deliveries_organization ON public.sales_brochure_deliveries(organization_id,created_at DESC);
ALTER TABLE public.sales_brochure_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_brochure_deliveries FROM anon,authenticated;
GRANT SELECT ON public.sales_brochure_deliveries TO authenticated;
GRANT ALL ON public.sales_brochure_deliveries TO service_role;
CREATE POLICY brochure_deliveries_read ON public.sales_brochure_deliveries FOR SELECT TO authenticated USING(
 public.can_view_brochure_employee(employee_id)
 AND EXISTS(SELECT 1 FROM public.sales_brochures b WHERE b.id=brochure_id)
);
COMMENT ON TABLE public.sales_brochure_deliveries IS 'Osobna wiadomość i niezmienna wersja PDF dla każdego odbiorcy. Sending/uncertain blokują ponowienie po niejednoznacznym wyniku transportu.';

CREATE OR REPLACE FUNCTION public.get_seller_demo_report_scoped(p_brochure uuid,p_offset integer DEFAULT 0,p_all boolean DEFAULT false,p_employee uuid DEFAULT NULL)
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
 'sent',(SELECT count(*) FROM public.sales_brochure_deliveries d WHERE d.brochure_id=p_brochure AND d.status='sent' AND (CASE WHEN COALESCE(p_all,false) THEN (p_employee IS NULL OR d.employee_id=p_employee) ELSE d.employee_id=own_id END)),
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

COMMIT;
