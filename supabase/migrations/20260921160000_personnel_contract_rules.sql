BEGIN;
-- Numeracja jest rezerwowana w tej samej transakcji co umowa.
CREATE TABLE public.personnel_number_counters (
 company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE RESTRICT,
 kind text NOT NULL, year integer NOT NULL, last_number bigint NOT NULL,
 PRIMARY KEY(company_id,kind,year)
);
ALTER TABLE public.personnel_number_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personnel_number_counters FROM PUBLIC,anon,authenticated;
ALTER TABLE public.personnel_contracts
 ADD COLUMN number_managed boolean NOT NULL DEFAULT false,
 ADD COLUMN agreement_form text NOT NULL DEFAULT 'written' CHECK(agreement_form IN ('written','oral')),
 ADD COLUMN payment_method text NOT NULL DEFAULT 'bank' CHECK(payment_method IN ('bank','cash')),
 ADD COLUMN engagement_scope text NOT NULL DEFAULT 'period' CHECK(engagement_scope IN ('period','event')),
 ADD COLUMN event_id uuid REFERENCES public.events(id) ON DELETE RESTRICT,
 ADD COLUMN settlement_cycle text NOT NULL DEFAULT 'monthly' CHECK(settlement_cycle IN ('monthly','on_completion')),
 ADD COLUMN payroll_profile jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(payroll_profile)='object');
CREATE OR REPLACE FUNCTION public.personnel_contract_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prefix text; number_year integer; next_number bigint; candidate text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.my_company_id IS NULL OR NEW.signed_date IS NULL THEN RAISE EXCEPTION 'Wybierz działalność i datę zawarcia do numeracji umowy'; END IF;
  prefix:=CASE NEW.contract_kind WHEN 'employment' THEN 'UOP' WHEN 'mandate' THEN 'UZ' WHEN 'specific_work' THEN 'UOD' END;
  number_year:=extract(year FROM NEW.signed_date);
  LOOP
   INSERT INTO public.personnel_number_counters(company_id,kind,year,last_number) VALUES(NEW.my_company_id,NEW.contract_kind,number_year,1)
   ON CONFLICT(company_id,kind,year) DO UPDATE SET last_number=personnel_number_counters.last_number+1 RETURNING last_number INTO next_number;
   candidate:=prefix||'/'||number_year||'/'||lpad(next_number::text,greatest(4,length(next_number::text)),'0');
   EXIT WHEN NOT EXISTS(SELECT 1 FROM public.personnel_contracts WHERE my_company_id=NEW.my_company_id AND lower(contract_number)=lower(candidate));
  END LOOP;
  NEW.contract_number:=candidate; NEW.number_managed:=true;
 ELSE
  IF NEW.contract_number IS DISTINCT FROM OLD.contract_number OR NEW.number_managed<>OLD.number_managed THEN RAISE EXCEPTION 'Numer umowy jest chroniony przez system'; END IF;
  IF OLD.number_managed AND (NEW.my_company_id IS DISTINCT FROM OLD.my_company_id OR NEW.contract_kind<>OLD.contract_kind OR extract(year FROM NEW.signed_date) IS DISTINCT FROM extract(year FROM OLD.signed_date)) THEN RAISE EXCEPTION 'Działalność, rodzaj i rok należą do numeru umowy. Utwórz nową umowę dla innej serii.'; END IF;
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
CREATE TRIGGER a_personnel_contract_rules BEFORE INSERT OR UPDATE ON public.personnel_contracts FOR EACH ROW EXECUTE FUNCTION public.personnel_contract_rules();
REVOKE ALL ON FUNCTION public.personnel_contract_rules() FROM PUBLIC,anon,authenticated;

-- Stawki mają okres obowiązywania; nie ekstrapolujemy ich na kolejne lata.
CREATE TABLE public.personnel_statutory_rates (
 year integer PRIMARY KEY, mandate_hourly numeric(8,2) NOT NULL, employment_monthly numeric(8,2) NOT NULL, source text NOT NULL
);
INSERT INTO public.personnel_statutory_rates VALUES
 (2025,30.50,4666,'https://eli.gov.pl/eli/DU/2024/1362/ogl'),
 (2026,31.40,4806,'https://eli.gov.pl/eli/DU/2025/1242/ogl'),
 (2027,32.30,4950,'https://eli.gov.pl/eli/DU/2026/1213/ogl');
