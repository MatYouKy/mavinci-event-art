-- Rozdziela prawnego nabywcę faktury od klienta, dla którego realizowany jest event.
-- organization_id nadal oznacza nabywcę/płatnika widocznego na fakturze i w KSeF.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS billing_arrangement text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS service_recipient_organization_id uuid
    REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_recipient_contact_id uuid
    REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_billing_arrangement_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_billing_arrangement_check
  CHECK (billing_arrangement IN ('direct', 'hotel', 'agency', 'other'));

CREATE INDEX IF NOT EXISTS idx_invoices_service_recipient_organization
  ON public.invoices(service_recipient_organization_id)
  WHERE service_recipient_organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_service_recipient_contact
  ON public.invoices(service_recipient_contact_id)
  WHERE service_recipient_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_billing_arrangement
  ON public.invoices(billing_arrangement)
  WHERE billing_arrangement <> 'direct';

-- Zachowaj historyczny kontekst istniejących faktur powiązanych z wydarzeniami.
UPDATE public.invoices AS invoice
SET
  service_recipient_organization_id = COALESCE(
    invoice.service_recipient_organization_id,
    event.organization_id
  ),
  service_recipient_contact_id = COALESCE(
    invoice.service_recipient_contact_id,
    event.contact_person_id
  ),
  billing_arrangement = CASE
    WHEN invoice.billing_arrangement <> 'direct' THEN invoice.billing_arrangement
    WHEN invoice.organization_id IS NOT DISTINCT FROM event.organization_id THEN 'direct'
    ELSE 'other'
  END
FROM public.events AS event
WHERE invoice.event_id = event.id
  AND (
    invoice.service_recipient_organization_id IS NULL
    OR invoice.service_recipient_contact_id IS NULL
  );

-- Historia organizacji uwzględnia zarówno faktury wystawione na nią,
-- jak i faktury za jej wydarzenia opłacone przez hotel lub innego pośrednika.
CREATE OR REPLACE FUNCTION public.get_organization_invoices(p_organization_id uuid)
RETURNS TABLE (
  id uuid,
  invoice_number text,
  invoice_type text,
  status text,
  issue_date date,
  payment_due_date date,
  total_gross numeric,
  paid_date date,
  event_name text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    invoice.id,
    invoice.invoice_number,
    invoice.invoice_type,
    invoice.status,
    invoice.issue_date,
    invoice.payment_due_date,
    invoice.total_gross,
    invoice.paid_date,
    event.name AS event_name
  FROM public.invoices AS invoice
  LEFT JOIN public.events AS event ON invoice.event_id = event.id
  WHERE invoice.organization_id = p_organization_id
     OR invoice.service_recipient_organization_id = p_organization_id
  ORDER BY invoice.issue_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_organization_invoices(uuid) TO authenticated;

COMMENT ON COLUMN public.invoices.billing_arrangement IS
  'Sposób rozliczenia eventu: direct, hotel, agency lub other.';
COMMENT ON COLUMN public.invoices.organization_id IS
  'Prawny nabywca i płatnik faktury; dane tej organizacji trafiają na PDF i do KSeF.';
COMMENT ON COLUMN public.invoices.service_recipient_organization_id IS
  'Organizacja będąca klientem wydarzenia, niezależnie od tego, kto opłaca fakturę.';
COMMENT ON COLUMN public.invoices.service_recipient_contact_id IS
  'Kontakt będący klientem wydarzenia, niezależnie od tego, kto opłaca fakturę.';
