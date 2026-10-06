-- Rentowność sprzedaży prowadzonej przez opiekuna. Bez przeliczania historii.
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.seller_partner_manager_id(uuid,uuid)') IS NULL
    OR to_regprocedure('public.commission_settlement_can_access(uuid,boolean)') IS NULL
    OR to_regclass('public.compensation_settings') IS NULL THEN
    RAISE EXCEPTION 'Najpierw uruchom migracje opiekuna, rozliczeń prowizji i wynagrodzeń pracowników.';
  END IF;
END $$;

CREATE TABLE public.seller_owner_profit_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE RESTRICT,
  event_id uuid REFERENCES public.events(id) ON DELETE RESTRICT,
  manager_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  owner_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id) ON DELETE RESTRICT,
  source_key text NOT NULL,
  costs_net numeric(14,2) NOT NULL CHECK(costs_net >= 0 AND costs_net::text NOT IN ('NaN','Infinity','-Infinity')),
  note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 2000),
  snapshot jsonb NOT NULL,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX seller_owner_profit_reviews_offer_idx ON public.seller_owner_profit_reviews(offer_id,recorded_at DESC,id);
ALTER TABLE public.seller_owner_profit_reviews ENABLE ROW LEVEL SECURITY;
-- Wewnętrzne koszty nie są dostępne przez REST ani RPC portalu sprzedawcy.
REVOKE ALL ON public.seller_owner_profit_reviews FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.event_commissions ADD COLUMN owner_profit_review_id uuid
  REFERENCES public.seller_owner_profit_reviews(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX event_commissions_owner_profit_event_idx ON public.event_commissions(event_id)
  WHERE owner_profit_review_id IS NOT NULL;
CREATE POLICY owner_profit_commissions_crm_only ON public.event_commissions AS RESTRICTIVE
  FOR ALL TO authenticated
  USING(owner_profit_review_id IS NULL OR public.commission_settlement_can_access(event_id,false))
  WITH CHECK(owner_profit_review_id IS NULL OR public.commission_settlement_can_access(event_id,true));

CREATE FUNCTION public.seller_owner_profit_access(p_offer uuid,p_manage boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT COALESCE(auth.uid() IS NOT NULL AND NOT public.current_session_is_seller_portal()
    AND public.seller_offer_can_manage(p_offer)
    AND EXISTS(SELECT 1 FROM public.offers o WHERE o.id=p_offer AND o.sales_channel='seller_portal'
      AND public.commission_settlement_can_access(o.event_id,p_manage)),false);
$$;

-- Private, authoritative input. Fingerprints include cost sources, not just
-- the offer total: changes require another explicit cost review before payout.
CREATE FUNCTION public.seller_owner_profit_context(p_offer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  o public.offers%ROWTYPE; e public.events%ROWTYPE; manager public.employees%ROWTYPE;
  owner_profile public.sales_partner_profiles%ROWTYPE;
  owner_terms public.sales_partner_brand_terms%ROWTYPE;
  seller_terms public.sales_partner_brand_terms%ROWTYPE;
  settings public.compensation_settings%ROWTYPE;
  v_manager uuid; v_net numeric; v_list numeric; v_discount numeric; v_revenue numeric;
  v_external numeric:=0; v_other numeric:=0; v_nominal numeric:=0; v_external_count integer:=0;
  v_cost_source text:='none'; v_issues jsonb:='[]'; v_input jsonb; v_commissions jsonb;
  v_costs jsonb; v_tasks jsonb; v_times jsonb; v_items jsonb; v_owner_conflict boolean:=false;
BEGIN
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer AND sales_channel='seller_portal';
  SELECT * INTO e FROM public.events WHERE id=o.event_id;
  v_manager:=public.seller_partner_manager_id(o.sales_partner_id,o.my_company_id);
  SELECT * INTO manager FROM public.employees WHERE id=v_manager;
  SELECT * INTO owner_profile FROM public.sales_partner_profiles WHERE employee_id=v_manager;
  SELECT * INTO owner_terms FROM public.sales_partner_brand_terms
    WHERE sales_partner_id=owner_profile.id AND my_company_id=o.my_company_id;
  SELECT * INTO seller_terms FROM public.sales_partner_brand_terms
    WHERE sales_partner_id=o.sales_partner_id AND my_company_id=o.my_company_id;
  SELECT * INTO settings FROM public.compensation_settings WHERE id=1;

  IF v_manager IS NULL OR NOT COALESCE(manager.is_active,false)
    OR NOT COALESCE(public.employee_can_access_company(v_manager,o.my_company_id),false) THEN
    v_issues:=v_issues||jsonb_build_array('Przypisz aktywnego opiekuna z dostępem do marki w kontakcie sprzedawcy.');
  END IF;
  IF owner_profile.id IS NULL OR owner_profile.status<>'active' OR NOT COALESCE(owner_terms.is_active AND owner_terms.commission_enabled,false)
    OR NOT COALESCE(owner_terms.default_commission_rate>0 AND owner_terms.default_commission_rate<=100,false) THEN
    v_issues:=v_issues||jsonb_build_array('Ustaw aktywną prowizję opiekuna dla tej marki w kartotece sprzedawców (procent od zysku, 0–100%).');
  END IF;
  IF owner_profile.id=o.sales_partner_id THEN
    v_issues:=v_issues||jsonb_build_array('Opiekun i sprzedawca są tą samą osobą. Nie naliczamy dwóch wynagrodzeń za tę samą sprzedaż.');
  END IF;
  IF owner_terms.default_payment_method='payroll' AND settings.id IS NULL THEN
    v_issues:=v_issues||jsonb_build_array('Brakuje konfiguracji kosztu pracodawcy w ustawieniach wynagrodzeń.');
  END IF;
  IF o.event_id IS NOT NULL AND (e.my_company_id IS DISTINCT FROM o.my_company_id OR e.financial_source='calculation') THEN
    v_issues:=v_issues||jsonb_build_array('Uzgodnij źródło finansowe wydarzenia z ofertą i jej marką przed naliczeniem prowizji.');
  END IF;
  IF EXISTS(SELECT 1 FROM public.offers x WHERE x.event_id=o.event_id AND x.id<>o.id AND x.status::text='accepted') THEN
    v_issues:=v_issues||jsonb_build_array('Wydarzenie ma kilka zaakceptowanych ofert. Najpierw uzgodnij podział kosztów — nie naliczamy prowizji wielokrotnie.');
  END IF;
  IF e.status::text='cancelled' OR o.status::text IN ('cancelled','rejected') THEN
    v_issues:=v_issues||jsonb_build_array('Oferta lub wydarzenie są anulowane albo odrzucone.');
  END IF;

  -- Parity with getOfferTotals().net. Markup is not company revenue.
  v_discount:=greatest(0,coalesce(o.discount_amount,0));
  v_list:=greatest(0,coalesce(o.subtotal,0));
  IF v_list=0 AND coalesce(o.total_amount,0)>0 THEN
    v_list:=CASE WHEN coalesce(o.tax_amount,0)>0 THEN greatest(0,o.total_amount-o.tax_amount)
      ELSE o.total_amount/(1+greatest(0,coalesce(o.tax_percent,23))/100) END+v_discount;
  END IF;
  v_net:=round(greatest(0,v_list-least(v_list,v_discount)),2);
  v_revenue:=CASE WHEN o.commercial_model='markup' THEN o.partner_base_net ELSE v_net END;
  IF v_revenue IS NULL OR v_revenue<=0 THEN
    v_issues:=v_issues||jsonb_build_array('Brakuje dodatniego przychodu netto firmy w ofercie.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'partner',c.sales_partner_id,'employee',c.employee_id,
    'salesperson',c.salesperson_id,'contact',c.contact_id,'amount',c.amount,'company_cost',c.company_cost_amount,
    'cancelled',c.status='cancelled','payment_method',c.payment_method) ORDER BY c.id),'[]') INTO v_commissions
    FROM public.event_commissions c WHERE c.event_id=o.event_id AND c.owner_profit_review_id IS NULL;
  SELECT EXISTS(SELECT 1 FROM public.event_commissions c WHERE c.event_id=o.event_id AND c.owner_profit_review_id IS NULL
    AND (c.employee_id=v_manager OR c.salesperson_id=v_manager OR c.sales_partner_id=owner_profile.id)) INTO v_owner_conflict;
  IF v_owner_conflict THEN
    v_issues:=v_issues||jsonb_build_array('Opiekun ma już starsze lub ręczne naliczenie w wydarzeniu. Rozlicz je świadomie — nie przeliczamy historii ani nie tworzymy drugiej prowizji.');
  END IF;
  SELECT count(*),coalesce(sum(CASE WHEN c.status<>'cancelled' THEN coalesce(c.company_cost_amount,c.amount) ELSE 0 END),0)
    INTO v_external_count,v_external FROM public.event_commissions c
    JOIN public.sales_partner_profiles p ON p.id=o.sales_partner_id
    WHERE c.event_id=o.event_id AND c.owner_profit_review_id IS NULL
      AND (c.sales_partner_id=p.id OR c.contact_id=p.contact_id OR c.employee_id=p.employee_id);
  SELECT coalesce(sum(coalesce(c.company_cost_amount,c.amount)),0) INTO v_other FROM public.event_commissions c
    WHERE c.event_id=o.event_id AND c.owner_profit_review_id IS NULL AND c.status<>'cancelled'
      AND NOT (coalesce(c.employee_id=v_manager,false) OR coalesce(c.salesperson_id=v_manager,false) OR coalesce(c.sales_partner_id=owner_profile.id,false))
      AND NOT EXISTS(SELECT 1 FROM public.sales_partner_profiles p WHERE p.id=o.sales_partner_id
        AND (c.sales_partner_id=p.id OR c.contact_id=p.contact_id OR c.employee_id=p.employee_id));
  IF o.commercial_model='markup' THEN
    v_cost_source:='markup';
    IF v_external>0 THEN
      v_issues:=v_issues||jsonb_build_array('Sprzedawca rozliczany narzutem ma także prowizję w wydarzeniu. Wyjaśnij podwójne naliczenie.');
    END IF;
  ELSIF v_external_count>0 THEN v_cost_source:='ledger';
  ELSIF seller_terms.id IS NULL OR NOT seller_terms.is_active THEN
    v_issues:=v_issues||jsonb_build_array('Uzupełnij warunki rozliczenia sprzedawcy zewnętrznego dla marki.');
  ELSIF seller_terms.commission_enabled THEN
    v_nominal:=round(v_net*greatest(0,coalesce(o.partner_commission_rate,seller_terms.default_commission_rate,0))/100,2);
    v_external:=CASE WHEN seller_terms.default_payment_method='cash_dividend'
      THEN round(v_nominal/(1-least(99.99,greatest(0,seller_terms.dividend_tax_rate))/100),2) ELSE v_nominal END;
    v_cost_source:=CASE WHEN v_external>0 THEN 'estimated' ELSE 'none' END;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'currency',c.currency,
    'category',c.category_id,'subcontractor',c.subcontractor_id,'rejected',c.status='rejected','note',c.notes) ORDER BY c.id),'[]')
    INTO v_costs FROM public.event_costs c WHERE c.event_id=o.event_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'agreed_cost',t.agreed_cost,'total_cost',t.total_cost,
    'cancelled',t.status::text='cancelled') ORDER BY t.id),'[]') INTO v_tasks FROM public.subcontractor_tasks t WHERE t.event_id=o.event_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'minutes',t.duration_minutes,'rate',t.hourly_rate,
    'compensation',t.compensation_snapshot,'end_time',t.end_time) ORDER BY t.id),'[]') INTO v_times FROM public.time_entries t WHERE t.event_id=o.event_id;
  SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') INTO v_items FROM public.offer_items i WHERE i.offer_id=o.id;
  v_input:=jsonb_build_object('offer',jsonb_build_object('id',o.id,'company',o.my_company_id,'event',o.event_id,
      'status',o.status,'model',o.commercial_model,'seller',o.sales_partner_id,'net',v_net,'revenue',v_revenue,'rate',o.partner_commission_rate),
    'manager',v_manager,'manager_active',manager.is_active,'owner_profile',to_jsonb(owner_profile),
    'owner_terms',to_jsonb(owner_terms),'seller_terms',to_jsonb(seller_terms),'settings',to_jsonb(settings),
    'event',jsonb_build_object('company',e.my_company_id,'source',e.financial_source,'calculation',e.accepted_calculation_id,'cancelled',e.status::text='cancelled'),
    'costs',v_costs,'subcontractors',v_tasks,'time',v_times,'items',v_items,'commissions',v_commissions,'issues',v_issues);
  RETURN jsonb_build_object('source_key',md5(v_input::text),'event_id',o.event_id,'offer_status',o.status,
    'manager_id',v_manager,'manager_name',nullif(btrim(concat_ws(' ',manager.name,manager.surname)),''),
    'owner_partner_id',owner_profile.id,'company_id',o.my_company_id,'revenue_net',v_revenue,'client_net',v_net,
    'commercial_model',o.commercial_model,'external_cost',v_external,'other_commissions_cost',v_other,'external_cost_source',v_cost_source,
    'rate',owner_terms.default_commission_rate,'payment_method',owner_terms.default_payment_method,
    'dividend_tax_rate',owner_terms.dividend_tax_rate,'employer_social_rate',settings.employer_social_rate,
    'issues',v_issues);
