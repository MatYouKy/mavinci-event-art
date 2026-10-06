-- Prowizja wynika z jawnego przypisania osoby do płatnika wydarzenia,
-- nie z samego faktu, że osoba pracuje w organizacji.
-- Nie przeliczamy historycznych naliczeń ani nie cofamy wypłat/anulowań.
BEGIN;

ALTER TABLE public.event_commissions
  ADD COLUMN IF NOT EXISTS automatic_source text,
  ADD COLUMN IF NOT EXISTS automatic_company_id uuid REFERENCES public.my_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS automatic_waiting_for_offer boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.protect_pending_billing_commission()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.automatic_waiting_for_offer AND NEW.automatic_waiting_for_offer THEN
    IF NEW.status IN ('approved', 'paid') THEN
      RAISE EXCEPTION 'Najpierw ustal podstawę prowizji: zaakceptuj ofertę lub zapisz ręczne naliczenie.';
    END IF;
    -- Ręczna edycja przerywa oczekiwanie automatu. Sam odczyt go nie zmienia.
    IF NEW.status <> 'planned' OR
       ROW(NEW.event_id, NEW.sales_partner_id, NEW.contact_id, NEW.employee_id,
           NEW.organization_id, NEW.calculation_type, NEW.rate, NEW.base_amount,
           NEW.amount, NEW.payment_method, NEW.dividend_tax_rate, NEW.base_description,
           NEW.notes, NEW.due_date)
       IS DISTINCT FROM
       ROW(OLD.event_id, OLD.sales_partner_id, OLD.contact_id, OLD.employee_id,
           OLD.organization_id, OLD.calculation_type, OLD.rate, OLD.base_amount,
           OLD.amount, OLD.payment_method, OLD.dividend_tax_rate, OLD.base_description,
           OLD.notes, OLD.due_date) THEN
      NEW.automatic_waiting_for_offer := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_pending_billing_commission ON public.event_commissions;
CREATE TRIGGER trg_protect_pending_billing_commission
BEFORE UPDATE ON public.event_commissions
FOR EACH ROW EXECUTE FUNCTION public.protect_pending_billing_commission();

CREATE OR REPLACE FUNCTION public.sync_event_billing_seller_commissions(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  e public.events%ROWTYPE;
  o public.offers%ROWTYPE;
  previous public.event_commissions%ROWTYPE;
  seller record;
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
  -- Serializacja zapisów tego samego wydarzenia. ID jest zgodne z automatem API.
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-commission:' || p_event_id::text, 0));
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR e.billing_arrangement = 'direct' OR e.billing_organization_id IS NULL
     OR e.my_company_id IS NULL THEN
    RETURN jsonb_build_object('matched', 0, 'eligible', 0, 'created', 0, 'completed', 0, 'waiting', 0);
  END IF;

  SELECT * INTO o FROM public.offers
  WHERE event_id = e.id AND status = 'accepted'
  ORDER BY created_at DESC, id LIMIT 1;

  IF o.id IS NOT NULL AND (o.my_company_id IS NULL OR o.my_company_id = e.my_company_id) THEN
    -- Ta sama podstawa netto po rabacie co getOfferTotals; budżet nie jest podstawą.
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
    SELECT p.id, p.contact_id, p.employee_id, p.partner_type, p.status,
      coalesce(nullif(c.full_name, ''), nullif(concat_ws(' ', c.first_name, c.last_name), '')) AS name,
      t.is_active, t.commission_enabled, t.default_commission_rate,
      t.default_payment_method, t.dividend_tax_rate
    FROM public.event_billing_contacts b
    JOIN public.sales_partner_profiles p ON p.contact_id = b.contact_id
    JOIN public.contacts c ON c.id = b.contact_id
    LEFT JOIN public.sales_partner_brand_terms t
      ON t.sales_partner_id = p.id AND t.my_company_id = e.my_company_id
    WHERE b.event_id = e.id AND b.organization_id = e.billing_organization_id
      AND EXISTS (SELECT 1 FROM public.contact_organizations r
        WHERE r.contact_id = b.contact_id AND r.organization_id = b.organization_id AND r.is_current)
    ORDER BY p.id
  LOOP
    matched := matched + 1;
    IF seller.status <> 'active' OR NOT coalesce(seller.is_active, false)
       OR NOT coalesce(seller.commission_enabled, false) OR seller.name IS NULL THEN CONTINUE; END IF;
    -- Właściciel oferty z narzutem nie dostaje dodatkowo prowizji procentowej.
    IF ready AND o.sales_partner_id = seller.id AND o.commercial_model = 'markup' THEN CONTINUE; END IF;
    rate := CASE WHEN ready AND o.sales_partner_id = seller.id AND o.commercial_model = 'commission'
      THEN o.partner_commission_rate ELSE seller.default_commission_rate END;
    IF coalesce(rate, 0) <= 0 THEN CONTINUE; END IF;
    eligible := eligible + 1;

    -- Wpis ręczny, wypłacony i anulowany również blokuje duplikat.
    SELECT * INTO previous FROM public.event_commissions c
    WHERE c.event_id = e.id AND (c.sales_partner_id = seller.id
      OR c.contact_id = seller.contact_id
      OR (seller.employee_id IS NOT NULL AND c.employee_id = seller.employee_id))
    ORDER BY c.created_at, c.id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF previous.automatic_source = 'billing_contact' AND previous.automatic_waiting_for_offer
         AND previous.automatic_company_id = e.my_company_id AND previous.status = 'planned'
         AND previous.calculation_type = 'percent' AND previous.amount = 0 AND previous.base_amount = 0 THEN
        IF ready THEN
          -- Zachowujemy zapisany procent i sposób wypłaty; uzupełniamy tylko podstawę.
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
      seller.name, seller.employee_id, seller.contact_id, e.billing_organization_id, 'percent', rate,
      CASE WHEN ready THEN net ELSE 0 END, 0,
      CASE WHEN ready THEN 'Wartość netto zaakceptowanej oferty' ELSE 'Oczekuje na zaakceptowaną ofertę — podstawa netto nieustalona' END,
      seller.default_payment_method, seller.dividend_tax_rate, 'planned', public.current_workflow_employee_id(),
      'billing_contact', e.my_company_id, NOT ready
    ) ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS affected = ROW_COUNT;
    added := added + affected;
    IF NOT ready THEN waiting := waiting + affected; END IF;
    -- Istniejący trigger calculate_event_commission_cost wylicza kwotę oraz koszt spółki.
  END LOOP;

  RETURN jsonb_build_object('matched', matched, 'eligible', eligible, 'created', added,
    'completed', completed, 'waiting', waiting);
