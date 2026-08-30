-- Jedno źródło prawdy dla sposobu rozliczenia wydarzenia.
-- Klient wydarzenia pozostaje w events.organization_id, natomiast organizacja
-- wystawiana na fakturze może być hotelem, agencją lub innym pośrednikiem.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS billing_arrangement text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS billing_organization_id uuid
    REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_billing_arrangement_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_billing_arrangement_check
  CHECK (billing_arrangement IN ('direct', 'hotel', 'agency', 'other'));

CREATE INDEX IF NOT EXISTS idx_events_billing_organization
  ON public.events(billing_organization_id)
  WHERE billing_organization_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.event_billing_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  UNIQUE(event_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_event_billing_contacts_event
  ON public.event_billing_contacts(event_id);

CREATE INDEX IF NOT EXISTS idx_event_billing_contacts_organization
  ON public.event_billing_contacts(organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_billing_contacts_primary
  ON public.event_billing_contacts(event_id)
  WHERE is_primary;

ALTER TABLE public.event_billing_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event billing contacts follow commercial access"
  ON public.event_billing_contacts;
CREATE POLICY "event billing contacts follow commercial access"
  ON public.event_billing_contacts
  FOR SELECT TO authenticated
  USING (public.can_view_event_commercials(event_id, false));

DROP POLICY IF EXISTS "event billing contacts are managed with commercials"
  ON public.event_billing_contacts;
CREATE POLICY "event billing contacts are managed with commercials"
  ON public.event_billing_contacts
  FOR ALL TO authenticated
  USING (public.can_view_event_commercials(event_id, true))
  WITH CHECK (public.can_view_event_commercials(event_id, true));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_billing_contacts TO authenticated;

COMMENT ON COLUMN public.events.billing_arrangement IS
  'Sposób rozliczenia wydarzenia: direct, hotel, agency lub other.';
COMMENT ON COLUMN public.events.billing_organization_id IS
  'Organizacja będąca nabywcą i płatnikiem faktur za wydarzenie, gdy rozliczenie nie jest bezpośrednie.';
COMMENT ON TABLE public.event_billing_contacts IS
  'Osoby po stronie organizacji płatnika odpowiedzialne za rozliczenie wydarzenia.';

NOTIFY pgrst, 'reload schema';
