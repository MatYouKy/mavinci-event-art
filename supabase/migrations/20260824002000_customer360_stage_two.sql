/*
  # Klient 360° — etap 2

  - opiekun i cykl życia kontaktu/organizacji,
  - audyt ręcznych powiązań aktywności,
  - bezpieczne tworzenie kontaktu z jednoznacznego zapytania,
  - transakcyjny podgląd i scalanie duplikatów tylko przez administratora,
  - kategoryzacja powodów utraty sprzedaży.
*/

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS auto_created_from_inquiry_id uuid;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'lead';

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS lost_reason_category text;

UPDATE public.tasks
SET lost_reason_category = 'other'
WHERE inquiry_stage = 'lost' AND lost_reason_category IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_lifecycle_status_check'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_lifecycle_status_check
      CHECK (lifecycle_status IN ('lead', 'prospect', 'customer', 'inactive', 'lost'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_lifecycle_status_check'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_lifecycle_status_check
      CHECK (lifecycle_status IN ('lead', 'prospect', 'customer', 'inactive', 'lost'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_lost_reason_category_check'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_lost_reason_category_check
      CHECK (
        lost_reason_category IS NULL OR lost_reason_category IN (
          'price', 'availability', 'competitor', 'no_response', 'scope',
          'timing', 'market_research', 'duplicate', 'other'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_lost_reason_category_required_check'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_lost_reason_category_required_check
      CHECK (inquiry_stage <> 'lost' OR lost_reason_category IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_owner_lifecycle
  ON public.contacts(owner_id, lifecycle_status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_organizations_owner_lifecycle
  ON public.organizations(owner_id, lifecycle_status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_tasks_lost_reason_category
  ON public.tasks(lost_reason_category) WHERE inquiry_stage = 'lost';

CREATE OR REPLACE FUNCTION public.can_manage_customer360()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE employee.id = auth.uid()
      AND employee.is_active = true
      AND (
        employee.role = 'admin'
        OR employee.access_level = 'admin'
        OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_customer360_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE employee.id = auth.uid()
      AND employee.is_active = true
      AND (employee.role = 'admin' OR employee.access_level = 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.protect_customer360_responsibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
  ) AND pg_trigger_depth() <= 1 AND NOT public.can_manage_customer360() THEN
    RAISE EXCEPTION 'Brak uprawnień do zmiany opiekuna lub etapu relacji';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_protect_customer360_responsibility ON public.contacts;
CREATE TRIGGER contacts_protect_customer360_responsibility
  BEFORE UPDATE OF owner_id, lifecycle_status ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.protect_customer360_responsibility();

DROP TRIGGER IF EXISTS organizations_protect_customer360_responsibility ON public.organizations;
CREATE TRIGGER organizations_protect_customer360_responsibility
  BEFORE UPDATE OF owner_id, lifecycle_status ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.protect_customer360_responsibility();

CREATE TABLE IF NOT EXISTS public.customer360_activity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type text NOT NULL CHECK (activity_type IN (
    'inquiry', 'call', 'offer', 'event', 'email_conversation', 'received_email', 'sent_email'
  )),
  activity_id uuid NOT NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  linked_by uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  link_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer360_link_has_customer CHECK (contact_id IS NOT NULL OR organization_id IS NOT NULL),
  UNIQUE(activity_type, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_customer360_links_contact
  ON public.customer360_activity_links(contact_id, created_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer360_links_organization
  ON public.customer360_activity_links(organization_id, created_at DESC) WHERE organization_id IS NOT NULL;

ALTER TABLE public.customer360_activity_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer360_activity_links_select ON public.customer360_activity_links;
CREATE POLICY customer360_activity_links_select
  ON public.customer360_activity_links FOR SELECT TO authenticated
  USING (public.can_manage_customer360());

DROP POLICY IF EXISTS customer360_activity_links_manage ON public.customer360_activity_links;
CREATE POLICY customer360_activity_links_manage
  ON public.customer360_activity_links FOR ALL TO authenticated
  USING (public.can_manage_customer360())
  WITH CHECK (public.can_manage_customer360() AND linked_by = auth.uid());

CREATE OR REPLACE FUNCTION public.link_customer360_activity(
  p_activity_type text,
  p_activity_id uuid,
  p_contact_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS public.customer360_activity_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.customer360_activity_links%ROWTYPE;
BEGIN
  IF NOT public.can_manage_customer360() THEN
    RAISE EXCEPTION 'Brak uprawnień do zarządzania powiązaniami klienta';
  END IF;
  IF p_contact_id IS NULL AND p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Wybierz kontakt lub organizację';
  END IF;
  IF p_activity_type NOT IN (
    'inquiry', 'call', 'offer', 'event', 'email_conversation', 'received_email', 'sent_email'
  ) THEN
    RAISE EXCEPTION 'Nieobsługiwany typ aktywności';
  END IF;

  INSERT INTO public.customer360_activity_links(
    activity_type, activity_id, contact_id, organization_id, linked_by, link_reason
  ) VALUES (
    p_activity_type, p_activity_id, p_contact_id, p_organization_id, auth.uid(), NULLIF(btrim(p_reason), '')
  )
  ON CONFLICT (activity_type, activity_id) DO UPDATE SET
    contact_id = EXCLUDED.contact_id,
    organization_id = EXCLUDED.organization_id,
    linked_by = auth.uid(),
    link_reason = EXCLUDED.link_reason,
    updated_at = now()
  RETURNING * INTO result;

  IF p_activity_type = 'inquiry' THEN
    UPDATE public.tasks SET contact_id = p_contact_id, organization_id = p_organization_id
    WHERE id = p_activity_id AND is_inquiry = true;
  ELSIF p_activity_type = 'call' THEN
    UPDATE public.crm_call_activities SET contact_id = p_contact_id, organization_id = p_organization_id
    WHERE id = p_activity_id;
  ELSIF p_activity_type = 'offer' THEN
    IF p_contact_id IS NOT NULL AND p_organization_id IS NOT NULL THEN
      RAISE EXCEPTION 'Oferta może należeć do kontaktu albo organizacji, nie do obu jednocześnie';
    END IF;
    UPDATE public.offers SET
      contact_id = p_contact_id,
      organization_id = p_organization_id,
      client_type = CASE
        WHEN p_contact_id IS NOT NULL THEN 'individual'::client_type_enum
        WHEN p_organization_id IS NOT NULL THEN 'business'::client_type_enum
        ELSE NULL
      END
    WHERE id = p_activity_id;
  ELSIF p_activity_type = 'event' THEN
    UPDATE public.events SET contact_person_id = p_contact_id, organization_id = p_organization_id
    WHERE id = p_activity_id;
  ELSIF p_activity_type = 'email_conversation' THEN
    UPDATE public.email_sales_conversations
    SET contact_id = p_contact_id, organization_id = p_organization_id
    WHERE id = p_activity_id;
  END IF;

  RETURN result;
END;
$$;

CREATE TABLE IF NOT EXISTS public.customer360_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_contact_id uuid NOT NULL,
  source_contact_id uuid NOT NULL,
  source_snapshot jsonb NOT NULL,
  merged_by uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  merged_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer360_merge_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer360_merge_log_admin ON public.customer360_merge_log;
CREATE POLICY customer360_merge_log_admin
  ON public.customer360_merge_log FOR SELECT TO authenticated
  USING (public.is_customer360_admin());

CREATE OR REPLACE FUNCTION public.preview_customer360_contact_merge(
  p_target_contact_id uuid,
  p_source_contact_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.can_manage_customer360() THEN
    RAISE EXCEPTION 'Brak uprawnień';
  END IF;
  IF p_target_contact_id = p_source_contact_id THEN
    RAISE EXCEPTION 'Wybierz dwa różne kontakty';
  END IF;

  SELECT jsonb_build_object(
    'target', to_jsonb(target),
    'source', to_jsonb(source),
    'relations', jsonb_build_object(
      'inquiries', (SELECT count(*) FROM public.tasks WHERE contact_id = source.id),
      'calls', (SELECT count(*) FROM public.crm_call_activities WHERE contact_id = source.id),
      'offers', (SELECT count(*) FROM public.offers WHERE contact_id = source.id),
      'events', (SELECT count(*) FROM public.events WHERE contact_person_id = source.id),
      'meetings', (SELECT count(*) FROM public.meeting_participants WHERE contact_id = source.id),
      'organizations', (SELECT count(*) FROM public.contact_organizations WHERE contact_id = source.id),
      'contracts', (SELECT count(*) FROM public.contracts WHERE client_id = source.id),
      'invoices', (SELECT count(*) FROM public.invoices WHERE contact_person_id = source.id)
    )
  ) INTO result
  FROM public.contacts target
  CROSS JOIN public.contacts source
  WHERE target.id = p_target_contact_id AND source.id = p_source_contact_id;

  IF result IS NULL THEN RAISE EXCEPTION 'Nie znaleziono kontaktu'; END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_customer360_contacts(
  p_target_contact_id uuid,
  p_source_contact_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target public.contacts%ROWTYPE;
  source public.contacts%ROWTYPE;
BEGIN
  IF NOT public.is_customer360_admin() THEN
    RAISE EXCEPTION 'Tylko administrator może scalać kontakty';
  END IF;
  IF p_target_contact_id = p_source_contact_id THEN
    RAISE EXCEPTION 'Wybierz dwa różne kontakty';
  END IF;

  SELECT * INTO target FROM public.contacts WHERE id = p_target_contact_id FOR UPDATE;
  SELECT * INTO source FROM public.contacts WHERE id = p_source_contact_id FOR UPDATE;
  IF target.id IS NULL OR source.id IS NULL THEN RAISE EXCEPTION 'Nie znaleziono kontaktu'; END IF;

  INSERT INTO public.customer360_merge_log(
    target_contact_id, source_contact_id, source_snapshot, merged_by
  ) VALUES (target.id, source.id, to_jsonb(source), auth.uid());

  UPDATE public.contacts SET
    email = COALESCE(NULLIF(email, ''), source.email),
    phone = COALESCE(NULLIF(phone, ''), source.phone),
    mobile = COALESCE(NULLIF(mobile, ''), source.mobile),
    address = COALESCE(NULLIF(address, ''), source.address),
    city = COALESCE(NULLIF(city, ''), source.city),
    postal_code = COALESCE(NULLIF(postal_code, ''), source.postal_code),
    avatar_url = COALESCE(NULLIF(avatar_url, ''), source.avatar_url),
    owner_id = COALESCE(owner_id, source.owner_id),
    tags = ARRAY(SELECT DISTINCT unnest(COALESCE(tags, '{}'::text[]) || COALESCE(source.tags, '{}'::text[]))),
    notes = concat_ws(E'\n\n', NULLIF(notes, ''), NULLIF(source.notes, '')),
    updated_at = now()
  WHERE id = target.id;

  UPDATE public.tasks SET contact_id = target.id WHERE contact_id = source.id;
  UPDATE public.crm_call_activities SET contact_id = target.id WHERE contact_id = source.id;
  UPDATE public.offers SET contact_id = target.id WHERE contact_id = source.id;
  UPDATE public.events SET contact_person_id = target.id WHERE contact_person_id = source.id;
  UPDATE public.invoices SET contact_person_id = target.id WHERE contact_person_id = source.id;
  UPDATE public.contracts SET client_id = target.id WHERE client_id = source.id;
  UPDATE public.email_sales_conversations SET contact_id = target.id WHERE contact_id = source.id;
  UPDATE public.organizations SET primary_contact_id = target.id WHERE primary_contact_id = source.id;
  UPDATE public.organizations SET legal_representative_id = target.id WHERE legal_representative_id = source.id;
  UPDATE public.customer360_activity_links SET contact_id = target.id WHERE contact_id = source.id;

  INSERT INTO public.contact_organizations(
    contact_id, organization_id, position, department, started_at, ended_at,
    is_current, is_primary, is_decision_maker, notes
  )
  SELECT target.id, organization_id, position, department, started_at, ended_at,
    is_current, is_primary, is_decision_maker, notes
  FROM public.contact_organizations WHERE contact_id = source.id
  ON CONFLICT (contact_id, organization_id) DO UPDATE SET
    is_current = EXCLUDED.is_current OR public.contact_organizations.is_current,
    is_primary = EXCLUDED.is_primary OR public.contact_organizations.is_primary,
    is_decision_maker = EXCLUDED.is_decision_maker OR public.contact_organizations.is_decision_maker,
    notes = concat_ws(E'\n', public.contact_organizations.notes, EXCLUDED.notes);
  DELETE FROM public.contact_organizations WHERE contact_id = source.id;

  INSERT INTO public.event_contact_persons(contact_id, event_id, is_primary, role, notes)
  SELECT target.id, event_id, is_primary, role, notes
  FROM public.event_contact_persons WHERE contact_id = source.id
  ON CONFLICT (event_id, contact_id) DO UPDATE SET
    is_primary = EXCLUDED.is_primary OR public.event_contact_persons.is_primary,
    role = COALESCE(public.event_contact_persons.role, EXCLUDED.role),
    notes = concat_ws(E'\n', public.event_contact_persons.notes, EXCLUDED.notes);
  DELETE FROM public.event_contact_persons WHERE contact_id = source.id;

  INSERT INTO public.organization_decision_makers(
    organization_id, contact_id, title, can_sign_contracts, notes
  )
  SELECT organization_id, target.id, title, can_sign_contracts, notes
  FROM public.organization_decision_makers WHERE contact_id = source.id
  ON CONFLICT (organization_id, contact_id) DO UPDATE SET
    can_sign_contracts = EXCLUDED.can_sign_contracts OR public.organization_decision_makers.can_sign_contracts,
    title = COALESCE(public.organization_decision_makers.title, EXCLUDED.title),
    notes = concat_ws(E'\n', public.organization_decision_makers.notes, EXCLUDED.notes);
  DELETE FROM public.organization_decision_makers WHERE contact_id = source.id;

  INSERT INTO public.meeting_participants(meeting_id, contact_id)
  SELECT meeting_id, target.id FROM public.meeting_participants source_participant
  WHERE source_participant.contact_id = source.id
    AND NOT EXISTS (
      SELECT 1 FROM public.meeting_participants target_participant
      WHERE target_participant.meeting_id = source_participant.meeting_id
        AND target_participant.contact_id = target.id
    );
  DELETE FROM public.meeting_participants WHERE contact_id = source.id;

  DELETE FROM public.contacts WHERE id = source.id;
  RETURN target.id;
END;
$$;

-- Automatyczne tworzenie kontaktu tylko dla zapytania z poprawnym kanałem kontaktu.
CREATE OR REPLACE FUNCTION public.link_inquiry_to_customer360()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inquiry_email text;
  inquiry_phone text;
  raw_name text;
  first_name_value text;
  last_name_value text;
  matched_contact_id uuid;
  matched_count integer;
  matched_organization_id uuid;
  organization_count integer;
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true OR NEW.contact_id IS NOT NULL THEN RETURN NEW; END IF;

  inquiry_email := lower(btrim(COALESCE(NEW.inquiry_details ->> 'client_email', NEW.inquiry_details ->> 'email', '')));
  inquiry_phone := public.customer360_normalize_phone(COALESCE(NEW.inquiry_details ->> 'client_phone', NEW.inquiry_details ->> 'phone', ''));

  PERFORM pg_advisory_xact_lock(hashtext(inquiry_email || '|' || inquiry_phone));

  WITH candidates AS (
    SELECT contact.id FROM public.contacts contact
    WHERE (inquiry_email <> '' AND lower(btrim(COALESCE(contact.email, ''))) = inquiry_email)
       OR (inquiry_phone <> '' AND inquiry_phone IN (
         public.customer360_normalize_phone(contact.mobile), public.customer360_normalize_phone(contact.phone)
       ))
  )
  SELECT count(*), (array_agg(id ORDER BY id))[1]
  INTO matched_count, matched_contact_id FROM candidates;

  IF matched_count > 1 THEN RETURN NEW; END IF;

  IF matched_count = 0 AND (
    inquiry_email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
    OR length(inquiry_phone) >= 9
  ) THEN
    raw_name := btrim(COALESCE(
      NEW.inquiry_details ->> 'client_text',
      NEW.inquiry_details ->> 'name',
      NEW.inquiry_details ->> 'client_company',
      split_part(inquiry_email, '@', 1),
      'Nowy kontakt'
    ));
    first_name_value := split_part(raw_name, ' ', 1);
    last_name_value := NULLIF(btrim(substring(raw_name FROM length(first_name_value) + 1)), '');

    INSERT INTO public.contacts(
      first_name, last_name, email, mobile, status, lifecycle_status, source,
      owner_id, auto_created_from_inquiry_id, notes
    ) VALUES (
      COALESCE(NULLIF(first_name_value, ''), 'Nowy'), COALESCE(last_name_value, '-'),
      NULLIF(inquiry_email, ''), NULLIF(inquiry_phone, ''), 'active', 'lead',
      COALESCE(NEW.inquiry_details ->> 'source_slug', NEW.inquiry_details ->> 'source_kind', 'inquiry'),
      NEW.inquiry_owner_id, NEW.id, 'Kontakt utworzony automatycznie z zapytania sprzedażowego.'
    ) RETURNING id INTO matched_contact_id;
  END IF;

  IF matched_contact_id IS NULL THEN RETURN NEW; END IF;
  NEW.contact_id := matched_contact_id;

  SELECT count(*), (array_agg(relation.organization_id ORDER BY relation.organization_id))[1]
  INTO organization_count, matched_organization_id
  FROM public.contact_organizations relation
  WHERE relation.contact_id = matched_contact_id AND relation.is_current = true;
  IF organization_count = 1 THEN NEW.organization_id := matched_organization_id; END IF;

  RETURN NEW;
END;
$$;

UPDATE public.tasks
SET inquiry_details = inquiry_details
WHERE is_inquiry = true
  AND contact_id IS NULL
  AND inquiry_details IS NOT NULL;
