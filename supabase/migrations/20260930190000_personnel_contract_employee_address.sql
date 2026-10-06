BEGIN;

-- A contract and the linked employee address must be saved atomically.
-- SECURITY INVOKER deliberately retains existing employee update permissions.
CREATE OR REPLACE FUNCTION public.sync_contract_employee_address()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE parts jsonb; employee uuid; person_employee uuid; street text; prefix text;
BEGIN
 parts:=NEW.document_details->'party_address_parts';
 IF jsonb_typeof(parts) IS DISTINCT FROM 'object' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
   IF parts IS NOT DISTINCT FROM OLD.document_details->'party_address_parts'
      AND NEW.employee_id IS NOT DISTINCT FROM OLD.employee_id AND NEW.person_id IS NOT DISTINCT FROM OLD.person_id THEN RETURN NEW; END IF;
 END IF;
 -- Incomplete drafts must not erase a complete employee profile.
 IF EXISTS (SELECT 1 FROM unnest(ARRAY['name','house','city','postal_code','country']) key
            WHERE nullif(btrim(parts->>key),'') IS NULL) THEN RETURN NEW; END IF;
 IF NEW.person_id IS NOT NULL THEN SELECT employee_id INTO person_employee FROM public.personnel_people WHERE id=NEW.person_id; END IF;
 IF NEW.employee_id IS NOT NULL AND person_employee IS NOT NULL AND NEW.employee_id<>person_employee THEN
   RAISE EXCEPTION 'Powiązanie osoby z pracownikiem jest niezgodne';
 END IF;
 employee:=coalesce(NEW.employee_id,person_employee);
 IF employee IS NULL THEN RETURN NEW; END IF;
 prefix:=CASE parts->>'type' WHEN 'street' THEN 'ul.' WHEN 'avenue' THEN 'al.' WHEN 'square' THEN 'pl.' WHEN 'estate' THEN 'os.' ELSE NULL END;
 street:=concat_ws(' ',prefix,btrim(parts->>'name'),btrim(parts->>'house')||CASE WHEN nullif(btrim(parts->>'apartment'),'') IS NOT NULL THEN '/'||btrim(parts->>'apartment') ELSE '' END);
 UPDATE public.employees SET address_street=street,address_city=btrim(parts->>'city'),address_postal_code=btrim(parts->>'postal_code'),updated_at=now() WHERE id=employee;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie zapisano umowy: brak uprawnień do aktualizacji adresu pracownika'; END IF;
 UPDATE public.personnel_people SET address=NEW.party_address,address_parts=parts WHERE employee_id=employee;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_contract_employee_address() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_contract_employee_address AFTER INSERT OR UPDATE OF document_details,employee_id,person_id ON public.personnel_contracts
 FOR EACH ROW EXECUTE FUNCTION public.sync_contract_employee_address();

NOTIFY pgrst, 'reload schema';
COMMIT;