END;
$$;

CREATE FUNCTION public.get_seller_owner_profit(p_offer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ctx jsonb; review public.seller_owner_profit_reviews; c public.event_commissions;
BEGIN
  IF NOT public.seller_owner_profit_access(p_offer) THEN RAISE EXCEPTION 'Brak dostępu do wewnętrznej rentowności' USING ERRCODE='42501'; END IF;
  ctx:=public.seller_owner_profit_context(p_offer);
  SELECT * INTO review FROM public.seller_owner_profit_reviews WHERE offer_id=p_offer ORDER BY recorded_at DESC,id LIMIT 1;
  SELECT * INTO c FROM public.event_commissions WHERE event_id=(ctx->>'event_id')::uuid AND owner_profit_review_id IS NOT NULL;
  RETURN jsonb_build_object('context',ctx,'can_manage',public.seller_owner_profit_access(p_offer,true),
    'review',CASE WHEN review.id IS NULL THEN NULL ELSE to_jsonb(review) END,
    'history',coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'recorded_at',h.recorded_at,
      'recorded_by',coalesce((SELECT nullif(btrim(concat_ws(' ',emp.name,emp.surname)),'') FROM public.employees emp
        WHERE emp.id=h.recorded_by OR emp.auth_user_id=h.recorded_by ORDER BY emp.id LIMIT 1),'Pracownik CRM'),
      'costs_net',h.costs_net,'note',h.note,'base_amount',h.snapshot->'base_amount','amount',h.snapshot->'amount')
      ORDER BY h.recorded_at DESC,h.id) FROM (SELECT * FROM public.seller_owner_profit_reviews
        WHERE offer_id=p_offer ORDER BY recorded_at DESC,id LIMIT 10) h),'[]'::jsonb),
    'stale',review.id IS NOT NULL AND review.source_key IS DISTINCT FROM ctx->>'source_key',
    'commission',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'status',c.status,'amount',c.amount,
      'company_cost',c.company_cost_amount,'review_id',c.owner_profit_review_id,'employee_id',c.employee_id,
      'has_payouts',EXISTS(SELECT 1 FROM public.event_commission_payouts p WHERE p.commission_id=c.id)) END);
