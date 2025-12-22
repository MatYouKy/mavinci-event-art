/*
  # System mailowych zaproszeń do wydarzeń
  
  1. Nowe kolumny w employee_assignments:
     - invitation_token: Unikalny token do akcji mailowych (accept/reject)
     - invitation_expires_at: Data wygaśnięcia tokenu (7 dni)
     - invitation_email_sent: Czy mail został wysłany
     - invitation_email_sent_at: Kiedy wysłano mail
  
  2. Funkcja generowania tokenu
  3. Automatyczna generacja tokenu przy INSERT
  4. Trigger wysyłający mail z zaproszeniem
*/

-- Dodaj kolumny do employee_assignments
ALTER TABLE employee_assignments 
ADD COLUMN IF NOT EXISTS invitation_token TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS invitation_email_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS invitation_email_sent_at TIMESTAMP WITH TIME ZONE;

-- Funkcja generująca bezpieczny token
CREATE OR REPLACE FUNCTION generate_invitation_token()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  token TEXT;
  exists_token BOOLEAN;
BEGIN
  LOOP
    -- Generuj losowy token (32 znaki)
    token := encode(gen_random_bytes(24), 'base64');
    token := replace(replace(replace(token, '/', '_'), '+', '-'), '=', '');
    
    -- Sprawdź czy token już istnieje
    SELECT EXISTS(
      SELECT 1 FROM employee_assignments WHERE invitation_token = token
    ) INTO exists_token;
    
    EXIT WHEN NOT exists_token;
  END LOOP;
  
  RETURN token;
END;
$$;

-- Trigger automatycznie generujący token przy INSERT
CREATE OR REPLACE FUNCTION auto_generate_invitation_token()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.invitation_token IS NULL THEN
    NEW.invitation_token := generate_invitation_token();
    NEW.invitation_expires_at := now() + interval '7 days';
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generate_invitation_token_trigger ON employee_assignments;
CREATE TRIGGER generate_invitation_token_trigger
  BEFORE INSERT ON employee_assignments
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_invitation_token();

-- Zaktualizuj istniejące rekordy bez tokenu
UPDATE employee_assignments
SET 
  invitation_token = generate_invitation_token(),
  invitation_expires_at = now() + interval '7 days'
WHERE invitation_token IS NULL AND status = 'pending';

-- Indeks dla szybkiego wyszukiwania po tokenie
CREATE INDEX IF NOT EXISTS idx_employee_assignments_invitation_token 
ON employee_assignments(invitation_token) WHERE invitation_token IS NOT NULL;

COMMENT ON COLUMN employee_assignments.invitation_token IS 
'Unikalny token używany w mailach do akceptacji/odrzucenia zaproszenia bez logowania';

COMMENT ON COLUMN employee_assignments.invitation_expires_at IS 
'Data wygaśnięcia tokenu (domyślnie 7 dni od utworzenia)';
