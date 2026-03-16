/*
  # Poprawka Policy DELETE dla Ofert - Dodanie offers_manage

  1. Problem
    - Policy wymagała tylko role = 'admin'
    - Użytkownicy z uprawnieniem 'offers_manage' nie mogli usuwać ofert

  2. Rozwiązanie
    - Dodanie warunku: 'offers_manage' = ANY(permissions)
    - Zachowanie walidacji statusu (draft/sent)

  3. Bezpieczeństwo
    - Nadal tylko draft/sent mogą być usunięte
    - Admini + osoby z offers_manage mogą usuwać
*/

-- Usuń starą policy
DROP POLICY IF EXISTS "Admins can delete draft and sent offers" ON offers;

-- Utwórz poprawioną policy z offers_manage
CREATE POLICY "Admins and offers_manage can delete draft and sent offers"
  ON offers FOR DELETE
  TO authenticated
  USING (
    -- Admini lub osoby z uprawnieniem offers_manage
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'offers_manage' = ANY(employees.permissions)
      )
    )
    -- I TYLKO oferty w statusie draft lub sent
    AND status IN ('draft', 'sent')
  );

COMMENT ON POLICY "Admins and offers_manage can delete draft and sent offers" ON offers IS
'Admini i użytkownicy z uprawnieniem offers_manage mogą usuwać tylko oferty w statusie draft lub sent. Zaakceptowane i odrzucone oferty są chronione przed usunięciem.';
