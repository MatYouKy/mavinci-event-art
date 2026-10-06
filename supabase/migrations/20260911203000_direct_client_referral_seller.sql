BEGIN;

-- Polecenie wydarzenia jest niezależne od nabywcy faktury i osób płatnika.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS referring_sales_partner_id uuid
    REFERENCES public.sales_partner_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_referring_sales_partner
  ON public.events(referring_sales_partner_id)
  WHERE referring_sales_partner_id IS NOT NULL;

COMMENT ON COLUMN public.events.referring_sales_partner_id IS
  'Jawnie wybrany sprzedawca polecający wydarzenie. Nie zmienia klienta, nabywcy ani sposobu rozliczenia. Usunięcie powiązania nie usuwa historii naliczonych prowizji.';

CREATE OR REPLACE FUNCTION public.validate_event_referring_sales_partner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  partner_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.referring_sales_partner_id IS NOT DISTINCT FROM OLD.referring_sales_partner_id THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.referring_sales_partner_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF coalesce(public.current_session_is_seller_portal(), true) THEN
      RAISE EXCEPTION 'Polecającego sprzedawcę przypisuje pracownik CRM, nie portal sprzedawcy';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF NOT coalesce(public.can_view_event_commercials(NEW.id, true), false)
         OR NOT coalesce(public.current_employee_can_access_event_company(NEW.id), false) THEN
        RAISE EXCEPTION 'Brak uprawnień do zmiany sprzedawcy polecającego to wydarzenie';
      END IF;
    ELSIF NOT coalesce(public.finance_can_manage(), false) THEN
      RAISE EXCEPTION 'Brak uprawnień do przypisania prowizji przy tworzeniu wydarzenia';
    END IF;
    IF NEW.my_company_id IS NOT NULL
       AND NOT coalesce(public.current_employee_can_access_company(NEW.my_company_id), false) THEN
      RAISE EXCEPTION 'Brak dostępu do marki wydarzenia';
    END IF;
  ELSIF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Zaloguj się, aby przypisać sprzedawcę polecającego';
  END IF;

  IF NEW.referring_sales_partner_id IS NULL THEN RETURN NEW; END IF;

  -- FOR SHARE chroni przed równoczesnym wyłączeniem profilu podczas przypisania.
  SELECT p.status INTO partner_status FROM public.sales_partner_profiles p
  WHERE p.id = NEW.referring_sales_partner_id FOR SHARE;
  IF NOT FOUND OR partner_status <> 'active' THEN
    RAISE EXCEPTION 'Sprzedawca nie istnieje albo jest nieaktywny. Odśwież listę i wybierz aktywny profil';
  END IF;
  -- Brak warunków marki nie zabrania zapisania polecenia; blokuje naliczenie.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_event_referring_sales_partner()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_validate_event_referring_sales_partner ON public.events;
CREATE TRIGGER trg_validate_event_referring_sales_partner
BEFORE INSERT OR UPDATE OF referring_sales_partner_id ON public.events
FOR EACH ROW EXECUTE FUNCTION public.validate_event_referring_sales_partner();

