/*
# Bidirectional sync between event and invoice settlement status

1. Changes
   - Creates trigger function sync_event_settled_to_invoices():
     When event status changes to 'settled', all linked non-cancelled, non-proforma
     invoices are marked as 'paid' (with payment_status, paid_amount, paid_at updated).
   - Creates trigger function sync_invoice_paid_to_event():
     When a regular (vat) or corrective invoice linked to an event is marked as 'paid',
     the event status is updated to 'settled'.
   - Both triggers include guards to prevent infinite recursion.

2. Security
   - Triggers execute as SECURITY DEFINER (needed to update across tables).
   - No RLS changes required.

3. Important Notes
   - Only non-proforma, non-cancelled invoices are synced when event becomes settled.
   - Only invoices with invoice_type IN ('vat', 'corrective') trigger event settlement
     (advance and proforma invoices do NOT trigger event settlement).
   - Setting event to a status OTHER than 'settled' does NOT revert invoice statuses.
   - Setting invoice to a status OTHER than 'paid' does NOT revert event status.
   - Uses GUC variable 'app.syncing_settlement' as recursion guard within transaction.
*/

-- 1. When event status changes to 'settled' -> mark linked invoices as 'paid'
CREATE OR REPLACE FUNCTION sync_event_settled_to_invoices()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'settled' AND (OLD.status IS DISTINCT FROM 'settled') THEN
    IF current_setting('app.syncing_settlement', true) = 'true' THEN
      RETURN NEW;
    END IF;

    PERFORM set_config('app.syncing_settlement', 'true', true);

    UPDATE invoices
    SET
      status = 'paid',
      payment_status = 'paid',
      paid_amount = COALESCE(total_gross, total_net, 0),
      paid_at = COALESCE(paid_at, now()),
      updated_at = now()
    WHERE event_id = NEW.id
      AND status NOT IN ('paid', 'cancelled')
      AND (is_proforma IS NOT TRUE)
      AND invoice_type != 'proforma';

    PERFORM set_config('app.syncing_settlement', 'false', true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_settled_sync_invoices ON events;
CREATE TRIGGER trg_event_settled_sync_invoices
  AFTER UPDATE OF status ON events
  FOR EACH ROW
  EXECUTE FUNCTION sync_event_settled_to_invoices();


-- 2. When invoice status changes to 'paid' -> mark linked event as 'settled'
CREATE OR REPLACE FUNCTION sync_invoice_paid_to_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid')
     AND NEW.event_id IS NOT NULL
     AND NEW.invoice_type IN ('vat', 'corrective')
     AND (NEW.is_proforma IS NOT TRUE)
  THEN
    IF current_setting('app.syncing_settlement', true) = 'true' THEN
      RETURN NEW;
    END IF;

    PERFORM set_config('app.syncing_settlement', 'true', true);

    UPDATE events
    SET
      status = 'settled',
      updated_at = now()
    WHERE id = NEW.event_id
      AND status NOT IN ('settled', 'cancelled');

    PERFORM set_config('app.syncing_settlement', 'false', true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_paid_sync_event ON invoices;
CREATE TRIGGER trg_invoice_paid_sync_event
  AFTER UPDATE OF status ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION sync_invoice_paid_to_event();
