BEGIN;
ALTER TABLE public.personnel_people ADD COLUMN IF NOT EXISTS address_parts jsonb;

CREATE OR REPLACE FUNCTION public.save_subcontractor_personnel_profile(p_id uuid,p_profile jsonb,p_identifier text,p_address text,p_bank_account text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE saved public.subcontractors; input public.subcontractors;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do danych umów i wynagrodzeń.' USING ERRCODE='42501'; END IF;
 input:=jsonb_populate_record(NULL::public.subcontractors,p_profile);
 IF input.default_settlement_type IS DISTINCT FROM 'civil_contract' THEN RAISE EXCEPTION 'Wybierz rozliczenie umową zlecenia.'; END IF;
 IF nullif(btrim(input.company_name),'') IS NULL THEN RAISE EXCEPTION 'Podaj imię i nazwisko podwykonawcy.'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.subcontractors(company_name,email,phone,default_settlement_type,entity_type,is_registered_business,preferred_payment_method,requires_contract,notes,status)
  VALUES(input.company_name,input.email,input.phone,'civil_contract','individual',false,'transfer',true,input.notes,'inactive') RETURNING * INTO saved;
 ELSE
  UPDATE public.subcontractors SET company_name=input.company_name,email=input.email,phone=input.phone,default_settlement_type='civil_contract',entity_type='individual',is_registered_business=false,preferred_payment_method='transfer',requires_contract=true,notes=input.notes
  WHERE id=p_id RETURNING * INTO saved;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono podwykonawcy lub brak prawa zapisu.'; END IF;
 END IF;
 INSERT INTO public.personnel_people(subcontractor_id,name,identifier,address,bank_account,address_parts)
 VALUES(saved.id,saved.company_name,nullif(btrim(p_identifier),''),nullif(btrim(p_address),''),nullif(btrim(p_bank_account),''),nullif(p_profile->'personnel_address_parts','null'::jsonb))
 ON CONFLICT(subcontractor_id) DO UPDATE SET identifier=EXCLUDED.identifier,address=EXCLUDED.address,bank_account=EXCLUDED.bank_account,address_parts=EXCLUDED.address_parts;
 RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.save_subcontractor_personnel_profile(uuid,jsonb,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_subcontractor_personnel_profile(uuid,jsonb,text,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
