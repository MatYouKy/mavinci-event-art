BEGIN;

-- Every message has its own history; the immutable PDF can be used again.
ALTER TABLE public.sales_brochure_deliveries
  DROP CONSTRAINT IF EXISTS sales_brochure_deliveries_generation_id_key;
CREATE INDEX IF NOT EXISTS brochure_deliveries_generation_history
  ON public.sales_brochure_deliveries(generation_id, created_at DESC, id);
CREATE UNIQUE INDEX IF NOT EXISTS brochure_deliveries_one_open_per_generation
  ON public.sales_brochure_deliveries(generation_id)
  WHERE status IN ('prepared', 'sending', 'failed', 'uncertain');

CREATE OR REPLACE FUNCTION public.prepare_saved_brochure_delivery(
  p_generation_id uuid, p_batch_id uuid, p_employee_id uuid,
  p_recipient_email text, p_recipient_name text,
  p_contact_id uuid, p_organization_id uuid, p_email_account_id uuid,
  p_subject text, p_body_html text, p_previous_delivery_id uuid DEFAULT NULL
)
RETURNS public.sales_brochure_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_source public.sales_brochure_generations%ROWTYPE;
  v_delivery public.sales_brochure_deliveries%ROWTYPE;
  v_email text := lower(btrim(p_recipient_email));
  v_source_email text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Wiadomości przygotowuje wyłącznie serwer CRM' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_source FROM public.sales_brochure_generations
    WHERE id = p_generation_id FOR UPDATE;
  IF NOT FOUND OR p_employee_id IS NULL OR v_source.created_by IS DISTINCT FROM p_employee_id THEN
    RAISE EXCEPTION 'Możesz wysłać wyłącznie własną wersję broszury' USING ERRCODE = '42501';
  END IF;
  v_source_email := lower(btrim(COALESCE(NULLIF(v_source.recipient_email, ''),
    NULLIF(v_source.snapshot->>'recipientEmail', ''),
    v_source.snapshot->'demoAttribution'->>'recipientEmail', '')));
  IF v_source_email <> '' AND v_source_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'Ten PDF jest przypisany do innego adresu odbiorcy';
  END IF;
  IF (v_source.recipient_contact_id IS NOT NULL AND v_source.recipient_contact_id IS DISTINCT FROM p_contact_id)
    OR (v_source.recipient_organization_id IS NOT NULL AND v_source.recipient_organization_id IS DISTINCT FROM p_organization_id) THEN
    RAISE EXCEPTION 'Powiązanie klienta musi być zgodne z zapisaną wersją PDF';
  END IF;
  IF NULLIF(v_source.snapshot->'demoAttribution'->>'campaignId', '') IS NOT NULL THEN
    RAISE EXCEPTION 'Wersję kampanijną wyślij z poziomu jej kampanii';
  END IF;

  SELECT * INTO v_delivery FROM public.sales_brochure_deliveries
    WHERE batch_id = p_batch_id AND recipient_email = v_email;
  IF FOUND THEN
    IF v_delivery.generation_id IS DISTINCT FROM p_generation_id
      OR v_delivery.employee_id IS DISTINCT FROM p_employee_id THEN
      RAISE EXCEPTION 'Nieprawidłowa wysyłka';
    END IF;
    RETURN v_delivery;
  END IF;

  -- Return unfinished work unchanged; never silently reset an uncertain send.
  SELECT * INTO v_delivery FROM public.sales_brochure_deliveries
    WHERE generation_id = p_generation_id ORDER BY created_at DESC, id DESC LIMIT 1;
  IF FOUND THEN
    IF v_delivery.status <> 'sent' THEN RETURN v_delivery; END IF;
    IF p_previous_delivery_id IS DISTINCT FROM v_delivery.id THEN
      RAISE EXCEPTION 'Ta broszura została już wysłana. Odśwież formularz i potwierdź ponowną wysyłkę';
    END IF;
  END IF;
  INSERT INTO public.sales_brochure_deliveries (
    batch_id, brochure_id, generation_id, employee_id, contact_id, organization_id,
    recipient_email, recipient_name, email_account_id, subject, body_html
  ) VALUES (
    p_batch_id, v_source.brochure_id, v_source.id, p_employee_id, p_contact_id, p_organization_id,
    v_email, COALESCE(p_recipient_name, ''), p_email_account_id, p_subject, p_body_html
  ) RETURNING * INTO v_delivery;
  RETURN v_delivery;
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_saved_brochure_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_saved_brochure_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text,uuid)
  TO service_role;

-- Existing RLS, ownership and mailbox access checks remain unchanged.
COMMIT;
