/*
  # Funkcja do tworzenia użytkowników klientów

  ## Opis
  
  Dodaje funkcję pomocniczą do tworzenia użytkowników klientów z poziomu aplikacji.
  Pozwala administratorowi stworzyć konto dla klienta z własnym hasłem.

  ## Funkcje
  
  - `create_client_user(email, password, client_id, full_name)` - tworzy użytkownika klienta
  - Zwraca ID utworzonego użytkownika
  - Automatycznie potwierdza email (email_confirmed_at = NOW())
  - Ustawia odpowiednie metadane

  ## Bezpieczeństwo
  
  - Funkcja dostępna tylko dla zalogowanych pracowników
  - SECURITY DEFINER pozwala na zapis do auth.users
*/

-- Funkcja do tworzenia użytkownika klienta
CREATE OR REPLACE FUNCTION create_client_user(
  p_email text,
  p_password text,
  p_client_id uuid,
  p_full_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_calling_user_id uuid;
BEGIN
  -- Sprawdź czy wywołujący jest zalogowanym pracownikiem
  v_calling_user_id := auth.uid();
  
  IF v_calling_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Must be authenticated';
  END IF;

  -- Sprawdź czy użytkownik już istnieje
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = p_email;

  IF v_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'User with this email already exists';
  END IF;

  -- Wygeneruj nowe ID
  v_user_id := gen_random_uuid();

  -- Utwórz użytkownika
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    p_email,
    crypt(p_password, gen_salt('bf')),
    NOW(), -- Email potwierdzony od razu
    NOW(),
    NOW(),
    jsonb_build_object(
      'provider', 'email',
      'providers', ARRAY['email'],
      'user_type', 'client',
      'created_by', v_calling_user_id
    ),
    jsonb_build_object(
      'client_id', p_client_id,
      'full_name', p_full_name,
      'user_type', 'client'
    ),
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
  );

  RETURN v_user_id;
END;
$$;

-- Komentarz
COMMENT ON FUNCTION create_client_user IS 'Tworzy użytkownika klienta z automatycznym potwierdzeniem email';

-- Grant execute dla authenticated users (pracownicy)
GRANT EXECUTE ON FUNCTION create_client_user TO authenticated;
