BEGIN;
CREATE TABLE public.seller_demo_sessions (
  id uuid PRIMARY KEY,
  brochure_id uuid NOT NULL REFERENCES public.sales_brochures(id) ON DELETE CASCADE,
  network_hash text NOT NULL CHECK (length(network_hash)=64),
  full_name text NOT NULL DEFAULT '' CHECK(length(full_name)<=120),
  organization text NOT NULL DEFAULT '' CHECK(length(organization)<=160),
  email text NOT NULL DEFAULT '' CHECK(length(email)<=200),
  phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40),
  brand_config jsonb NOT NULL DEFAULT '{}',
  logo_added boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.seller_demo_visits (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.seller_demo_sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.seller_demo_generations (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.seller_demo_sessions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'generating' CHECK(status IN ('generating','ready','failed')),
  pdf_path text UNIQUE,
  snapshot jsonb NOT NULL DEFAULT '{}',
  download_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX seller_demo_sessions_brochure ON public.seller_demo_sessions(brochure_id,updated_at DESC);
CREATE INDEX seller_demo_sessions_network ON public.seller_demo_sessions(network_hash,created_at);
CREATE INDEX seller_demo_visits_session ON public.seller_demo_visits(session_id,created_at);
CREATE INDEX seller_demo_generations_session ON public.seller_demo_generations(session_id,created_at);
ALTER TABLE public.seller_demo_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_demo_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_demo_generations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_demo_sessions,public.seller_demo_visits,public.seller_demo_generations FROM anon,authenticated;
GRANT SELECT ON public.seller_demo_sessions,public.seller_demo_visits,public.seller_demo_generations TO authenticated;
GRANT ALL ON public.seller_demo_sessions,public.seller_demo_visits,public.seller_demo_generations TO service_role;
CREATE POLICY seller_demo_sessions_crm ON public.seller_demo_sessions FOR SELECT TO authenticated USING(
 public.can_manage_sales_brochures() AND NOT public.current_session_is_seller_portal()
 AND EXISTS(SELECT 1 FROM public.sales_brochures b WHERE b.id=brochure_id)
);
CREATE POLICY seller_demo_visits_crm ON public.seller_demo_visits FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.seller_demo_sessions s WHERE s.id=session_id));
CREATE POLICY seller_demo_generations_crm ON public.seller_demo_generations FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.seller_demo_sessions s WHERE s.id=session_id));

CREATE FUNCTION public.record_seller_demo_visit(p_session uuid,p_brochure uuid,p_visit uuid,p_network text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('seller-demo-visit:'||p_network,0));
 IF NOT EXISTS(SELECT 1 FROM sales_brochures WHERE id=p_brochure AND status<>'archived' AND brand_config->>'seller_demo_enabled'='true') THEN RAISE EXCEPTION 'Demo niedostępne'; END IF;
 IF EXISTS(SELECT 1 FROM seller_demo_visits WHERE id=p_visit AND session_id=p_session) THEN RETURN; END IF;
 IF (SELECT count(*) FROM seller_demo_visits v JOIN seller_demo_sessions s ON s.id=v.session_id WHERE s.network_hash=p_network AND v.created_at>now()-interval '1 hour')>=100 THEN RAISE EXCEPTION 'Limit wejść'; END IF;
 INSERT INTO seller_demo_sessions(id,brochure_id,network_hash) VALUES(p_session,p_brochure,p_network) ON CONFLICT(id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM seller_demo_sessions WHERE id=p_session AND brochure_id=p_brochure) THEN RAISE EXCEPTION 'Nieprawidłowa sesja'; END IF;
 INSERT INTO seller_demo_visits(id,session_id) VALUES(p_visit,p_session);
