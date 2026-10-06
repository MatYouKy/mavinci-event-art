BEGIN;
-- Reuse existing settlement columns and personnel contracts; no identity data is copied into CRM profiles.
CREATE FUNCTION public.guard_subcontractor_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tax_id text; checksum integer; i integer; weights integer[]:=ARRAY[6,5,7,2,3,4,5,6,7];
BEGIN
 IF TG_OP='INSERT' OR NEW.default_settlement_type IS DISTINCT FROM OLD.default_settlement_type OR NEW.nip IS DISTINCT FROM OLD.nip THEN
   IF NEW.default_settlement_type IN ('invoice_vat','invoice_no_vat') THEN
     tax_id:=regexp_replace(coalesce(NEW.nip,''),'[[:space:]-]','','g');
     IF tax_id !~ '^[0-9]{10}$' OR tax_id ~ '^([0-9])\1{9}$' THEN RAISE EXCEPTION 'Do rozliczenia fakturą podaj prawidłowy NIP.' USING ERRCODE='23514'; END IF;
     checksum:=0;
     FOR i IN 1..9 LOOP checksum:=checksum+weights[i]*substring(tax_id,i,1)::integer; END LOOP;
     IF checksum%11<>substring(tax_id,10,1)::integer THEN RAISE EXCEPTION 'NIP ma nieprawidłową sumę kontrolną.' USING ERRCODE='23514'; END IF;
     NEW.nip:=tax_id;
   END IF;
 END IF;
 IF NEW.default_settlement_type='civil_contract' THEN
   NEW.requires_contract:=true;
   NEW.entity_type:='individual';
   IF NOT EXISTS(SELECT 1 FROM personnel_contracts WHERE subcontractor_id=NEW.id AND contract_kind='mandate' AND status='active') THEN
     IF TG_OP='INSERT' OR NEW.default_settlement_type IS DISTINCT FROM OLD.default_settlement_type THEN NEW.status:='inactive';
     ELSIF NEW.status='active' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Najpierw uzupełnij i zatwierdź umowę zlecenia.' USING ERRCODE='23514'; END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_subcontractor_profile BEFORE INSERT OR UPDATE ON public.subcontractors FOR EACH ROW EXECUTE FUNCTION public.guard_subcontractor_profile();
CREATE FUNCTION public.activate_subcontractor_after_mandate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.contract_kind='mandate' AND NEW.status='active' AND NEW.subcontractor_id IS NOT NULL THEN
   UPDATE subcontractors SET status='active' WHERE id=NEW.subcontractor_id AND default_settlement_type='civil_contract' AND status='inactive';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER activate_subcontractor_after_mandate AFTER INSERT OR UPDATE OF status ON public.personnel_contracts FOR EACH ROW EXECUTE FUNCTION public.activate_subcontractor_after_mandate();
CREATE OR REPLACE FUNCTION public.personnel_picker_subcontractors()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company_name',company_name) ORDER BY company_name),'[]') FROM public.subcontractors WHERE public.personnel_can_access() AND (status<>'inactive' OR default_settlement_type='civil_contract');
$$;
REVOKE ALL ON FUNCTION public.guard_subcontractor_profile(), public.activate_subcontractor_after_mandate() FROM PUBLIC;
NOTIFY pgrst,'reload schema';
COMMIT;
