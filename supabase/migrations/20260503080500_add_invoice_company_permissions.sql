/*
  # Per-company invoice permissions

  Adds `invoice_company_permissions jsonb` on `employees` so admins can grant
  fine-grained per-my_company permissions for invoices.

  1. Changes
    - employees.invoice_company_permissions jsonb DEFAULT '{}'::jsonb
      Shape: { "<my_company_id>": ["view", "issue", "view_all", "manage"] }
      An empty object means: no per-company restriction (legacy behavior driven
      by `my_company_ids` only).

  2. Security
    - Non-destructive addition; existing employees get '{}' by default.
    - Enforcement happens in the invoices UI (client-side) and is layered on
      top of existing `permissions` and `my_company_ids`.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'invoice_company_permissions'
  ) THEN
    ALTER TABLE employees
      ADD COLUMN invoice_company_permissions jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;