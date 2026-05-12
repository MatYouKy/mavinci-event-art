/*
  # Obsluga platnosci czesciowych faktur KSeF

  1. Nowa tabela ksef_invoice_payments
    - `id` (uuid, PK)
    - `ksef_invoice_id` (uuid, FK do ksef_invoices, ON DELETE CASCADE)
    - `amount` (numeric, kwota wplaty)
    - `payment_date` (date, data wplaty)
    - `notes` (text, opcjonalne uwagi)
    - `created_at` (timestamptz)
    - `created_by` (uuid)

  2. Zmiany w ksef_invoices
    - Rozszerzenie CHECK constraint payment_status o wartosc 'partially_paid'

  3. Automatyka
    - Trigger recalculate_ksef_invoice_payment_status przeliczajacy status i date platnosci
      po kazdej zmianie w ksef_invoice_payments na podstawie sumy wplat vs gross_amount

  4. Security
    - Wlaczone RLS dla ksef_invoice_payments
    - Polityki dla authenticated users (SELECT/INSERT/UPDATE/DELETE)
*/

CREATE TABLE IF NOT EXISTS ksef_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ksef_invoice_id uuid NOT NULL REFERENCES ksef_invoices(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_ksef_invoice_payments_invoice ON ksef_invoice_payments(ksef_invoice_id);
CREATE INDEX IF NOT EXISTS idx_ksef_invoice_payments_date ON ksef_invoice_payments(payment_date);

ALTER TABLE ksef_invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view ksef invoice payments" ON ksef_invoice_payments;
CREATE POLICY "Authenticated can view ksef invoice payments"
  ON ksef_invoice_payments FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated can insert ksef invoice payments" ON ksef_invoice_payments;
CREATE POLICY "Authenticated can insert ksef invoice payments"
  ON ksef_invoice_payments FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update ksef invoice payments" ON ksef_invoice_payments;
CREATE POLICY "Authenticated can update ksef invoice payments"
  ON ksef_invoice_payments FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can delete ksef invoice payments" ON ksef_invoice_payments;
CREATE POLICY "Authenticated can delete ksef invoice payments"
  ON ksef_invoice_payments FOR DELETE
  TO authenticated
  USING (true);

-- Rozszerzenie CHECK constraint na payment_status
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ksef_invoices_payment_status_check'
  ) THEN
    ALTER TABLE ksef_invoices DROP CONSTRAINT ksef_invoices_payment_status_check;
  END IF;
END $$;

ALTER TABLE ksef_invoices
  ADD CONSTRAINT ksef_invoices_payment_status_check
  CHECK (payment_status IN ('paid', 'unpaid', 'overdue', 'partially_paid'));

-- Funkcja przeliczajaca status platnosci na podstawie wplat
CREATE OR REPLACE FUNCTION recalculate_ksef_invoice_payment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice_id uuid;
  v_sum numeric(14,2);
  v_gross numeric(14,2);
  v_due date;
  v_latest_date timestamptz;
  v_new_status text;
BEGIN
  v_invoice_id := COALESCE(NEW.ksef_invoice_id, OLD.ksef_invoice_id);

  SELECT COALESCE(SUM(amount), 0), MAX(payment_date)::timestamptz
    INTO v_sum, v_latest_date
  FROM ksef_invoice_payments
  WHERE ksef_invoice_id = v_invoice_id;

  SELECT gross_amount, payment_due_date
    INTO v_gross, v_due
  FROM ksef_invoices
  WHERE id = v_invoice_id;

  IF v_sum <= 0 THEN
    IF v_due IS NOT NULL AND v_due < CURRENT_DATE THEN
      v_new_status := 'overdue';
    ELSE
      v_new_status := 'unpaid';
    END IF;
    UPDATE ksef_invoices
      SET payment_status = v_new_status,
          payment_date = NULL
      WHERE id = v_invoice_id;
  ELSIF v_gross IS NOT NULL AND v_sum >= v_gross THEN
    UPDATE ksef_invoices
      SET payment_status = 'paid',
          payment_date = v_latest_date
      WHERE id = v_invoice_id;
  ELSE
    UPDATE ksef_invoices
      SET payment_status = 'partially_paid',
          payment_date = v_latest_date
      WHERE id = v_invoice_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_ksef_payment_status_ins ON ksef_invoice_payments;
CREATE TRIGGER trg_recalc_ksef_payment_status_ins
  AFTER INSERT ON ksef_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION recalculate_ksef_invoice_payment_status();

DROP TRIGGER IF EXISTS trg_recalc_ksef_payment_status_upd ON ksef_invoice_payments;
CREATE TRIGGER trg_recalc_ksef_payment_status_upd
  AFTER UPDATE ON ksef_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION recalculate_ksef_invoice_payment_status();

DROP TRIGGER IF EXISTS trg_recalc_ksef_payment_status_del ON ksef_invoice_payments;
CREATE TRIGGER trg_recalc_ksef_payment_status_del
  AFTER DELETE ON ksef_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION recalculate_ksef_invoice_payment_status();

COMMENT ON TABLE ksef_invoice_payments IS 'Wplaty czastkowe do faktur KSeF (wsparcie platnosci czesciowych)';
COMMENT ON COLUMN ksef_invoices.payment_status IS 'Status platnosci: paid, unpaid, overdue, partially_paid';