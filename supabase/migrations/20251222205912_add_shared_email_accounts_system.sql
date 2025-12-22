/*
  # System wspólnych kont email

  1. Zmiany w employee_email_accounts
    - Dodaj `account_type` enum: 'personal', 'shared', 'system'
    - Dodaj `department` dla kont wspólnych (np. "Biuro", "Finanse", "Kadry")
    - Dodaj `description` - opis konta
    - employee_id może być null dla kont wspólnych

  2. Nowa tabela employee_email_account_assignments
    - Przypisania pracowników do kont wspólnych
    - Pozwala na zarządzanie dostępem do kont wspólnych

  3. Security
    - Aktualizacja RLS policies
    - Pracownicy widzą swoje konta + konta wspólne do których mają dostęp
*/

-- Dodaj enum dla typu konta
DO $$ BEGIN
  CREATE TYPE email_account_type AS ENUM ('personal', 'shared', 'system');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Dodaj nowe kolumny do employee_email_accounts
ALTER TABLE employee_email_accounts
ADD COLUMN IF NOT EXISTS account_type email_account_type DEFAULT 'personal',
ADD COLUMN IF NOT EXISTS department text,
ADD COLUMN IF NOT EXISTS description text;

-- Ustaw typ dla istniejących kont
UPDATE employee_email_accounts
SET account_type = CASE
  WHEN is_system_account = true THEN 'system'::email_account_type
  WHEN employee_id IS NULL THEN 'shared'::email_account_type
  ELSE 'personal'::email_account_type
END
WHERE account_type IS NULL OR account_type = 'personal';

-- employee_id może być null dla kont wspólnych
ALTER TABLE employee_email_accounts
ALTER COLUMN employee_id DROP NOT NULL;

-- Tabela przypisań pracowników do kont wspólnych
CREATE TABLE IF NOT EXISTS employee_email_account_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_account_id uuid NOT NULL REFERENCES employee_email_accounts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  can_send boolean DEFAULT true,
  can_receive boolean DEFAULT true,
  assigned_at timestamptz DEFAULT now(),
  assigned_by uuid REFERENCES employees(id),
  UNIQUE(email_account_id, employee_id)
);

-- Enable RLS
ALTER TABLE employee_email_account_assignments ENABLE ROW LEVEL SECURITY;

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_email_account_assignments_account
  ON employee_email_account_assignments(email_account_id);
CREATE INDEX IF NOT EXISTS idx_email_account_assignments_employee
  ON employee_email_account_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_email_accounts_type
  ON employee_email_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_employee_email_accounts_department
  ON employee_email_accounts(department) WHERE department IS NOT NULL;

-- Aktualizacja RLS policies dla employee_email_accounts

-- Drop old policies
DROP POLICY IF EXISTS "Authenticated users can view active email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Authenticated users can insert email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Authenticated users can update email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Authenticated users can delete email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can view their accessible email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can insert email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can update email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can delete email accounts" ON employee_email_accounts;

-- Nowe policies: Użytkownicy widzą:
-- 1. Swoje osobiste konta
-- 2. Konta wspólne do których są przypisani
-- 3. Wszystkie konta systemowe
CREATE POLICY "Users can view their accessible email accounts"
  ON employee_email_accounts
  FOR SELECT
  TO authenticated
  USING (
    is_active = true AND (
      -- Własne konta osobiste
      (account_type = 'personal' AND employee_id = auth.uid())
      -- Konta wspólne do których jest przypisany
      OR (account_type = 'shared' AND EXISTS (
        SELECT 1 FROM employee_email_account_assignments
        WHERE email_account_id = employee_email_accounts.id
        AND employee_id = auth.uid()
      ))
      -- Wszystkie konta systemowe
      OR account_type = 'system'
      -- Service role ma dostęp do wszystkiego
      OR auth.jwt() ->> 'role' = 'service_role'
    )
  );

-- INSERT: Tylko admini mogą dodawać konta wspólne i systemowe
CREATE POLICY "Users can insert email accounts"
  ON employee_email_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Każdy może dodać swoje osobiste konto
    (account_type = 'personal' AND employee_id = auth.uid())
    -- Tylko admin może dodać wspólne lub systemowe
    OR (account_type IN ('shared', 'system') AND EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    ))
    -- Service role może wszystko
    OR auth.jwt() ->> 'role' = 'service_role'
  );

-- UPDATE: Użytkownicy mogą edytować swoje konta, admini wszystkie
CREATE POLICY "Users can update email accounts"
  ON employee_email_accounts
  FOR UPDATE
  TO authenticated
  USING (
    -- Własne konto osobiste
    (account_type = 'personal' AND employee_id = auth.uid())
    -- Admin może edytować wszystko
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    )
    -- Service role może wszystko
    OR auth.jwt() ->> 'role' = 'service_role'
  )
  WITH CHECK (
    -- Własne konto osobiste
    (account_type = 'personal' AND employee_id = auth.uid())
    -- Admin może edytować wszystko
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    )
    -- Service role może wszystko
    OR auth.jwt() ->> 'role' = 'service_role'
  );

-- DELETE: Tylko admini mogą usuwać konta (z wyjątkiem swoich osobistych)
CREATE POLICY "Users can delete email accounts"
  ON employee_email_accounts
  FOR DELETE
  TO authenticated
  USING (
    -- Własne konto osobiste
    (account_type = 'personal' AND employee_id = auth.uid())
    -- Admin może usuwać wszystko
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    )
    -- Service role może wszystko
    OR auth.jwt() ->> 'role' = 'service_role'
  );

-- RLS policies dla employee_email_account_assignments

CREATE POLICY "Users can view their account assignments"
  ON employee_email_account_assignments
  FOR SELECT
  TO authenticated
  USING (
    -- Własne przypisania
    employee_id = auth.uid()
    -- Admin widzi wszystkie
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    )
    -- Service role widzi wszystko
    OR auth.jwt() ->> 'role' = 'service_role'
  );

CREATE POLICY "Admins can manage account assignments"
  ON employee_email_account_assignments
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    )
    OR auth.jwt() ->> 'role' = 'service_role'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    )
    OR auth.jwt() ->> 'role' = 'service_role'
  );

-- Funkcja pomocnicza: Sprawdź czy użytkownik ma dostęp do konta
CREATE OR REPLACE FUNCTION has_email_account_access(
  account_id uuid,
  user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  acc_type email_account_type;
  acc_employee_id uuid;
BEGIN
  -- Pobierz info o koncie
  SELECT account_type, employee_id
  INTO acc_type, acc_employee_id
  FROM employee_email_accounts
  WHERE id = account_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Konto systemowe - każdy ma dostęp
  IF acc_type = 'system' THEN
    RETURN true;
  END IF;

  -- Konto osobiste - tylko właściciel
  IF acc_type = 'personal' THEN
    RETURN acc_employee_id = user_id;
  END IF;

  -- Konto wspólne - sprawdź przypisanie
  IF acc_type = 'shared' THEN
    RETURN EXISTS (
      SELECT 1 FROM employee_email_account_assignments
      WHERE email_account_id = account_id
      AND employee_id = user_id
    );
  END IF;

  RETURN false;
END;
$$;

COMMENT ON COLUMN employee_email_accounts.account_type IS
'Typ konta: personal (osobiste), shared (wspólne działowe), system (automatyczne maile systemowe)';

COMMENT ON COLUMN employee_email_accounts.department IS
'Nazwa działu dla kont wspólnych (np. Biuro, Finanse, Kadry)';

COMMENT ON TABLE employee_email_account_assignments IS
'Przypisania pracowników do kont email wspólnych';