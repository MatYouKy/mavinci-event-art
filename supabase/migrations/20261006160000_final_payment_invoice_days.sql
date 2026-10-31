BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.event_payment_milestones
  ALTER COLUMN due_date DROP NOT NULL,
  ADD COLUMN payment_due_days integer CHECK (payment_due_days BETWEEN 0 AND 3650),
  ADD CONSTRAINT payment_milestone_date_or_invoice_terms CHECK (due_date IS NOT NULL OR payment_due_days IS NOT NULL);

CREATE OR REPLACE FUNCTION public.set_event_payment_plan(
  p_event_id uuid, p_mode text, p_total numeric, p_first_amount numeric,
  p_first_date date, p_final_date date, p_final_days integer
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
  ELSE
    IF p_final_days IS NULL OR p_final_days < 0 OR p_final_days > 3650 THEN
      RAISE EXCEPTION 'Podaj termin płatności od 0 do 3650 dni od wystawienia faktury.';
    END IF;
    v_final := NULL;
  END IF;
  IF (p_mode = 'earnest_event' AND v_final IS NULL) OR (p_mode <> 'final_only' AND
    (p_first_amount IS NULL OR p_first_amount::text IN ('NaN','Infinity','-Infinity')
      OR p_first_amount <= 0 OR p_first_amount >= p_total OR p_first_amount <> round(p_first_amount,2)
      OR p_first_date IS NULL OR (p_mode = 'earnest_event' AND p_first_date > v_final))) THEN
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
  INSERT INTO public.event_payment_milestones(event_id,label,milestone_type,amount,due_date,payment_plan_mode,payment_due_days)
  VALUES(p_event_id,CASE WHEN p_mode = 'earnest_event' THEN 'Dopłata w dniu uroczystości' ELSE 'Płatność końcowa' END,
    'balance',p_total - CASE WHEN p_mode = 'final_only' THEN 0 ELSE p_first_amount END,v_final,p_mode,CASE WHEN p_mode = 'earnest_event' THEN NULL ELSE p_final_days END);
END;
$$;
REVOKE ALL ON FUNCTION public.set_event_payment_plan(uuid,text,numeric,numeric,date,date,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_event_payment_plan(uuid,text,numeric,numeric,date,date,integer) TO authenticated;

-- Run before the existing status trigger, so a draft or missing invoice cannot create arrears.
CREATE FUNCTION public.derive_event_payment_due_date()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE invoice_event uuid; invoice_day date; invoice_status text;
BEGIN
  IF NEW.payment_due_days IS NOT NULL THEN
    NEW.due_date := NULL;
    IF NEW.invoice_id IS NOT NULL THEN
      SELECT event_id, issue_date, status::text INTO invoice_event, invoice_day, invoice_status
      FROM public.invoices WHERE id = NEW.invoice_id;
      IF NOT FOUND OR invoice_event IS DISTINCT FROM NEW.event_id THEN
        RAISE EXCEPTION 'Wybierz fakturę przypisaną do tego wydarzenia.';
      END IF;
      IF invoice_status IN ('issued','sent','paid','overdue') THEN
        NEW.due_date := invoice_day + NEW.payment_due_days;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER derive_event_payment_due_date_trigger
BEFORE INSERT OR UPDATE ON public.event_payment_milestones
FOR EACH ROW EXECUTE FUNCTION public.derive_event_payment_due_date();

-- Follow issue date/status changes even when the invoice was linked while still a draft.
CREATE FUNCTION public.sync_invoice_event_payment_due_date()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.event_payment_milestones
  SET due_date = CASE WHEN NEW.status::text IN ('issued','sent','paid','overdue')
    THEN NEW.issue_date + payment_due_days ELSE NULL END
  WHERE invoice_id = NEW.id AND payment_due_days IS NOT NULL
    AND event_id = NEW.event_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_invoice_event_payment_due_date() FROM PUBLIC;
CREATE TRIGGER sync_invoice_event_payment_due_date_trigger
AFTER UPDATE OF issue_date, status ON public.invoices
FOR EACH ROW WHEN (OLD.issue_date IS DISTINCT FROM NEW.issue_date OR OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.sync_invoice_event_payment_due_date();
NOTIFY pgrst, 'reload schema';
COMMIT;
