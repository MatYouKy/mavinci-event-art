BEGIN;

-- The client belongs to the immutable PDF version, not to the shared template.
ALTER TABLE public.sales_brochure_generations
  ADD COLUMN IF NOT EXISTS recipient_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_name text,
  ADD COLUMN IF NOT EXISTS recipient_email text;

CREATE INDEX IF NOT EXISTS brochure_generations_recipient_contact
  ON public.sales_brochure_generations(recipient_contact_id, created_at DESC)
  WHERE recipient_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS brochure_generations_recipient_organization
  ON public.sales_brochure_generations(recipient_organization_id, created_at DESC)
  WHERE recipient_organization_id IS NOT NULL;

-- Preserve explicit historical relations; never identify a client by email.
UPDATE public.sales_brochure_generations g
SET recipient_contact_id = d.contact_id,
    recipient_organization_id = d.organization_id,
    recipient_name = d.recipient_name,
    recipient_email = d.recipient_email
FROM public.sales_brochure_deliveries d
WHERE d.generation_id = g.id
  AND g.recipient_contact_id IS NULL AND g.recipient_organization_id IS NULL;

UPDATE public.sales_brochure_generations
SET recipient_organization_id = generated_for_organization_id,
    recipient_name = COALESCE(recipient_name, snapshot->'organization'->>'name')
WHERE recipient_contact_id IS NULL AND recipient_organization_id IS NULL
  AND generated_for_organization_id IS NOT NULL;

UPDATE public.sales_brochure_generations
SET recipient_email = COALESCE(NULLIF(snapshot->>'recipientEmail', ''),
  NULLIF(snapshot->'demoAttribution'->>'recipientEmail', ''))
WHERE recipient_email IS NULL;

CREATE OR REPLACE FUNCTION public.record_sales_brochure_generation(
  p_brochure_id uuid,
  p_pdf_path text,
  p_file_name text,
  p_file_size bigint,
  p_snapshot jsonb,
  p_created_by uuid DEFAULT NULL
)
RETURNS public.sales_brochure_generations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_brochure public.sales_brochures%ROWTYPE;
  v_generation public.sales_brochure_generations%ROWTYPE;
  v_version integer;
  v_contact uuid := NULLIF(p_snapshot->'recipient'->>'contactId', '')::uuid;
  v_organization uuid := NULLIF(p_snapshot->'recipient'->>'organizationId', '')::uuid;
  v_email text := COALESCE(NULLIF(btrim(p_snapshot->>'recipientEmail'), ''),
    NULLIF(btrim(p_snapshot->'demoAttribution'->>'recipientEmail'), ''));
  v_personal boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Wersje broszur zapisuje wyłącznie generator PDF' USING ERRCODE = '42501';
  END IF;
  IF p_created_by IS NULL THEN
    RAISE EXCEPTION 'Brak autora wersji broszury';
  END IF;

  SELECT * INTO v_brochure FROM public.sales_brochures
  WHERE id = p_brochure_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono broszury'; END IF;

  -- The locked template serializes concurrent generations, even when personal
  -- versions no longer change current_pdf_version on the universal brochure.
  SELECT GREATEST(COALESCE(MAX(version), 0), v_brochure.current_pdf_version) + 1
  INTO v_version FROM public.sales_brochure_generations WHERE brochure_id = p_brochure_id;

  v_personal := v_contact IS NOT NULL OR v_organization IS NOT NULL OR v_email IS NOT NULL
    OR NULLIF(p_snapshot->'demoAttribution'->>'campaignId', '') IS NOT NULL;

  INSERT INTO public.sales_brochure_generations (
    brochure_id, version, pdf_path, file_name, file_size,
    generated_for_organization_id, snapshot, created_by,
    recipient_contact_id, recipient_organization_id, recipient_name, recipient_email
  ) VALUES (
    v_brochure.id, v_version, p_pdf_path, p_file_name, p_file_size,
    v_brochure.organization_id, COALESCE(p_snapshot, '{}'::jsonb), p_created_by,
    v_contact,
    COALESCE(v_organization, CASE WHEN v_contact IS NULL THEN v_brochure.organization_id END),
    COALESCE(NULLIF(p_snapshot->'recipient'->>'name', ''), p_snapshot->'organization'->>'name'),
    v_email
  ) RETURNING * INTO v_generation;

  -- Never replace the universal PDF with a recipient- or campaign-specific PDF.
  IF NOT v_personal THEN
    UPDATE public.sales_brochures
    SET current_pdf_path = p_pdf_path, current_pdf_version = v_version,
        generated_at = now(), modified_after_generation = false,
        status = CASE WHEN status = 'draft' THEN 'ready' ELSE status END,
        updated_at = now(), updated_by = p_created_by
    WHERE id = v_brochure.id;
  END IF;
  RETURN v_generation;
END;
$$;

REVOKE ALL ON FUNCTION public.record_sales_brochure_generation(uuid,text,text,bigint,jsonb,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sales_brochure_generation(uuid,text,text,bigint,jsonb,uuid)
  TO service_role;

-- A linked version is personal even if there is no email or demo link.
CREATE OR REPLACE FUNCTION public.guard_campaign_personal_demo_brochure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NEW.brochure_generation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales_brochure_generations g
    WHERE g.id = NEW.brochure_generation_id AND public.can_view_brochure_employee(g.created_by)
  ) THEN RAISE EXCEPTION 'Brak dostępu do tej wersji broszury' USING ERRCODE = '42501'; END IF;
  IF NEW.brochure_generation_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sales_brochure_generations g WHERE g.id = NEW.brochure_generation_id
      AND (g.recipient_contact_id IS NOT NULL OR g.recipient_organization_id IS NOT NULL
        OR NULLIF(g.recipient_email, '') IS NOT NULL
        OR NULLIF(g.snapshot->>'recipientEmail', '') IS NOT NULL
        OR NULLIF(g.snapshot->'demoAttribution'->>'recipientEmail', '') IS NOT NULL
        OR NULLIF(g.snapshot->'recipient'->>'contactId', '') IS NOT NULL
        OR NULLIF(g.snapshot->'recipient'->>'organizationId', '') IS NOT NULL)
  ) THEN RAISE EXCEPTION 'Ta wersja PDF jest przypisana do klienta. Do kampanii wygeneruj wersję ogólną, bez klienta i e-maila odbiorcy.'; END IF;
  IF NEW.brochure_generation_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sales_brochure_generations g WHERE g.id = NEW.brochure_generation_id
      AND NULLIF(g.snapshot->'demoAttribution'->>'campaignId', '') IS NOT NULL
      AND g.snapshot->'demoAttribution'->>'campaignId' <> NEW.id::text
  ) THEN RAISE EXCEPTION 'PDF jest przypisany do innej kampanii. Najpierw wygeneruj ogólną wersję broszury.'; END IF;
  RETURN NEW;
END;
$$;

-- Existing author-scoped RLS and private Storage policies remain unchanged.
COMMENT ON COLUMN public.sales_brochure_generations.recipient_contact_id IS
  'Kontakt przypisany do konkretnego PDF; nie zmienia klienta ani treści broszury bazowej.';
COMMENT ON COLUMN public.sales_brochure_generations.recipient_organization_id IS
  'Organizacja przypisana do konkretnego PDF; dostęp nadal ograniczony uprawnieniami autora wersji.';

COMMIT;
