/*
  # Add my_company_ids permission to employees

  Adds a uuid array column `my_company_ids` on `employees` so admins can restrict
  which of their companies (from `my_companies`) a given employee can see in the
  invoices module.

  1. Changes
    - employees.my_company_ids uuid[] DEFAULT '{}' (NOT NULL)
      - Empty array means: access to ALL companies (no restriction).
      - Non-empty array means: only those company ids are visible.

  2. Security
    - Column added without destructive changes.
    - Enforcement happens client-side in the invoices module; admins and
      users with `admin` permission remain unrestricted regardless of value.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'my_company_ids'
  ) THEN
    ALTER TABLE employees
      ADD COLUMN my_company_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
  END IF;
END $$;