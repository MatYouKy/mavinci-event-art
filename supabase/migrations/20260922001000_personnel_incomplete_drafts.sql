BEGIN;
ALTER TABLE public.personnel_contracts DROP CONSTRAINT personnel_contracts_term_period_check;
ALTER TABLE public.personnel_contracts ADD CONSTRAINT personnel_contracts_term_period_check CHECK (
 (status='draft' AND (contract_term IS NULL OR contract_term IN ('fixed','indefinite')) AND (start_date IS NULL OR end_date IS NULL OR end_date>=start_date))
 OR (status<>'draft' AND contract_term IN ('fixed','indefinite') AND contract_term IS NOT NULL AND start_date IS NOT NULL AND (end_date IS NULL OR end_date>=start_date) AND (contract_term<>'fixed' OR end_date IS NOT NULL) AND (status NOT IN ('completed','terminated') OR end_date IS NOT NULL))
) NOT VALID;
CREATE OR REPLACE FUNCTION public.personnel_contract_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prefix text; number_year integer; next_number bigint; candidate text;
BEGIN
 -- Drafts have a provisional identifier; legal numbering is assigned on completion.
 IF TG_OP='UPDATE' AND (NEW.contract_number IS DISTINCT FROM OLD.contract_number OR NEW.number_managed IS DISTINCT FROM OLD.number_managed) THEN RAISE EXCEPTION 'Numer umowy jest chroniony przez system'; END IF;
 IF NEW.status='draft' THEN
  IF TG_OP='INSERT' THEN NEW.contract_number:='SZKIC/'||NEW.id::text; NEW.number_managed:=false; END IF;
  RETURN NEW;
 END IF;
 IF NEW.my_company_id IS NULL OR NEW.signed_date IS NULL THEN RAISE EXCEPTION 'Wybierz działalność i datę zawarcia do numeracji umowy'; END IF;
 IF TG_OP='INSERT' OR NOT NEW.number_managed OR (OLD.status='draft' AND (NEW.my_company_id IS DISTINCT FROM OLD.my_company_id OR NEW.contract_kind IS DISTINCT FROM OLD.contract_kind OR extract(year FROM NEW.signed_date) IS DISTINCT FROM extract(year FROM OLD.signed_date))) THEN
  prefix:=CASE NEW.contract_kind WHEN 'employment' THEN 'UOP' WHEN 'mandate' THEN 'UZ' WHEN 'specific_work' THEN 'UOD' END;
  number_year:=extract(year FROM NEW.signed_date);
  LOOP
   INSERT INTO public.personnel_number_counters(company_id,kind,year,last_number) VALUES(NEW.my_company_id,NEW.contract_kind,number_year,1)
   ON CONFLICT(company_id,kind,year) DO UPDATE SET last_number=personnel_number_counters.last_number+1 RETURNING last_number INTO next_number;
   candidate:=prefix||'/'||number_year||'/'||lpad(next_number::text,greatest(4,length(next_number::text)),'0');
   EXIT WHEN NOT EXISTS(SELECT 1 FROM public.personnel_contracts WHERE my_company_id=NEW.my_company_id AND lower(contract_number)=lower(candidate));
  END LOOP;
  NEW.contract_number:=candidate; NEW.number_managed:=true;
 ELSIF TG_OP='UPDATE' AND OLD.number_managed AND (NEW.my_company_id IS DISTINCT FROM OLD.my_company_id OR NEW.contract_kind<>OLD.contract_kind OR extract(year FROM NEW.signed_date) IS DISTINCT FROM extract(year FROM OLD.signed_date)) THEN RAISE EXCEPTION 'Działalność, rodzaj i rok należą do numeru umowy. Utwórz nową umowę dla innej serii.';
 END IF;
 IF NEW.contract_kind='employment' AND NEW.party_kind IS DISTINCT FROM 'person' THEN RAISE EXCEPTION 'Stroną umowy o pracę musi być osoba'; END IF;
 IF NEW.contract_kind='employment' AND NEW.payment_method='cash' AND coalesce(NEW.payroll_profile->>'cash_requested','false')<>'true' THEN RAISE EXCEPTION 'Gotówka przy etacie wymaga wniosku pracownika o wypłatę do rąk własnych'; END IF;
 IF nullif(NEW.payroll_profile->>'birth_date','')::date>current_date THEN RAISE EXCEPTION 'Data urodzenia nie może być w przyszłości'; END IF;
 IF nullif(NEW.payroll_profile->>'education_to','')::date<nullif(NEW.payroll_profile->>'education_from','')::date THEN RAISE EXCEPTION 'Sprawdź daty statusu edukacji'; END IF;
 IF TG_OP='UPDATE' AND NEW.event_id IS DISTINCT FROM OLD.event_id AND EXISTS(SELECT 1 FROM public.personnel_work_items WHERE contract_id=OLD.id) THEN RAISE EXCEPTION 'Nie zmieniaj realizacji umowy z zarejestrowaną pracą'; END IF;
 IF NEW.engagement_scope='event' AND (NEW.event_id IS NULL OR NEW.contract_term<>'fixed') THEN RAISE EXCEPTION 'Jedna realizacja wymaga wydarzenia i określonego okresu'; END IF;
 IF NEW.engagement_scope='period' AND NEW.event_id IS NOT NULL THEN RAISE EXCEPTION 'Dla współpracy okresowej pozostaw wydarzenie puste'; END IF;
 IF NEW.subcontractor_task_id IS NOT NULL AND NEW.event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.subcontractor_tasks WHERE id=NEW.subcontractor_task_id AND event_id=NEW.event_id) THEN RAISE EXCEPTION 'Realizacja musi odpowiadać zleceniu podwykonawcy'; END IF;
 IF NEW.agreement_form='oral' AND (NEW.contract_kind='employment' OR coalesce(NEW.payroll_profile->>'oral_confirmed','false')<>'true') THEN RAISE EXCEPTION 'Dla ustaleń ustnych potwierdź dopuszczalność tej formy. Umowa o pracę wymaga pisemnego potwierdzenia.'; END IF;
 IF NEW.settlement_cycle='on_completion' AND (NEW.end_date IS NULL OR date_trunc('month',NEW.start_date)<>date_trunc('month',NEW.end_date)) THEN RAISE EXCEPTION 'Pracę na przełomie miesięcy rozliczaj miesięcznie, również przy jednej realizacji'; END IF;
 IF NEW.contract_kind='employment' AND NEW.settlement_cycle<>'monthly' THEN RAISE EXCEPTION 'Umowę o pracę rozliczaj miesięcznie'; END IF;
 IF NEW.contract_kind='mandate' AND (NEW.end_date IS NULL OR NEW.end_date>NEW.start_date+interval '1 month') AND NEW.settlement_cycle<>'monthly' THEN RAISE EXCEPTION 'Zlecenie dłuższe niż miesiąc wymaga wypłat co najmniej raz w miesiącu'; END IF;
 RETURN NEW;
END; $$;
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
 IF NEW.status<>'draft' AND NEW.contract_kind='mandate' AND NEW.party_kind IS DISTINCT FROM 'person' THEN RAISE EXCEPTION 'Wskaż osobę będącą stroną umowy zlecenia'; END IF;
 RETURN NEW;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
