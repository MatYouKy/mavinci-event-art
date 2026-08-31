-- Jedna faktura może rozliczać kilka niezależnych operacyjnie wydarzeń.
-- Zmiana nie modyfikuje istniejącego modelu faktury: invoices.event_id nadal
-- wskazuje wydarzenie, z którego wystawiono dokument. Poniższe tabele zapisują
-- wyłącznie dodatkowe, jawne powiązania rozliczeniowe.

CREATE TABLE IF NOT EXISTS public.event_settlement_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  primary_event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  billing_arrangement text NOT NULL DEFAULT 'direct'
    CHECK (billing_arrangement IN ('direct', 'hotel', 'agency', 'other')),
  billing_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_settlement_group_members (
  group_id uuid NOT NULL REFERENCES public.event_settlement_groups(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, event_id),
  UNIQUE (event_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_settlement_group_primary_member
  ON public.event_settlement_group_members(group_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_event_settlement_members_event
  ON public.event_settlement_group_members(event_id);

-- allocation_weight jest proporcją przychodu przypisaną do wydarzenia.
-- Kwoty są liczone na bieżąco w widoku, więc edycja faktury nie wymaga triggera.
CREATE TABLE IF NOT EXISTS public.invoice_event_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  settlement_group_id uuid REFERENCES public.event_settlement_groups(id) ON DELETE SET NULL,
  is_primary boolean NOT NULL DEFAULT false,
  allocation_method text NOT NULL DEFAULT 'automatic_expected'
    CHECK (allocation_method IN ('automatic_offer', 'automatic_expected', 'equal', 'manual')),
  allocation_weight numeric(18,6) NOT NULL DEFAULT 1 CHECK (allocation_weight >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_event_allocations_event
  ON public.invoice_event_allocations(event_id);

CREATE INDEX IF NOT EXISTS idx_invoice_event_allocations_invoice
  ON public.invoice_event_allocations(invoice_id);

ALTER TABLE public.event_settlement_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_settlement_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_event_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settlement groups follow event commercial access"
  ON public.event_settlement_groups;
CREATE POLICY "settlement groups follow event commercial access"
  ON public.event_settlement_groups
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_settlement_group_members member
      WHERE member.group_id = id
        AND public.can_view_event_commercials(member.event_id, false)
    )
  );

DROP POLICY IF EXISTS "settlement members follow event commercial access"
  ON public.event_settlement_group_members;
CREATE POLICY "settlement members follow event commercial access"
  ON public.event_settlement_group_members
  FOR SELECT TO authenticated
  USING (public.can_view_event_commercials(event_id, false));

DROP POLICY IF EXISTS "invoice allocations follow event commercial access"
  ON public.invoice_event_allocations;
CREATE POLICY "invoice allocations follow event commercial access"
  ON public.invoice_event_allocations
  FOR SELECT TO authenticated
  USING (public.can_view_event_commercials(event_id, false));

GRANT SELECT ON public.event_settlement_groups TO authenticated;
GRANT SELECT ON public.event_settlement_group_members TO authenticated;
GRANT SELECT ON public.invoice_event_allocations TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_invoice_settlement_allocations(
  p_invoice_id uuid,
  p_group_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_primary_event_id uuid;
  v_total_weight numeric;
  v_member_count integer;
BEGIN
  SELECT settlement_group.primary_event_id
  INTO v_primary_event_id
  FROM public.event_settlement_groups settlement_group
  WHERE settlement_group.id = p_group_id;

  IF v_primary_event_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = p_invoice_id) THEN
    RETURN;
  END IF;

  WITH weights AS (
    SELECT member.event_id,
           GREATEST(COALESCE(
             NULLIF(latest_offer.total_amount, 0),
             NULLIF(event.expected_revenue, 0),
             0
           ), 0) AS weight
    FROM public.event_settlement_group_members member
    JOIN public.events event ON event.id = member.event_id
    LEFT JOIN LATERAL (
      SELECT offer.total_amount
      FROM public.offers offer
      WHERE offer.event_id = member.event_id
        AND offer.status = 'accepted'
      ORDER BY offer.created_at DESC
      LIMIT 1
    ) latest_offer ON true
    WHERE member.group_id = p_group_id
  )
  SELECT COALESCE(SUM(weight), 0), COUNT(*)
  INTO v_total_weight, v_member_count
  FROM weights;

  DELETE FROM public.invoice_event_allocations
  WHERE invoice_id = p_invoice_id;

  INSERT INTO public.invoice_event_allocations (
    invoice_id,
    event_id,
    settlement_group_id,
    is_primary,
    allocation_method,
    allocation_weight
  )
  SELECT
    p_invoice_id,
    member.event_id,
    p_group_id,
    member.event_id = v_primary_event_id,
    CASE
      WHEN v_total_weight > 0 AND latest_offer.total_amount > 0 THEN 'automatic_offer'
      WHEN v_total_weight > 0 THEN 'automatic_expected'
      ELSE 'equal'
    END,
    CASE
      WHEN v_total_weight > 0 THEN GREATEST(COALESCE(
        NULLIF(latest_offer.total_amount, 0),
        NULLIF(event.expected_revenue, 0),
        0
      ), 0) / v_total_weight
      ELSE 1::numeric / NULLIF(v_member_count, 0)
    END
  FROM public.event_settlement_group_members member
  JOIN public.events event ON event.id = member.event_id
  LEFT JOIN LATERAL (
    SELECT offer.total_amount
    FROM public.offers offer
    WHERE offer.event_id = member.event_id
      AND offer.status = 'accepted'
    ORDER BY offer.created_at DESC
    LIMIT 1
  ) latest_offer ON true
  WHERE member.group_id = p_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_invoice_settlement_allocations(uuid, uuid)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.save_event_settlement_group(
  p_anchor_event_id uuid,
  p_event_ids uuid[],
  p_name text,
  p_primary_event_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_event_ids uuid[];
  v_event_id uuid;
  v_conflicting_group uuid;
  v_arrangement text;
  v_billing_organization_id uuid;
  v_invoice_id uuid;
BEGIN
  SELECT ARRAY_AGG(DISTINCT selected.event_id)
  INTO v_event_ids
  FROM UNNEST(COALESCE(p_event_ids, ARRAY[]::uuid[])) AS selected(event_id)
  WHERE selected.event_id IS NOT NULL;

  IF COALESCE(CARDINALITY(v_event_ids), 0) < 2
     OR NOT p_anchor_event_id = ANY(v_event_ids)
     OR NOT p_primary_event_id = ANY(v_event_ids) THEN
    RAISE EXCEPTION 'Wspólne rozliczenie wymaga co najmniej dwóch wydarzeń oraz wydarzenia głównego.';
  END IF;

  FOREACH v_event_id IN ARRAY v_event_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event_id) THEN
      RAISE EXCEPTION 'Nie znaleziono wydarzenia %.', v_event_id;
    END IF;
    IF NOT public.can_view_event_commercials(v_event_id, true) THEN
      RAISE EXCEPTION 'Brak uprawnień do zarządzania rozliczeniem wydarzenia %.', v_event_id;
    END IF;
  END LOOP;

  SELECT member.group_id INTO v_group_id
  FROM public.event_settlement_group_members member
  WHERE member.event_id = p_anchor_event_id;

  SELECT member.group_id INTO v_conflicting_group
  FROM public.event_settlement_group_members member
  WHERE member.event_id = ANY(v_event_ids)
    AND (v_group_id IS NULL OR member.group_id <> v_group_id)
  LIMIT 1;

  IF v_conflicting_group IS NOT NULL THEN
    RAISE EXCEPTION 'Jedno z wydarzeń należy już do innej grupy rozliczeniowej.';
  END IF;

  SELECT event.billing_arrangement, event.billing_organization_id
  INTO v_arrangement, v_billing_organization_id
  FROM public.events event
  WHERE event.id = p_anchor_event_id;

  IF v_group_id IS NULL THEN
    INSERT INTO public.event_settlement_groups (
      name, primary_event_id, billing_arrangement, billing_organization_id, created_by
    ) VALUES (
      COALESCE(NULLIF(BTRIM(p_name), ''), 'Wspólne rozliczenie wydarzeń'),
      p_primary_event_id,
      COALESCE(v_arrangement, 'direct'),
      v_billing_organization_id,
      public.current_workflow_employee_id()
    )
    RETURNING id INTO v_group_id;
  ELSE
    UPDATE public.event_settlement_groups
    SET name = COALESCE(NULLIF(BTRIM(p_name), ''), name),
        primary_event_id = p_primary_event_id,
        billing_arrangement = COALESCE(v_arrangement, 'direct'),
        billing_organization_id = v_billing_organization_id,
        status = 'active',
        updated_at = now()
    WHERE id = v_group_id;
  END IF;

  DELETE FROM public.event_settlement_group_members member
  WHERE member.group_id = v_group_id
    AND NOT member.event_id = ANY(v_event_ids);

  UPDATE public.event_settlement_group_members
  SET is_primary = false
  WHERE group_id = v_group_id;

  FOREACH v_event_id IN ARRAY v_event_ids LOOP
    INSERT INTO public.event_settlement_group_members (group_id, event_id, is_primary)
    VALUES (v_group_id, v_event_id, v_event_id = p_primary_event_id)
    ON CONFLICT (event_id) DO UPDATE
    SET group_id = EXCLUDED.group_id,
        is_primary = EXCLUDED.is_primary;
  END LOOP;

  -- Wszystkie wydarzenia grupy korzystają z tego samego płatnika, ale ich
  -- klient, zespół, harmonogram, sprzęt i koszty pozostają niezależne.
  UPDATE public.events
  SET billing_arrangement = COALESCE(v_arrangement, 'direct'),
      billing_organization_id = v_billing_organization_id,
      updated_at = now()
  WHERE id = ANY(v_event_ids);

  INSERT INTO public.event_billing_contacts (
    event_id, organization_id, contact_id, is_primary, created_by
  )
  SELECT
    member_event_id,
    anchor_contact.organization_id,
    anchor_contact.contact_id,
    false,
    public.current_workflow_employee_id()
  FROM UNNEST(v_event_ids) AS selected(member_event_id)
  JOIN public.event_billing_contacts anchor_contact
    ON anchor_contact.event_id = p_anchor_event_id
  WHERE member_event_id <> p_anchor_event_id
  ON CONFLICT (event_id, contact_id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id;

  FOR v_invoice_id IN
    SELECT invoice.id
    FROM public.invoices invoice
    WHERE invoice.event_id = ANY(v_event_ids)
  LOOP
    PERFORM public.refresh_invoice_settlement_allocations(v_invoice_id, v_group_id);
  END LOOP;

  RETURN v_group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_invoice_to_event_settlement(
  p_invoice_id uuid,
  p_source_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  IF NOT public.can_view_event_commercials(p_source_event_id, true) THEN
    RAISE EXCEPTION 'Brak uprawnień do powiązania faktury z wydarzeniami.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.invoices invoice
    WHERE invoice.id = p_invoice_id
      AND invoice.event_id = p_source_event_id
  ) THEN
    RAISE EXCEPTION 'Faktura nie jest przypisana do wskazanego wydarzenia.';
  END IF;

  SELECT member.group_id INTO v_group_id
  FROM public.event_settlement_group_members member
  JOIN public.event_settlement_groups settlement_group
    ON settlement_group.id = member.group_id
   AND settlement_group.status = 'active'
  WHERE member.event_id = p_source_event_id;

  IF v_group_id IS NOT NULL THEN
    PERFORM public.refresh_invoice_settlement_allocations(p_invoice_id, v_group_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.dissolve_event_settlement_group(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_member_event_id uuid;
BEGIN
  SELECT member.group_id INTO v_group_id
  FROM public.event_settlement_group_members member
  WHERE member.event_id = p_event_id;

  IF v_group_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_member_event_id IN
    SELECT member.event_id
    FROM public.event_settlement_group_members member
    WHERE member.group_id = v_group_id
  LOOP
    IF NOT public.can_view_event_commercials(v_member_event_id, true) THEN
      RAISE EXCEPTION 'Brak uprawnień do rozłączenia tej grupy rozliczeniowej.';
    END IF;
  END LOOP;

  UPDATE public.event_settlement_groups
  SET status = 'closed', updated_at = now()
  WHERE id = v_group_id;

  -- Powiązania dokumentów pozostają jako historia. Usuwamy wyłącznie aktywne
  -- członkostwo, aby wydarzenia mogły wejść do nowej grupy w przyszłości.
  DELETE FROM public.event_settlement_group_members
  WHERE group_id = v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_event_settlement_group(uuid, uuid[], text, uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_invoice_to_event_settlement(uuid, uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dissolve_event_settlement_group(uuid)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_event_settlement_group(uuid, uuid[], text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_invoice_to_event_settlement(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.dissolve_event_settlement_group(uuid)
  TO authenticated;

CREATE OR REPLACE VIEW public.event_invoice_settlements
WITH (security_invoker = true)
AS
WITH linked AS (
  SELECT
    allocation.event_id,
    invoice.id,
    invoice.event_id AS invoice_primary_event_id,
    invoice.invoice_number,
    invoice.invoice_type,
    invoice.status,
    invoice.payment_status,
    invoice.issue_date,
    invoice.payment_due_date,
    invoice.total_net,
    invoice.total_vat,
    invoice.total_gross,
    invoice.currency_code,
    invoice.buyer_name,
    invoice.billing_arrangement,
    invoice.is_proforma,
    invoice.pdf_url,
    allocation.settlement_group_id,
    allocation.is_primary,
    allocation.allocation_method,
    allocation.allocation_weight
      / NULLIF(SUM(allocation.allocation_weight) OVER (PARTITION BY invoice.id), 0) AS ratio,
    COUNT(*) OVER (PARTITION BY invoice.id) AS shared_event_count
  FROM public.invoice_event_allocations allocation
  JOIN public.invoices invoice ON invoice.id = allocation.invoice_id
), direct AS (
  SELECT
    invoice.event_id,
    invoice.id,
    invoice.event_id AS invoice_primary_event_id,
    invoice.invoice_number,
    invoice.invoice_type,
    invoice.status,
    invoice.payment_status,
    invoice.issue_date,
    invoice.payment_due_date,
    invoice.total_net,
    invoice.total_vat,
    invoice.total_gross,
    invoice.currency_code,
    invoice.buyer_name,
    invoice.billing_arrangement,
    invoice.is_proforma,
    invoice.pdf_url,
    NULL::uuid AS settlement_group_id,
    true AS is_primary,
    'equal'::text AS allocation_method,
    1::numeric AS ratio,
    1::bigint AS shared_event_count
  FROM public.invoices invoice
  WHERE invoice.event_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.invoice_event_allocations allocation
      WHERE allocation.invoice_id = invoice.id
    )
)
SELECT
  event_id,
  id,
  invoice_primary_event_id,
  invoice_number,
  invoice_type,
  status,
  payment_status,
  issue_date,
  payment_due_date,
  total_net,
  total_vat,
  total_gross,
  currency_code,
  buyer_name,
  billing_arrangement,
  is_proforma,
  pdf_url,
  settlement_group_id,
  is_primary,
  allocation_method,
  CASE
    WHEN is_primary THEN total_net - COALESCE(
      SUM(ROUND(total_net * ratio, 2)) FILTER (WHERE NOT is_primary)
        OVER (PARTITION BY id),
      0
    )
    ELSE ROUND(total_net * ratio, 2)
  END AS allocated_net,
  CASE
    WHEN is_primary THEN total_vat - COALESCE(
      SUM(ROUND(total_vat * ratio, 2)) FILTER (WHERE NOT is_primary)
        OVER (PARTITION BY id),
      0
    )
    ELSE ROUND(total_vat * ratio, 2)
  END AS allocated_vat,
  CASE
    WHEN is_primary THEN total_gross - COALESCE(
      SUM(ROUND(total_gross * ratio, 2)) FILTER (WHERE NOT is_primary)
        OVER (PARTITION BY id),
      0
    )
    ELSE ROUND(total_gross * ratio, 2)
  END AS allocated_gross,
  shared_event_count
FROM linked
UNION ALL
SELECT
  event_id,
  id,
  invoice_primary_event_id,
  invoice_number,
  invoice_type,
  status,
  payment_status,
  issue_date,
  payment_due_date,
  total_net,
  total_vat,
  total_gross,
  currency_code,
  buyer_name,
  billing_arrangement,
  is_proforma,
  pdf_url,
  settlement_group_id,
  is_primary,
  allocation_method,
  total_net AS allocated_net,
  total_vat AS allocated_vat,
  total_gross AS allocated_gross,
  shared_event_count
FROM direct;

GRANT SELECT ON public.event_invoice_settlements TO authenticated;

CREATE OR REPLACE FUNCTION public.get_event_shared_invoice_summary(p_event_id uuid)
RETURNS TABLE (
  invoices_count bigint,
  invoices_paid_count bigint,
  invoices_total numeric,
  actual_invoice_revenue numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (
      WHERE settlement.status = 'paid' OR settlement.payment_status = 'paid'
    )::bigint,
    COALESCE(SUM(settlement.allocated_gross) FILTER (
      WHERE settlement.status <> 'cancelled'
        AND COALESCE(settlement.is_proforma, false) = false
        AND settlement.invoice_type <> 'proforma'
    ), 0),
    COALESCE(SUM(settlement.allocated_gross) FILTER (
      WHERE settlement.status IN ('issued', 'sent', 'paid', 'overdue')
        AND COALESCE(settlement.is_proforma, false) = false
        AND settlement.invoice_type <> 'proforma'
    ), 0)
  FROM public.event_invoice_settlements settlement
  WHERE settlement.event_id = p_event_id
    AND public.can_view_event_commercials(p_event_id, false);
$$;

GRANT EXECUTE ON FUNCTION public.get_event_shared_invoice_summary(uuid) TO authenticated;

-- Pierwsza, wskazana przez użytkownika grupa. Operacyjnym właścicielem
-- dokumentu pozostaje wydarzenie f6dc..., a jego faktury zostają rozdzielone
-- pomiędzy obie uroczystości według wartości zaakceptowanych ofert.
INSERT INTO public.event_settlement_groups (
  id, name, primary_event_id, billing_arrangement, billing_organization_id
)
SELECT
  'a8c6e1b2-9d45-4f13-8c72-6e0f9a5b3d21'::uuid,
  'Wspólne rozliczenie — '
    || COALESCE(secondary_event.name, 'Wydarzenie 1')
    || ' / '
    || COALESCE(primary_event.name, 'Wydarzenie 2'),
  primary_event.id,
  CASE
    WHEN latest_invoice.billing_arrangement IN ('hotel', 'agency', 'other')
      THEN latest_invoice.billing_arrangement
    ELSE primary_event.billing_arrangement
  END,
  CASE
    WHEN latest_invoice.billing_arrangement IN ('hotel', 'agency', 'other')
      THEN latest_invoice.organization_id
    ELSE primary_event.billing_organization_id
  END
FROM public.events primary_event
JOIN public.events secondary_event
  ON secondary_event.id = '8daa9fad-ed15-4f4b-b6f5-e2d35ba3362b'::uuid
LEFT JOIN LATERAL (
  SELECT invoice.billing_arrangement, invoice.organization_id
  FROM public.invoices invoice
  WHERE invoice.event_id = primary_event.id
  ORDER BY invoice.issue_date DESC, invoice.created_at DESC
  LIMIT 1
) latest_invoice ON true
WHERE primary_event.id = 'f6dcdfb5-09e2-4fcb-9514-f254d6a29008'::uuid
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    primary_event_id = EXCLUDED.primary_event_id,
    billing_arrangement = EXCLUDED.billing_arrangement,
    billing_organization_id = EXCLUDED.billing_organization_id,
    status = 'active',
    updated_at = now();

DELETE FROM public.event_settlement_group_members
WHERE event_id IN (
  '8daa9fad-ed15-4f4b-b6f5-e2d35ba3362b'::uuid,
  'f6dcdfb5-09e2-4fcb-9514-f254d6a29008'::uuid
)
  AND EXISTS (
    SELECT 1 FROM public.event_settlement_groups
    WHERE id = 'a8c6e1b2-9d45-4f13-8c72-6e0f9a5b3d21'::uuid
  );

INSERT INTO public.event_settlement_group_members (group_id, event_id, is_primary)
SELECT
  'a8c6e1b2-9d45-4f13-8c72-6e0f9a5b3d21'::uuid,
  event.id,
  event.id = 'f6dcdfb5-09e2-4fcb-9514-f254d6a29008'::uuid
FROM public.events event
WHERE event.id IN (
  '8daa9fad-ed15-4f4b-b6f5-e2d35ba3362b'::uuid,
  'f6dcdfb5-09e2-4fcb-9514-f254d6a29008'::uuid
)
  AND EXISTS (
    SELECT 1 FROM public.event_settlement_groups
    WHERE id = 'a8c6e1b2-9d45-4f13-8c72-6e0f9a5b3d21'::uuid
  )
ON CONFLICT (event_id) DO UPDATE
SET group_id = EXCLUDED.group_id,
    is_primary = EXCLUDED.is_primary;

UPDATE public.events linked_event
SET billing_arrangement = settlement_group.billing_arrangement,
    billing_organization_id = settlement_group.billing_organization_id,
    updated_at = now()
FROM public.event_settlement_groups settlement_group
WHERE linked_event.id IN (
    '8daa9fad-ed15-4f4b-b6f5-e2d35ba3362b'::uuid,
    'f6dcdfb5-09e2-4fcb-9514-f254d6a29008'::uuid
  )
  AND settlement_group.id = 'a8c6e1b2-9d45-4f13-8c72-6e0f9a5b3d21'::uuid;

INSERT INTO public.event_billing_contacts (
  event_id, organization_id, contact_id, is_primary, created_by
)
SELECT
  '8daa9fad-ed15-4f4b-b6f5-e2d35ba3362b'::uuid,
  primary_contact.organization_id,
  primary_contact.contact_id,
  false,
  primary_contact.created_by
FROM public.event_billing_contacts primary_contact
WHERE primary_contact.event_id = 'f6dcdfb5-09e2-4fcb-9514-f254d6a29008'::uuid
  AND EXISTS (
    SELECT 1 FROM public.event_settlement_groups
    WHERE id = 'a8c6e1b2-9d45-4f13-8c72-6e0f9a5b3d21'::uuid
  )
ON CONFLICT (event_id, contact_id) DO UPDATE
SET organization_id = EXCLUDED.organization_id;

DO $$
DECLARE
  v_invoice_id uuid;
BEGIN
  FOR v_invoice_id IN
    SELECT invoice.id
    FROM public.invoices invoice
    WHERE invoice.event_id IN (
      '8daa9fad-ed15-4f4b-b6f5-e2d35ba3362b'::uuid,
      'f6dcdfb5-09e2-4fcb-9514-f254d6a29008'::uuid
    )
  LOOP
    PERFORM public.refresh_invoice_settlement_allocations(
      v_invoice_id,
      'a8c6e1b2-9d45-4f13-8c72-6e0f9a5b3d21'::uuid
    );
  END LOOP;
END;
$$;

COMMENT ON TABLE public.event_settlement_groups IS
  'Grupy operacyjnie niezależnych wydarzeń rozliczanych jednym dokumentem.';
COMMENT ON TABLE public.invoice_event_allocations IS
  'Jawny podział wartości jednej faktury pomiędzy rozliczane wydarzenia.';

NOTIFY pgrst, 'reload schema';
