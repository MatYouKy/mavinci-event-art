BEGIN;

-- A CRM account is optional. This identity survives changes in account access.
CREATE TABLE public.personnel_people (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid UNIQUE REFERENCES public.employees(id) ON DELETE SET NULL,
 subcontractor_id uuid UNIQUE REFERENCES public.subcontractors(id) ON DELETE SET NULL,
 name text NOT NULL CHECK (length(btrim(name)) > 0),
 surname text NOT NULL DEFAULT '', email text, phone text, address text,
 identifier text, bank_account text, notes text, is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.personnel_can_access(p_manage boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(NOT public.current_session_is_seller_portal() AND EXISTS (
 SELECT 1 FROM public.employees e WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active
 AND (e.role::text='admin' OR e.access_level::text='admin' OR 'admin'=ANY(coalesce(e.permissions,'{}'))
 OR 'personnel_manage'=ANY(coalesce(e.permissions,'{}'))
 OR (NOT p_manage AND 'personnel_view'=ANY(coalesce(e.permissions,'{}'))))),false);
$$;
-- Existing managers retain access; an employee-directory permission alone does not expose salaries.
UPDATE public.employees SET permissions=array_append(coalesce(permissions,'{}'),'personnel_manage')
 WHERE coalesce(permissions,'{}') && ARRAY['employees_manage','subcontractors_manage']
 AND NOT 'personnel_manage'=ANY(coalesce(permissions,'{}'));
CREATE OR REPLACE FUNCTION public.can_view_personnel_contracts()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.personnel_can_access(false); $$;
CREATE OR REPLACE FUNCTION public.can_manage_personnel_contracts()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.personnel_can_access(true); $$;

INSERT INTO public.personnel_people(employee_id,name,surname,email,phone,is_active)
 SELECT id,coalesce(nullif(btrim(name),''),'Pracownik'),coalesce(surname,''),email,phone_number,is_active FROM public.employees;
CREATE OR REPLACE FUNCTION public.sync_personnel_employee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.personnel_people(employee_id,name,surname,email,phone,is_active)
 VALUES(NEW.id,coalesce(nullif(btrim(NEW.name),''),'Pracownik'),coalesce(NEW.surname,''),NEW.email,NEW.phone_number,NEW.is_active)
 ON CONFLICT(employee_id) DO UPDATE SET name=excluded.name,surname=excluded.surname,email=excluded.email,phone=excluded.phone,is_active=excluded.is_active,updated_at=now();
 RETURN NEW;
END; $$;
CREATE TRIGGER sync_personnel_employee AFTER INSERT OR UPDATE OF name,surname,email,phone_number,is_active ON public.employees FOR EACH ROW EXECUTE FUNCTION public.sync_personnel_employee();
ALTER TABLE public.personnel_people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personnel_people FROM anon,authenticated;
CREATE POLICY personnel_people_read ON public.personnel_people FOR SELECT TO authenticated USING (
 public.personnel_can_access() OR employee_id=public.current_workflow_employee_id());
CREATE POLICY personnel_people_manage ON public.personnel_people FOR ALL TO authenticated USING(public.personnel_can_access(true)) WITH CHECK(public.personnel_can_access(true));
GRANT SELECT,INSERT,UPDATE ON public.personnel_people TO authenticated;
CREATE TRIGGER personnel_people_updated BEFORE UPDATE ON public.personnel_people FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.personnel_contract_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(btrim(name))>0),
 contract_kind text NOT NULL DEFAULT 'mandate' CHECK(contract_kind IN ('mandate','employment','specific_work')),
 content text NOT NULL CHECK(length(btrim(content))>0), version integer NOT NULL DEFAULT 1,
 is_active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.personnel_contract_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personnel_contract_templates FROM anon,authenticated;
CREATE POLICY personnel_templates_read ON public.personnel_contract_templates FOR SELECT TO authenticated USING(public.personnel_can_access());
CREATE POLICY personnel_templates_manage ON public.personnel_contract_templates FOR ALL TO authenticated USING(public.personnel_can_access(true)) WITH CHECK(public.personnel_can_access(true));
GRANT SELECT,INSERT,UPDATE ON public.personnel_contract_templates TO authenticated;
CREATE OR REPLACE FUNCTION public.personnel_template_version()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN NEW.version:=OLD.version+1; NEW.updated_at:=clock_timestamp(); RETURN NEW; END; $$;
CREATE TRIGGER personnel_template_version BEFORE UPDATE ON public.personnel_contract_templates FOR EACH ROW EXECUTE FUNCTION public.personnel_template_version();
INSERT INTO public.personnel_contract_templates(name,content) VALUES ('Umowa zlecenie — podstawowy',
 E'UMOWA ZLECENIE NR {{numer}}\n\nZawarta dnia {{data_zawarcia}} pomiędzy:\n{{zleceniodawca}}\n{{adres_zleceniodawcy}}, NIP: {{nip_zleceniodawcy}}\nReprezentacja: {{reprezentacja}}\na\n{{osoba}}, {{adres_osoby}}\nIdentyfikator: {{identyfikator}}\n\n§ 1. Przedmiot zlecenia\n{{zakres}}\n\n§ 2. Okres wykonania\nOd {{od}} do {{do}}.\n\n§ 3. Wynagrodzenie i rozliczenie\n{{wynagrodzenie}}\n{{warunki_platnosci}}\nRachunek do wypłaty: {{rachunek}}\n\n§ 4. Dodatkowe ustalenia\n{{ustalenia}}\n\nZleceniodawca: ____________________\nZleceniobiorca: ____________________');

ALTER TABLE public.personnel_contracts
 ADD COLUMN subcontractor_task_id uuid REFERENCES public.subcontractor_tasks(id) ON DELETE RESTRICT,
 ADD COLUMN person_id uuid REFERENCES public.personnel_people(id) ON DELETE RESTRICT,
 ADD COLUMN signed_date date, ADD COLUMN party_address text, ADD COLUMN party_bank_account text,
 ADD COLUMN party_kind text CHECK(party_kind IN ('person','company')),
 ADD COLUMN work_scope text, ADD COLUMN payment_terms text, ADD COLUMN additional_terms text,
 ADD COLUMN issuer_representative text,
 ADD COLUMN template_id uuid REFERENCES public.personnel_contract_templates(id) ON DELETE RESTRICT;
UPDATE public.personnel_contracts c SET person_id=p.id,party_kind='person' FROM public.personnel_people p WHERE p.employee_id=c.employee_id;
ALTER TABLE public.personnel_contracts ADD CONSTRAINT personnel_person_or_subcontractor CHECK(person_id IS NULL OR subcontractor_id IS NULL);
CREATE INDEX personnel_contract_person ON public.personnel_contracts(person_id);
CREATE OR REPLACE FUNCTION public.personnel_owns_contract(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(NOT public.current_session_is_seller_portal() AND EXISTS (
 SELECT 1 FROM public.personnel_contracts c LEFT JOIN public.personnel_people p ON p.id=c.person_id
 WHERE c.id=p_id AND coalesce(p.employee_id,c.employee_id)=public.current_workflow_employee_id()
 AND EXISTS(SELECT 1 FROM public.employees e WHERE e.id=public.current_workflow_employee_id() AND e.is_active)),false);
$$;
CREATE OR REPLACE FUNCTION public.personnel_can_read_contract(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.personnel_can_access() OR public.personnel_owns_contract(p_id); $$;
CREATE POLICY personnel_contracts_own ON public.personnel_contracts FOR SELECT TO authenticated USING(public.personnel_owns_contract(id));
CREATE POLICY personnel_payments_own ON public.personnel_contract_payments FOR SELECT TO authenticated USING(public.personnel_owns_contract(personnel_contract_id));

-- Immutable versions contain the document, parties, template and agreed rate periods.
CREATE TABLE public.personnel_contract_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contract_id uuid NOT NULL REFERENCES public.personnel_contracts(id) ON DELETE RESTRICT,
 version integer NOT NULL, content text NOT NULL, snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
 UNIQUE(contract_id,version)
);
ALTER TABLE public.personnel_contract_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personnel_contract_documents FROM anon,authenticated;
CREATE POLICY personnel_documents_read ON public.personnel_contract_documents FOR SELECT TO authenticated USING(public.personnel_can_read_contract(contract_id));
GRANT SELECT ON public.personnel_contract_documents TO authenticated;

CREATE TABLE public.personnel_contract_rates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contract_id uuid NOT NULL REFERENCES public.personnel_contracts(id) ON DELETE RESTRICT,
 valid_from date NOT NULL, valid_to date CHECK(valid_to>=valid_from),
 pay_basis text NOT NULL CHECK(pay_basis IN ('hourly','monthly','fixed')),
 rate_basis text NOT NULL CHECK(rate_basis IN ('gross','net')),
 rate numeric(14,2) NOT NULL CHECK(rate>0),
 company_cost_rate numeric(14,2) CHECK(company_cost_rate>=rate),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX personnel_rates_contract ON public.personnel_contract_rates(contract_id,valid_from);
ALTER TABLE public.personnel_contract_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personnel_contract_rates FROM anon,authenticated;
CREATE POLICY personnel_rates_read ON public.personnel_contract_rates FOR SELECT TO authenticated USING(public.personnel_can_read_contract(contract_id));
GRANT SELECT ON public.personnel_contract_rates TO authenticated;
CREATE OR REPLACE FUNCTION public.add_personnel_rate(p_contract_id uuid,p_from date,p_to date,p_basis text,p_rate_basis text,p_rate numeric,p_company_cost numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.personnel_contracts; result uuid;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do wynagrodzeń'; END IF;
 SELECT * INTO c FROM public.personnel_contracts WHERE id=p_contract_id FOR UPDATE;
 IF NOT FOUND OR c.start_date IS NULL OR p_from<c.start_date OR (c.end_date IS NOT NULL AND (p_from>c.end_date OR p_to IS NULL OR p_to>c.end_date)) THEN RAISE EXCEPTION 'Stawka musi mieścić się w okresie umowy'; END IF;
 IF EXISTS(SELECT 1 FROM public.personnel_contract_documents WHERE contract_id=c.id) THEN RAISE EXCEPTION 'Umowa ma utrwalony dokument. Zmianę warunków zapisz jako nową umowę lub aneks w rejestrze.'; END IF;
 IF EXISTS(SELECT 1 FROM public.personnel_contract_rates WHERE contract_id=c.id AND daterange(valid_from,valid_to,'[]') && daterange(p_from,p_to,'[]')) THEN RAISE EXCEPTION 'Okresy stawek tej umowy nie mogą się nakładać'; END IF;
 INSERT INTO public.personnel_contract_rates(contract_id,valid_from,valid_to,pay_basis,rate_basis,rate,company_cost_rate)
 VALUES(c.id,p_from,p_to,p_basis,p_rate_basis,p_rate,p_company_cost) RETURNING id INTO result;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.remove_personnel_rate(p_rate uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c_id uuid;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do stawek'; END IF;
 SELECT contract_id INTO c_id FROM public.personnel_contract_rates WHERE id=p_rate;
 PERFORM 1 FROM public.personnel_contracts WHERE id=c_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.personnel_contract_documents WHERE contract_id=c_id)
 OR EXISTS(SELECT 1 FROM public.time_entries WHERE personnel_rate_snapshot->>'id'=p_rate::text)
 OR EXISTS(SELECT 1 FROM public.personnel_work_entries WHERE rate_snapshot->>'id'=p_rate::text)
 OR EXISTS(SELECT 1 FROM public.personnel_settlements WHERE contract_id=c_id) THEN RAISE EXCEPTION 'Stawka została już wykorzystana w pracy, dokumencie lub rozliczeniu'; END IF;
 DELETE FROM public.personnel_contract_rates WHERE id=p_rate;
END; $$;
REVOKE ALL ON FUNCTION public.remove_personnel_rate(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remove_personnel_rate(uuid) TO authenticated;

ALTER TABLE public.time_entries ADD COLUMN personnel_contract_id uuid REFERENCES public.personnel_contracts(id) ON DELETE RESTRICT,
 ADD COLUMN personnel_rate_snapshot jsonb;
CREATE INDEX time_entries_personnel ON public.time_entries(personnel_contract_id,start_time);
CREATE TABLE public.personnel_work_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contract_id uuid NOT NULL REFERENCES public.personnel_contracts(id) ON DELETE RESTRICT,
 event_id uuid REFERENCES public.events(id) ON DELETE RESTRICT, work_date date NOT NULL,
 minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 1440), description text NOT NULL CHECK(length(btrim(description))>0),
 rate_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.personnel_work_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personnel_work_entries FROM anon,authenticated;
CREATE POLICY personnel_work_read ON public.personnel_work_entries FOR SELECT TO authenticated USING(public.personnel_can_read_contract(contract_id));
CREATE POLICY personnel_work_manage ON public.personnel_work_entries FOR ALL TO authenticated USING(public.personnel_can_access(true)) WITH CHECK(public.personnel_can_access(true));
GRANT SELECT,INSERT,DELETE ON public.personnel_work_entries TO authenticated;
CREATE TABLE public.personnel_settlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contract_id uuid NOT NULL REFERENCES public.personnel_contracts(id) ON DELETE RESTRICT,
 period date NOT NULL CHECK(extract(day FROM period)=1), currency text NOT NULL,
 nominal_amount numeric(14,2) NOT NULL CHECK(nominal_amount>=0), rate_basis text NOT NULL CHECK(rate_basis IN ('gross','net')),
 net_amount numeric(14,2) NOT NULL CHECK(net_amount>=0), company_cost numeric(14,2) NOT NULL CHECK(company_cost>=net_amount),
 work_snapshot jsonb NOT NULL, notes text, approved_at timestamptz NOT NULL DEFAULT now(), approved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
 UNIQUE(contract_id,period)
);
ALTER TABLE public.personnel_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personnel_settlements FROM anon,authenticated;
CREATE POLICY personnel_settlements_read ON public.personnel_settlements FOR SELECT TO authenticated USING(public.personnel_can_read_contract(contract_id));
GRANT SELECT ON public.personnel_settlements TO authenticated;
ALTER TABLE public.personnel_contract_payments ADD COLUMN settlement_id uuid REFERENCES public.personnel_settlements(id) ON DELETE RESTRICT;
CREATE INDEX personnel_payment_settlement ON public.personnel_contract_payments(settlement_id);
CREATE OR REPLACE FUNCTION public.guard_personnel_settlement_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.settlement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.personnel_settlements s WHERE s.id=NEW.settlement_id AND s.contract_id=NEW.personnel_contract_id AND s.currency=NEW.currency AND NEW.payment_type IN ('salary','advance')) THEN RAISE EXCEPTION 'Wypłata i rozliczenie muszą dotyczyć tej samej umowy i waluty'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER personnel_settlement_payment BEFORE INSERT OR UPDATE ON public.personnel_contract_payments FOR EACH ROW EXECUTE FUNCTION public.guard_personnel_settlement_payment();

CREATE OR REPLACE FUNCTION public.personnel_rate_at(p_contract uuid,p_date date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT to_jsonb(r) || jsonb_build_object('currency',c.currency)
 FROM public.personnel_contract_rates r JOIN public.personnel_contracts c ON c.id=r.contract_id
 WHERE c.id=p_contract AND c.status<>'draft' AND c.start_date<=p_date AND (c.end_date IS NULL OR c.end_date>=p_date)
 AND r.valid_from<=p_date AND (r.valid_to IS NULL OR r.valid_to>=p_date);
$$;
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
    WHERE coalesce(pp.employee_id,pc.employee_id)=NEW.employee_id AND public.personnel_rate_at(pc.id,d) IS NOT NULL;
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
   NEW.rate_snapshot:=rate;
  END IF;
 ELSIF TG_TABLE_NAME='time_entries' THEN NEW.personnel_rate_snapshot:=NULL;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER z_personnel_work BEFORE INSERT OR UPDATE OR DELETE ON public.time_entries FOR EACH ROW EXECUTE FUNCTION public.guard_personnel_work();
CREATE TRIGGER personnel_work_guard BEFORE INSERT OR DELETE ON public.personnel_work_entries FOR EACH ROW EXECUTE FUNCTION public.guard_personnel_work();
CREATE VIEW public.personnel_work_items WITH (security_invoker=true) AS
 SELECT id,'crm'::text AS source,personnel_contract_id AS contract_id,event_id,(start_time AT TIME ZONE 'Europe/Warsaw')::date AS work_date,
 duration_minutes AS minutes,coalesce(title,description,'Praca') AS description,personnel_rate_snapshot AS rate_snapshot
 FROM public.time_entries WHERE personnel_contract_id IS NOT NULL AND end_time IS NOT NULL
 UNION ALL SELECT id,'external',contract_id,event_id,work_date,minutes,description,rate_snapshot FROM public.personnel_work_entries;
GRANT SELECT ON public.personnel_work_items TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_personnel_settlement(p_contract uuid,p_period date,p_nominal numeric,p_net numeric,p_cost numeric,p_notes text,p_expected_work jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.personnel_contracts; items jsonb; basis_count integer; basis text; pay_count integer; pay text; amount numeric; result uuid;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do rozliczeń'; END IF;
 SELECT * INTO c FROM public.personnel_contracts WHERE id=p_contract FOR UPDATE;
 IF NOT FOUND OR c.status='draft' OR p_period IS NULL OR extract(day FROM p_period)<>1 THEN RAISE EXCEPTION 'Wybierz zapisaną aktywną umowę i początek miesiąca'; END IF;
 IF c.start_date>=p_period+interval '1 month' OR (c.end_date IS NOT NULL AND c.end_date<p_period) THEN RAISE EXCEPTION 'Miesiąc nie mieści się w okresie umowy'; END IF;
 IF EXISTS(SELECT 1 FROM public.time_entries WHERE personnel_contract_id=c.id AND end_time IS NULL AND start_time<(p_period+interval '1 month')::timestamp AT TIME ZONE 'Europe/Warsaw') THEN RAISE EXCEPTION 'Zakończ aktywne wpisy czasu przed rozliczeniem'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY source,id),'[]') INTO items FROM public.personnel_work_items w WHERE contract_id=c.id AND work_date>=p_period AND work_date<p_period+interval '1 month';
 IF items IS DISTINCT FROM p_expected_work THEN RAISE EXCEPTION 'Wpisy zmieniły się. Odśwież rozliczenie przed zatwierdzeniem'; END IF;
 SELECT count(DISTINCT rate_basis),min(rate_basis),count(DISTINCT pay_basis),min(pay_basis) INTO basis_count,basis,pay_count,pay FROM public.personnel_contract_rates
 WHERE contract_id=c.id AND valid_from<p_period+interval '1 month' AND (valid_to IS NULL OR valid_to>=p_period);
 IF basis_count<>1 OR pay_count<>1 THEN RAISE EXCEPTION 'Miesiąc musi mieć jednoznaczną podstawę wynagrodzenia'; END IF;
 IF pay='hourly' THEN
  SELECT round(coalesce(sum((x->>'minutes')::numeric/60*(x->'rate_snapshot'->>'rate')::numeric),0),2) INTO amount FROM jsonb_array_elements(items) x;
 ELSE
  amount:=p_nominal;
  IF pay='fixed' AND EXISTS(SELECT 1 FROM public.personnel_settlements WHERE contract_id=c.id) THEN RAISE EXCEPTION 'Ryczałt tej umowy został już rozliczony'; END IF;
 END IF;
 IF amount IS NULL OR amount<0 OR p_net IS NULL OR p_cost IS NULL OR p_net<0 OR p_cost<greatest(p_net,amount) OR (basis='gross' AND p_net>amount) OR (basis='net' AND p_net<>amount) THEN RAISE EXCEPTION 'Sprawdź naliczenie, potwierdzoną kwotę netto i pełny koszt firmy'; END IF;
 INSERT INTO public.personnel_settlements(contract_id,period,currency,nominal_amount,rate_basis,net_amount,company_cost,work_snapshot,notes,approved_by)
 VALUES(c.id,p_period,c.currency,amount,basis,p_net,p_cost,items,nullif(btrim(p_notes),''),public.current_workflow_employee_id()) RETURNING id INTO result;
 RETURN result;
END; $$;
CREATE VIEW public.personnel_settlement_balances WITH (security_invoker=true) AS
 SELECT s.*,coalesce(p.paid,0) AS paid_amount,s.net_amount-coalesce(p.paid,0) AS remaining_amount FROM public.personnel_settlements s
 LEFT JOIN LATERAL (SELECT sum(amount) AS paid FROM public.personnel_contract_payments WHERE settlement_id=s.id AND payment_type IN ('salary','advance')) p ON true;
GRANT SELECT ON public.personnel_settlement_balances TO authenticated;

-- Keep the existing links for finance integrations and historical records.
CREATE OR REPLACE FUNCTION public.guard_personnel_contract()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.personnel_people;
BEGIN
 IF TG_OP='UPDATE' AND (EXISTS(SELECT 1 FROM public.personnel_contract_documents WHERE contract_id=OLD.id) OR EXISTS(SELECT 1 FROM public.personnel_settlements WHERE contract_id=OLD.id))
 AND (to_jsonb(NEW)-ARRAY['status','notes','updated_at','employee_id','person_id','end_date']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','notes','updated_at','employee_id','person_id','end_date']) THEN RAISE EXCEPTION 'Utrwalona umowa zachowuje treść i warunki. Zmianę zapisz jako nową umowę lub aneks.'; END IF;
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
CREATE TRIGGER personnel_contract_guard BEFORE INSERT OR UPDATE ON public.personnel_contracts FOR EACH ROW EXECUTE FUNCTION public.guard_personnel_contract();

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
 to_char(valid_from,'DD.MM.YYYY')||' – '||coalesce(to_char(valid_to,'DD.MM.YYYY'),'bezterminowo')||': '||rate||' '||c.currency||CASE rate_basis WHEN 'gross' THEN ' brutto' ELSE ' netto' END||CASE pay_basis WHEN 'hourly' THEN ' / godz.' WHEN 'monthly' THEN ' / miesiąc' ELSE ' za całe zlecenie' END,E'\n' ORDER BY valid_from)
 INTO rates,pay_text FROM public.personnel_contract_rates r WHERE contract_id=c.id;
 IF rates IS NULL THEN RAISE EXCEPTION 'Dodaj warunki wynagrodzenia'; END IF;
 vals:=jsonb_build_object('numer',c.contract_number,'data_zawarcia',to_char(c.signed_date,'DD.MM.YYYY'),'zleceniodawca',company.legal_name,'adres_zleceniodawcy',concat_ws(', ',concat_ws(' ',company.street,company.building_number || CASE WHEN nullif(btrim(company.apartment_number),'') IS NOT NULL THEN '/'||company.apartment_number ELSE '' END),company.postal_code||' '||company.city),'nip_zleceniodawcy',company.nip,'reprezentacja',c.issuer_representative,'osoba',c.party_name,'adres_osoby',c.party_address,'identyfikator',coalesce(c.party_identifier,'—'),'zakres',c.work_scope,'od',to_char(c.start_date,'DD.MM.YYYY'),'do',coalesce(to_char(c.end_date,'DD.MM.YYYY'),'bezterminowo'),'wynagrodzenie',pay_text,'warunki_platnosci',c.payment_terms,'rachunek',coalesce(c.party_bank_account,'według uzgodnionego sposobu wypłaty'),'ustalenia',coalesce(c.additional_terms,'Brak dodatkowych ustaleń.'));
 body:=t.content;
 FOR k,v IN SELECT * FROM jsonb_each_text(vals) LOOP body:=replace(body,'{{'||k||'}}',v); END LOOP;
 IF body~'\{\{[^}]+\}\}' THEN RAISE EXCEPTION 'Szablon zawiera nieobsługiwane lub nieuzupełnione pola'; END IF;
 SELECT coalesce(max(version),0)+1 INTO ver FROM public.personnel_contract_documents WHERE contract_id=c.id;
 INSERT INTO public.personnel_contract_documents(contract_id,version,content,snapshot,created_by) VALUES(c.id,ver,body,jsonb_build_object('contract',to_jsonb(c),'company',to_jsonb(company),'template',to_jsonb(t),'rates',rates),public.current_workflow_employee_id()) RETURNING id INTO result;
 RETURN result;
END; $$;

-- Only manager-authorized endpoints can mutate immutable financial records.

-- A new rate must not retroactively change previously recorded work.
CREATE POLICY personnel_time_read ON public.time_entries FOR SELECT TO authenticated USING (
 personnel_contract_id IS NOT NULL AND public.personnel_can_read_contract(personnel_contract_id));

CREATE OR REPLACE FUNCTION public.personnel_picker_employees()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'surname',surname) ORDER BY surname,name),'[]') FROM public.employees WHERE public.personnel_can_access() AND is_active;
$$;
CREATE OR REPLACE FUNCTION public.personnel_picker_subcontractors()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company_name',company_name) ORDER BY company_name),'[]') FROM public.subcontractors WHERE public.personnel_can_access() AND status<>'inactive';
$$;
CREATE OR REPLACE FUNCTION public.personnel_picker_companies()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'legal_name',legal_name,'is_default',is_default) ORDER BY is_default DESC,name),'[]') FROM public.my_companies WHERE public.personnel_can_access() AND is_active;
$$;
CREATE OR REPLACE FUNCTION public.link_personnel_employee(p_person uuid,p_employee uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source public.personnel_people; previous public.personnel_people;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do kartoteki'; END IF;
 PERFORM 1 FROM public.personnel_people WHERE id=p_person OR employee_id=p_employee ORDER BY id FOR UPDATE;
 SELECT * INTO source FROM public.personnel_people WHERE id=p_person;
 SELECT * INTO previous FROM public.personnel_people WHERE employee_id=p_employee;
 IF source.id IS NULL OR source.employee_id IS NOT NULL OR previous.id IS NULL THEN RAISE EXCEPTION 'Wybierz współpracownika bez konta i istniejącego pracownika CRM'; END IF;
 IF previous.subcontractor_id IS NOT NULL AND previous.subcontractor_id IS DISTINCT FROM source.subcontractor_id THEN RAISE EXCEPTION 'Konto ma inne powiązanie z podwykonawcą'; END IF;
 UPDATE public.personnel_people SET employee_id=NULL,is_active=false WHERE id=previous.id;
 UPDATE public.personnel_people SET employee_id=p_employee WHERE id=source.id;
 UPDATE public.personnel_contracts SET person_id=source.id WHERE person_id=previous.id;
 -- Preserve old profile as archived; no documents or payments are removed.
END; $$;
REVOKE INSERT,UPDATE ON public.personnel_people FROM authenticated;
GRANT INSERT(name,surname,email,phone,address,identifier,bank_account,notes,is_active),UPDATE(name,surname,email,phone,address,identifier,bank_account,notes,is_active) ON public.personnel_people TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_personnel_time(p_entry uuid,p_contract uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE entry public.time_entries;
BEGIN
 SELECT * INTO entry FROM public.time_entries WHERE id=p_entry FOR UPDATE;
 IF NOT FOUND OR NOT (public.personnel_can_access(true) OR entry.employee_id=public.current_workflow_employee_id()) THEN RAISE EXCEPTION 'Brak dostępu do wpisu czasu'; END IF;
 IF p_contract IS NULL THEN RAISE EXCEPTION 'Wybierz umowę'; END IF;
 UPDATE public.time_entries SET personnel_contract_id=p_contract WHERE id=entry.id;
END; $$;
REVOKE ALL ON FUNCTION public.personnel_picker_employees(),public.personnel_picker_subcontractors(),public.personnel_picker_companies(),public.link_personnel_employee(uuid,uuid),public.assign_personnel_time(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.personnel_picker_employees(),public.personnel_picker_subcontractors(),public.personnel_picker_companies(),public.link_personnel_employee(uuid,uuid),public.assign_personnel_time(uuid,uuid) TO authenticated;

-- A unified event cost; approved totals replace estimates, payments never add a second cost.
CREATE OR REPLACE FUNCTION public.personnel_event_cost(p_event uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT (public.personnel_can_access() OR public.compensation_can_access()) THEN RAISE EXCEPTION 'Brak dostępu do kosztów personelu'; END IF;
 WITH months AS (
 SELECT contract_id,date_trunc('month',work_date)::date AS period,
 sum(minutes) AS all_minutes,sum(minutes) FILTER(WHERE event_id=p_event) AS event_minutes,
 sum(CASE WHEN event_id=p_event AND rate_snapshot->>'pay_basis'='hourly' THEN minutes::numeric/60*(rate_snapshot->>'company_cost_rate')::numeric ELSE 0 END) AS estimate,
 count(*) FILTER(WHERE event_id=p_event AND (rate_snapshot->>'company_cost_rate' IS NULL OR rate_snapshot->>'pay_basis'<>'hourly')) AS missing
 FROM public.personnel_work_items GROUP BY contract_id,date_trunc('month',work_date)::date
 ), costs AS (
 SELECT m.*,s.id AS settlement_id,s.currency,s.company_cost FROM months m LEFT JOIN public.personnel_settlements s ON s.contract_id=m.contract_id AND s.period=m.period WHERE m.event_minutes>0
 ) SELECT jsonb_build_object(
 'confirmed',coalesce(sum(company_cost*event_minutes/all_minutes) FILTER(WHERE settlement_id IS NOT NULL AND currency='PLN'),0),
 'estimated',coalesce(sum(estimate) FILTER(WHERE settlement_id IS NULL AND EXISTS(SELECT 1 FROM public.personnel_contracts c WHERE c.id=costs.contract_id AND c.currency='PLN')),0),
 'incomplete',coalesce(sum(CASE WHEN settlement_id IS NULL THEN missing ELSE 0 END),0),
 'covered_subcontractor_tasks',coalesce((SELECT jsonb_agg(DISTINCT c.subcontractor_task_id) FROM public.personnel_contracts c JOIN public.subcontractor_tasks t ON t.id=c.subcontractor_task_id WHERE t.event_id=p_event AND c.status<>'draft' AND EXISTS(SELECT 1 FROM costs x WHERE x.contract_id=c.id AND (x.settlement_id IS NOT NULL OR x.estimate>0))),'[]'),
 'foreign_currency',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.personnel_contracts c WHERE c.id=costs.contract_id AND c.currency<>'PLN'))
 ) INTO result FROM costs;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.personnel_event_cost(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.personnel_event_cost(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.personnel_can_access(boolean),public.personnel_owns_contract(uuid),public.personnel_can_read_contract(uuid),public.add_personnel_rate(uuid,date,date,text,text,numeric,numeric),public.approve_personnel_settlement(uuid,date,numeric,numeric,numeric,text,jsonb),public.generate_personnel_document(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.personnel_can_access(boolean),public.personnel_owns_contract(uuid),public.personnel_can_read_contract(uuid),public.add_personnel_rate(uuid,date,date,text,text,numeric,numeric),public.approve_personnel_settlement(uuid,date,numeric,numeric,numeric,text,jsonb),public.generate_personnel_document(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_personnel_employee(),public.personnel_template_version(),public.personnel_rate_at(uuid,date),public.guard_personnel_work(),public.guard_personnel_settlement_payment(),public.guard_personnel_contract() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
