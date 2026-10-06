BEGIN;
-- Recipient delivery uses notification_recipients; user_id and is_global
-- were removed from notifications by the 20251015050727 refactor.
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
 INSERT INTO public.notifications(id,title,message,type,category,action_url,metadata)
 VALUES(NEW.id,'Z Twojej broszury wygenerowano próbną ofertę',
 source.name||' · wersja '||source.version::text||'. '||
 CASE WHEN campaign_id IS NOT NULL THEN 'Kampania: '||COALESCE(campaign_name,campaign_id)||'.'
 WHEN recipient_email IS NOT NULL THEN 'Użyto linku przypisanego do: '||recipient_email||'. Link mógł zostać przekazany dalej.'
 ELSE 'Link bez wskazanego odbiorcy.' END,
 'info','offer','/crm/brochures/'||source.brochure_id::text||'#seller-demo-report',
 jsonb_build_object('workflow','seller_demo','demo_generation_id',NEW.id,'brochure_generation_id',source.id,'employee_id',source.created_by,'campaign_id',campaign_id))
 ON CONFLICT(id) DO NOTHING RETURNING id INTO notice;
 INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
 VALUES(NEW.id,recipient,false) ON CONFLICT(notification_id,user_id) DO NOTHING;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_seller_demo_generation() FROM PUBLIC,anon,authenticated;
COMMIT;
