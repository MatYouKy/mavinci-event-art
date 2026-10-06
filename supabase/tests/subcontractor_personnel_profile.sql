BEGIN;

DO $$ DECLARE actor uuid; saved jsonb; sid uuid; BEGIN
 SELECT coalesce(auth_user_id,id) INTO actor FROM public.employees WHERE is_active AND (role::text='admin' OR access_level::text='admin' OR 'admin'=ANY(coalesce(permissions,'{}'))) LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'No test actor available'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 saved:=public.save_subcontractor_personnel_profile(NULL,'{"company_name":"__test_personnel_profile","default_settlement_type":"civil_contract"}','','Testowy adres','');
 sid:=(saved->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM personnel_people WHERE subcontractor_id=sid AND address='Testowy adres' AND identifier IS NULL) THEN RAISE EXCEPTION 'Private profile not saved'; END IF;
 PERFORM public.save_subcontractor_personnel_profile(sid,'{"company_name":"__test_personnel_profile","default_settlement_type":"civil_contract","personnel_address_parts":{"type":"street","name":"Testowa","house":"1","city":"Olsztyn"}}','44051401458','Inny adres','61109010140000071219812874');
 IF (SELECT count(*) FROM personnel_people WHERE subcontractor_id=sid)<>1 THEN RAISE EXCEPTION 'Duplicate private profile'; END IF;
 IF NOT EXISTS(SELECT 1 FROM personnel_people WHERE subcontractor_id=sid AND address='Inny adres' AND address_parts->>'house'='1' AND bank_account='61109010140000071219812874') THEN RAISE EXCEPTION 'Update failed'; END IF;
 IF EXISTS(SELECT 1 FROM subcontractors WHERE id=sid AND (address IS NOT NULL OR bank_account IS NOT NULL)) THEN RAISE EXCEPTION 'Private data copied to public profile'; END IF;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN PERFORM public.save_subcontractor_personnel_profile(sid,'{}','','',''); RAISE EXCEPTION 'TEST: allowed without permission'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'PASS: atomic create/edit, private storage, partial data and permissions';
ROLLBACK;
