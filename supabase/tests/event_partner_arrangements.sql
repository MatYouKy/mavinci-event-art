BEGIN;
DO $$ DECLARE actor uuid; eid uuid; oid uuid; BEGIN
 SELECT coalesce(auth_user_id,id) INTO actor FROM public.employees WHERE is_active AND (role::text='admin' OR access_level::text='admin' OR 'admin'=ANY(coalesce(permissions,'{}'))) LIMIT 1;
 SELECT id INTO eid FROM public.events LIMIT 1;
 SELECT id INTO oid FROM public.organizations LIMIT 1;
 IF actor IS NULL OR eid IS NULL OR oid IS NULL THEN RAISE EXCEPTION 'Missing test fixtures'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 SET LOCAL ROLE authenticated;
 INSERT INTO public.event_partner_arrangements(event_id,enabled,organization_id,notes) VALUES(eid,true,oid,'test');
 UPDATE public.event_partner_arrangements SET order_reference='TEST/1' WHERE event_id=eid;
 IF NOT EXISTS(SELECT 1 FROM public.event_partner_arrangements WHERE event_id=eid AND order_reference='TEST/1') THEN RAISE EXCEPTION 'Save failed'; END IF;
 BEGIN UPDATE public.event_partner_arrangements SET organization_id=NULL WHERE event_id=eid; RAISE EXCEPTION 'TEST missing partner allowed'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 UPDATE public.event_partner_arrangements SET notes='unauthorized' WHERE event_id=eid;
 SET LOCAL ROLE postgres;
 IF EXISTS(SELECT 1 FROM public.event_partner_arrangements WHERE event_id=eid AND notes='unauthorized') THEN RAISE EXCEPTION 'Access bypass'; END IF;
END $$;
SELECT 'PASS: partner create/edit, required partner and permission checks';
ROLLBACK;