ALTER TABLE public.personnel_statutory_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personnel_statutory_rates FROM PUBLIC,anon,authenticated;
CREATE POLICY personnel_statutory_read ON public.personnel_statutory_rates FOR SELECT TO authenticated USING(public.personnel_can_access() OR public.current_workflow_employee_id() IS NOT NULL);
GRANT SELECT ON public.personnel_statutory_rates TO authenticated;
ALTER TABLE public.personnel_contract_rates DROP CONSTRAINT personnel_contract_rates_pay_basis_check,
 ADD CONSTRAINT personnel_contract_rates_pay_basis_check CHECK(pay_basis IN ('hourly','monthly','fixed','piecework')),
 ADD COLUMN unit_label text;
ALTER TABLE public.personnel_work_entries ADD COLUMN quantity numeric(14,3) CHECK(quantity>0),
 DROP CONSTRAINT personnel_work_entries_minutes_check,
 ADD CONSTRAINT personnel_work_entries_minutes_check CHECK(minutes BETWEEN 0 AND 1440 AND (minutes>0 OR coalesce(quantity>0,false)));
ALTER TABLE public.personnel_settlements ADD COLUMN payroll_snapshot jsonb, ADD COLUMN gross_amount numeric(14,2), ADD COLUMN minimum_amount numeric(14,2);
ALTER TABLE public.personnel_contract_payments ADD COLUMN payment_method text NOT NULL DEFAULT 'bank' CHECK(payment_method IN ('bank','cash')),
 ADD COLUMN receipt_reference text;
