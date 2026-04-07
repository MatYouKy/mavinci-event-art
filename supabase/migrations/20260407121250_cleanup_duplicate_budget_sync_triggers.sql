/*
  # Cleanup duplicate budget sync triggers
  
  ## Problem
  - Są dwa triggery robiące podobne rzeczy:
    1. sync_offer_total_with_budget_trigger (stary - tylko expected_revenue)
    2. trigger_sync_offer_with_event_budget (nowy - expected_revenue + estimated_costs)
  - To powoduje konflikty i nieprawidłowe dane
  
  ## Rozwiązanie
  1. Usuń stare triggery i funkcje
  2. Pozostaw tylko trigger_sync_offer_with_event_budget
  3. Upewnij się że działa dla zaakceptowanych ofert
*/

-- 1. Usuń stare triggery
DROP TRIGGER IF EXISTS sync_offer_total_with_budget_trigger ON offers;
DROP TRIGGER IF EXISTS sync_offer_total_with_budget_trigger_delete ON offers;
DROP FUNCTION IF EXISTS sync_offer_total_with_event_budget();

-- 2. Upewnij się że nowszy trigger istnieje i jest poprawny
-- (już istnieje z poprzedniej migracji 20251204200359_sync_offer_costs_with_event_budget_v2.sql)

-- 3. Zaktualizuj wszystkie eventy z zaakceptowanych ofert
UPDATE events e
SET 
  expected_revenue = COALESCE(latest_offer.total_amount, 0),
  estimated_costs = COALESCE(latest_offer.total_cost, 0)
FROM (
  SELECT DISTINCT ON (event_id)
    event_id,
    total_amount,
    total_cost
  FROM offers
  WHERE event_id IS NOT NULL
    AND status = 'accepted'
  ORDER BY event_id, created_at DESC
) AS latest_offer
WHERE e.id = latest_offer.event_id;

-- 4. Resetuj wartości dla eventów bez zaakceptowanych ofert
UPDATE events
SET 
  expected_revenue = 0,
  estimated_costs = 0
WHERE id NOT IN (
  SELECT DISTINCT event_id 
  FROM offers 
  WHERE event_id IS NOT NULL 
    AND status = 'accepted'
)
AND (expected_revenue != 0 OR estimated_costs != 0);

-- 5. Dodaj komentarze do kolumn dla jasności
COMMENT ON COLUMN events.expected_revenue IS 'Oczekiwany przychód - synchronizowany z zaakceptowanej oferty (total_amount)';
COMMENT ON COLUMN events.estimated_costs IS 'Szacowane koszty - synchronizowane z zaakceptowanej oferty (total_cost)';
COMMENT ON COLUMN events.actual_revenue IS 'Faktyczny przychód - suma opłaconych faktur';
COMMENT ON COLUMN events.actual_costs IS 'Faktyczne koszty - suma kosztów z tabeli event_costs';
