/*
  # Ograniczenie Usuwania Ofert Na Podstawie Statusu

  1. Modyfikacja RLS Policy
    - Oferty o statusie 'accepted' NIE MOGĄ być usunięte
    - Oferty o statusie 'rejected' NIE MOGĄ być usunięte
    - Tylko oferty 'draft' i 'sent' mogą być usunięte przez adminów
    - Zapobiega przypadkowemu usunięciu ważnych ofert

  2. Bezpieczeństwo
    - Dodaje warunek status IN ('draft', 'sent') do policy DELETE
    - Zachowuje istniejące uprawnienia (tylko admini)
*/

-- Usuń starą policy DELETE
DROP POLICY IF EXISTS "Admins can delete offers" ON offers;

-- Utwórz nową policy DELETE z walidacją statusu
CREATE POLICY "Admins can delete draft and sent offers"
  ON offers FOR DELETE
  TO authenticated
  USING (
    -- Tylko admini mogą usuwać
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
    -- I TYLKO oferty w statusie draft lub sent
    AND status IN ('draft', 'sent')
  );

COMMENT ON POLICY "Admins can delete draft and sent offers" ON offers IS
'Admini mogą usuwać tylko oferty w statusie draft lub sent. Zaakceptowane i odrzucone oferty są chronione przed usunięciem.';