CREATE OR REPLACE FUNCTION public.personnel_payment_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.payment_method='cash' AND (nullif(btrim(NEW.receipt_reference),'') IS NULL OR NEW.bank_transaction_id IS NOT NULL) THEN RAISE EXCEPTION 'Wypłata gotówką wymaga potwierdzenia odbioru i nie może być powiązana z przelewem'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER personnel_cash_payment BEFORE INSERT OR UPDATE ON public.personnel_contract_payments FOR EACH ROW EXECUTE FUNCTION public.personnel_payment_rules();
REVOKE ALL ON FUNCTION public.personnel_payment_rules() FROM PUBLIC,anon,authenticated;
DROP FUNCTION public.add_personnel_rate(uuid,date,date,text,text,numeric,numeric);
CREATE OR REPLACE FUNCTION public.add_personnel_rate(p_contract_id uuid,p_from date,p_to date,p_basis text,p_rate_basis text,p_rate numeric,p_company_cost numeric DEFAULT NULL,p_unit_label text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.personnel_contracts; result uuid; floor_rate numeric;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do wynagrodzeń'; END IF;
 SELECT * INTO c FROM public.personnel_contracts WHERE id=p_contract_id FOR UPDATE;
 IF NOT FOUND OR c.start_date IS NULL OR p_from<c.start_date OR (c.end_date IS NOT NULL AND (p_from>c.end_date OR p_to IS NULL OR p_to>c.end_date)) THEN RAISE EXCEPTION 'Stawka musi mieścić się w okresie umowy'; END IF;
 IF EXISTS(SELECT 1 FROM public.personnel_contract_documents WHERE contract_id=c.id) THEN RAISE EXCEPTION 'Umowa ma utrwalony dokument. Zmianę warunków zapisz jako nową umowę lub aneks w rejestrze.'; END IF;
 IF EXISTS(SELECT 1 FROM public.personnel_contract_rates WHERE contract_id=c.id AND daterange(valid_from,valid_to,'[]') && daterange(p_from,p_to,'[]')) THEN RAISE EXCEPTION 'Okresy stawek tej umowy nie mogą się nakładać'; END IF;
 IF p_basis='piecework' AND nullif(btrim(p_unit_label),'') IS NULL THEN RAISE EXCEPTION 'Nazwij jednostkę akordu, np. sztuka lub montaż'; END IF;
 IF c.contract_kind='mandate' AND p_basis='fixed' AND c.settlement_cycle='monthly' THEN RAISE EXCEPTION 'Zlecenie rozliczane miesięcznie wymaga stawki godzinowej, akordu lub kwoty miesięcznej'; END IF;
 IF c.contract_kind='mandate' AND p_basis='hourly' AND p_rate_basis='gross' AND c.currency='PLN' THEN
  SELECT max(mandate_hourly) INTO floor_rate FROM public.personnel_statutory_rates WHERE year BETWEEN extract(year FROM p_from) AND extract(year FROM coalesce(p_to,p_from));
  IF p_rate<floor_rate THEN RAISE EXCEPTION 'Stawka zlecenia w tym okresie musi wynosić co najmniej % zł brutto/godz.',floor_rate; END IF;
 END IF;
 INSERT INTO public.personnel_contract_rates(contract_id,valid_from,valid_to,pay_basis,rate_basis,rate,company_cost_rate,unit_label)
 VALUES(c.id,p_from,p_to,p_basis,p_rate_basis,p_rate,p_company_cost,CASE WHEN p_basis='piecework' THEN btrim(p_unit_label) END) RETURNING id INTO result;
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.guard_personnel_contract()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.personnel_people;
BEGIN
 IF TG_OP='UPDATE' AND (EXISTS(SELECT 1 FROM public.personnel_contract_documents WHERE contract_id=OLD.id) OR EXISTS(SELECT 1 FROM public.personnel_settlements WHERE contract_id=OLD.id))
 AND (to_jsonb(NEW)-ARRAY['status','notes','updated_at','employee_id','person_id','end_date','payroll_profile']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','notes','updated_at','employee_id','person_id','end_date','payroll_profile']) THEN RAISE EXCEPTION 'Utrwalona umowa zachowuje treść i warunki. Zmianę zapisz jako nową umowę lub aneks.'; END IF;
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
CREATE OR REPLACE FUNCTION public.guard_personnel_work()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.personnel_contracts; d date; old_d date; n integer; rate jsonb; old_contract uuid;
BEGIN
 IF TG_TABLE_NAME='time_entries' THEN
  IF TG_OP<>'INSERT' THEN old_contract:=OLD.personnel_contract_id; old_d:=(OLD.start_time AT TIME ZONE 'Europe/Warsaw')::date; END IF;
  IF TG_OP<>'DELETE' THEN
   d:=(NEW.start_time AT TIME ZONE 'Europe/Warsaw')::date;
   IF TG_OP='UPDATE' AND NEW.employee_id IS DISTINCT FROM OLD.employee_id AND NEW.personnel_contract_id IS NOT NULL THEN RAISE EXCEPTION 'Najpierw usuń powiązanie wpisu z umową'; END IF;
   IF NEW.personnel_contract_id IS NULL AND TG_OP='INSERT' THEN
    SELECT count(*),(array_agg(pc.id))[1] INTO n,NEW.personnel_contract_id FROM public.personnel_contracts pc
    LEFT JOIN public.personnel_people pp ON pp.id=pc.person_id
    WHERE coalesce(pp.employee_id,pc.employee_id)=NEW.employee_id AND public.personnel_rate_at(pc.id,d) IS NOT NULL AND (pc.event_id IS NULL OR pc.event_id=NEW.event_id);
    IF n>1 THEN RAISE EXCEPTION 'Kilka umów obejmuje tę datę. Wybierz umowę przy wpisie czasu.'; END IF;
   END IF;
   IF NEW.personnel_contract_id IS NOT NULL THEN
    SELECT * INTO c FROM public.personnel_contracts WHERE id=NEW.personnel_contract_id FOR UPDATE;
    IF NOT EXISTS(SELECT 1 FROM public.personnel_people p WHERE p.id=c.person_id AND p.employee_id=NEW.employee_id) AND c.employee_id IS DISTINCT FROM NEW.employee_id THEN RAISE EXCEPTION 'Umowa nie należy do pracownika'; END IF;
    IF NOT (public.personnel_can_access(true) OR public.personnel_owns_contract(c.id)) THEN RAISE EXCEPTION 'Brak dostępu do umowy'; END IF;
   END IF;
  END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN old_contract:=OLD.contract_id; old_d:=OLD.work_date; END IF;
  IF TG_OP<>'DELETE' THEN d:=NEW.work_date; SELECT * INTO c FROM public.personnel_contracts WHERE id=NEW.contract_id FOR UPDATE; END IF;
 END IF;
 IF old_contract IS NOT NULL THEN
  PERFORM 1 FROM public.personnel_contracts WHERE id=old_contract FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.personnel_settlements WHERE contract_id=old_contract AND period=date_trunc('month',old_d)::date) THEN RAISE EXCEPTION 'Wpis jest w zatwierdzonym rozliczeniu'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF c.id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.personnel_settlements WHERE contract_id=c.id AND period=date_trunc('month',d)::date) THEN RAISE EXCEPTION 'Ten miesiąc umowy został już rozliczony'; END IF;
  IF c.subcontractor_task_id IS NOT NULL AND (NEW.event_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.subcontractor_tasks st WHERE st.id=c.subcontractor_task_id AND st.event_id=NEW.event_id)) THEN RAISE EXCEPTION 'Wpis musi dotyczyć wydarzenia powiązanego zleceniem podwykonawcy'; END IF;
  IF c.event_id IS NOT NULL AND NEW.event_id IS DISTINCT FROM c.event_id THEN RAISE EXCEPTION 'Ta umowa dotyczy wyłącznie wskazanej realizacji'; END IF;
  rate:=public.personnel_rate_at(c.id,d);
  IF rate IS NULL THEN RAISE EXCEPTION 'Brak obowiązujących warunków umowy dla daty pracy'; END IF;
  IF TG_TABLE_NAME='time_entries' THEN
   -- A single item must not straddle a change of rate or accounting month.
   IF NEW.end_time IS NOT NULL AND (date_trunc('month',(NEW.end_time-interval '1 microsecond') AT TIME ZONE 'Europe/Warsaw')::date<>date_trunc('month',d)::date OR public.personnel_rate_at(c.id,((NEW.end_time-interval '1 microsecond') AT TIME ZONE 'Europe/Warsaw')::date)->>'id' IS DISTINCT FROM rate->>'id') THEN RAISE EXCEPTION 'Podziel wpis na granicy miesiąca lub zmiany stawki'; END IF;
   IF TG_OP='UPDATE' AND NEW.personnel_contract_id=OLD.personnel_contract_id AND d=old_d AND OLD.personnel_rate_snapshot IS NOT NULL THEN rate:=OLD.personnel_rate_snapshot; END IF;
   NEW.personnel_rate_snapshot:=rate;
   NEW.hourly_rate:=CASE WHEN rate->>'pay_basis'='hourly' THEN (rate->>'rate')::numeric ELSE NULL END;
  ELSE
   IF coalesce((SELECT sum(minutes) FROM public.personnel_work_entries WHERE contract_id=c.id AND work_date=d),0)+NEW.minutes>1440 THEN RAISE EXCEPTION 'Suma wpisów tej umowy przekracza 24 godziny w dniu'; END IF;
   IF NEW.quantity IS NOT NULL AND rate->>'pay_basis'<>'piecework' THEN RAISE EXCEPTION 'Jednostki akordu wymagają stawki akordowej'; END IF;
   NEW.rate_snapshot:=rate;
  END IF;
 ELSIF TG_TABLE_NAME='time_entries' THEN NEW.personnel_rate_snapshot:=NULL;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE VIEW public.personnel_work_items WITH (security_invoker=true) AS
 SELECT id,'crm'::text AS source,personnel_contract_id AS contract_id,event_id,(start_time AT TIME ZONE 'Europe/Warsaw')::date AS work_date,
 duration_minutes AS minutes,coalesce(title,description,'Praca') AS description,personnel_rate_snapshot AS rate_snapshot,NULL::numeric AS quantity
 FROM public.time_entries WHERE personnel_contract_id IS NOT NULL AND end_time IS NOT NULL
 UNION ALL SELECT id,'external',contract_id,event_id,work_date,minutes,description,rate_snapshot,quantity FROM public.personnel_work_entries;
