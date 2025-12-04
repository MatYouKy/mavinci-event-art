/*
  # Synchronizacja kosztów z oferty do budżetu eventu

  1. Rozszerzenie synchronizacji
    - Zaakceptowana oferta → aktualizuj expected_revenue i estimated_costs w events
    - total_amount z oferty → expected_revenue eventu
    - total_cost z oferty → estimated_costs eventu
    
  2. Logika biznesowa
    - Koszty planowane (estimated_costs) = suma kosztów z zaakceptowanej oferty
    - Koszty rzeczywiste (actual_costs) = suma z tabeli event_costs
    - Marża = expected_revenue - estimated_costs
*/

-- Rozszerzona funkcja synchronizująca ofertę z budżetem eventu
CREATE OR REPLACE FUNCTION sync_offer_with_event_budget()
RETURNS TRIGGER AS $$
DECLARE
  accepted_offer_total numeric;
  accepted_offer_costs numeric;
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    -- Gdy oferta jest zaakceptowana, zaktualizuj budżet eventu
    IF NEW.status = 'accepted' AND NEW.event_id IS NOT NULL THEN
      UPDATE events
      SET 
        expected_revenue = NEW.total_amount,
        estimated_costs = NEW.total_cost
      WHERE id = NEW.event_id;
      
      RETURN NEW;
    END IF;
    
    -- Gdy oferta jest odrzucona/anulowana lub zmienia się status z 'accepted'
    IF (NEW.status IN ('rejected', 'cancelled') OR OLD.status = 'accepted') AND NEW.event_id IS NOT NULL THEN
      -- Znajdź sumę z innych zaakceptowanych ofert
      SELECT 
        COALESCE(SUM(total_amount), 0),
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
  
  -- Usunięcie oferty
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status = 'accepted' AND OLD.event_id IS NOT NULL THEN
      -- Znajdź sumę z pozostałych zaakceptowanych ofert
      SELECT 
        COALESCE(SUM(total_amount), 0),
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

-- Trigger już istnieje, ale upewnijmy się że jest aktualny
DROP TRIGGER IF EXISTS trigger_sync_offer_with_event_budget ON offers;
CREATE TRIGGER trigger_sync_offer_with_event_budget
  AFTER INSERT OR UPDATE OR DELETE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION sync_offer_with_event_budget();

-- Zaktualizuj funkcję get_event_financial_info aby zwracała też koszty
DROP FUNCTION IF EXISTS get_event_financial_info(uuid);

CREATE FUNCTION get_event_financial_info(p_event_id uuid)
RETURNS TABLE (
  event_name text,
  client_type text,
  is_business boolean,
  can_invoice boolean,
  expected_revenue numeric,
  actual_revenue numeric,
  actual_cash_revenue numeric,
  total_revenue numeric,
  estimated_costs numeric,
  actual_costs numeric,
  estimated_profit numeric,
  actual_profit numeric,
  accepted_offer_id uuid,
  accepted_offer_number text,
  accepted_offer_total numeric,
  accepted_offer_costs numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.name as event_name,
    e.client_type::text,
    CASE 
      WHEN o.id IS NOT NULL THEN true
      WHEN c.is_business_client THEN true
      ELSE false
    END as is_business,
    CASE 
      WHEN o.id IS NOT NULL AND o.nip IS NOT NULL THEN true
      WHEN c.is_business_client AND c.nip IS NOT NULL THEN true
      ELSE false
    END as can_invoice,
    e.expected_revenue,
    e.actual_revenue,
    e.actual_cash_revenue,
    (e.actual_revenue + e.actual_cash_revenue) as total_revenue,
    e.estimated_costs,
    e.actual_costs,
    (e.expected_revenue - e.estimated_costs) as estimated_profit,
    ((e.actual_revenue + e.actual_cash_revenue) - e.actual_costs) as actual_profit,
    off.id as accepted_offer_id,
    off.offer_number as accepted_offer_number,
    off.total_amount as accepted_offer_total,
    off.total_cost as accepted_offer_costs
  FROM events e
  LEFT JOIN organizations o ON e.organization_id = o.id
  LEFT JOIN contacts c ON e.contact_person_id = c.id
  LEFT JOIN LATERAL (
    SELECT id, offer_number, total_amount, total_cost
    FROM offers
    WHERE event_id = e.id AND status = 'accepted'
    ORDER BY created_at DESC
    LIMIT 1
  ) off ON true
  WHERE e.id = p_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_event_financial_info(uuid) TO authenticated;

COMMENT ON FUNCTION sync_offer_with_event_budget IS 'Synchronizuje zaakceptowaną ofertę (przychody i koszty) z budżetem eventu';
COMMENT ON FUNCTION get_event_financial_info IS 'Szczegółowe informacje finansowe eventu z kosztami i marżą';

-- Inicjalizacja kosztów z istniejących ofert
UPDATE events e
SET estimated_costs = (
  SELECT COALESCE(SUM(o.total_cost), 0)
  FROM offers o
  WHERE o.event_id = e.id AND o.status = 'accepted'
)
WHERE EXISTS (
  SELECT 1 FROM offers o
  WHERE o.event_id = e.id AND o.status = 'accepted'
);
