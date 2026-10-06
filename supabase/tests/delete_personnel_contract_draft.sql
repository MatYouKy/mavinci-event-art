BEGIN;
DO $$ DECLARE cid uuid; stamp timestamptz; actor uuid; BEGIN
 SELECT coalesce(auth_user_id,id) INTO actor FROM public.employees WHERE is_active AND (role::text='admin' OR access_level::text='admin' OR 'admin'=ANY(coalesce(permissions,'{}'))) LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'No test actor'; END IF;
 INSERT INTO public.personnel_contracts(contract_kind,contract_number,title,status,contract_term,party_name,engagement_scope,settlement_cycle)
 VALUES('specific_work','','Test usuwania','draft','fixed','','event','on_completion') RETURNING id,updated_at INTO cid,stamp;
 SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN
 PERFORM public.delete_personnel_contract_draft(cid,stamp);
 RAISE EXCEPTION 'TEST unauthorized delete';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 BEGIN
 PERFORM public.delete_personnel_contract_draft(cid,stamp-interval '1 second');
 RAISE EXCEPTION 'TEST stale delete';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='TEST stale delete' THEN RAISE; END IF; END;
 PERFORM public.delete_personnel_contract_draft(cid,stamp);
 IF EXISTS(SELECT 1 FROM public.personnel_contracts WHERE id=cid) THEN RAISE EXCEPTION 'Draft still exists'; END IF;
 RESET ROLE;
END $$;
SELECT 'PASS: authenticated draft deletion, stale data and permission protection';
ROLLBACK;