END;
$$;

CREATE FUNCTION public.save_seller_owner_profit_review(p_offer uuid,p_costs_net numeric,p_note text,p_expected_source text,p_expected_review uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ctx jsonb; previous_id uuid; v_base numeric; v_amount numeric; v_cost numeric; v_snapshot jsonb;
BEGIN
  IF NOT public.seller_owner_profit_access(p_offer,true) THEN RAISE EXCEPTION 'Brak uprawnień do kalkulacji rentowności' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_offer::text,18120000));
  PERFORM 1 FROM public.offers WHERE id=p_offer FOR UPDATE;
  SELECT id INTO previous_id FROM public.seller_owner_profit_reviews WHERE offer_id=p_offer ORDER BY recorded_at DESC,id LIMIT 1;
  IF previous_id IS DISTINCT FROM p_expected_review THEN RAISE EXCEPTION 'Ktoś zapisał nowszą kalkulację. Odśwież panel.'; END IF;
  ctx:=public.seller_owner_profit_context(p_offer);
  IF ctx->>'source_key' IS DISTINCT FROM p_expected_source THEN RAISE EXCEPTION 'Dane finansowe zmieniły się. Odśwież panel i ponownie sprawdź koszty.'; END IF;
  IF jsonb_array_length(ctx->'issues')>0 THEN RAISE EXCEPTION '%',ctx->'issues'->>0; END IF;
  IF p_costs_net IS NULL OR p_costs_net<0 OR p_costs_net>999999999999.99 OR p_costs_net::text IN ('NaN','Infinity','-Infinity')
    OR length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Podaj sprawdzone koszty netto i opis ich zakresu (3–2000 znaków).'; END IF;
  IF EXISTS(SELECT 1 FROM public.event_commissions c WHERE c.event_id=(ctx->>'event_id')::uuid AND c.owner_profit_review_id IS NOT NULL
    AND (c.status<>'planned' OR EXISTS(SELECT 1 FROM public.event_commission_payouts p WHERE p.commission_id=c.id))) THEN
    RAISE EXCEPTION 'Prowizja jest zatwierdzona, wypłacona lub anulowana. Nie nadpisujemy rozliczenia — wymaga osobnej korekty.';
  END IF;
  v_base:=greatest(0,round((ctx->>'revenue_net')::numeric-round(p_costs_net,2)-(ctx->>'external_cost')::numeric-(ctx->>'other_commissions_cost')::numeric,2));
  v_amount:=round(v_base*(ctx->>'rate')::numeric/100,2);
  v_cost:=CASE ctx->>'payment_method'
    WHEN 'cash_dividend' THEN round(v_amount/(1-least(99.99,greatest(0,(ctx->>'dividend_tax_rate')::numeric))/100),2)
    WHEN 'payroll' THEN round(v_amount*(1+(ctx->>'employer_social_rate')::numeric/100),2)
    ELSE v_amount END;
  v_snapshot:=ctx||jsonb_build_object('costs_net',round(p_costs_net,2),'base_amount',v_base,'amount',v_amount,'company_cost',v_cost,
    'remaining_profit',round((ctx->>'revenue_net')::numeric-round(p_costs_net,2)-(ctx->>'external_cost')::numeric-(ctx->>'other_commissions_cost')::numeric-v_cost,2));
  INSERT INTO public.seller_owner_profit_reviews(offer_id,event_id,manager_id,owner_partner_id,source_key,costs_net,note,snapshot,recorded_by)
    VALUES(p_offer,(ctx->>'event_id')::uuid,(ctx->>'manager_id')::uuid,(ctx->>'owner_partner_id')::uuid,ctx->>'source_key',round(p_costs_net,2),btrim(p_note),v_snapshot,auth.uid());
  RETURN public.get_seller_owner_profit(p_offer);
