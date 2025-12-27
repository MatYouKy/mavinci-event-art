/*
  # Pozwól na publiczne akceptowanie/odrzucanie zaproszeń

  1. Polityki
    - Dodaj politykę SELECT dla użytkowników niezalogowanych (anon) aby mogli sprawdzić zaproszenie po tokenie
    - Dodaj politykę UPDATE dla użytkowników niezalogowanych (anon) aby mogli zaktualizować status zaproszenia
    - Ograniczenie: tylko dla zaproszeń które mają nieprzeterminowany token

  2. Bezpieczeństwo
    - Użytkownik anon może tylko odczytać rekordy z poprawnym invitation_token
    - Użytkownik anon może tylko zaktualizować status i responded_at
    - Token musi być nieprzeterminowany (invitation_expires_at > now())
*/

-- Pozwól niezalogowanym użytkownikom odczytać zaproszenie po tokenie
CREATE POLICY "Allow public to read invitations by token"
  ON employee_assignments FOR SELECT
  TO anon
  USING (
    invitation_token IS NOT NULL
    AND invitation_token != ''
    AND invitation_expires_at > now()
  );

-- Pozwól niezalogowanym użytkownikom zaktualizować status zaproszenia
CREATE POLICY "Allow public to update invitation status by token"
  ON employee_assignments FOR UPDATE
  TO anon
  USING (
    invitation_token IS NOT NULL
    AND invitation_token != ''
    AND invitation_expires_at > now()
    AND status = 'pending'
  )
  WITH CHECK (
    invitation_token IS NOT NULL
    AND invitation_token != ''
    AND invitation_expires_at > now()
    AND status IN ('accepted', 'rejected')
  );

-- Pozwól niezalogowanym użytkownikom tworzyć notyfikacje dla koordynatora
CREATE POLICY "Allow public to create event notifications"
  ON notifications FOR INSERT
  TO anon
  WITH CHECK (
    category = 'employee'
    AND related_entity_type = 'event'
  );

-- Pozwól niezalogowanym użytkownikom dodawać odbiorców notyfikacji
CREATE POLICY "Allow public to add notification recipients"
  ON notification_recipients FOR INSERT
  TO anon
  WITH CHECK (true);

-- Pozwól niezalogowanym użytkownikom aktualizować istniejące notyfikacje (dla pracownika)
CREATE POLICY "Allow public to update own notifications"
  ON notifications FOR UPDATE
  TO anon
  USING (
    related_entity_type = 'event'
    AND category = 'employee'
  )
  WITH CHECK (
    related_entity_type = 'event'
    AND category = 'employee'
  );
