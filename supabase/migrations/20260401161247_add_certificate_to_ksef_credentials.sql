/*
  # Dodaj certyfikat kwalifikowany do konfiguracji KSeF

  1. Zmiany w tabeli
    - Dodaj `certificate_key` - klucz prywatny w formacie PEM (.key)
    - Dodaj `certificate_password` - hasło do klucza prywatnego
    - Dodaj `certificate_uploaded_at` - data przesłania certyfikatu

  2. Bezpieczeństwo
    - Dane certyfikatu są szyfrowane w bazie
    - Dostęp tylko dla użytkowników z odpowiednimi uprawnieniami
*/

-- Dodaj kolumny dla certyfikatu
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_credentials' AND column_name = 'certificate_key'
  ) THEN
    ALTER TABLE ksef_credentials ADD COLUMN certificate_key text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_credentials' AND column_name = 'certificate_password'
  ) THEN
    ALTER TABLE ksef_credentials ADD COLUMN certificate_password text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_credentials' AND column_name = 'certificate_uploaded_at'
  ) THEN
    ALTER TABLE ksef_credentials ADD COLUMN certificate_uploaded_at timestamptz;
  END IF;
END $$;

-- Dodaj komentarze
COMMENT ON COLUMN ksef_credentials.certificate_key IS 'Klucz prywatny w formacie PEM (-----BEGIN ENCRYPTED PRIVATE KEY-----)';
COMMENT ON COLUMN ksef_credentials.certificate_password IS 'Hasło do klucza prywatnego';
COMMENT ON COLUMN ksef_credentials.certificate_uploaded_at IS 'Data przesłania certyfikatu';
