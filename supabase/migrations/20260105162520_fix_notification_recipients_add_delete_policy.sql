/*
  # Dodaj policy DELETE dla notification_recipients

  1. Problem
    - Użytkownicy nie mogą usuwać swoich notyfikacji
    - Brakuje policy DELETE na notification_recipients
    - DELETE zwraca success ale nic nie usuwa (RLS blokuje)

  2. Rozwiązanie
    - Dodaj policy pozwalającą użytkownikom usuwać swoje notyfikacje
    - Policy: authenticated users mogą DELETE WHERE user_id = auth.uid()

  3. Bezpieczeństwo
    - Użytkownik może usunąć tylko SWOJE notyfikacje (user_id = auth.uid())
    - Notyfikacje innych użytkowników są chronione
*/

-- Dodaj policy DELETE dla użytkowników
CREATE POLICY "Users can delete their own notification recipients"
  ON notification_recipients
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Test
DO $$
BEGIN
  RAISE NOTICE 'Policy DELETE dla notification_recipients dodana pomyślnie';
END $$;
