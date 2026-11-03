BEGIN;
SET LOCAL lock_timeout='5s';
-- When no separate milestone exists, respect the payment term on the actual invoice.
DO $$ DECLARE definition text; needle text; BEGIN
 definition:=pg_get_functiondef('private.event_workflow_next_action(uuid)'::regprocedure);
 needle:=$old$   IF payment_day IS NOT NULL THEN
    starts_at:=greatest(starts_at,(payment_day+time '09:00') AT TIME ZONE 'Europe/Warsaw');$old$;
 IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Nieznana wersja terminów przypomnień'; END IF;
 definition:=replace(definition,needle,$new$   IF payment_day IS NULL AND req.requirement_key='invoice_paid' THEN
    SELECT min(i.payment_due_date) INTO payment_day FROM public.invoices i
    WHERE i.status IN('issued','sent','overdue') AND i.is_proforma IS NOT TRUE
      AND i.invoice_type IN('vat','advance','final','corrective')
      AND (EXISTS(SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id=i.id AND a.event_id=p_event AND a.allocation_weight>0)
        OR(i.event_id=p_event AND NOT EXISTS(SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id=i.id)));
   END IF;
   IF payment_day IS NOT NULL THEN
    starts_at:=greatest(starts_at,(payment_day+time '09:00') AT TIME ZONE 'Europe/Warsaw');$new$);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
