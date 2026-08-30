/*
  Restore the canonical local invoice register.

  Local invoices remain the source for proformas, drafts, PDF previews and documents
  before/alongside KSeF. Employee ids are not guaranteed to equal auth user ids.
*/

-- This repair extends the canonical invoice model introduced by 20260901190000.
-- Fail early with one actionable message instead of reporting missing objects one by one.
DO $$
BEGIN
  IF to_regclass('public.invoice_order_items') IS NULL
     OR to_regclass('public.invoice_settlements') IS NULL
     OR to_regclass('public.invoice_source_links') IS NULL
     OR to_regprocedure('public.create_invoice_atomic(jsonb,jsonb,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Najpierw uruchom migrację 20260901190000_harden_invoice_accounting_and_ksef_fa3.sql, a następnie ponownie tę migrację.';
  END IF;
END;
$$;

-- Recover company ownership only when seller NIP points to exactly one company.
WITH unique_companies AS (
  SELECT
    regexp_replace(nip, '[^0-9]', '', 'g') AS normalized_nip,
    min(id::text)::uuid AS company_id
  FROM public.my_companies
  WHERE NULLIF(regexp_replace(COALESCE(nip, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
  GROUP BY regexp_replace(nip, '[^0-9]', '', 'g')
  HAVING count(*) = 1
)
UPDATE public.invoices invoice
SET my_company_id = company.company_id
FROM unique_companies company
WHERE invoice.my_company_id IS NULL
  AND NULLIF(regexp_replace(COALESCE(invoice.seller_nip, ''), '[^0-9]', '', 'g'), '') = company.normalized_nip;

CREATE OR REPLACE FUNCTION public.current_invoice_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT employee.id
  FROM public.employees employee
  WHERE COALESCE(employee.is_active, true)
    AND (
      employee.auth_user_id = auth.uid()
      OR employee.id = auth.uid()
      OR lower(employee.email) = lower(COALESCE(auth.jwt()->>'email', ''))
    )
  ORDER BY
    CASE
      WHEN employee.auth_user_id = auth.uid() THEN 0
      WHEN employee.id = auth.uid() THEN 1
      ELSE 2
    END,
    employee.created_at
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_invoices()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.current_invoice_employee_id()
      AND COALESCE(employee.is_active, true)
      AND (
        employee.role::text = 'admin'
        OR employee.access_level::text = 'admin'
        OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'invoices_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'finances_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_invoices()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.current_invoice_employee_id()
      AND COALESCE(employee.is_active, true)
      AND (
        employee.role::text = 'admin'
        OR employee.access_level::text = 'admin'
        OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'invoices_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'invoices_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'finances_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'finances_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_invoice_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.current_invoice_employee_id()
      AND COALESCE(employee.is_active, true)
      AND (
        employee.role::text = 'admin'
        OR employee.access_level::text = 'admin'
        OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR (
          (
            'invoices_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
            OR 'finances_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          )
          AND (
            cardinality(COALESCE(employee.my_company_ids, '{}'::uuid[])) = 0
            OR p_company_id = ANY(COALESCE(employee.my_company_ids, '{}'::uuid[]))
          )
          AND (
            COALESCE(employee.invoice_company_permissions, '{}'::jsonb) = '{}'::jsonb
            OR COALESCE(employee.invoice_company_permissions -> p_company_id::text, '[]'::jsonb)
              ?| ARRAY['issue', 'manage']
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_invoice_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.current_invoice_employee_id()
      AND public.can_view_invoices()
      AND (
        employee.role::text = 'admin'
        OR employee.access_level::text = 'admin'
        OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR (
          (
            cardinality(COALESCE(employee.my_company_ids, '{}'::uuid[])) = 0
            OR p_company_id = ANY(COALESCE(employee.my_company_ids, '{}'::uuid[]))
          )
          AND (
            COALESCE(employee.invoice_company_permissions, '{}'::jsonb) = '{}'::jsonb
            OR COALESCE(employee.invoice_company_permissions -> p_company_id::text, '[]'::jsonb)
              ?| ARRAY['view', 'view_own', 'view_all', 'issue', 'manage']
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_invoice(p_invoice_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.invoices invoice
    WHERE invoice.id = p_invoice_id
      AND public.can_manage_invoice_company(invoice.my_company_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_invoice_row(p_company_id uuid, p_created_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.current_invoice_employee_id()
      AND public.can_view_invoices()
      AND (
        employee.role::text = 'admin'
        OR employee.access_level::text = 'admin'
        OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR (
          (
            cardinality(COALESCE(employee.my_company_ids, '{}'::uuid[])) = 0
            OR p_company_id = ANY(COALESCE(employee.my_company_ids, '{}'::uuid[]))
          )
          AND (
            COALESCE(employee.invoice_company_permissions, '{}'::jsonb) = '{}'::jsonb
            OR COALESCE(employee.invoice_company_permissions -> p_company_id::text, '[]'::jsonb)
              ?| ARRAY['view_all', 'manage']
            OR (
              COALESCE(employee.invoice_company_permissions -> p_company_id::text, '[]'::jsonb)
                ?| ARRAY['view', 'view_own', 'issue']
              AND p_created_by = employee.id
            )
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_invoice(p_invoice_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.invoices invoice
    WHERE invoice.id = p_invoice_id
      AND public.can_view_invoice_row(invoice.my_company_id, invoice.created_by)
  );
$$;

REVOKE ALL ON FUNCTION public.current_invoice_employee_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_invoices() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_invoices() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_invoice_company(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_invoice(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_invoice_company(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_invoice_row(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_invoice(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_invoice_employee_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_invoices() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_invoices() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_invoice_company(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_invoice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_invoice_company(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_invoice_row(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_invoice(uuid) TO authenticated, service_role;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read invoices for finances_manage" ON public.invoices;
DROP POLICY IF EXISTS "Allow insert invoices for finances_manage" ON public.invoices;
DROP POLICY IF EXISTS "Allow update invoices for finances_manage" ON public.invoices;
DROP POLICY IF EXISTS "Allow delete invoices for finances_manage" ON public.invoices;
DROP POLICY IF EXISTS "Allow read invoices for authorized users" ON public.invoices;
DROP POLICY IF EXISTS "Allow insert invoices for authorized users" ON public.invoices;
DROP POLICY IF EXISTS "Allow update invoices for authorized users" ON public.invoices;
DROP POLICY IF EXISTS "Allow delete invoices for authorized users" ON public.invoices;
DROP POLICY IF EXISTS invoice_rows_read_canonical ON public.invoices;
DROP POLICY IF EXISTS invoice_rows_insert_canonical ON public.invoices;
DROP POLICY IF EXISTS invoice_rows_update_canonical ON public.invoices;
DROP POLICY IF EXISTS invoice_rows_delete_canonical ON public.invoices;

CREATE POLICY invoice_rows_read_canonical
  ON public.invoices FOR SELECT TO authenticated
  USING (public.can_view_invoice_row(my_company_id, created_by));

CREATE POLICY invoice_rows_insert_canonical
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_invoice_company(my_company_id)
    AND (created_by IS NULL OR created_by = public.current_invoice_employee_id())
  );

CREATE POLICY invoice_rows_update_canonical
  ON public.invoices FOR UPDATE TO authenticated
  USING (public.can_manage_invoice_company(my_company_id))
  WITH CHECK (public.can_manage_invoice_company(my_company_id));

CREATE POLICY invoice_rows_delete_canonical
  ON public.invoices FOR DELETE TO authenticated
  USING (public.can_manage_invoice_company(my_company_id));

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all invoice_items for finances_manage" ON public.invoice_items;
DROP POLICY IF EXISTS "Allow all invoice_items for authorized users" ON public.invoice_items;
DROP POLICY IF EXISTS invoice_items_read_canonical ON public.invoice_items;
DROP POLICY IF EXISTS invoice_items_manage_canonical ON public.invoice_items;

CREATE POLICY invoice_items_read_canonical
  ON public.invoice_items FOR SELECT TO authenticated
  USING (public.can_view_invoice(invoice_id));

CREATE POLICY invoice_items_manage_canonical
  ON public.invoice_items FOR ALL TO authenticated
  USING (public.can_manage_invoice(invoice_id))
  WITH CHECK (public.can_manage_invoice(invoice_id));

ALTER TABLE public.invoice_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read invoice_history for finances_manage" ON public.invoice_history;
DROP POLICY IF EXISTS "Allow insert invoice_history for finances_manage" ON public.invoice_history;
DROP POLICY IF EXISTS "Allow read invoice_history for authorized users" ON public.invoice_history;
DROP POLICY IF EXISTS "Allow insert invoice_history for authorized users" ON public.invoice_history;
DROP POLICY IF EXISTS invoice_history_read_canonical ON public.invoice_history;
DROP POLICY IF EXISTS invoice_history_insert_canonical ON public.invoice_history;

CREATE POLICY invoice_history_read_canonical
  ON public.invoice_history FOR SELECT TO authenticated
  USING (public.can_view_invoice(invoice_id));

CREATE POLICY invoice_history_insert_canonical
  ON public.invoice_history FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_invoice(invoice_id));

DROP POLICY IF EXISTS "View invoice order items" ON public.invoice_order_items;
CREATE POLICY "View invoice order items"
  ON public.invoice_order_items FOR SELECT TO authenticated
  USING (public.can_view_invoice(invoice_id));

DROP POLICY IF EXISTS "View invoice settlements" ON public.invoice_settlements;
CREATE POLICY "View invoice settlements"
  ON public.invoice_settlements FOR SELECT TO authenticated
  USING (
    public.can_view_invoice(final_invoice_id)
    AND public.can_view_invoice(advance_invoice_id)
  );

DROP POLICY IF EXISTS "View invoice source links" ON public.invoice_source_links;
CREATE POLICY "View invoice source links"
  ON public.invoice_source_links FOR SELECT TO authenticated
  USING (
    public.can_view_invoice(source_invoice_id)
    AND public.can_view_invoice(target_invoice_id)
  );

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.can_view_invoice_row(uuid, uuid) IS
  'Canonical invoice visibility with auth-user mapping and per-company own/all scopes.';