CREATE OR REPLACE FUNCTION public.generate_personnel_document(p_contract uuid,p_template uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.personnel_contracts; t public.personnel_contract_templates; company public.my_companies; body text; vals jsonb; k text; v text; rates jsonb; result uuid; ver integer; pay_text text;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do generowania umów'; END IF;
 SELECT * INTO c FROM public.personnel_contracts WHERE id=p_contract FOR UPDATE;
 SELECT * INTO t FROM public.personnel_contract_templates WHERE id=p_template AND is_active;
 SELECT * INTO company FROM public.my_companies WHERE id=c.my_company_id;
 IF c.id IS NULL OR t.id IS NULL OR t.contract_kind<>c.contract_kind OR company.id IS NULL THEN RAISE EXCEPTION 'Wybierz działalność i szablon zgodny z rodzajem umowy'; END IF;
 IF c.signed_date IS NULL OR nullif(btrim(c.party_address),'') IS NULL OR nullif(btrim(c.work_scope),'') IS NULL OR nullif(btrim(c.payment_terms),'') IS NULL OR nullif(btrim(c.issuer_representative),'') IS NULL THEN RAISE EXCEPTION 'Uzupełnij datę zawarcia, adres, reprezentację, zakres zlecenia i warunki płatności'; END IF;
 IF c.contract_kind='mandate' AND c.party_kind IS DISTINCT FROM 'person' THEN RAISE EXCEPTION 'Umowa zlecenie wymaga wskazania osoby'; END IF;
 SELECT jsonb_agg(to_jsonb(r) ORDER BY valid_from),string_agg(
 to_char(valid_from,'DD.MM.YYYY')||' – '||coalesce(to_char(valid_to,'DD.MM.YYYY'),'bezterminowo')||': '||rate||' '||c.currency||CASE rate_basis WHEN 'gross' THEN ' brutto' ELSE ' netto' END||CASE pay_basis WHEN 'hourly' THEN ' / godz.' WHEN 'monthly' THEN ' / miesiąc' WHEN 'piecework' THEN ' / '||unit_label ELSE ' za całe zlecenie' END,E'\n' ORDER BY valid_from)
 INTO rates,pay_text FROM public.personnel_contract_rates r WHERE contract_id=c.id;
 IF rates IS NULL THEN RAISE EXCEPTION 'Dodaj warunki wynagrodzenia'; END IF;
 vals:=jsonb_build_object('numer',c.contract_number,'data_zawarcia',to_char(c.signed_date,'DD.MM.YYYY'),'zleceniodawca',company.legal_name,'adres_zleceniodawcy',concat_ws(', ',concat_ws(' ',company.street,company.building_number || CASE WHEN nullif(btrim(company.apartment_number),'') IS NOT NULL THEN '/'||company.apartment_number ELSE '' END),company.postal_code||' '||company.city),'nip_zleceniodawcy',company.nip,'reprezentacja',c.issuer_representative,'osoba',c.party_name,'adres_osoby',c.party_address,'identyfikator',coalesce(c.party_identifier,'—'),'zakres',c.work_scope,'od',to_char(c.start_date,'DD.MM.YYYY'),'do',coalesce(to_char(c.end_date,'DD.MM.YYYY'),'bezterminowo'),'wynagrodzenie',pay_text,'warunki_platnosci',c.payment_terms,'rachunek',CASE WHEN c.payment_method='cash' THEN 'gotówką, za potwierdzeniem odbioru' ELSE coalesce(c.party_bank_account,'według uzgodnionego sposobu wypłaty') END,'ustalenia',coalesce(c.additional_terms,'Brak dodatkowych ustaleń.'));
 body:=CASE WHEN c.agreement_form='oral' THEN E'POTWIERDZENIE USTALEŃ USTNYCH\n\n' ELSE '' END||t.content;
 FOR k,v IN SELECT * FROM jsonb_each_text(vals) LOOP body:=replace(body,'{{'||k||'}}',v); END LOOP;
 IF body~'\{\{[^}]+\}\}' THEN RAISE EXCEPTION 'Szablon zawiera nieobsługiwane lub nieuzupełnione pola'; END IF;
 body:=body||E'\n\nRozliczenie: '||CASE c.settlement_cycle WHEN 'monthly' THEN 'miesięczne' ELSE 'po zakończeniu' END||'. Sposób wypłaty: '||CASE c.payment_method WHEN 'cash' THEN 'gotówka za potwierdzeniem odbioru' ELSE 'przelew' END||'.'||CASE WHEN c.event_id IS NOT NULL THEN E'\nRealizacja: '||coalesce((SELECT name FROM public.events WHERE id=c.event_id),c.event_id::text) ELSE '' END;
 SELECT coalesce(max(version),0)+1 INTO ver FROM public.personnel_contract_documents WHERE contract_id=c.id;
 INSERT INTO public.personnel_contract_documents(contract_id,version,content,snapshot,created_by) VALUES(c.id,ver,body,jsonb_build_object('contract',to_jsonb(c),'company',to_jsonb(company),'template',to_jsonb(t),'rates',rates),public.current_workflow_employee_id()) RETURNING id INTO result;
 RETURN result;
END; $$;
DROP FUNCTION public.approve_personnel_settlement(uuid,date,numeric,numeric,numeric,text,jsonb);
CREATE OR REPLACE FUNCTION public.approve_personnel_settlement(p_contract uuid,p_period date,p_nominal numeric,p_net numeric,p_cost numeric,p_notes text,p_expected_work jsonb,p_payroll jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.personnel_contracts; items jsonb; basis_count integer; basis text; pay_count integer; pay text; amount numeric; result uuid;
 gross numeric; pit numeric; social numeric; health numeric; other numeric; employer numeric; floor_amount numeric:=0;
 born date; paid date; first_work date; last_work date; relief numeric; outside_relief numeric; used_relief numeric; snapshot jsonb;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do rozliczeń'; END IF;
 -- Shared lock serializes annual relief checks across contracts of the same person.
 PERFORM pg_advisory_xact_lock(609211600);
 SELECT * INTO c FROM public.personnel_contracts WHERE id=p_contract FOR UPDATE;
 IF NOT FOUND OR c.status='draft' OR p_period IS NULL OR extract(day FROM p_period)<>1 THEN RAISE EXCEPTION 'Wybierz zapisaną aktywną umowę i początek miesiąca'; END IF;
 IF c.start_date>=p_period+interval '1 month' OR (c.end_date IS NOT NULL AND c.end_date<p_period) THEN RAISE EXCEPTION 'Miesiąc nie mieści się w okresie umowy'; END IF;
 IF EXISTS(SELECT 1 FROM public.time_entries WHERE personnel_contract_id=c.id AND end_time IS NULL AND start_time<(p_period+interval '1 month')::timestamp AT TIME ZONE 'Europe/Warsaw') THEN RAISE EXCEPTION 'Zakończ aktywne wpisy czasu przed rozliczeniem'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY source,id),'[]'),min(work_date),max(work_date) INTO items,first_work,last_work FROM public.personnel_work_items w WHERE contract_id=c.id AND work_date>=p_period AND work_date<p_period+interval '1 month';
 IF items IS DISTINCT FROM p_expected_work THEN RAISE EXCEPTION 'Wpisy zmieniły się. Odśwież rozliczenie przed zatwierdzeniem'; END IF;
 SELECT count(DISTINCT rate_basis),min(rate_basis),count(DISTINCT pay_basis),min(pay_basis) INTO basis_count,basis,pay_count,pay FROM public.personnel_contract_rates
 WHERE contract_id=c.id AND valid_from<p_period+interval '1 month' AND (valid_to IS NULL OR valid_to>=p_period);
 IF basis_count<>1 OR pay_count<>1 THEN RAISE EXCEPTION 'Miesiąc musi mieć jednoznaczną podstawę wynagrodzenia'; END IF;
 IF pay='hourly' THEN
  SELECT round(coalesce(sum((x->>'minutes')::numeric/60*(x->'rate_snapshot'->>'rate')::numeric),0),2) INTO amount FROM jsonb_array_elements(items) x;
 ELSIF pay='piecework' THEN
  SELECT round(coalesce(sum(coalesce((x->>'quantity')::numeric,0)*(x->'rate_snapshot'->>'rate')::numeric),0),2) INTO amount FROM jsonb_array_elements(items) x;
 ELSE
  amount:=p_nominal;
  IF pay='fixed' AND EXISTS(SELECT 1 FROM public.personnel_settlements WHERE contract_id=c.id) THEN RAISE EXCEPTION 'Ryczałt tej umowy został już rozliczony'; END IF;
 END IF;
 IF p_payroll->'profile' IS DISTINCT FROM c.payroll_profile THEN RAISE EXCEPTION 'Dane PIT/ZUS zmieniły się. Otwórz ponownie umowę przed rozliczeniem'; END IF;
 IF coalesce(p_payroll->>'tax_scheme','') NOT IN ('scale','flat','other') THEN RAISE EXCEPTION 'Wskaż sposób opodatkowania z rozliczenia'; END IF;
 IF p_payroll IS NULL OR coalesce(p_payroll->>'confirmed','false')<>'true' OR nullif(btrim(p_notes),'') IS NULL THEN RAISE EXCEPTION 'Podaj źródło i potwierdź rozliczenie księgowe'; END IF;
 paid:=nullif(p_payroll->>'payment_date','')::date;
 IF paid IS NULL THEN RAISE EXCEPTION 'Podaj datę uzyskania przychodu przyjętą w rozliczeniu'; END IF;
 gross:=nullif(p_payroll->>'gross','')::numeric; pit:=nullif(p_payroll->>'pit','')::numeric;
 social:=nullif(p_payroll->>'social','')::numeric; health:=nullif(p_payroll->>'health','')::numeric;
 other:=nullif(p_payroll->>'other','')::numeric; employer:=nullif(p_payroll->>'employer','')::numeric;
 IF gross IS NULL OR pit IS NULL OR social IS NULL OR health IS NULL OR other IS NULL OR employer IS NULL
 OR least(gross,pit,social,health,other,employer)<0 OR gross::text='NaN' OR pit::text='NaN' OR social::text='NaN' OR health::text='NaN' OR other::text='NaN' OR employer::text='NaN'
 OR p_net IS NULL OR p_cost IS NULL OR p_net<0 OR p_net<>round(gross-pit-social-health-other,2) OR p_cost<>round(gross+employer,2)
 OR amount IS NULL OR amount<0 OR (basis='gross' AND gross<amount) OR (basis='net' AND p_net<amount) THEN RAISE EXCEPTION 'Kwoty muszą być zgodne: netto = brutto minus potrącenia, koszt firmy = brutto plus obciążenia pracodawcy'; END IF;
 IF c.contract_kind='mandate' THEN
  IF c.currency<>'PLN' THEN RAISE EXCEPTION 'Rozliczenie zlecenia w innej walucie wymaga przeliczenia minimum na PLN. Zapisz rozliczenie w PLN.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.personnel_statutory_rates WHERE year=extract(year FROM p_period)) THEN RAISE EXCEPTION 'Brak zatwierdzonej stawki minimalnej dla tego roku'; END IF;
  SELECT round(coalesce(sum((x->>'minutes')::numeric/60*r.mandate_hourly),0),2) INTO floor_amount
  FROM jsonb_array_elements(items) x JOIN public.personnel_statutory_rates r ON r.year=extract(year FROM (x->>'work_date')::date);
  IF gross>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE (x->>'minutes')::numeric>0) THEN RAISE EXCEPTION 'Zlecenie wymaga ewidencji godzin także przy akordzie i ryczałcie'; END IF;
  IF gross<floor_amount THEN RAISE EXCEPTION 'Wynagrodzenie wymaga wyrównania do minimum: % zł brutto za zapisane godziny',floor_amount; END IF;
 END IF;
 born:=nullif(c.payroll_profile->>'birth_date','')::date;
 relief:=coalesce(nullif(p_payroll->>'youth_relief','')::numeric,0);
 outside_relief:=coalesce(nullif(p_payroll->>'outside_relief','')::numeric,0);
 IF relief<0 OR outside_relief<0 OR relief>gross OR relief::text='NaN' OR outside_relief::text='NaN' THEN RAISE EXCEPTION 'Nieprawidłowa kwota ulgi'; END IF;
 IF relief>0 THEN
  IF c.currency<>'PLN' OR born IS NULL OR paid<born OR paid>(born+interval '26 years')::date OR c.contract_kind NOT IN ('employment','mandate') OR coalesce(p_payroll->>'tax_scheme','')<>'scale' OR coalesce(c.payroll_profile->>'youth_opt_out','unknown')<>'no' THEN RAISE EXCEPTION 'Ulga dla młodych wymaga właściwego wieku w dniu przychodu, rodzaju umowy, skali PIT i braku wniosku o niestosowanie'; END IF;
  IF c.person_id IS NULL AND c.employee_id IS NULL AND nullif(btrim(c.party_identifier),'') IS NULL THEN RAISE EXCEPTION 'Powiąż osobę lub podaj jej identyfikator do kontroli rocznego limitu ulgi'; END IF;
  SELECT coalesce(sum((s.payroll_snapshot->>'youth_relief')::numeric),0) INTO used_relief FROM public.personnel_settlements s JOIN public.personnel_contracts pc ON pc.id=s.contract_id
  WHERE extract(year FROM (s.payroll_snapshot->>'payment_date')::date)=extract(year FROM paid)
  AND (pc.id=c.id OR pc.person_id=c.person_id OR pc.employee_id=c.employee_id OR (nullif(btrim(c.party_identifier),'') IS NOT NULL AND pc.party_identifier=c.party_identifier));
  IF relief+outside_relief+used_relief>85528 THEN RAISE EXCEPTION 'Przekroczony wspólny limit ulgi 85 528 zł. W CRM wykorzystano % zł.',used_relief; END IF;
 END IF;
 IF coalesce(p_payroll->>'student_exempt','false')='true' THEN
  first_work:=coalesce(first_work,greatest(c.start_date,p_period)); last_work:=coalesce(last_work,least(coalesce(c.end_date,(p_period+interval '1 month-1 day')::date),(p_period+interval '1 month-1 day')::date));
  IF c.contract_kind<>'mandate' OR born IS NULL OR first_work<born OR last_work>=(born+interval '26 years')::date
  OR coalesce(c.payroll_profile->>'education','unknown') NOT IN ('pupil','student')
  OR coalesce(c.payroll_profile->>'own_employer','unknown')<>'no'
  OR nullif(c.payroll_profile->>'education_from','') IS NULL OR nullif(c.payroll_profile->>'education_to','') IS NULL
  OR (c.payroll_profile->>'education_from')::date>first_work OR (c.payroll_profile->>'education_to')::date<last_work
  OR social<>0 OR health<>0 THEN RAISE EXCEPTION 'Zwolnienie ucznia/studenta wymaga statusu i wieku poniżej 26 lat przez cały rozliczany okres, braku własnego pracodawcy oraz zerowych składek. Zmianę statusu w miesiącu rozlicz indywidualnie bez oznaczania pełnego zwolnienia.'; END IF;
 END IF;
 snapshot:=p_payroll||jsonb_build_object('profile',c.payroll_profile,'rules_version','PL-2026-09-21','source',btrim(p_notes));
 INSERT INTO public.personnel_settlements(contract_id,period,currency,nominal_amount,rate_basis,net_amount,company_cost,work_snapshot,notes,approved_by,payroll_snapshot,gross_amount,minimum_amount)
 VALUES(c.id,p_period,c.currency,amount,basis,p_net,p_cost,items,btrim(p_notes),public.current_workflow_employee_id(),snapshot,gross,floor_amount) RETURNING id INTO result;
 RETURN result;
