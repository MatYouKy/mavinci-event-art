-- Motyw CRM wybierany przez pracownika (Ustawienia → Ogólne → Wygląd)
-- ===============================================================================================================
-- Można uruchomić ponownie.
--
-- employees.crm_theme: burgundy (domyślny), navy (granat), dark (szary jak macOS), light (jasny jak macOS).
-- Pracownik zmienia go sam (zasada „Users can update own profile”); kolumna nie jest uprawnieniem, więc
-- strażnik guard_employee_privileged_columns jej nie blokuje. Osobna kolumna zamiast preferences (jsonb),
-- bo preferencje są zapisywane w całości z kilku miejsc i mogłyby nadpisać wybór starszą kopią.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS crm_theme text NOT NULL DEFAULT 'burgundy';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.employees'::regclass AND conname = 'employees_crm_theme_check') THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_crm_theme_check CHECK (crm_theme IN ('burgundy', 'navy', 'dark', 'light'));
  END IF;
END $$;

COMMENT ON COLUMN public.employees.crm_theme IS
  'Motyw CRM pracownika: burgundy, navy, dark, light (Ustawienia → Ogólne → Wygląd).';