END;
$$;

CREATE FUNCTION public.book_seller_owner_profit_commission(p_review uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.seller_owner_profit_reviews; ctx jsonb; existing public.event_commissions; latest uuid;
BEGIN
  SELECT * INTO STRICT r FROM public.seller_owner_profit_reviews WHERE id=p_review;
  IF NOT public.seller_owner_profit_access(r.offer_id,true) THEN RAISE EXCEPTION 'Brak uprawnień do naliczenia prowizji' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.offer_id::text,18120000));
  PERFORM 1 FROM public.offers WHERE id=r.offer_id FOR UPDATE;
  IF r.event_id IS NULL THEN RAISE EXCEPTION 'Najpierw utwórz wydarzenie. Kalkulacja oferty nie jest jeszcze naliczeniem do wypłaty.'; END IF;
  PERFORM 1 FROM public.events WHERE id=r.event_id FOR UPDATE;
  SELECT id INTO latest FROM public.seller_owner_profit_reviews WHERE offer_id=r.offer_id ORDER BY recorded_at DESC,id LIMIT 1;
  ctx:=public.seller_owner_profit_context(r.offer_id);
  IF r.id IS DISTINCT FROM latest OR r.source_key IS DISTINCT FROM ctx->>'source_key' THEN
    RAISE EXCEPTION 'Kalkulacja nie jest aktualna. Sprawdź koszty i zapisz nową wersję.';
  END IF;
  IF jsonb_array_length(ctx->'issues')>0 THEN RAISE EXCEPTION '%',ctx->'issues'->>0; END IF;
  IF ctx->>'offer_status'<>'accepted' THEN RAISE EXCEPTION 'Najpierw zaakceptuj ofertę.'; END IF;
  IF ctx->>'external_cost_source'='estimated' THEN RAISE EXCEPTION 'Najpierw uzupełnij naliczenie sprzedawcy zewnętrznego w wydarzeniu i ponownie sprawdź kalkulację.'; END IF;
  SELECT * INTO existing FROM public.event_commissions WHERE event_id=r.event_id AND owner_profit_review_id IS NOT NULL FOR UPDATE;
  IF existing.id IS NOT NULL AND existing.owner_profit_review_id=r.id THEN RETURN public.get_seller_owner_profit(r.offer_id); END IF;
  IF existing.id IS NOT NULL AND (existing.status<>'planned' OR existing.employee_id<>r.manager_id
    OR EXISTS(SELECT 1 FROM public.event_commission_payouts p WHERE p.commission_id=existing.id)) THEN
    RAISE EXCEPTION 'Istniejąca prowizja wymaga osobnej korekty. Nie zmieniamy beneficjenta ani historii wypłat.';
  END IF;
  INSERT INTO public.event_commissions(id,event_id,beneficiary_type,beneficiary_name,employee_id,sales_partner_id,
    calculation_type,rate,base_amount,amount,payment_method,dividend_tax_rate,company_cost_amount,base_description,
    automatic_source,automatic_company_id,owner_profit_review_id,status,created_by)
  VALUES(coalesce(existing.id,gen_random_uuid()),r.event_id,'employee',ctx->>'manager_name',r.manager_id,r.owner_partner_id,
    'percent',(r.snapshot->>'rate')::numeric,(r.snapshot->>'base_amount')::numeric,(r.snapshot->>'amount')::numeric,
    r.snapshot->>'payment_method',(r.snapshot->>'dividend_tax_rate')::numeric,(r.snapshot->>'company_cost')::numeric,
    'Zysk netto przed prowizją opiekuna, po kosztach realizacji i pozostałych prowizjach','seller_owner_profit',
    (ctx->>'company_id')::uuid,r.id,'planned',public.current_employee_id())
  ON CONFLICT(id) DO UPDATE SET rate=excluded.rate,base_amount=excluded.base_amount,amount=excluded.amount,
    payment_method=excluded.payment_method,dividend_tax_rate=excluded.dividend_tax_rate,
    company_cost_amount=excluded.company_cost_amount,owner_profit_review_id=excluded.owner_profit_review_id;
  RETURN public.get_seller_owner_profit(r.offer_id);