END; $$;
-- Preserve view column order: new fields follow existing balance columns.
CREATE OR REPLACE VIEW public.personnel_settlement_balances WITH (security_invoker=true) AS
 SELECT s.id,s.contract_id,s.period,s.currency,s.nominal_amount,s.rate_basis,s.net_amount,s.company_cost,s.work_snapshot,s.notes,s.approved_at,s.approved_by,
 coalesce(p.paid,0) AS paid_amount,s.net_amount-coalesce(p.paid,0) AS remaining_amount,s.payroll_snapshot,s.gross_amount,s.minimum_amount FROM public.personnel_settlements s
 LEFT JOIN LATERAL (SELECT sum(amount) AS paid FROM public.personnel_contract_payments WHERE settlement_id=s.id AND payment_type IN ('salary','advance')) p ON true;
REVOKE ALL ON FUNCTION public.add_personnel_rate(uuid,date,date,text,text,numeric,numeric,text),public.approve_personnel_settlement(uuid,date,numeric,numeric,numeric,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_personnel_rate(uuid,date,date,text,text,numeric,numeric,text),public.approve_personnel_settlement(uuid,date,numeric,numeric,numeric,text,jsonb,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.personnel_event_cost(p_event uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT (public.personnel_can_access() OR public.compensation_can_access()) THEN RAISE EXCEPTION 'Brak dostępu do kosztów personelu'; END IF;
 WITH months AS (
 SELECT contract_id,date_trunc('month',work_date)::date AS period,
 sum(CASE WHEN rate_snapshot->>'pay_basis'='piecework' THEN coalesce(quantity,0)*(rate_snapshot->>'rate')::numeric ELSE minutes END) AS all_minutes,sum(CASE WHEN rate_snapshot->>'pay_basis'='piecework' THEN coalesce(quantity,0)*(rate_snapshot->>'rate')::numeric ELSE minutes END) FILTER(WHERE event_id=p_event) AS event_minutes,
 sum(CASE WHEN event_id=p_event AND rate_snapshot->>'pay_basis'='hourly' THEN minutes::numeric/60*(rate_snapshot->>'company_cost_rate')::numeric WHEN event_id=p_event AND rate_snapshot->>'pay_basis'='piecework' THEN coalesce(quantity,0)*(rate_snapshot->>'company_cost_rate')::numeric ELSE 0 END) AS estimate,
 count(*) FILTER(WHERE event_id=p_event AND (rate_snapshot->>'company_cost_rate' IS NULL OR rate_snapshot->>'pay_basis' NOT IN ('hourly','piecework'))) AS missing
 FROM public.personnel_work_items GROUP BY contract_id,date_trunc('month',work_date)::date
 ), costs AS (
 SELECT m.*,s.id AS settlement_id,s.currency,s.company_cost FROM months m LEFT JOIN public.personnel_settlements s ON s.contract_id=m.contract_id AND s.period=m.period WHERE m.event_minutes>0
 ) SELECT jsonb_build_object(
 'confirmed',coalesce(sum(company_cost*event_minutes/nullif(all_minutes,0)) FILTER(WHERE settlement_id IS NOT NULL AND currency='PLN'),0),
 'estimated',coalesce(sum(estimate) FILTER(WHERE settlement_id IS NULL AND EXISTS(SELECT 1 FROM public.personnel_contracts c WHERE c.id=costs.contract_id AND c.currency='PLN')),0),
 'incomplete',coalesce(sum(CASE WHEN settlement_id IS NULL THEN missing ELSE 0 END),0),
 'covered_subcontractor_tasks',coalesce((SELECT jsonb_agg(DISTINCT c.subcontractor_task_id) FROM public.personnel_contracts c JOIN public.subcontractor_tasks t ON t.id=c.subcontractor_task_id WHERE t.event_id=p_event AND c.status<>'draft' AND EXISTS(SELECT 1 FROM costs x WHERE x.contract_id=c.id AND (x.settlement_id IS NOT NULL OR x.estimate>0))),'[]'),
 'foreign_currency',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.personnel_contracts c WHERE c.id=costs.contract_id AND c.currency<>'PLN'))
 ) INTO result FROM costs;
 RETURN result;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