CREATE OR REPLACE FUNCTION public.sync_event_billing_seller_commissions(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  e public.events%ROWTYPE;
  o public.offers%ROWTYPE;
  previous public.event_commissions%ROWTYPE;
  terms public.sales_partner_brand_terms%ROWTYPE;
  seller record;
  current_partner_status text;
  net numeric := 0;
  list_net numeric := 0;
  discount numeric := 0;
  rate numeric;
  ready boolean := false;
  hash text;
  commission_id uuid;
  affected integer;
  matched integer := 0;
  eligible integer := 0;
  added integer := 0;
  completed integer := 0;
  waiting integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-commission:' || p_event_id::text, 0));
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR e.my_company_id IS NULL THEN
    RETURN jsonb_build_object('matched', 0, 'eligible', 0, 'created', 0, 'completed', 0, 'waiting', 0);
  END IF;

  SELECT * INTO o FROM public.offers
  WHERE event_id = e.id AND status = 'accepted'
  ORDER BY created_at DESC, id LIMIT 1;
  IF o.id IS NOT NULL AND (o.my_company_id IS NULL OR o.my_company_id = e.my_company_id) THEN
    discount := greatest(0, coalesce(o.discount_amount, 0));
    list_net := greatest(0, coalesce(o.subtotal, 0));
    IF list_net = 0 AND coalesce(o.total_amount, 0) > 0 THEN
      list_net := CASE WHEN coalesce(o.tax_amount, 0) > 0
        THEN greatest(0, o.total_amount - o.tax_amount)
        ELSE o.total_amount / (1 + greatest(0, coalesce(o.tax_percent, 23)) / 100)
      END + discount;
    END IF;
    net := round(greatest(0, list_net - discount), 2);
    ready := net > 0;
  END IF;

  FOR seller IN
    SELECT p.id, p.contact_id, p.employee_id, p.partner_type,
      coalesce(
        nullif(btrim(concat_ws(' ', employee.name, employee.surname)), ''),
        nullif(c.full_name, ''),
        nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')
      ) AS name,
      CASE WHEN p.id = e.referring_sales_partner_id
        THEN p.organization_id ELSE e.billing_organization_id END AS organization_id,
      CASE WHEN p.id = e.referring_sales_partner_id
        THEN 'event_referral' ELSE 'billing_contact' END AS source
    FROM public.sales_partner_profiles p
    LEFT JOIN public.contacts c ON c.id = p.contact_id
    LEFT JOIN public.employees employee ON employee.id = p.employee_id
    WHERE p.id = e.referring_sales_partner_id
      OR (
        e.billing_arrangement <> 'direct' AND e.billing_organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.event_billing_contacts b
          WHERE b.event_id = e.id AND b.organization_id = e.billing_organization_id
            AND b.contact_id = p.contact_id
            AND EXISTS (
              SELECT 1 FROM public.contact_organizations r
              WHERE r.contact_id = b.contact_id AND r.organization_id = b.organization_id AND r.is_current
            )
        )
      )
    ORDER BY p.id
  LOOP
    matched := matched + 1;
    SELECT p.status INTO current_partner_status
    FROM public.sales_partner_profiles p WHERE p.id = seller.id FOR SHARE;
    IF NOT FOUND OR current_partner_status <> 'active' OR seller.name IS NULL THEN CONTINUE; END IF;

    -- Korzystamy wyłącznie z aktualnych warunków marki wydarzenia, nie marki
    -- sprzedawcy ani innej oferty. Blokada chroni naliczenie podczas ich edycji.
    SELECT * INTO terms FROM public.sales_partner_brand_terms t
    WHERE t.sales_partner_id = seller.id AND t.my_company_id = e.my_company_id
    FOR SHARE;
    IF NOT FOUND OR NOT coalesce(terms.is_active, false)
       OR NOT coalesce(terms.commission_enabled, false) THEN CONTINUE; END IF;
    IF ready AND o.sales_partner_id = seller.id AND o.commercial_model = 'markup' THEN CONTINUE; END IF;
    rate := CASE WHEN ready AND o.sales_partner_id = seller.id AND o.commercial_model = 'commission'
      THEN o.partner_commission_rate ELSE terms.default_commission_rate END;
    IF coalesce(rate, 0) <= 0 THEN CONTINUE; END IF;
    eligible := eligible + 1;

    -- Jeden beneficjent na wydarzenie: także ręczne, zatwierdzone, wypłacone
    -- oraz anulowane naliczenia blokują automatyczny duplikat.
    SELECT * INTO previous FROM public.event_commissions c
    WHERE c.event_id = e.id AND (c.sales_partner_id = seller.id
      OR (seller.contact_id IS NOT NULL AND c.contact_id = seller.contact_id)
      OR (seller.employee_id IS NOT NULL AND c.employee_id = seller.employee_id))
    ORDER BY c.created_at, c.id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF previous.automatic_source IN ('billing_contact', 'event_referral')
         AND previous.automatic_waiting_for_offer
         AND previous.automatic_company_id = e.my_company_id AND previous.status = 'planned'
         AND previous.calculation_type = 'percent' AND previous.amount = 0 AND previous.base_amount = 0 THEN
        IF ready THEN
          UPDATE public.event_commissions SET base_amount = net,
            base_description = 'Wartość netto zaakceptowanej oferty', automatic_waiting_for_offer = false
          WHERE id = previous.id AND automatic_waiting_for_offer AND status = 'planned';
          GET DIAGNOSTICS affected = ROW_COUNT;
          completed := completed + affected;
        ELSE
          waiting := waiting + 1;
        END IF;
      END IF;
      CONTINUE;
    END IF;

    hash := encode(sha256(convert_to('mavinci:event-commission:' || e.id::text || ':' || seller.id::text, 'UTF8')), 'hex');
    commission_id := (substr(hash, 1, 8) || '-' || substr(hash, 9, 4) || '-5' || substr(hash, 14, 3)
      || '-a' || substr(hash, 18, 3) || '-' || substr(hash, 21, 12))::uuid;
    INSERT INTO public.event_commissions (
      id, event_id, sales_partner_id, beneficiary_type, beneficiary_name, employee_id,
      contact_id, organization_id, calculation_type, rate, base_amount, amount,
      base_description, payment_method, dividend_tax_rate, status, created_by,
      automatic_source, automatic_company_id, automatic_waiting_for_offer
    ) VALUES (
      commission_id, e.id, seller.id,
      CASE WHEN seller.partner_type = 'internal_employee' THEN 'employee' ELSE 'salesperson' END,
      seller.name, seller.employee_id, seller.contact_id, seller.organization_id, 'percent', rate,
      CASE WHEN ready THEN net ELSE 0 END, 0,
      CASE WHEN ready THEN 'Wartość netto zaakceptowanej oferty' ELSE 'Oczekuje na zaakceptowaną ofertę — podstawa netto nieustalona' END,
      terms.default_payment_method, terms.dividend_tax_rate, 'planned', public.current_workflow_employee_id(),
      seller.source, e.my_company_id, NOT ready
    ) ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS affected = ROW_COUNT;
    added := added + affected;
    IF NOT ready THEN waiting := waiting + affected; END IF;
  END LOOP;

  RETURN jsonb_build_object('matched', matched, 'eligible', eligible, 'created', added,
    'completed', completed, 'waiting', waiting);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_event_billing_seller_commissions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_billing_seller_commissions(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_billing_commissions_after_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.referring_sales_partner_id IS NOT NULL THEN
      PERFORM public.sync_event_billing_seller_commissions(NEW.id);
    END IF;
  ELSIF ROW(NEW.billing_arrangement, NEW.billing_organization_id, NEW.my_company_id, NEW.referring_sales_partner_id)
     IS DISTINCT FROM ROW(OLD.billing_arrangement, OLD.billing_organization_id, OLD.my_company_id, OLD.referring_sales_partner_id) THEN
    PERFORM public.sync_event_billing_seller_commissions(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_billing_commissions_after_event() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_event_billing_seller_commissions ON public.events;
CREATE TRIGGER trg_event_billing_seller_commissions
AFTER INSERT OR UPDATE OF billing_arrangement, billing_organization_id, my_company_id, referring_sales_partner_id
ON public.events FOR EACH ROW EXECUTE FUNCTION public.sync_billing_commissions_after_event();

-- Istniejące triggery kontaktów i zaakceptowanych ofert używają tej samej funkcji.
-- Bez wstecznego przypisywania sprzedawców, usuwania ani przeliczania historii.
NOTIFY pgrst, 'reload schema';
COMMIT;
