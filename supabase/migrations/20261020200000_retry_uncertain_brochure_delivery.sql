BEGIN;

-- Keep the uncertain attempt and its transport token intact. A deliberate retry
-- is a separate draft, never a reset of the original transport state.
ALTER TABLE public.sales_brochure_deliveries
  ADD COLUMN IF NOT EXISTS retry_of_delivery_id uuid
    REFERENCES public.sales_brochure_deliveries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS brochure_deliveries_one_retry_per_attempt
  ON public.sales_brochure_deliveries(retry_of_delivery_id)
  WHERE retry_of_delivery_id IS NOT NULL;

DROP INDEX IF EXISTS public.brochure_deliveries_one_open_per_generation;
CREATE UNIQUE INDEX brochure_deliveries_one_open_per_generation
  ON public.sales_brochure_deliveries(generation_id)
  WHERE status IN ('prepared', 'sending', 'failed', 'uncertain')
    AND superseded_at IS NULL;

CREATE OR REPLACE FUNCTION public.retry_uncertain_brochure_delivery(
  p_delivery_id uuid, p_employee_id uuid, p_accept_duplicate_risk boolean
)
RETURNS public.sales_brochure_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_source public.sales_brochure_generations%ROWTYPE;
  v_original public.sales_brochure_deliveries%ROWTYPE;
  v_retry public.sales_brochure_deliveries%ROWTYPE;
  v_latest_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Ponowienie przygotowuje wyłącznie serwer CRM' USING ERRCODE = '42501';
  END IF;
  IF p_accept_duplicate_risk IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Potwierdź ryzyko otrzymania przez odbiorcę dwóch wiadomości';
  END IF;

  -- Match the lock order used by prepare_saved_brochure_delivery.
  SELECT g.* INTO v_source FROM public.sales_brochure_generations g
    JOIN public.sales_brochure_deliveries d ON d.generation_id = g.id
    WHERE d.id = p_delivery_id
    FOR UPDATE OF g;
  IF NOT FOUND OR p_employee_id IS NULL OR v_source.created_by IS DISTINCT FROM p_employee_id THEN
    RAISE EXCEPTION 'Możesz ponowić wyłącznie własną wysyłkę broszury' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(v_source.snapshot->'demoAttribution'->>'campaignId', '') IS NOT NULL THEN
    RAISE EXCEPTION 'Wersję kampanijną obsłuż z poziomu jej kampanii';
  END IF;

  SELECT * INTO v_original FROM public.sales_brochure_deliveries
    WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND OR v_original.employee_id IS DISTINCT FROM p_employee_id THEN
    RAISE EXCEPTION 'Możesz ponowić wyłącznie własną wiadomość' USING ERRCODE = '42501';
  END IF;
  -- A lost response, double click or second tab must return the same new draft.
  SELECT * INTO v_retry FROM public.sales_brochure_deliveries
    WHERE retry_of_delivery_id = p_delivery_id;
  IF FOUND THEN RETURN v_retry; END IF;

  SELECT id INTO v_latest_id FROM public.sales_brochure_deliveries
    WHERE generation_id = v_source.id ORDER BY created_at DESC, id DESC LIMIT 1;
  IF v_latest_id IS DISTINCT FROM v_original.id
    OR v_original.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Istnieje już nowsza próba. Odśwież stan wiadomości';
  END IF;
  IF v_original.status IS DISTINCT FROM 'uncertain' THEN
    RAISE EXCEPTION 'Stan poprzedniej próby zmienił się. Odśwież go przed ponowieniem';
  END IF;
  -- The previous SMTP request may still finish after the HTTP response was lost.
  IF COALESCE(v_original.transport_started_at, v_original.attempted_at, v_original.created_at)
    > clock_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION 'Poprzednia wysyłka może jeszcze trwać. Ponowienie będzie możliwe po 5 minutach od rozpoczęcia próby';
  END IF;

  UPDATE public.sales_brochure_deliveries
    SET superseded_at = clock_timestamp() WHERE id = v_original.id;
  INSERT INTO public.sales_brochure_deliveries (
    batch_id, brochure_id, generation_id, employee_id, contact_id, organization_id,
    recipient_email, recipient_name, email_account_id, subject, body_html,
    retry_of_delivery_id, created_at
  ) VALUES (
    gen_random_uuid(), v_original.brochure_id, v_original.generation_id, p_employee_id,
    v_original.contact_id, v_original.organization_id, v_original.recipient_email,
    v_original.recipient_name, v_original.email_account_id, v_original.subject,
    v_original.body_html, v_original.id, clock_timestamp()
  ) RETURNING * INTO v_retry;
  RETURN v_retry;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_uncertain_brochure_delivery(uuid,uuid,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_uncertain_brochure_delivery(uuid,uuid,boolean)
  TO service_role;

-- No existing attempt is unlocked automatically and this migration sends no mail.
NOTIFY pgrst, 'reload schema';
COMMIT;
