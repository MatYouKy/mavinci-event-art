-- Transactional regression test: all sample profiles are rolled back.
BEGIN;
DO $$ DECLARE sid uuid; BEGIN
 BEGIN
 INSERT INTO subcontractors(company_name,default_settlement_type,nip) VALUES ('__test_invoice','invoice_vat',null);
 RAISE EXCEPTION 'TEST: missing NIP accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
 INSERT INTO subcontractors(company_name,default_settlement_type,nip) VALUES ('__test_invoice','invoice_vat','0000000000');
 RAISE EXCEPTION 'TEST: invalid NIP accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO subcontractors(company_name,default_settlement_type) VALUES ('__test_cash','cash');
 INSERT INTO subcontractors(company_name,default_settlement_type,nip) VALUES ('__test_invoice','invoice_vat','5260250274');
 INSERT INTO subcontractors(company_name,default_settlement_type,status) VALUES ('__test_mandate','civil_contract','active') RETURNING id INTO sid;
 IF NOT EXISTS(SELECT 1 FROM subcontractors WHERE id=sid AND status='inactive' AND requires_contract) THEN RAISE EXCEPTION 'TEST: mandate not pending'; END IF;
 BEGIN
 UPDATE subcontractors SET status='active' WHERE id=sid;
 RAISE EXCEPTION 'TEST: incomplete mandate activated';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'subcontractor guards passed';
ROLLBACK;
