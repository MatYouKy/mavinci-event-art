/*
  # Fix ambiguous event_id in sync functions v2

  1. Problem
    - Column references are ambiguous in multiple functions
    - Could refer to either column or variable/parameter
    
  2. Solution
    - Add table prefix to all column references
*/

CREATE OR REPLACE FUNCTION sync_offer_with_event_budget()
RETURNS TRIGGER AS $$
DECLARE
  accepted_offer_total numeric;
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    IF NEW.status = 'accepted' AND NEW.event_id IS NOT NULL THEN
      UPDATE events e
      SET expected_revenue = NEW.total_amount
      WHERE e.id = NEW.event_id;
      
      RETURN NEW;
    END IF;
    
    IF (NEW.status IN ('rejected', 'cancelled') OR OLD.status = 'accepted') AND NEW.event_id IS NOT NULL THEN
      SELECT COALESCE(SUM(o.total_amount), 0) INTO accepted_offer_total
      FROM offers o
      WHERE o.event_id = NEW.event_id
        AND o.status = 'accepted'
        AND o.id != NEW.id;
      
      UPDATE events e
      SET expected_revenue = accepted_offer_total
      WHERE e.id = NEW.event_id;
      
      RETURN NEW;
    END IF;
  END IF;
  
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status = 'accepted' AND OLD.event_id IS NOT NULL THEN
      SELECT COALESCE(SUM(o.total_amount), 0) INTO accepted_offer_total
      FROM offers o
      WHERE o.event_id = OLD.event_id
        AND o.status = 'accepted'
        AND o.id != OLD.id;
      
      UPDATE events e
      SET expected_revenue = accepted_offer_total
      WHERE e.id = OLD.event_id;
      
      RETURN OLD;
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
  accepted_offer_id uuid,
  accepted_offer_number text,
  accepted_offer_total numeric
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
    off.id as accepted_offer_id,
    off.offer_number as accepted_offer_number,
    off.total_amount as accepted_offer_total
  FROM events e
  LEFT JOIN organizations o ON e.organization_id = o.id
  LEFT JOIN contacts c ON e.contact_person_id = c.id
  LEFT JOIN LATERAL (
    SELECT off2.id, off2.offer_number, off2.total_amount
    FROM offers off2
    WHERE off2.event_id = e.id AND off2.status = 'accepted'
    ORDER BY off2.created_at DESC
    LIMIT 1
  ) off ON true
  WHERE e.id = p_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_event_financial_info(uuid) TO authenticated;