/*
  # Dodaj bypass RLS dla service_role na employee_email_accounts

  1. Zmiany
    - Dodano politykę dla service_role która omija RLS
    - Worker IMAP używa SERVICE_ROLE_KEY więc potrzebuje pełnego dostępu
  
  2. Bezpieczeństwo
    - Service role może czytać wszystkie konta email
    - Potrzebne dla workera IMAP który działa w tle
*/

-- Usuń starą politykę jeśli istnieje
DROP POLICY IF EXISTS "Service role bypass RLS" ON employee_email_accounts;

-- Dodaj politykę dla service_role
CREATE POLICY "Service role full access"
  ON employee_email_accounts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
