BEGIN;
DO $$ DECLARE actor uuid; pid uuid; sid uuid; cid uuid; stamp timestamptz; BEGIN
 SELECT coalesce(auth_user_id,id) INTO actor FROM public.employees WHERE is_active AND (role::text='admin' OR access_level::text='admin' OR 'admin'=ANY(coalesce(permissions,'{}'))) LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'No actor'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 SET LOCAL ROLE authenticated;
 INSERT INTO public.personnel_people(name,surname) VALUES('__test','collaborator') RETURNING id INTO pid;
 INSERT INTO public.personnel_services(person_id,name,price,billing_unit) VALUES(pid,'DJ',100,'hour') RETURNING id INTO sid;
 UPDATE public.personnel_services SET overtime_hourly_rate=120 WHERE id=sid;
 IF NOT EXISTS(SELECT 1 FROM public.personnel_services WHERE id=sid AND overtime_hourly_rate=120) THEN RAISE EXCEPTION 'Service not saved'; END IF;
 BEGIN INSERT INTO public.personnel_services(person_id,name,price) VALUES(pid,'invalid',-1); RAISE EXCEPTION 'TEST negative accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN PERFORM public.delete_personnel_collaborator(pid); RAISE EXCEPTION 'TEST no access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 INSERT INTO public.personnel_contracts(contract_kind,contract_number,title,status,contract_term,party_name,person_id,engagement_scope,settlement_cycle)
 VALUES('mandate','','Test history','draft','fixed','Test',pid,'event','on_completion') RETURNING id,updated_at INTO cid,stamp;
 BEGIN PERFORM public.delete_personnel_collaborator(pid); RAISE EXCEPTION 'TEST history deleted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='TEST history deleted' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT 1 FROM public.personnel_people WHERE id=pid) THEN RAISE EXCEPTION 'History lost'; END IF;
 PERFORM public.delete_personnel_contract_draft(cid,stamp);
 PERFORM public.delete_personnel_collaborator(pid);
 IF EXISTS(SELECT 1 FROM public.personnel_people WHERE id=pid) OR EXISTS(SELECT 1 FROM public.personnel_services WHERE id=sid) THEN RAISE EXCEPTION 'Delete failed'; END IF;
 RESET ROLE;
END $$;
SELECT 'PASS: authenticated service CRUD, validation, collaborator deletion and access';
ROLLBACK;

