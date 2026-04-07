/*
  # Synchronizacja budżetu - zapisuj brutto (netto + VAT)

  ## Problem
  - Trigger `sync_offer_with_event_budget` zapisywał `total_amount` (netto) w `expected_revenue`
  - Powinien zapisywać brutto (total_amount + tax_amount) aby dane finansowe były poprawne

  ## Rozwiązanie
  - Zaktualizuj funkcję aby obliczała brutto = total_amount + tax_amount
  - Zaktualizuj istniejące dane
*/

CREATE OR REPLACE FUNCTION sync_offer_with_event_budget()
RETURNS TRIGGER AS $$
DECLARE
  accepted_offer_total numeric;
  accepted_offer_costs numeric;
  offer_gross numeric;
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    IF NEW.status = 'accepted' AND NEW.event_id IS NOT NULL THEN
      offer_gross := COALESCE(NEW.total_amount, 0) + COALESCE(NEW.tax_amount, 0);
      UPDATE events
      SET
        expected_revenue = offer_gross,
        estimated_costs = COALESCE(NEW.total_cost, 0)
      WHERE id = NEW.event_id;

      RETURN NEW;
    END IF;

    IF (NEW.status IN ('rejected', 'cancelled') OR (OLD IS NOT NULL AND OLD.status = 'accepted')) AND NEW.event_id IS NOT NULL THEN
      SELECT
        COALESCE(SUM(total_amount + COALESCE(tax_amount, 0)), 0),
        COALESCE(SUM(total_cost), 0)
      INTO accepted_offer_total, accepted_offer_costs
      FROM offers
      WHERE event_id = NEW.event_id
        AND status = 'accepted'
        AND id != NEW.id;

      UPDATE events
      SET
        expected_revenue = accepted_offer_total,
        estimated_costs = accepted_offer_costs
      WHERE id = NEW.event_id;

      RETURN NEW;
    END IF;
  END IF;

  IF (TG_OP = 'DELETE') THEN
    IF OLD.status = 'accepted' AND OLD.event_id IS NOT NULL THEN
      SELECT
        COALESCE(SUM(total_amount + COALESCE(tax_amount, 0)), 0),
        COALESCE(SUM(total_cost), 0)
      INTO accepted_offer_total, accepted_offer_costs
      FROM offers
      WHERE event_id = OLD.event_id
        AND status = 'accepted'
        AND id != OLD.id;

      UPDATE events
      SET
        expected_revenue = accepted_offer_total,
        estimated_costs = accepted_offer_costs
      WHERE id = OLD.event_id;

      RETURN OLD;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Zaktualizuj istniejące dane - zapisz brutto w expected_revenue
UPDATE events e
SET
  expected_revenue = COALESCE(latest_offer.gross_amount, 0),
  estimated_costs = COALESCE(latest_offer.total_cost, 0)
FROM (
  SELECT DISTINCT ON (event_id)
    event_id,
    (total_amount + COALESCE(tax_amount, 0)) as gross_amount,
    total_cost
  FROM offers
  WHERE event_id IS NOT NULL
    AND status = 'accepted'
  ORDER BY event_id, created_at DESC
) AS latest_offer
WHERE e.id = latest_offer.event_id;