END;
$$;

CREATE FUNCTION public.protect_seller_owner_profit_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.seller_owner_profit_reviews; ctx jsonb; needs_current boolean:=false; latest uuid;
BEGIN
  IF TG_OP='UPDATE' AND OLD.owner_profit_review_id IS NOT NULL AND NEW.owner_profit_review_id IS NULL THEN
    RAISE EXCEPTION 'Nie można usunąć podstawy prowizji opiekuna.';
  END IF;
  IF NEW.owner_profit_review_id IS NULL THEN
    -- Future owner commissions cannot bypass the profit basis through the old
    -- manual form or the revenue-based automatic endpoint. Legacy rows stay.
    IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.offers o
      LEFT JOIN public.sales_partner_profiles p ON p.id=NEW.sales_partner_id
      WHERE o.event_id=NEW.event_id AND o.sales_channel='seller_portal'
        AND public.seller_partner_manager_id(o.sales_partner_id,o.my_company_id)
          IN (NEW.employee_id,NEW.salesperson_id,p.employee_id)) THEN
      RAISE EXCEPTION 'Prowizję opiekuna nalicz od zysku w panelu Rentowność i prowizja opiekuna przy ofercie.';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT r FROM public.seller_owner_profit_reviews WHERE id=NEW.owner_profit_review_id;
  IF TG_OP='UPDATE' AND OLD.owner_profit_review_id IS DISTINCT FROM NEW.owner_profit_review_id
    AND (OLD.status<>'planned' OR EXISTS(SELECT 1 FROM public.event_commission_payouts p WHERE p.commission_id=OLD.id)) THEN
    RAISE EXCEPTION 'Zatwierdzona prowizja lub historia wypłat nie mogą otrzymać innej podstawy.';
  END IF;
  IF ROW(NEW.event_id,NEW.employee_id,NEW.sales_partner_id,NEW.calculation_type,NEW.rate,NEW.base_amount,NEW.amount,NEW.payment_method,NEW.dividend_tax_rate,NEW.automatic_source)
    IS DISTINCT FROM ROW(r.event_id,r.manager_id,r.owner_partner_id,'percent'::text,(r.snapshot->>'rate')::numeric,
      (r.snapshot->>'base_amount')::numeric,(r.snapshot->>'amount')::numeric,r.snapshot->>'payment_method',
      (r.snapshot->>'dividend_tax_rate')::numeric,'seller_owner_profit'::text)
    OR NEW.contact_id IS NOT NULL OR NEW.organization_id IS NOT NULL OR NEW.salesperson_id IS NOT NULL
    OR NEW.beneficiary_type<>'employee' THEN
    RAISE EXCEPTION 'Dane prowizji opiekuna muszą odpowiadać zapisanej kalkulacji zysku.';
  END IF;
  -- This trigger runs AFTER the generic nominal/cash calculation and BEFORE
  -- payout-history protection. Payroll company cost is not just gross pay.
  NEW.company_cost_amount:=(r.snapshot->>'company_cost')::numeric;
  IF TG_OP='INSERT' THEN needs_current:=true;
  ELSE needs_current:=OLD.owner_profit_review_id IS DISTINCT FROM NEW.owner_profit_review_id
    OR (NEW.status IN ('approved','paid') AND NEW.status IS DISTINCT FROM OLD.status); END IF;
  IF needs_current THEN
    ctx:=public.seller_owner_profit_context(r.offer_id);
    SELECT id INTO latest FROM public.seller_owner_profit_reviews WHERE offer_id=r.offer_id ORDER BY recorded_at DESC,id LIMIT 1;
    IF r.id IS DISTINCT FROM latest OR r.source_key IS DISTINCT FROM ctx->>'source_key'
      OR jsonb_array_length(ctx->'issues')>0 OR ctx->>'offer_status'<>'accepted' OR ctx->>'external_cost_source'='estimated' THEN
      RAISE EXCEPTION 'Najpierw sprawdź i zapisz aktualną kalkulację zysku opiekuna. Nie zatwierdzamy nieaktualnej podstawy.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_owner_profit_commission_guard BEFORE INSERT OR UPDATE ON public.event_commissions
  FOR EACH ROW EXECUTE FUNCTION public.protect_seller_owner_profit_commission();

