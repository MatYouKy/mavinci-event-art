BEGIN;
DO $$ DECLARE cid uuid; identifier text; BEGIN
 INSERT INTO public.personnel_contracts(contract_kind,contract_number,title,status,contract_term,start_date,end_date,signed_date,party_name,party_kind,engagement_scope,settlement_cycle)
 VALUES('mandate','','Szkic regresyjny','draft','fixed',NULL,NULL,NULL,'',NULL,'event','on_completion') RETURNING id,contract_number INTO cid,identifier;
 IF identifier NOT LIKE 'SZKIC/%' THEN RAISE EXCEPTION 'Missing draft identifier'; END IF;
 UPDATE public.personnel_contracts SET notes='Drugi zapis',end_date='2026-12-01' WHERE id=cid;
 UPDATE public.personnel_contracts SET start_date='2026-11-01',end_date=NULL WHERE id=cid;
 IF NOT EXISTS(SELECT 1 FROM public.personnel_contracts WHERE id=cid AND start_date='2026-11-01' AND end_date IS NULL AND status='draft') THEN RAISE EXCEPTION 'Draft data lost'; END IF;
 BEGIN
 UPDATE public.personnel_contracts SET status='active' WHERE id=cid;
 RAISE EXCEPTION 'TEST: incomplete draft activated';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='TEST: incomplete draft activated' THEN RAISE; END IF; END;
 UPDATE public.personnel_contracts SET start_date=NULL WHERE id=cid;
 IF NOT EXISTS(SELECT 1 FROM public.personnel_contracts WHERE id=cid AND status='draft' AND signed_date IS NULL AND start_date IS NULL) THEN RAISE EXCEPTION 'Draft not preserved'; END IF;
END $$;
SELECT 'PASS: empty dates, partial dates, repeated save and activation guard';
ROLLBACK;
