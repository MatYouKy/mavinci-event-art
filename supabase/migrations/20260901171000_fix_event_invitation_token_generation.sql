-- Naprawa tokenów zaproszeń po ograniczeniu search_path funkcji bazodanowych.
-- gen_random_bytes() pochodzi z pgcrypto i w Supabase zwykle znajduje się
-- w schemacie extensions. Token z dwóch gen_random_uuid() nie zależy od
-- pgcrypto, pozostaje kryptograficznie losowy i jest od razu bezpieczny w URL.

CREATE OR REPLACE FUNCTION public.generate_invitation_token()
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  generated_token text;
  token_exists boolean;
BEGIN
  LOOP
    generated_token := pg_catalog.replace(
      pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text,
      '-',
      ''
    );

    SELECT EXISTS (
      SELECT 1
      FROM public.employee_assignments assignment
      WHERE assignment.invitation_token = generated_token
    )
    INTO token_exists;

    EXIT WHEN NOT token_exists;
  END LOOP;

  RETURN generated_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_generate_invitation_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.invitation_token IS NULL OR btrim(NEW.invitation_token) = '' THEN
    NEW.invitation_token := public.generate_invitation_token();
    NEW.invitation_expires_at := pg_catalog.now() + interval '7 days';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.generate_invitation_token() IS
  'Generuje niezależny od pgcrypto, bezpieczny token zaproszenia pracownika.';

COMMENT ON FUNCTION public.auto_generate_invitation_token() IS
  'Uzupełnia token i termin ważności przed dodaniem pracownika do wydarzenia.';
