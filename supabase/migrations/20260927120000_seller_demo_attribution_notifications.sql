BEGIN;
CREATE INDEX IF NOT EXISTS sales_brochure_demo_source
ON public.sales_brochure_generations(brochure_id, (snapshot->'demoAttribution'->>'sourceId'))
WHERE snapshot ? 'demoAttribution';

CREATE OR REPLACE FUNCTION public.notify_seller_demo_generation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE source record; recipient uuid; notice uuid; recipient_email text; campaign_id text; campaign_name text;
BEGIN
 IF NEW.status <> 'ready' OR OLD.status = 'ready' OR NEW.pdf_path IS NULL THEN RETURN NEW; END IF;
 SELECT g.id,g.created_by,g.version,g.snapshot,b.id AS brochure_id,b.name,b.my_company_id
 INTO source FROM public.seller_demo_sessions s
 JOIN public.sales_brochures b ON b.id=s.brochure_id
 JOIN public.sales_brochure_generations g ON g.brochure_id=b.id
 WHERE s.id=NEW.session_id
 AND g.id::text=NEW.snapshot->'attribution'->>'generationId'
 AND g.snapshot->'demoAttribution'->>'sourceId'=NEW.snapshot->'attribution'->>'sourceId';
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT u.id INTO recipient FROM public.employees e JOIN auth.users u ON u.id=e.auth_user_id OR u.id=e.id
 WHERE e.id=source.created_by AND e.is_active=true
 AND public.employee_can_access_company(e.id,source.my_company_id)
 ORDER BY (u.id=e.auth_user_id) DESC NULLS LAST LIMIT 1;
 IF recipient IS NULL THEN RETURN NEW; END IF;
 recipient_email:=NULLIF(source.snapshot->'demoAttribution'->>'recipientEmail','');
 campaign_id:=source.snapshot->'demoAttribution'->>'campaignId';
 SELECT name INTO campaign_name FROM public.mailing_campaigns WHERE id::text=campaign_id;
 INSERT INTO public.notifications(id,title,message,type,category,user_id,is_global,action_url,metadata)
 VALUES(NEW.id,'Z Twojej broszury wygenerowano próbną ofertę',
 source.name||' · wersja '||source.version::text||'. '||
 CASE WHEN campaign_id IS NOT NULL THEN 'Kampania: '||COALESCE(campaign_name,campaign_id)||'.'
 WHEN recipient_email IS NOT NULL THEN 'Użyto linku przypisanego do: '||recipient_email||'. Link mógł zostać przekazany dalej.'
 ELSE 'Link bez wskazanego odbiorcy.' END,
 'info','offer',recipient,false,'/crm/brochures/'||source.brochure_id::text||'#seller-demo-report',
 jsonb_build_object('workflow','seller_demo','demo_generation_id',NEW.id,'brochure_generation_id',source.id,'employee_id',source.created_by,'campaign_id',campaign_id))
 ON CONFLICT(id) DO NOTHING RETURNING id INTO notice;
 INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
 VALUES(NEW.id,recipient,false) ON CONFLICT(notification_id,user_id) DO NOTHING;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_seller_demo_generation() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS seller_demo_generation_notification ON public.seller_demo_generations;
CREATE TRIGGER seller_demo_generation_notification AFTER UPDATE OF status ON public.seller_demo_generations
FOR EACH ROW WHEN (NEW.status='ready' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.notify_seller_demo_generation();

-- A recipient-specific PDF must never be reused as a shared campaign asset.
CREATE OR REPLACE FUNCTION public.guard_campaign_personal_demo_brochure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
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
REVOKE ALL ON FUNCTION public.guard_campaign_personal_demo_brochure() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS campaign_personal_demo_brochure_guard ON public.mailing_campaigns;
CREATE TRIGGER campaign_personal_demo_brochure_guard BEFORE INSERT OR UPDATE OF brochure_generation_id ON public.mailing_campaigns
FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_personal_demo_brochure();

CREATE INDEX IF NOT EXISTS seller_demo_sessions_campaign ON public.seller_demo_sessions
((brand_config->'attribution'->>'campaignId'));
CREATE OR REPLACE FUNCTION public.get_seller_demo_campaign_report(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT public.can_manage_sales_brochures() OR NOT public.can_manage_marketing_campaigns()
 OR NOT EXISTS(SELECT 1 FROM public.mailing_campaigns WHERE id=p_campaign)
 THEN RAISE EXCEPTION 'Brak dostępu do statystyk demonstracji kampanii'; END IF;
 RETURN jsonb_build_object(
 'visits',(SELECT count(*) FROM public.seller_demo_visits v JOIN public.seller_demo_sessions s ON s.id=v.session_id WHERE s.brand_config->'attribution'->>'campaignId'=p_campaign::text),
 'sessions',(SELECT count(*) FROM public.seller_demo_sessions s WHERE s.brand_config->'attribution'->>'campaignId'=p_campaign::text),
 'pdfs',(SELECT count(*) FROM public.seller_demo_generations g WHERE g.snapshot->'attribution'->>'campaignId'=p_campaign::text AND g.status='ready'),
 'downloads',(SELECT count(*) FROM public.seller_demo_generations g WHERE g.snapshot->'attribution'->>'campaignId'=p_campaign::text AND g.download_started_at IS NOT NULL)
 );
END;
$$;
REVOKE ALL ON FUNCTION public.get_seller_demo_campaign_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_seller_demo_campaign_report(uuid) TO authenticated;
COMMIT;

