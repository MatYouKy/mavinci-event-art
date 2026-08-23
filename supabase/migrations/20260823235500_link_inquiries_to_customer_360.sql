/*
  # Trwałe powiązanie zapytań z Kartą Klienta 360°

  Formularze i webhooki nadal zapisują oryginalne dane w inquiry_details, ale
  przy jednoznacznym dopasowaniu e-maila lub telefonu otrzymują również FK do
  kontaktu. Dopasowanie nie wybiera arbitralnie rekordu, gdy istnieje duplikat.
*/

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_contact_activity
  ON public.tasks (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_organization_activity
  ON public.tasks (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.customer360_normalize_phone(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN regexp_replace(COALESCE(value, ''), '\D', '', 'g') ~ '^48[0-9]{9}$'
      THEN substring(regexp_replace(COALESCE(value, ''), '\D', '', 'g') FROM 3)
    ELSE regexp_replace(COALESCE(value, ''), '\D', '', 'g')
  END;
$$;

CREATE OR REPLACE FUNCTION public.link_inquiry_to_customer360()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inquiry_email text;
  inquiry_phone text;
  matched_contact_id uuid;
  matched_count integer;
  matched_organization_id uuid;
  organization_count integer;
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true OR NEW.contact_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  inquiry_email := lower(btrim(COALESCE(
    NEW.inquiry_details ->> 'client_email',
    NEW.inquiry_details ->> 'email',
    ''
  )));
  inquiry_phone := public.customer360_normalize_phone(COALESCE(
    NEW.inquiry_details ->> 'client_phone',
    NEW.inquiry_details ->> 'phone',
    ''
  ));

  WITH candidates AS (
    SELECT contact.id
    FROM public.contacts contact
    WHERE
      (inquiry_email <> '' AND lower(btrim(COALESCE(contact.email, ''))) = inquiry_email)
      OR (
        inquiry_phone <> ''
        AND inquiry_phone IN (
          public.customer360_normalize_phone(contact.mobile),
          public.customer360_normalize_phone(contact.phone)
        )
      )
  )
  SELECT count(*), (array_agg(id ORDER BY id))[1]
  INTO matched_count, matched_contact_id
  FROM candidates;

  -- Przy wielu pasujących rekordach UI pokaże ostrzeżenie o duplikacie.
  IF matched_count <> 1 THEN
    RETURN NEW;
  END IF;

  NEW.contact_id := matched_contact_id;

  IF NEW.organization_id IS NULL THEN
    SELECT count(*), (array_agg(relation.organization_id ORDER BY relation.organization_id))[1]
    INTO organization_count, matched_organization_id
    FROM public.contact_organizations relation
    WHERE relation.contact_id = matched_contact_id
      AND relation.is_current = true;

    IF organization_count = 1 THEN
      NEW.organization_id := matched_organization_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_link_inquiry_to_customer360 ON public.tasks;
CREATE TRIGGER tasks_link_inquiry_to_customer360
  BEFORE INSERT OR UPDATE OF inquiry_details, is_inquiry, contact_id
  ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.link_inquiry_to_customer360();

-- Uruchamia bezpieczne dopasowanie również dla dotychczasowych zapytań.
UPDATE public.tasks
SET inquiry_details = inquiry_details
WHERE is_inquiry = true
  AND contact_id IS NULL
  AND inquiry_details IS NOT NULL;

COMMENT ON COLUMN public.tasks.contact_id IS
  'Jednoznacznie powiązany kontakt Klienta 360; NULL przy braku lub konflikcie dopasowania.';
