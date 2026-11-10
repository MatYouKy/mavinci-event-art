-- Numer umowy liczony po wszystkich umowach firmy, nie tylko tych, które widzi pracownik
-- ===============================================================================================================
-- Można uruchomić ponownie.
--
-- Błąd: pracownik z zakresem „Umowy: tylko własne” (np. sprzedawca) przy „Edytuj treść umowy” dostawał
-- 23505 duplicate key value violates unique constraint "contracts_contract_number_key".
-- Przyczyna: generate_contract_number() działała z uprawnieniami pracownika, więc sprawdzała zajętość numeru
-- tylko w umowach widocznych dla niego (RLS). Nie widząc cudzych umów z tego miesiąca, proponowała np.
-- UM/2026/11/001, który już istnieje.
-- Poprawka: funkcja działa jako właściciel tabeli (widzi wszystkie numery), z blokadą na miesiąc,
-- żeby dwie umowy zapisywane w tej samej chwili nie dostały tego samego numeru.
-- Format numeru bez zmian: UM/RRRR/MM/NNN — pierwszy wolny numer w miesiącu.
-- Funkcja zwraca tylko kolejny numer, bez danych umów; anon traci do niej dostęp.

CREATE OR REPLACE FUNCTION public.generate_contract_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prefix text := 'UM/' || to_char(current_date, 'YYYY') || '/' || to_char(current_date, 'MM') || '/';
  v_count integer := 1;
  v_contract_number text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.contracts.contract_number:' || v_prefix));

  LOOP
    v_contract_number := v_prefix || lpad(v_count::text, 3, '0');
    IF NOT EXISTS (SELECT 1 FROM public.contracts WHERE contract_number = v_contract_number) THEN
      RETURN v_contract_number;
    END IF;
    v_count := v_count + 1;
    IF v_count > 9999 THEN
      RAISE EXCEPTION 'Przekroczono limit numerów umów dla tego miesiąca';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_contract_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_contract_number() TO authenticated, service_role;