END; $$;
CREATE FUNCTION public.claim_seller_demo_pdf(p_session uuid,p_generation uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s seller_demo_sessions%ROWTYPE;
BEGIN
 -- Global limit bounds rendering costs even if an attacker rotates sessions.
 PERFORM pg_advisory_xact_lock(hashtextextended('seller-demo-pdf',0));
 SELECT * INTO s FROM seller_demo_sessions WHERE id=p_session FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM seller_demo_generations WHERE id=p_generation) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM seller_demo_generations WHERE session_id=p_session AND status='generating' AND created_at>now()-interval '3 minutes') THEN RETURN false; END IF;
 IF (SELECT count(*) FROM seller_demo_generations WHERE session_id=p_session AND created_at>now()-interval '1 hour')>=3 THEN RETURN false; END IF;
 IF (SELECT count(*) FROM seller_demo_generations g JOIN seller_demo_sessions x ON x.id=g.session_id WHERE x.network_hash=s.network_hash AND g.created_at>now()-interval '1 hour')>=10 THEN RETURN false; END IF;
 IF (SELECT count(*) FROM seller_demo_generations WHERE created_at>now()-interval '1 hour')>=60 THEN RETURN false; END IF;
 INSERT INTO seller_demo_generations(id,session_id) VALUES(p_generation,p_session);
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.record_seller_demo_visit(uuid,uuid,uuid,text),public.claim_seller_demo_pdf(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_seller_demo_visit(uuid,uuid,uuid,text),public.claim_seller_demo_pdf(uuid,uuid) TO service_role;

CREATE FUNCTION public.get_seller_demo_report(p_brochure uuid,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.can_manage_sales_brochures() OR public.current_session_is_seller_portal()
 OR NOT EXISTS(SELECT 1 FROM sales_brochures WHERE id=p_brochure) THEN RAISE EXCEPTION 'Brak dostępu' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
  'visits',(SELECT count(*) FROM seller_demo_visits v JOIN seller_demo_sessions s ON s.id=v.session_id WHERE s.brochure_id=p_brochure),
  'sessions',(SELECT count(*) FROM seller_demo_sessions WHERE brochure_id=p_brochure),
  'leads',(SELECT count(*) FROM seller_demo_sessions WHERE brochure_id=p_brochure AND (full_name<>'' OR organization<>'' OR email<>'' OR phone<>'')),
  'pdfs',(SELECT count(*) FROM seller_demo_generations g JOIN seller_demo_sessions s ON s.id=g.session_id WHERE s.brochure_id=p_brochure AND g.status='ready'),
  'downloads',(SELECT count(*) FROM seller_demo_generations g JOIN seller_demo_sessions s ON s.id=g.session_id WHERE s.brochure_id=p_brochure AND g.download_started_at IS NOT NULL),
  'documents',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT g.id,g.status,g.pdf_path,g.snapshot,g.created_at,g.download_started_at FROM seller_demo_generations g JOIN seller_demo_sessions s ON s.id=g.session_id WHERE s.brochure_id=p_brochure ORDER BY g.created_at DESC LIMIT 50 OFFSET greatest(p_offset,0)) x),'[]'::jsonb),
  'people',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
   SELECT s.id,s.full_name,s.organization,s.email,s.phone,s.logo_added,s.brand_config,s.created_at,s.updated_at,
    (SELECT count(*) FROM seller_demo_visits v WHERE v.session_id=s.id) AS visits,
    (SELECT count(*) FROM seller_demo_generations g WHERE g.session_id=s.id AND g.status='ready') AS pdfs,
    (SELECT count(*) FROM seller_demo_generations g WHERE g.session_id=s.id AND g.download_started_at IS NOT NULL) AS downloads
   FROM seller_demo_sessions s WHERE brochure_id=p_brochure AND (full_name<>'' OR organization<>'' OR email<>'' OR phone<>'') ORDER BY updated_at DESC LIMIT 50 OFFSET greatest(p_offset,0)
  ) x),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_seller_demo_report(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_seller_demo_report(uuid,integer) TO authenticated;
COMMENT ON TABLE public.seller_demo_sessions IS 'Demo broszury: dane podane w formularzu, bez logo, adresów IP i danych klientów hotelu. Brak zgody marketingowej; nie dodawać automatycznie do kampanii.';
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('seller-demo-pdfs','seller-demo-pdfs',false,20971520,ARRAY['application/pdf']) ON CONFLICT(id) DO NOTHING;
CREATE POLICY seller_demo_pdf_crm_read ON storage.objects FOR SELECT TO authenticated USING(
 bucket_id='seller-demo-pdfs' AND EXISTS(SELECT 1 FROM public.seller_demo_generations g WHERE g.pdf_path=name)
);
COMMIT;
