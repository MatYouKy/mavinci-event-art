/*
  # Funkcja resetowania statystyk analitycznych

  1. Nowa funkcja RPC
    - `reset_analytics_data` - Usuwa wszystkie dane analityczne
    - Wymaga uprawnień administratora
    - Działa z SECURITY DEFINER (omija RLS)
  
  2. Bezpieczeństwo
    - Sprawdza czy użytkownik jest zalogowany
    - Weryfikuje uprawnienia 'admin' lub 'website_edit'
    - Tylko autoryzowani użytkownicy mogą wyczyścić dane
*/

-- Funkcja do resetowania statystyk
CREATE OR REPLACE FUNCTION reset_analytics_data()
RETURNS json
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  current_user_id uuid;
  user_permissions text[];
  deleted_analytics integer;
  deleted_interactions integer;
  deleted_sessions integer;
BEGIN
  -- Pobierz ID zalogowanego użytkownika
  current_user_id := auth.uid();
  
  -- Sprawdź czy użytkownik jest zalogowany
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Musisz być zalogowany aby zresetować statystyki';
  END IF;
  
  -- Pobierz uprawnienia użytkownika
  SELECT permissions INTO user_permissions
  FROM employees
  WHERE id = current_user_id
  AND is_active = true;
  
  -- Sprawdź czy użytkownik ma odpowiednie uprawnienia
  IF user_permissions IS NULL OR 
     (NOT 'admin' = ANY(user_permissions) AND 
      NOT 'website_edit' = ANY(user_permissions)) THEN
    RAISE EXCEPTION 'Brak uprawnień do resetowania statystyk';
  END IF;
  
  -- Usuń dane z page_analytics
  DELETE FROM page_analytics;
  GET DIAGNOSTICS deleted_analytics = ROW_COUNT;
  
  -- Usuń dane z user_interactions (jeśli istnieje)
  BEGIN
    DELETE FROM user_interactions;
    GET DIAGNOSTICS deleted_interactions = ROW_COUNT;
  EXCEPTION WHEN undefined_table THEN
    deleted_interactions := 0;
  END;
  
  -- Usuń dane z active_sessions
  DELETE FROM active_sessions;
  GET DIAGNOSTICS deleted_sessions = ROW_COUNT;
  
  -- Zwróć podsumowanie
  RETURN json_build_object(
    'success', true,
    'deleted_analytics', deleted_analytics,
    'deleted_interactions', deleted_interactions,
    'deleted_sessions', deleted_sessions,
    'message', 'Statystyki zostały pomyślnie zresetowane'
  );
END;
$$;

-- Nadaj uprawnienia do wykonania funkcji
GRANT EXECUTE ON FUNCTION reset_analytics_data() TO authenticated;

COMMENT ON FUNCTION reset_analytics_data() IS 'Resetuje wszystkie dane analityczne. Wymaga uprawnień admin lub website_edit.';