END;
$$;

-- Klient nie może wywołać uprzywilejowanego automatu dla obcego wydarzenia.
-- API najpierw sprawdza pracownika, finanse, widoczność wydarzenia i markę.
REVOKE ALL ON FUNCTION public.sync_event_billing_seller_commissions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_billing_seller_commissions(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_billing_commissions_after_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (
    coalesce(public.current_session_is_seller_portal(), true)
    OR NOT coalesce(public.can_view_event_commercials(NEW.event_id, true), false)
    OR NOT coalesce(public.current_employee_can_access_event_company(NEW.event_id), false)
  ) THEN RAISE EXCEPTION 'Brak uprawnień do przypisania sprzedawcy w rozliczeniu tego wydarzenia'; END IF;
  PERFORM public.sync_event_billing_seller_commissions(NEW.event_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_billing_commissions_after_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.billing_arrangement, NEW.billing_organization_id, NEW.my_company_id)
     IS DISTINCT FROM ROW(OLD.billing_arrangement, OLD.billing_organization_id, OLD.my_company_id) THEN
    PERFORM public.sync_event_billing_seller_commissions(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_billing_commissions_after_offer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.event_id IS NOT NULL AND NEW.status = 'accepted' THEN
    PERFORM public.sync_event_billing_seller_commissions(NEW.event_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_billing_commissions_after_contact() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_billing_commissions_after_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_billing_commissions_after_offer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_billing_contact_seller_commissions ON public.event_billing_contacts;
CREATE TRIGGER trg_billing_contact_seller_commissions
AFTER INSERT OR UPDATE OF event_id, contact_id, organization_id ON public.event_billing_contacts
FOR EACH ROW EXECUTE FUNCTION public.sync_billing_commissions_after_contact();

DROP TRIGGER IF EXISTS trg_event_billing_seller_commissions ON public.events;
CREATE TRIGGER trg_event_billing_seller_commissions
AFTER UPDATE OF billing_arrangement, billing_organization_id, my_company_id ON public.events
FOR EACH ROW EXECUTE FUNCTION public.sync_billing_commissions_after_event();

DROP TRIGGER IF EXISTS trg_accepted_offer_billing_commissions ON public.offers;
CREATE TRIGGER trg_accepted_offer_billing_commissions
AFTER INSERT OR UPDATE OF status, event_id, my_company_id, subtotal, discount_amount,
  tax_amount, tax_percent, total_amount, commercial_model, partner_commission_rate, sales_partner_id
ON public.offers FOR EACH ROW EXECUTE FUNCTION public.sync_billing_commissions_after_offer();

COMMENT ON COLUMN public.event_commissions.automatic_waiting_for_offer IS
  'Planowane przypisanie ze stawką sprzedawcy, ale bez podstawy. Nie jest kwotą do wypłaty. Ręczna edycja kończy automatyczne oczekiwanie.';
-- Bez masowego backfillu: starsze powiązania uzupełnia API przy otwarciu wydarzenia.
NOTIFY pgrst, 'reload schema';
COMMIT;
