/*
  # Napraw aktualizację statusu ofert

  1. Problem
    - Twórca oferty może ją edytować tylko gdy ma status 'draft'
    - Po zmianie statusu na 'sent' lub 'accepted', traci możliwość zmiany statusu
    
  2. Rozwiązanie
    - Pozwól twórcy oferty zmieniać jej status niezależnie od obecnego statusu
    - Zachowaj ograniczenie edycji treści tylko dla draft
*/

-- Usuń starą politykę
DROP POLICY IF EXISTS "Employees can update offers" ON offers;

-- Stwórz nową politykę - osobno dla statusu i treści
CREATE POLICY "Employees can update offers"
  ON offers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        -- Admin i offers_manage mogą edytować wszystko
        employees.role = 'admin'
        OR 'admin' = ANY(employees.permissions)
        OR 'offers_manage' = ANY(employees.permissions)
        -- Twórca może edytować swoją ofertę (treść tylko w draft, status zawsze)
        OR offers.created_by = employees.id
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'admin' = ANY(employees.permissions)
        OR 'offers_manage' = ANY(employees.permissions)
        OR offers.created_by = employees.id
      )
    )
  );

COMMENT ON POLICY "Employees can update offers" ON offers IS 
'Admins and offers_manage can edit all. Creators can always update their offers including status changes.';
