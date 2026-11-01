-- Dostęp do finansów według działalności — uzupełnienie 20261101165000 (2026-11-01).
--
-- Po 20261101165000 tabela my_companies (dane firmy, rachunki bankowe, rachunek prywatny właściciela, rachunki
-- US/ZUS, numeracja faktur) jest widoczna tylko przy dostępie do finansów danej działalności (poziom ≥ „sales”).
-- Formularze CRM, które potrzebują jedynie wyboru marki (np. wydarzenie: „Firma realizująca”), korzystają z tej
-- funkcji: zwraca id, nazwę, NIP i logo działalności, do których pracownik ma dostęp (employee_can_access_company),
-- bez żadnych danych finansowych. Konto portalu sprzedawcy i anon — pusta lista / brak dostępu.
-- Wymaga: 20261101165000_finance_company_access.sql. Bez tabel tymczasowych. Plik można bezpiecznie uruchomić ponownie.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.finance_company_level(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261101165000_finance_company_access.sql.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_my_accessible_companies()
RETURNS TABLE (id uuid, name text, nip text, is_default boolean, is_active boolean, logo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.id, c.name, c.nip, c.is_default, c.is_active, c.logo_url
  FROM public.my_companies c
  WHERE auth.uid() IS NOT NULL AND NOT public.current_session_is_seller_portal()
    AND public.current_invoice_employee_id() IS NOT NULL
    AND public.employee_can_access_company(public.current_invoice_employee_id(), c.id)
  ORDER BY c.is_default DESC NULLS LAST, c.name;
$$;
COMMENT ON FUNCTION public.get_my_accessible_companies() IS
  'Działalności dostępne dla zalogowanego pracownika (id, nazwa, NIP, logo) do wyboru marki w formularzach CRM — bez danych finansowych.';

REVOKE EXECUTE ON FUNCTION public.get_my_accessible_companies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_accessible_companies() TO authenticated, service_role;

COMMIT;
