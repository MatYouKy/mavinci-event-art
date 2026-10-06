BEGIN;
ALTER TABLE public.personnel_contracts
 ADD COLUMN planned_net_amount numeric(14,2) CHECK (planned_net_amount > 0 AND planned_net_amount <= 1000000),
 ADD COLUMN net_cost_settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(net_cost_settings) = 'object');
COMMENT ON COLUMN public.personnel_contracts.planned_net_amount IS 'Informacyjny plan netto; jednostkę określa net_cost_settings.basis. Nie jest zatwierdzonym rozliczeniem ani wartością brutto umowy.';
COMMENT ON COLUMN public.personnel_contracts.net_cost_settings IS 'Założenia symulacji netto/PIT/ZUS/CIT. Bez automatycznego tworzenia zobowiązań. Warunki wynagrodzenia zatwierdza się osobno jako stawkę.';
CREATE OR REPLACE FUNCTION public.guard_personnel_contract()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.personnel_people;
BEGIN
 IF TG_OP='UPDATE' AND (EXISTS(SELECT 1 FROM public.personnel_contract_documents WHERE contract_id=OLD.id) OR EXISTS(SELECT 1 FROM public.personnel_settlements WHERE contract_id=OLD.id))
 AND (to_jsonb(NEW)-ARRAY['status','notes','updated_at','employee_id','person_id','end_date','payroll_profile','planned_net_amount','net_cost_settings']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','notes','updated_at','employee_id','person_id','end_date','payroll_profile','planned_net_amount','net_cost_settings']) THEN RAISE EXCEPTION 'Utrwalona umowa zachowuje treść i warunki. Zmianę zapisz jako nową umowę lub aneks.'; END IF;
 IF TG_OP='UPDATE' AND NEW.end_date IS DISTINCT FROM OLD.end_date AND EXISTS(SELECT 1 FROM public.personnel_contract_documents WHERE contract_id=OLD.id) THEN
  IF OLD.contract_term<>'indefinite' OR OLD.end_date IS NOT NULL OR NEW.end_date IS NULL OR EXISTS(SELECT 1 FROM public.personnel_work_items WHERE contract_id=OLD.id AND work_date>NEW.end_date) THEN RAISE EXCEPTION 'Możesz zakończyć umowę bezterminową po ostatnim dniu zarejestrowanej pracy'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.status='draft' AND OLD.status<>'draft' AND (EXISTS(SELECT 1 FROM public.personnel_work_items WHERE contract_id=OLD.id) OR EXISTS(SELECT 1 FROM public.personnel_settlements WHERE contract_id=OLD.id)) THEN RAISE EXCEPTION 'Umowa z zarejestrowaną pracą nie może wrócić do szkicu'; END IF;
 IF NEW.subcontractor_task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.subcontractor_tasks st WHERE st.id=NEW.subcontractor_task_id AND st.subcontractor_id=NEW.subcontractor_id) THEN RAISE EXCEPTION 'Zlecenie musi należeć do wybranego podwykonawcy'; END IF;
 IF NEW.person_id IS NULL AND NEW.employee_id IS NOT NULL THEN SELECT * INTO p FROM public.personnel_people WHERE employee_id=NEW.employee_id; NEW.person_id:=p.id; END IF;
 IF NEW.person_id IS NOT NULL THEN
  SELECT * INTO p FROM public.personnel_people WHERE id=NEW.person_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono osoby'; END IF;
  NEW.employee_id:=p.employee_id;
  NEW.subcontractor_id:=NULL;
  NEW.party_kind:='person';
 END IF;
 IF TG_OP='INSERT' AND NEW.contract_kind='mandate' AND NEW.party_kind IS DISTINCT FROM 'person' THEN RAISE EXCEPTION 'Wskaż osobę będącą stroną umowy zlecenia'; END IF;
 RETURN NEW;
END; $$;
COMMIT;