CREATE FUNCTION public.protect_seller_owner_profit_payout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.seller_owner_profit_reviews; ctx jsonb; latest uuid;
BEGIN
  SELECT review.* INTO r FROM public.event_commissions c JOIN public.seller_owner_profit_reviews review ON review.id=c.owner_profit_review_id
    WHERE c.id=NEW.commission_id;
  IF FOUND THEN
    ctx:=public.seller_owner_profit_context(r.offer_id);
    SELECT id INTO latest FROM public.seller_owner_profit_reviews WHERE offer_id=r.offer_id ORDER BY recorded_at DESC,id LIMIT 1;
    IF r.id IS DISTINCT FROM latest OR r.source_key IS DISTINCT FROM ctx->>'source_key' OR jsonb_array_length(ctx->'issues')>0 THEN
      RAISE EXCEPTION 'Koszty lub warunki prowizji zmieniły się od kalkulacji. Przed wypłatą wymagana jest kontrola i osobna korekta rozliczenia.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER owner_profit_payout_guard BEFORE INSERT ON public.event_commission_payouts
  FOR EACH ROW EXECUTE FUNCTION public.protect_seller_owner_profit_payout();
CREATE TRIGGER owner_profit_reviews_immutable BEFORE UPDATE OR DELETE ON public.seller_owner_profit_reviews
  FOR EACH ROW EXECUTE FUNCTION public.prevent_commission_payout_mutation();

REVOKE ALL ON FUNCTION public.seller_owner_profit_access(uuid,boolean),public.seller_owner_profit_context(uuid),
  public.protect_seller_owner_profit_commission(),public.protect_seller_owner_profit_payout()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_seller_owner_profit(uuid),public.save_seller_owner_profit_review(uuid,numeric,text,text,uuid),
  public.book_seller_owner_profit_commission(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_seller_owner_profit(uuid),public.save_seller_owner_profit_review(uuid,numeric,text,text,uuid),
  public.book_seller_owner_profit_commission(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
