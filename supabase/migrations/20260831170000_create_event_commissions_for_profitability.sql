-- Prowizje i wynagrodzenia partnerskie przypisane do konkretnego wydarzenia.
-- Są oddzielone od zwykłych kosztów, aby raport rentowności znał beneficjenta
-- i sposób wyliczenia, ale nadal traktował je jako koszt wydarzenia.

CREATE TABLE IF NOT EXISTS public.event_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  beneficiary_type text NOT NULL CHECK (
    beneficiary_type IN ('salesperson', 'hotel', 'partner', 'employee', 'other')
  ),
  beneficiary_name text NOT NULL,
  -- Sprzedawca jest pracownikiem CRM. W aktualnym schemacie nie istnieje
  -- osobna tabela salespeople; źródłem prawdy jest public.employees.
  salesperson_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  calculation_type text NOT NULL DEFAULT 'percent' CHECK (
    calculation_type IN ('percent', 'fixed')
  ),
  rate numeric(8,3) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  base_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (base_amount >= 0),
  amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'planned' CHECK (
    status IN ('planned', 'approved', 'paid', 'cancelled')
  ),
  notes text,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_commissions_event
  ON public.event_commissions(event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_commissions_beneficiary
  ON public.event_commissions(beneficiary_type, beneficiary_name);

ALTER TABLE public.event_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_commissions_select" ON public.event_commissions;
CREATE POLICY "event_commissions_select"
  ON public.event_commissions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND (
          employee.role = 'admin'
          OR employee.access_level = 'admin'
          OR 'finances_manage' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
          OR 'finances_view' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
        )
    )
  );

DROP POLICY IF EXISTS "event_commissions_manage" ON public.event_commissions;
CREATE POLICY "event_commissions_manage"
  ON public.event_commissions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND (
          employee.role = 'admin'
          OR employee.access_level = 'admin'
          OR 'finances_manage' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND (
          employee.role = 'admin'
          OR employee.access_level = 'admin'
          OR 'finances_manage' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_commissions TO authenticated;

COMMENT ON TABLE public.event_commissions IS
  'Prowizje sprzedawców, hoteli, sal, partnerów i innych beneficjentów przypisane do wydarzenia.';

-- PostgREST/Supabase powinien od razu zobaczyć nową tabelę po wykonaniu migracji.
NOTIFY pgrst, 'reload schema';
