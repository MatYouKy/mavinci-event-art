BEGIN;
CREATE OR REPLACE FUNCTION public.compensation_can_access(manage boolean DEFAULT false, admin_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(NOT public.current_session_is_seller_portal() AND EXISTS (
  SELECT 1 FROM public.employees e WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active
  AND (e.role::text='admin' OR e.access_level::text='admin' OR 'admin'=ANY(coalesce(e.permissions,'{}'))
    OR (NOT admin_only AND ('employees_manage'=ANY(coalesce(e.permissions,'{}')) OR 'finances_manage'=ANY(coalesce(e.permissions,'{}'))
      OR (NOT manage AND 'finances_view'=ANY(coalesce(e.permissions,'{}'))))))
 ),false);
$$;
REVOKE ALL ON FUNCTION public.compensation_can_access(boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.compensation_can_access(boolean,boolean) TO authenticated;
CREATE TABLE public.compensation_settings (
 id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
 cit_rate numeric NOT NULL DEFAULT 19 CHECK(cit_rate BETWEEN 0 AND 50),
 dividend_rate numeric NOT NULL DEFAULT 19 CHECK(dividend_rate BETWEEN 0 AND 50),
 employer_social_rate numeric NOT NULL DEFAULT 20.48 CHECK(employer_social_rate BETWEEN 0 AND 50),
 employee_social_rate numeric NOT NULL DEFAULT 13.71 CHECK(employee_social_rate BETWEEN 0 AND 50),
 mandate_social_rate numeric NOT NULL DEFAULT 11.26 CHECK(mandate_social_rate BETWEEN 0 AND 50),
 health_rate numeric NOT NULL DEFAULT 9 CHECK(health_rate BETWEEN 0 AND 50),
 pit_rate numeric NOT NULL DEFAULT 12 CHECK(pit_rate BETWEEN 0 AND 50),
 monthly_tax_credit numeric NOT NULL DEFAULT 0 CHECK(monthly_tax_credit BETWEEN 0 AND 10000),
 employment_deduction numeric NOT NULL DEFAULT 250 CHECK(employment_deduction BETWEEN 0 AND 10000),
 mandate_deduction_rate numeric NOT NULL DEFAULT 20 CHECK(mandate_deduction_rate BETWEEN 0 AND 50),
 reference_hours numeric NOT NULL DEFAULT 160 CHECK(reference_hours BETWEEN 1 AND 744),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.compensation_settings(id) VALUES(1);
ALTER TABLE public.compensation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY compensation_settings_read ON public.compensation_settings FOR SELECT TO authenticated USING(public.compensation_can_access());
CREATE POLICY compensation_settings_update ON public.compensation_settings FOR UPDATE TO authenticated USING(public.compensation_can_access(true,true)) WITH CHECK(public.compensation_can_access(true,true));
REVOKE ALL ON public.compensation_settings FROM anon,authenticated;
GRANT SELECT,UPDATE ON public.compensation_settings TO authenticated;
CREATE TABLE public.employee_compensation (
 employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
 pay_basis text NOT NULL CHECK(pay_basis IN ('hourly','monthly')),
 rate_basis text NOT NULL CHECK(rate_basis IN ('net','gross')),
 hourly_rate numeric(12,2) NOT NULL DEFAULT 0 CHECK(hourly_rate BETWEEN 0 AND 10000000),
 monthly_salary numeric(12,2) NOT NULL DEFAULT 0 CHECK(monthly_salary BETWEEN 0 AND 10000000),
 contract_kind text NOT NULL CHECK(contract_kind IN ('employment','mandate','other')),
 payment_method text NOT NULL CHECK(payment_method IN ('bank','cash')),
 funding_source text NOT NULL CHECK(funding_source IN ('company','dividend')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.employee_compensation ENABLE ROW LEVEL SECURITY;
CREATE POLICY employee_compensation_read ON public.employee_compensation FOR SELECT TO authenticated USING(public.compensation_can_access());
REVOKE ALL ON public.employee_compensation FROM anon,authenticated;
GRANT SELECT ON public.employee_compensation TO authenticated;
CREATE OR REPLACE FUNCTION public.save_employee_compensation(p_employee_id uuid,p_profile jsonb,p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS public.employee_compensation LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous public.employee_compensation; result public.employee_compensation;
BEGIN
 IF NOT public.compensation_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do wynagrodzeń'; END IF;
 PERFORM 1 FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pracownika'; END IF;
 SELECT * INTO previous FROM public.employee_compensation WHERE employee_id=p_employee_id FOR UPDATE;
 IF previous.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Warunki zmieniły się. Odśwież profil przed zapisem.'; END IF;
 INSERT INTO public.employee_compensation(employee_id,pay_basis,rate_basis,hourly_rate,monthly_salary,contract_kind,payment_method,funding_source)
 VALUES(p_employee_id,p_profile->>'pay_basis',p_profile->>'rate_basis',(p_profile->>'hourly_rate')::numeric,(p_profile->>'monthly_salary')::numeric,p_profile->>'contract_kind',p_profile->>'payment_method',p_profile->>'funding_source')
 ON CONFLICT(employee_id) DO UPDATE SET pay_basis=excluded.pay_basis,rate_basis=excluded.rate_basis,hourly_rate=excluded.hourly_rate,monthly_salary=excluded.monthly_salary,contract_kind=excluded.contract_kind,payment_method=excluded.payment_method,funding_source=excluded.funding_source,updated_at=clock_timestamp()
 RETURNING * INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.save_employee_compensation(uuid,jsonb,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_employee_compensation(uuid,jsonb,timestamptz) TO authenticated;
ALTER TABLE public.time_entries ADD COLUMN compensation_snapshot jsonb;
-- New hourly time records inherit the employee's agreed rate; historical entries are not rewritten.
CREATE OR REPLACE FUNCTION public.default_employee_time_rate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE profile public.employee_compensation; settings public.compensation_settings;
BEGIN
 IF TG_OP='UPDATE' THEN
   NEW.compensation_snapshot := OLD.compensation_snapshot;
   RETURN NEW;
 END IF;
 NEW.compensation_snapshot := NULL;
 SELECT * INTO profile FROM public.employee_compensation WHERE employee_id=NEW.employee_id AND pay_basis='hourly';
 IF FOUND THEN
  SELECT * INTO settings FROM public.compensation_settings WHERE id=1;
  NEW.hourly_rate := coalesce(NEW.hourly_rate,profile.hourly_rate);
  NEW.compensation_snapshot := jsonb_build_object('profile',to_jsonb(profile),'settings',to_jsonb(settings));
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.default_employee_time_rate() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER default_employee_time_rate BEFORE INSERT OR UPDATE ON public.time_entries FOR EACH ROW EXECUTE FUNCTION public.default_employee_time_rate();
COMMIT;
