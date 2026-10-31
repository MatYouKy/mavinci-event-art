BEGIN;

-- Bezpieczniki handlowe ofert: rabat powyżej limitu albo marża poniżej progu wymagają
-- akceptacji administratora (lub osoby zarządzającej finansami) przed wysłaniem klientowi.
-- Akceptacja dotyczy konkretnej wersji kwot: zmiana sumy, rabatu lub obniżenie marży ją unieważnia.
-- Oferty z portalu sprzedawców mają własny proces decyzji opiekuna i nie są tu objęte.

CREATE TABLE IF NOT EXISTS public.sales_offer_guardrails (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  max_discount_percent numeric(5,2) NOT NULL DEFAULT 10 CHECK (max_discount_percent BETWEEN 0 AND 100),
  min_margin_percent numeric(5,2) NOT NULL DEFAULT 25 CHECK (min_margin_percent BETWEEN -100 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL
);
INSERT INTO public.sales_offer_guardrails(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public.sales_offer_guardrails IS
  'Progi akceptacji ofert: rabat powyżej max_discount_percent lub marża poniżej min_margin_percent wymaga akceptacji przed wysyłką.';

ALTER TABLE public.sales_offer_guardrails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_offer_guardrails_read ON public.sales_offer_guardrails;
CREATE POLICY sales_offer_guardrails_read ON public.sales_offer_guardrails FOR SELECT TO authenticated
  USING (NOT public.current_session_is_seller_portal());
DROP POLICY IF EXISTS sales_offer_guardrails_admin ON public.sales_offer_guardrails;
CREATE POLICY sales_offer_guardrails_admin ON public.sales_offer_guardrails FOR UPDATE TO authenticated
  USING (public.current_employee_is_crm_admin()) WITH CHECK (public.current_employee_is_crm_admin());
GRANT SELECT, UPDATE ON public.sales_offer_guardrails TO authenticated;

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_requested_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_decided_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_note text,
  ADD COLUMN IF NOT EXISTS approval_snapshot jsonb;
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_approval_status_check;
ALTER TABLE public.offers ADD CONSTRAINT offers_approval_status_check
  CHECK (approval_status IS NULL OR approval_status IN ('pending', 'approved', 'rejected'));

-- Kto zatwierdza: administrator albo zarządzanie finansami firmy.
CREATE OR REPLACE FUNCTION public.current_employee_can_approve_offers()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.current_employee_is_crm_admin() OR public.finance_can_manage();
$$;

-- Ocena oferty względem progów. Kwoty liczone po stronie bazy z pozycji oferty (jak
-- calculate_offer_totals), a nie z kolumn total_cost/margin_percent zapisanych przez klienta.
-- Przyjmuje wiersz, żeby wyzwalacz mógł ocenić NOWE wartości jeszcze przed zapisem.
CREATE OR REPLACE FUNCTION public.offer_guardrail_evaluate_row(o public.offers)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE g public.sales_offer_guardrails%ROWTYPE;
  items_subtotal numeric := 0; items_cost numeric := 0; subtotal numeric; cost numeric;
  discount_value numeric; discount numeric; net numeric; margin numeric;
  reasons jsonb := '[]'::jsonb; approval_valid boolean := false; snapshot jsonb := o.approval_snapshot;
BEGIN
  SELECT * INTO g FROM public.sales_offer_guardrails WHERE id = 1;
  SELECT coalesce(sum(coalesce(i.total, 0)), 0)::numeric,
         coalesce(sum(coalesce(i.unit_cost, 0) * coalesce(i.quantity, 0)), 0)::numeric
    INTO items_subtotal, items_cost
  FROM public.offer_items i WHERE i.offer_id = o.id;

  subtotal := items_subtotal + CASE WHEN coalesce(o.logistics_enabled, false)
    THEN coalesce(o.logistics_price_net, 0)::numeric ELSE 0 END;
  cost := items_cost + coalesce(o.logistics_cost_net, 0)::numeric;
  discount_value := CASE WHEN coalesce(o.discount_amount, 0) > 0
    THEN least(subtotal, o.discount_amount::numeric)
    ELSE round(subtotal * coalesce(o.discount_percent, 0)::numeric / 100, 2) END;
  discount := CASE WHEN subtotal > 0 THEN round(discount_value / subtotal * 100, 2) ELSE 0 END;
  net := subtotal - discount_value;
  margin := CASE WHEN cost > 0 AND net > 0 THEN round((net - cost) / net * 100, 2) END;

  IF coalesce(g.enabled, false) AND coalesce(o.sales_channel, 'crm') <> 'seller_portal' THEN
    IF discount > g.max_discount_percent THEN
      reasons := reasons || jsonb_build_object('kind', 'discount', 'value', discount, 'limit', g.max_discount_percent,
        'message', format('Rabat %s%% przekracza limit %s%%', discount, g.max_discount_percent));
    END IF;
    IF margin IS NOT NULL AND margin < g.min_margin_percent THEN
      reasons := reasons || jsonb_build_object('kind', 'margin', 'value', margin, 'limit', g.min_margin_percent,
        'message', format('Marża %s%% jest poniżej progu %s%%', margin, g.min_margin_percent));
    END IF;
  END IF;

  -- Akceptacja obowiązuje dla tej samej wartości pozycji, rabatu nie wyższego i marży nie niższej.
  IF o.approval_status = 'approved' AND snapshot IS NOT NULL THEN
    approval_valid := abs(coalesce((snapshot->>'subtotal')::numeric, -1) - subtotal) <= 0.01
      AND discount <= coalesce((snapshot->>'discount')::numeric, -1) + 0.01
      AND (margin IS NULL
        OR margin >= coalesce(g.min_margin_percent, 0)
        OR ((snapshot->>'margin') IS NOT NULL AND margin >= (snapshot->>'margin')::numeric - 0.01));
  END IF;

  RETURN jsonb_build_object(
    'offer_id', o.id,
    'required', jsonb_array_length(reasons) > 0,
    'reasons', reasons,
    'subtotal', subtotal,
    'discount_percent', discount,
    'margin_percent', margin,
    'margin_known', margin IS NOT NULL,
    'approval_status', o.approval_status,
    'approval_valid', approval_valid,
    'approval_note', o.approval_note,
    'approval_requested_at', o.approval_requested_at,
    'approval_decided_at', o.approval_decided_at,
    'can_send', jsonb_array_length(reasons) = 0 OR approval_valid,
    'limits', jsonb_build_object('enabled', coalesce(g.enabled, false),
      'max_discount_percent', g.max_discount_percent, 'min_margin_percent', g.min_margin_percent)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.offer_guardrail_evaluation(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.offers%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.offers WHERE id = p_offer_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.offer_guardrail_evaluate_row(o);
END;
$$;

-- Dla interfejsu: ocena + prawa bieżącego użytkownika.
CREATE OR REPLACE FUNCTION public.get_offer_guardrail_status(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result jsonb; can_approve boolean := public.current_employee_can_approve_offers();
BEGIN
  IF public.current_crm_employee_id() IS NULL OR public.current_session_is_seller_portal() THEN
    RAISE EXCEPTION 'Wymagane konto pracownika.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.offers WHERE id = p_offer_id) THEN RETURN NULL; END IF;
  -- Marża i rabat cudzej oferty nie są widoczne dla innych sprzedawców.
  IF NOT (can_approve OR public.sales_can_manage_offer(p_offer_id)) THEN RETURN NULL; END IF;
  result := public.offer_guardrail_evaluation(p_offer_id);
  RETURN result || jsonb_build_object(
    'can_approve', can_approve,
    'can_send', (result->>'can_send')::boolean OR can_approve);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_offer_approval(p_offer_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid := public.current_crm_employee_id(); evaluation jsonb; o public.offers%ROWTYPE;
  approvers uuid[];
BEGIN
  IF actor IS NULL OR NOT public.sales_can_manage_offer(p_offer_id) THEN
    RAISE EXCEPTION 'Brak uprawnień do tej oferty.' USING ERRCODE = '42501';
  END IF;
  evaluation := public.offer_guardrail_evaluation(p_offer_id);
  IF NOT (evaluation->>'required')::boolean OR (evaluation->>'approval_valid')::boolean THEN RETURN evaluation; END IF;
  SELECT * INTO o FROM public.offers WHERE id = p_offer_id;
  -- Prośba o te same kwoty już czeka — bez ponownego powiadamiania.
  IF o.approval_status = 'pending'
    AND o.approval_snapshot->'subtotal' = evaluation->'subtotal'
    AND o.approval_snapshot->'discount' = evaluation->'discount_percent'
    AND o.approval_snapshot->'margin' IS NOT DISTINCT FROM evaluation->'margin_percent' THEN
    RETURN evaluation;
  END IF;

  PERFORM set_config('mavinci.offer_approval', 'yes', true);
  UPDATE public.offers SET approval_status = 'pending', approval_requested_at = now(), approval_requested_by = actor,
    approval_decided_at = NULL, approval_decided_by = NULL,
    approval_note = nullif(btrim(coalesce(p_note, '')), ''),
    approval_snapshot = jsonb_build_object('subtotal', evaluation->'subtotal',
      'discount', evaluation->'discount_percent', 'margin', evaluation->'margin_percent')
  WHERE id = p_offer_id;

  SELECT array_agg(coalesce(e.auth_user_id, e.id)) INTO approvers FROM public.employees e
  WHERE e.is_active AND (e.role::text = 'admin' OR e.access_level::text = 'admin'
    OR coalesce(e.permissions, '{}'::text[]) && ARRAY['admin', 'finances_manage']::text[]);
  PERFORM public.enqueue_crm_business_notification(
    'offer-approval:' || p_offer_id::text || ':' || extract(epoch FROM now())::bigint::text,
    'offer_approval_requested', 'Oferta czeka na akceptację',
    coalesce(nullif(o.title, ''), o.offer_number, 'Oferta') || ' — ' ||
      (SELECT string_agg(reason->>'message', '; ') FROM jsonb_array_elements(evaluation->'reasons') reason),
    'warning', 'system', '/crm/offers/' || p_offer_id::text, NULL, NULL,
    jsonb_build_object('offer_id', p_offer_id, 'requested_by', actor), approvers);

  RETURN public.offer_guardrail_evaluation(p_offer_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_offer_approval(p_offer_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid := public.current_crm_employee_id(); evaluation jsonb; o public.offers%ROWTYPE;
  requester uuid;
BEGIN
  IF actor IS NULL OR NOT public.current_employee_can_approve_offers() THEN
    RAISE EXCEPTION 'Ofertę zatwierdza administrator lub osoba zarządzająca finansami.' USING ERRCODE = '42501';
  END IF;
  IF NOT p_approve AND nullif(btrim(coalesce(p_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Podaj powód odrzucenia.' USING ERRCODE = '22023';
  END IF;
  evaluation := public.offer_guardrail_evaluation(p_offer_id);
  SELECT * INTO o FROM public.offers WHERE id = p_offer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono oferty.'; END IF;

  PERFORM set_config('mavinci.offer_approval', 'yes', true);
  UPDATE public.offers SET approval_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    approval_decided_at = now(), approval_decided_by = actor,
    approval_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), approval_note),
    approval_snapshot = jsonb_build_object('subtotal', evaluation->'subtotal',
      'discount', evaluation->'discount_percent', 'margin', evaluation->'margin_percent')
  WHERE id = p_offer_id;

  requester := o.approval_requested_by;
  IF requester IS NOT NULL AND requester <> actor THEN
    PERFORM public.enqueue_crm_business_notification(
      'offer-approval-decision:' || p_offer_id::text || ':' || extract(epoch FROM now())::bigint::text,
      'offer_approval_decided',
      CASE WHEN p_approve THEN 'Oferta zaakceptowana do wysyłki' ELSE 'Oferta wymaga zmian' END,
      coalesce(nullif(o.title, ''), o.offer_number, 'Oferta') || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
      CASE WHEN p_approve THEN 'success' ELSE 'warning' END, 'system', '/crm/offers/' || p_offer_id::text, NULL, NULL,
      jsonb_build_object('offer_id', p_offer_id, 'decided_by', actor),
      (SELECT array_agg(coalesce(e.auth_user_id, e.id)) FROM public.employees e WHERE e.id = requester));
  END IF;

  RETURN public.offer_guardrail_evaluation(p_offer_id);
END;
$$;

-- Usługa wysyłki (send-offer-email) sprawdza próg przed wysłaniem, w imieniu nadawcy.
CREATE OR REPLACE FUNCTION public.offer_send_guardrail(p_offer_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE old_sub text; evaluation jsonb; can_approve boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Tylko usługa wysyłki'; END IF;
  old_sub := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  can_approve := public.current_employee_can_approve_offers();
  PERFORM set_config('request.jwt.claim.sub', coalesce(old_sub, ''), true);
  evaluation := public.offer_guardrail_evaluation(p_offer_id);
  RETURN evaluation || jsonb_build_object('can_send', (evaluation->>'can_send')::boolean OR can_approve);
END;
$$;

-- Ręczna zmiana statusu na „wysłana” z poziomu klienta też podlega progom.
CREATE OR REPLACE FUNCTION public.guard_offer_send_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE evaluation jsonb;
BEGIN
  IF auth.uid() IS NULL OR auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF NEW.status::text = 'sent' AND OLD.status::text IS DISTINCT FROM 'sent'
    AND NOT public.current_employee_can_approve_offers() THEN
    -- Ocena NOWYCH wartości: rabat zmieniony razem ze statusem też podlega progom.
    evaluation := public.offer_guardrail_evaluate_row(NEW);
    IF evaluation IS NOT NULL AND NOT (evaluation->>'can_send')::boolean THEN
      RAISE EXCEPTION 'Oferta wymaga akceptacji przed wysłaniem: %',
        (SELECT string_agg(reason->>'message', '; ') FROM jsonb_array_elements(evaluation->'reasons') reason)
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_offer_send_approval ON public.offers;
CREATE TRIGGER guard_offer_send_approval BEFORE UPDATE OF status ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.guard_offer_send_approval();

-- Statusu akceptacji nie da się ustawić zwykłym zapisem oferty.
CREATE OR REPLACE FUNCTION public.protect_offer_approval_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.role() = 'service_role'
    OR coalesce(current_setting('mavinci.offer_approval', true), '') = 'yes' THEN RETURN NEW; END IF;
  IF (NEW.approval_status, NEW.approval_decided_by, NEW.approval_decided_at, NEW.approval_snapshot)
    IS DISTINCT FROM (OLD.approval_status, OLD.approval_decided_by, OLD.approval_decided_at, OLD.approval_snapshot) THEN
    RAISE EXCEPTION 'Akceptację oferty zmienia się przyciskami „Wyślij do akceptacji” / „Zatwierdź”.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_offer_approval_columns ON public.offers;
CREATE TRIGGER protect_offer_approval_columns BEFORE UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.protect_offer_approval_columns();

-- Nowa oferta (także kopia „Duplikuj”) zaczyna bez akceptacji.
CREATE OR REPLACE FUNCTION public.reset_offer_approval_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.approval_status := NULL; NEW.approval_requested_at := NULL; NEW.approval_requested_by := NULL;
  NEW.approval_decided_at := NULL; NEW.approval_decided_by := NULL; NEW.approval_note := NULL;
  NEW.approval_snapshot := NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reset_offer_approval_on_insert ON public.offers;
CREATE TRIGGER reset_offer_approval_on_insert BEFORE INSERT ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.reset_offer_approval_on_insert();

-- Ta sama definicja co w 20260926120000; kolumny akceptacji nie zmieniają treści oferty
-- (bez tego akceptacja unieważniałaby wygenerowany PDF).
CREATE OR REPLACE FUNCTION public.mark_offer_modified() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ignored text[]:=ARRAY['updated_at','generated_pdf_url','generated_pdf_revision','last_generated_at','last_generated_by','modified_after_generation','content_revision','status','sent_at','accepted_at','accepted_by','acceptance_note','accepted_package_id','accepted_variant_selections','event_id','inquiry_id',
  'approval_status','approval_requested_at','approval_requested_by','approval_decided_at','approval_decided_by','approval_note','approval_snapshot','viewed_at'];
BEGIN
 IF (to_jsonb(NEW)-ignored) IS DISTINCT FROM (to_jsonb(OLD)-ignored) THEN NEW.content_revision:=OLD.content_revision+1; END IF;
 IF NEW.content_revision IS DISTINCT FROM OLD.content_revision THEN NEW.modified_after_generation:=true; END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.current_employee_can_approve_offers(), public.get_offer_guardrail_status(uuid),
  public.request_offer_approval(uuid, text), public.decide_offer_approval(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_employee_can_approve_offers(), public.get_offer_guardrail_status(uuid),
  public.request_offer_approval(uuid, text), public.decide_offer_approval(uuid, boolean, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.offer_guardrail_evaluation(uuid), public.offer_guardrail_evaluate_row(public.offers)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.offer_guardrail_evaluation(uuid), public.offer_guardrail_evaluate_row(public.offers)
  TO service_role;
REVOKE ALL ON FUNCTION public.offer_send_guardrail(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.offer_send_guardrail(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.guard_offer_send_approval(), public.protect_offer_approval_columns(),
  public.reset_offer_approval_on_insert() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
