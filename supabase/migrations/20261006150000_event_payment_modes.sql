BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.event_payment_milestones ADD COLUMN payment_plan_mode text
  CHECK (payment_plan_mode IN ('advance_balance','final_only','earnest_event'));

-- Invoker rights retain the existing financial-data RLS policies.
CREATE OR REPLACE FUNCTION public.set_event_payment_plan(
  p_event_id uuid, p_mode text, p_total numeric, p_first_amount numeric,
  p_first_date date, p_final_date date
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_final date;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.can_view_event_commercials(p_event_id,true),false) THEN
    RAISE EXCEPTION 'Brak uprawnień do zmiany rozliczenia wydarzenia.' USING ERRCODE = '42501';
  END IF;
  -- Serialize plan replacements for this event; the entire operation is atomic.
  PERFORM pg_advisory_xact_lock(hashtextextended('payment-plan:' || p_event_id::text, 0));
  PERFORM 1 FROM public.event_payment_milestones WHERE event_id = p_event_id FOR UPDATE;
  IF p_mode IS NULL OR p_mode NOT IN ('advance_balance','final_only','earnest_event')
    OR p_total IS NULL OR p_total <= 0 OR p_total::text IN ('NaN','Infinity','-Infinity')
    OR p_total <> round(p_total,2) THEN
    RAISE EXCEPTION 'Nieprawidłowy sposób rozliczenia lub kwota brutto.';
  END IF;
  IF p_mode = 'earnest_event' THEN
    SELECT (event_date AT TIME ZONE 'Europe/Warsaw')::date INTO v_final
    FROM public.events WHERE id = p_event_id;
  ELSE v_final := p_final_date;
  END IF;
  IF v_final IS NULL OR (p_mode <> 'final_only' AND
    (p_first_amount IS NULL OR p_first_amount::text IN ('NaN','Infinity','-Infinity')
      OR p_first_amount <= 0 OR p_first_amount >= p_total OR p_first_amount <> round(p_first_amount,2)
      OR p_first_date IS NULL OR p_first_date > v_final)) THEN
    RAISE EXCEPTION 'Sprawdź kwotę i termin zaliczki lub zadatku oraz termin dopłaty.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_payment_milestones WHERE event_id = p_event_id
    AND (paid_amount > 0 OR paid_at IS NOT NULL OR invoice_id IS NOT NULL OR status = 'paid')) THEN
    RAISE EXCEPTION 'Nie można zastąpić rozliczenia z wpłatą lub powiązaną fakturą. Zachowaj dotychczasowe płatności.';
  END IF;
  DELETE FROM public.event_payment_milestones WHERE event_id = p_event_id;
  IF p_mode <> 'final_only' THEN
    INSERT INTO public.event_payment_milestones(event_id,label,milestone_type,amount,due_date,payment_plan_mode)
    VALUES(p_event_id,CASE WHEN p_mode = 'earnest_event' THEN 'Zadatek' ELSE 'Zaliczka' END,
      'deposit',p_first_amount,p_first_date,p_mode);
  END IF;
  INSERT INTO public.event_payment_milestones(event_id,label,milestone_type,amount,due_date,payment_plan_mode)
  VALUES(p_event_id,CASE WHEN p_mode = 'earnest_event' THEN 'Dopłata w dniu uroczystości' ELSE 'Płatność końcowa' END,
    'balance',p_total - CASE WHEN p_mode = 'final_only' THEN 0 ELSE p_first_amount END,v_final,p_mode);
END;
$$;
REVOKE ALL ON FUNCTION public.set_event_payment_plan(uuid,text,numeric,numeric,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_event_payment_plan(uuid,text,numeric,numeric,date,date) TO authenticated;

-- Patch the current definitions, preserving subsequent workflow fixes and grants.
DO $patch$
DECLARE definition text; old_fragment text; new_fragment text;
BEGIN
  definition := pg_get_functiondef('public.get_event_preflight_core(uuid)'::regprocedure);
  old_fragment := $old$  IF NOT EXISTS (SELECT 1 FROM public.event_payment_milestones milestone WHERE milestone.event_id = p_event_id) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','payment_schedule','label','Brak harmonogramu płatności','severity','critical','tab','finances'));
  ELSIF EXISTS (
    SELECT 1 FROM public.event_payment_milestones milestone
    WHERE milestone.event_id = p_event_id AND milestone.milestone_type = 'deposit'
      AND milestone.status NOT IN ('paid','waived')
  ) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','deposit','label','Zaliczka nie została zaksięgowana','severity','critical','tab','finances'));
  END IF;$old$;
  new_fragment := $new$  IF NOT EXISTS (SELECT 1 FROM public.event_payment_milestones milestone WHERE milestone.event_id = p_event_id) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','payment_schedule','label','Ustal sposób rozliczenia','severity','warning','tab','finances'));
  ELSIF EXISTS (
    SELECT 1 FROM public.event_payment_milestones milestone
    WHERE milestone.event_id = p_event_id AND milestone.status NOT IN ('paid','waived')
      AND milestone.due_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Warsaw')::date
      AND milestone.paid_amount < milestone.amount
  ) THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code','payment_overdue','label','Płatność klienta po terminie','severity','critical','tab','finances'));
  END IF;$new$;
  IF position(old_fragment in definition) = 0 THEN RAISE EXCEPTION 'Nieznana wersja kontroli płatności — przerwano migrację.'; END IF;
  definition := replace(definition,old_fragment,new_fragment);
  -- Missing payment setup is informational; it does not block operational readiness.
  definition := replace(definition, '''ready'', jsonb_array_length(issues) = 0',
    '''ready'', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(issues) item WHERE item->>''code'' <> ''payment_schedule'')');
  EXECUTE definition;

  definition := pg_get_functiondef('public.event_workflow_requirement_is_met(uuid,uuid)'::regprocedure);
  old_fragment := $old$    WHEN 'deposit_paid' THEN RETURN EXISTS (
      SELECT 1 FROM public.event_payment_milestones milestone WHERE milestone.event_id = p_event_id
        AND milestone.milestone_type = 'deposit' AND milestone.status IN ('paid','waived'));$old$;
  new_fragment := $new$    WHEN 'deposit_paid' THEN RETURN NOT EXISTS (
      SELECT 1 FROM public.event_payment_milestones milestone WHERE milestone.event_id = p_event_id
        AND milestone.milestone_type = 'deposit' AND milestone.status NOT IN ('paid','waived')
        AND milestone.due_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Warsaw')::date
        AND milestone.paid_amount < milestone.amount);$new$;
  IF position(old_fragment in definition) = 0 THEN RAISE EXCEPTION 'Nieznana wersja warunku zaliczki — przerwano migrację.'; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END;
$patch$;
UPDATE public.event_workflow_requirements
SET label = 'Brak zaległej zaliczki lub zadatku', task_title = 'Sprawdź termin zaliczki lub zadatku'
WHERE requirement_key = 'deposit_paid' AND label = 'Zaliczka zaksięgowana';

NOTIFY pgrst, 'reload schema';
COMMIT;
