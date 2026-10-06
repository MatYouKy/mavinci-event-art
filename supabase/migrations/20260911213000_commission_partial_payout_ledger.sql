-- Rejestruje potwierdzone przez użytkownika wypłaty, nie wykonuje przelewów.
-- Bez backfillu: starsze paid bez wpisów są prezentowane jako historia legacy.
BEGIN;

CREATE TABLE public.event_commission_payouts (
  id uuid PRIMARY KEY,
  commission_id uuid NOT NULL REFERENCES public.event_commissions(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  my_company_id uuid REFERENCES public.my_companies(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0 AND amount::text NOT IN ('NaN', 'Infinity', '-Infinity')),
  currency text NOT NULL DEFAULT 'PLN' CHECK (currency = 'PLN'),
  payment_date date NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('cash_dividend', 'invoice', 'payroll', 'other')),
  reference text CHECK (length(reference) <= 200),
  note text CHECK (length(note) <= 2000),
  -- UUID Auth pozostaje identyfikatorem autora także po zamknięciu jego konta.
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_commission_payouts_commission_date_idx
  ON public.event_commission_payouts(commission_id, payment_date, recorded_at);
CREATE INDEX event_commission_payouts_event_idx ON public.event_commission_payouts(event_id);
ALTER TABLE public.event_commission_payouts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.commission_settlement_can_access(p_event_id uuid DEFAULT NULL, p_manage boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT coalesce(auth.uid() IS NOT NULL
    AND NOT public.current_session_is_seller_portal()
    AND EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE (employee.id = auth.uid() OR employee.auth_user_id = auth.uid())
        AND employee.is_active = true
        AND (employee.role::text = 'admin' OR employee.access_level::text = 'admin'
          OR 'admin' = ANY(coalesce(employee.permissions, ARRAY[]::text[]))
          OR 'finances_manage' = ANY(coalesce(employee.permissions, ARRAY[]::text[]))
          OR (NOT p_manage AND 'finances_view' = ANY(coalesce(employee.permissions, ARRAY[]::text[]))))
    ) AND (p_event_id IS NULL OR (
      public.current_employee_can_view_event(p_event_id)
      AND public.current_employee_can_access_event_company(p_event_id)
    )), false);
$$;
REVOKE ALL ON FUNCTION public.commission_settlement_can_access(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commission_settlement_can_access(uuid, boolean) TO authenticated, service_role;

CREATE POLICY commission_payouts_finance_read ON public.event_commission_payouts
  FOR SELECT TO authenticated USING (public.commission_settlement_can_access(event_id, false));
-- Sprzedawca otrzymuje wyłącznie wybrane pola przez RPC; notatka jest wewnętrzna.
REVOKE ALL ON public.event_commission_payouts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.event_commission_payouts TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_commission_payout_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Historia wypłat jest trwała. Nie można zmieniać ani usuwać odnotowanej wypłaty.';
END;
$$;
CREATE TRIGGER trg_immutable_commission_payout
BEFORE UPDATE OR DELETE ON public.event_commission_payouts
FOR EACH ROW EXECUTE FUNCTION public.prevent_commission_payout_mutation();

CREATE OR REPLACE FUNCTION public.protect_commission_settlement_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  paid numeric;
  last_payment date;
BEGIN
  SELECT coalesce(sum(p.amount), 0), max(p.payment_date) INTO paid, last_payment
    FROM public.event_commission_payouts p WHERE p.commission_id = OLD.id;
  IF TG_OP = 'DELETE' THEN
    IF paid > 0 OR OLD.status = 'paid' THEN
      RAISE EXCEPTION 'Nie można usunąć prowizji z historią wypłaty.';
    END IF;
    RETURN OLD;
  END IF;
  IF paid > 0 OR OLD.status = 'paid' THEN
    IF ROW(NEW.id, NEW.event_id, NEW.sales_partner_id, NEW.employee_id, NEW.salesperson_id,
           NEW.contact_id, NEW.organization_id, NEW.beneficiary_type, NEW.beneficiary_name,
           NEW.calculation_type, NEW.rate, NEW.base_amount, NEW.amount, NEW.payment_method,
           NEW.dividend_tax_rate, coalesce(NEW.company_cost_amount, NEW.amount), NEW.automatic_company_id,
           NEW.automatic_waiting_for_offer, NEW.automatic_source)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.event_id, OLD.sales_partner_id, OLD.employee_id, OLD.salesperson_id,
           OLD.contact_id, OLD.organization_id, OLD.beneficiary_type, OLD.beneficiary_name,
           OLD.calculation_type, OLD.rate, OLD.base_amount, OLD.amount, OLD.payment_method,
           OLD.dividend_tax_rate, coalesce(OLD.company_cost_amount, OLD.amount), OLD.automatic_company_id,
           OLD.automatic_waiting_for_offer, OLD.automatic_source) THEN
      RAISE EXCEPTION 'Prowizja ma historię wypłaty. Nie można zmieniać odbiorcy, wydarzenia ani naliczonej kwoty.';
    END IF;
    IF paid > 0 THEN
      IF paid > OLD.amount OR NEW.status <> (CASE WHEN paid = OLD.amount THEN 'paid' ELSE 'approved' END) THEN
        RAISE EXCEPTION 'Status prowizji wynika z odnotowanych wypłat. Pozostałą kwotę rozlicz w historii wypłat.';
      END IF;
      IF NEW.paid_at IS DISTINCT FROM (CASE WHEN paid = OLD.amount
        THEN last_payment::timestamp AT TIME ZONE 'Europe/Warsaw' ELSE NULL::timestamptz END) THEN
        RAISE EXCEPTION 'Data pełnej wypłaty wynika z historii rozliczeń.';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
      RAISE EXCEPTION 'Historyczna wypłata pozostaje w rejestrze. Nie można ponownie otworzyć jej do wypłaty.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- Po kalkulacji kwoty i pozostałych istniejących BEFORE triggerach.
CREATE TRIGGER zzzz_protect_commission_settlement_history
BEFORE UPDATE OR DELETE ON public.event_commissions
FOR EACH ROW EXECUTE FUNCTION public.protect_commission_settlement_history();

CREATE OR REPLACE FUNCTION public.protect_payout_event_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.my_company_id IS DISTINCT FROM OLD.my_company_id AND EXISTS (
    SELECT 1 FROM public.event_commission_payouts p WHERE p.event_id = OLD.id
  ) THEN RAISE EXCEPTION 'Wydarzenie ma odnotowane wypłaty prowizji. Nie można przenieść historii do innej marki.'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_protect_payout_event_company
BEFORE UPDATE OF my_company_id ON public.events
FOR EACH ROW EXECUTE FUNCTION public.protect_payout_event_company();

CREATE OR REPLACE FUNCTION public.record_commission_settlement(
  p_commission_id uuid,
  p_action text DEFAULT 'payout',
  p_amount numeric DEFAULT NULL,
  p_payment_date date DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_expected_amount numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  commission public.event_commissions%ROWTYPE;
  previous public.event_commission_payouts%ROWTYPE;
  event_id_to_lock uuid;
  company_id uuid;
  paid numeric;
  final_amount numeric;
  last_payment date;
  normalized_reference text := nullif(btrim(p_reference), '');
  normalized_note text := nullif(btrim(p_note), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.commission_settlement_can_access(NULL, true) THEN
    RAISE EXCEPTION 'Brak uprawnień do rozliczania prowizji.' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve', 'payout') THEN RAISE EXCEPTION 'Nieprawidłowa operacja.'; END IF;
  IF p_action = 'payout' THEN
    IF p_idempotency_key IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_amount <= 0 OR p_amount >= 1000000000000 OR p_amount <> round(p_amount, 2)
       OR p_payment_date IS NULL OR p_payment_date < DATE '1900-01-01'
       OR p_payment_date > (current_timestamp AT TIME ZONE 'Europe/Warsaw')::date
       OR length(p_reference) > 200 OR length(p_note) > 2000 THEN
      RAISE EXCEPTION 'Podaj dodatnią kwotę do dwóch miejsc po przecinku, rzeczywistą datę dokonanej wypłaty oraz poprawny identyfikator.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('commission-payout:' || p_idempotency_key::text, 0));
  END IF;
  SELECT c.event_id INTO event_id_to_lock FROM public.event_commissions c WHERE c.id = p_commission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono prowizji.'; END IF;
  -- Stała kolejność blokad chroni również przed równoczesną zmianą marki.
  SELECT e.my_company_id INTO company_id FROM public.events e WHERE e.id = event_id_to_lock FOR SHARE;
  SELECT * INTO commission FROM public.event_commissions c WHERE c.id = p_commission_id FOR UPDATE;
  IF NOT FOUND OR commission.event_id IS DISTINCT FROM event_id_to_lock THEN
    RAISE EXCEPTION 'Prowizja zmieniła wydarzenie. Odśwież rozliczenia.';
  END IF;
  IF NOT public.commission_settlement_can_access(commission.event_id, true) THEN
    RAISE EXCEPTION 'Brak dostępu do rozliczenia tego wydarzenia.' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'approve' THEN
    IF p_expected_amount IS NULL OR p_expected_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_expected_amount <= 0 OR p_expected_amount IS DISTINCT FROM commission.amount
       OR commission.automatic_waiting_for_offer OR commission.status NOT IN ('planned', 'approved') THEN
      RAISE EXCEPTION 'Zatwierdzenie wymaga aktualnej dodatniej kwoty i ustalonej podstawy prowizji. Odśwież dane.';
    END IF;
    IF commission.status = 'approved' THEN
      RETURN jsonb_build_object('ok', true, 'commissionId', commission.id, 'duplicate', true);
    END IF;
    UPDATE public.event_commissions SET status = 'approved' WHERE id = commission.id RETURNING amount INTO final_amount;
    IF final_amount IS DISTINCT FROM p_expected_amount THEN
      RAISE EXCEPTION 'Kwota prowizji wymaga ponownego przeliczenia. Zapisz naliczenie przed zatwierdzeniem.';
    END IF;
    RETURN jsonb_build_object('ok', true, 'commissionId', commission.id, 'duplicate', false);
  END IF;

  SELECT * INTO previous FROM public.event_commission_payouts WHERE id = p_idempotency_key;
  IF FOUND THEN
    IF previous.commission_id IS DISTINCT FROM commission.id OR previous.amount IS DISTINCT FROM p_amount
       OR previous.payment_date IS DISTINCT FROM p_payment_date OR previous.reference IS DISTINCT FROM normalized_reference
       OR previous.note IS DISTINCT FROM normalized_note OR previous.recorded_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Identyfikator operacji został już wykorzystany z innymi danymi. Nie zapisano drugiej wypłaty.';
    END IF;
    RETURN jsonb_build_object('ok', true, 'commissionId', commission.id, 'paymentId', previous.id, 'duplicate', true);
  END IF;
  IF commission.status <> 'approved' OR commission.automatic_waiting_for_offer OR commission.amount <= 0 THEN
    RAISE EXCEPTION 'Wypłatę można zapisać tylko dla zatwierdzonej prowizji z ustaloną dodatnią kwotą.';
  END IF;
  SELECT coalesce(sum(p.amount), 0) INTO paid FROM public.event_commission_payouts p WHERE p.commission_id = commission.id;
  IF p_amount > commission.amount - paid THEN
    RAISE EXCEPTION 'Kwota przekracza pozostałą prowizję. Odśwież dane — inna wypłata mogła już zostać zapisana.';
  END IF;
  INSERT INTO public.event_commission_payouts (
    id, commission_id, event_id, my_company_id, amount, payment_date, payment_method, reference, note, recorded_by
  ) VALUES (
    p_idempotency_key, commission.id, commission.event_id, company_id, p_amount, p_payment_date,
    commission.payment_method, normalized_reference, normalized_note, auth.uid()
  );
  SELECT max(p.payment_date) INTO last_payment FROM public.event_commission_payouts p WHERE p.commission_id = commission.id;
  UPDATE public.event_commissions SET
    status = CASE WHEN paid + p_amount = commission.amount THEN 'paid' ELSE 'approved' END,
    paid_at = CASE WHEN paid + p_amount = commission.amount THEN last_payment::timestamp AT TIME ZONE 'Europe/Warsaw' ELSE NULL END
  WHERE id = commission.id;
  RETURN jsonb_build_object('ok', true, 'commissionId', commission.id, 'paymentId', p_idempotency_key, 'duplicate', false);
END;
$$;
REVOKE ALL ON FUNCTION public.record_commission_settlement(uuid, text, numeric, date, text, text, uuid, numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_commission_settlement(uuid, text, numeric, date, text, text, uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_commission_settlements(
  p_mode text DEFAULT 'crm', p_account_type text DEFAULT NULL, p_account_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  seller_id uuid;
  account_type text := p_account_type;
  account_id uuid := p_account_id;
  rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Wymagane logowanie.' USING ERRCODE = '42501'; END IF;
  IF p_mode = 'seller' THEN
    IF p_account_id IS NOT NULL OR p_account_type IS NOT NULL THEN
      RAISE EXCEPTION 'Portal udostępnia tylko własne konto.' USING ERRCODE = '42501';
    END IF;
    seller_id := public.current_sales_partner_id();
    IF seller_id IS NULL THEN RAISE EXCEPTION 'Brak dostępu do portalu sprzedawcy.' USING ERRCODE = '42501'; END IF;
    account_type := 'partner'; account_id := seller_id;
  ELSIF p_mode = 'crm' THEN
    IF NOT public.commission_settlement_can_access(NULL, false) THEN
      RAISE EXCEPTION 'Brak dostępu do finansów.' USING ERRCODE = '42501';
    END IF;
    IF account_type IS NULL OR account_type NOT IN ('contact', 'partner', 'employee', 'organization') OR account_id IS NULL THEN
      RAISE EXCEPTION 'Wybierz prawidłowe konto prowizji.';
    END IF;
  ELSE RAISE EXCEPTION 'Nieprawidłowy widok rozliczeń.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'event_id', c.event_id, 'event_name', e.name, 'event_date', e.event_date,
    'my_company_id', e.my_company_id, 'company_name', company.name,
    'can_manage', p_mode = 'crm' AND public.commission_settlement_can_access(c.event_id, true),
    'beneficiary_name', c.beneficiary_name, 'amount', c.amount,
    'company_cost_amount', CASE WHEN p_mode = 'crm' THEN coalesce(c.company_cost_amount, c.amount) ELSE NULL END,
    'status', c.status, 'automatic_waiting_for_offer', c.automatic_waiting_for_offer,
    'created_at', c.created_at, 'due_date', c.due_date, 'payment_method', c.payment_method,
    'paid_amount', CASE WHEN payments.count = 0 AND c.status = 'paid' THEN c.amount ELSE payments.total END,
    'remaining_amount', CASE WHEN c.status IN ('cancelled', 'paid') THEN 0 ELSE greatest(0, c.amount - payments.total) END,
    'payments', CASE WHEN payments.count = 0 AND c.status = 'paid' THEN jsonb_build_array(jsonb_build_object(
      'id', 'legacy:' || c.id::text, 'commission_id', c.id, 'amount', c.amount,
      'payment_date', (c.paid_at AT TIME ZONE 'Europe/Warsaw')::date,
      'recorded_at', NULL, 'reference', NULL, 'note', NULL, 'source', 'legacy'
    )) ELSE payments.entries END
  ) ORDER BY e.event_date DESC NULLS LAST, c.created_at DESC, c.id), '[]'::jsonb)
  INTO rows
  FROM public.event_commissions c
  JOIN public.events e ON e.id = c.event_id
  LEFT JOIN public.my_companies company ON company.id = e.my_company_id
  LEFT JOIN public.sales_partner_profiles profile ON profile.id = c.sales_partner_id
  CROSS JOIN LATERAL (
    SELECT count(*) AS count, coalesce(sum(p.amount), 0) AS total,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'commission_id', p.commission_id, 'amount', p.amount,
        'payment_date', p.payment_date, 'recorded_at', p.recorded_at,
        'reference', p.reference, 'note', CASE WHEN p_mode = 'crm' THEN p.note ELSE NULL END,
        'source', 'ledger'
      ) ORDER BY p.payment_date DESC, p.recorded_at DESC, p.id), '[]'::jsonb) AS entries
    FROM public.event_commission_payouts p WHERE p.commission_id = c.id
  ) payments
  WHERE (p_mode = 'seller' OR public.commission_settlement_can_access(c.event_id, false))
    AND CASE account_type
      WHEN 'contact' THEN c.contact_id = account_id OR profile.contact_id = account_id
      WHEN 'employee' THEN c.employee_id = account_id OR c.salesperson_id = account_id OR profile.employee_id = account_id
      WHEN 'organization' THEN c.organization_id = account_id
      WHEN 'partner' THEN c.sales_partner_id = account_id OR (c.sales_partner_id IS NULL AND EXISTS (
        SELECT 1 FROM public.sales_partner_profiles own_profile WHERE own_profile.id = account_id
          AND ((own_profile.contact_id IS NOT NULL AND c.contact_id = own_profile.contact_id)
            OR (own_profile.employee_id IS NOT NULL AND (c.employee_id = own_profile.employee_id OR c.salesperson_id = own_profile.employee_id)))
      ))
      ELSE false END;
  RETURN jsonb_build_object('mode', p_mode, 'accountType', account_type, 'accountId', account_id,
    'canManage', p_mode = 'crm' AND public.commission_settlement_can_access(NULL, true),
    'currency', 'PLN', 'commissions', rows);
END;
$$;
REVOKE ALL ON FUNCTION public.get_commission_settlements(text, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_commission_settlements(text, text, uuid) TO authenticated;

COMMENT ON TABLE public.event_commission_payouts IS
  'Niezmienny rejestr odnotowanych przez finanse wypłat nominalnej prowizji PLN. Nie zleca przelewów; id jest kluczem idempotencji operacji.';
NOTIFY pgrst, 'reload schema';
COMMIT;
