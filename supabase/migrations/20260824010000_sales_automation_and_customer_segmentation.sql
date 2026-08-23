/*
  # Automatyzacja sprzedaży i bezpieczna segmentacja klientów

  Segmentacja opisuje zainteresowania. Uprawnienie do mailingu jest osobnym,
  audytowanym stanem i nigdy nie jest nadawane automatycznie z zapytania.
*/

ALTER TABLE public.inquiry_sla_settings
  ADD COLUMN IF NOT EXISTS assignment_mode text NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS require_next_action_after_contact boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_next_action_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS auto_promote_customer_lifecycle boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inquiry_sla_assignment_mode_check'
      AND conrelid = 'public.inquiry_sla_settings'::regclass
  ) THEN
    ALTER TABLE public.inquiry_sla_settings
      ADD CONSTRAINT inquiry_sla_assignment_mode_check
      CHECK (assignment_mode IN ('current', 'round_robin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inquiry_sla_default_next_action_hours_check'
      AND conrelid = 'public.inquiry_sla_settings'::regclass
  ) THEN
    ALTER TABLE public.inquiry_sla_settings
      ADD CONSTRAINT inquiry_sla_default_next_action_hours_check
      CHECK (default_next_action_hours BETWEEN 1 AND 720);
  END IF;
END $$;

-- Automatyczna synchronizacja lifecycle działa w zagnieżdżonym triggerze.
-- Bezpośrednia zmiana z klienta nadal wymaga uprawnienia contacts_manage.
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

CREATE OR REPLACE FUNCTION public.prepare_inquiry_sales_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings public.inquiry_sla_settings%ROWTYPE;
  selected_owner uuid;
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true THEN RETURN NEW; END IF;
  SELECT * INTO settings FROM public.inquiry_sla_settings WHERE id = 1;

  IF TG_OP = 'INSERT'
     AND NEW.inquiry_owner_id IS NULL
     AND settings.assignment_mode = 'round_robin'
  THEN
    SELECT employee.id INTO selected_owner
    FROM public.employees employee
    WHERE employee.is_active = true
      AND (
        employee.role = 'admin'
        OR employee.access_level = 'admin'
        OR 'inquiries_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'inquiries_manage_own' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
    ORDER BY (
      SELECT count(*)
      FROM public.tasks owned
      WHERE owned.is_inquiry = true
        AND owned.inquiry_owner_id = employee.id
        AND owned.inquiry_stage NOT IN ('won', 'lost')
    ), employee.id
    LIMIT 1;
    NEW.inquiry_owner_id := selected_owner;
  END IF;

  IF settings.require_next_action_after_contact = true
     AND NEW.first_contact_at IS NOT NULL
     AND COALESCE(NEW.inquiry_stage, 'new') NOT IN ('won', 'lost')
     AND NEW.next_action_at IS NULL
  THEN
    NEW.next_action_at := now() + make_interval(hours => settings.default_next_action_hours);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_prepare_inquiry_sales_automation ON public.tasks;
CREATE TRIGGER a_prepare_inquiry_sales_automation
  BEFORE INSERT OR UPDATE OF is_inquiry, inquiry_owner_id, first_contact_at, next_action_at, inquiry_stage
  ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.prepare_inquiry_sales_automation();

CREATE OR REPLACE FUNCTION public.sync_customer_lifecycle_from_inquiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings public.inquiry_sla_settings%ROWTYPE;
  target_lifecycle text;
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true THEN RETURN NEW; END IF;
  SELECT * INTO settings FROM public.inquiry_sla_settings WHERE id = 1;
  IF settings.auto_promote_customer_lifecycle IS DISTINCT FROM true THEN RETURN NEW; END IF;

  target_lifecycle := CASE
    WHEN NEW.inquiry_stage = 'won' THEN 'customer'
    WHEN NEW.inquiry_stage = 'lost' THEN 'lost'
    WHEN NEW.inquiry_stage IN ('qualified', 'proposal', 'negotiation') THEN 'prospect'
    ELSE 'lead'
  END;

  IF NEW.inquiry_stage = 'lost' AND EXISTS (
    SELECT 1 FROM public.tasks other
    WHERE other.is_inquiry = true
      AND other.id <> NEW.id
      AND other.inquiry_stage NOT IN ('won', 'lost')
      AND (
        (NEW.contact_id IS NOT NULL AND other.contact_id = NEW.contact_id)
        OR (NEW.organization_id IS NOT NULL AND other.organization_id = NEW.organization_id)
      )
  ) THEN
    target_lifecycle := 'prospect';
  END IF;

  IF NEW.contact_id IS NOT NULL THEN
    UPDATE public.contacts
    SET lifecycle_status = target_lifecycle, updated_at = now()
    WHERE id = NEW.contact_id
      AND (lifecycle_status <> 'customer' OR target_lifecycle = 'customer');
  END IF;
  IF NEW.organization_id IS NOT NULL THEN
    UPDATE public.organizations
    SET lifecycle_status = target_lifecycle, updated_at = now()
    WHERE id = NEW.organization_id
      AND (lifecycle_status <> 'customer' OR target_lifecycle = 'customer');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_customer_lifecycle_from_inquiry_after_write ON public.tasks;
CREATE TRIGGER sync_customer_lifecycle_from_inquiry_after_write
  AFTER INSERT OR UPDATE OF inquiry_stage, contact_id, organization_id
  ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_customer_lifecycle_from_inquiry();

CREATE OR REPLACE FUNCTION public.can_view_customer_segmentation()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE employee.id = auth.uid() AND employee.is_active = true
      AND (
        employee.role = 'admin' OR employee.access_level = 'admin'
        OR 'contacts_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'inquiries_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'inquiries_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;

CREATE TABLE IF NOT EXISTS public.marketing_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  color text NOT NULL DEFAULT '#d3bb73',
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_marketing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  marketing_status text NOT NULL DEFAULT 'unknown'
    CHECK (marketing_status IN ('unknown', 'subscribed', 'unsubscribed', 'objected')),
  legal_basis text NOT NULL DEFAULT 'none'
    CHECK (legal_basis IN ('none', 'consent', 'legitimate_interest', 'existing_customer')),
  email_deliverability text NOT NULL DEFAULT 'unknown'
    CHECK (email_deliverability IN ('unknown', 'valid', 'bounced', 'invalid')),
  interests text[] NOT NULL DEFAULT '{}'::text[],
  event_types text[] NOT NULL DEFAULT '{}'::text[],
  regions text[] NOT NULL DEFAULT '{}'::text[],
  budget_min numeric(12,2),
  budget_max numeric(12,2),
  preferred_language text NOT NULL DEFAULT 'pl',
  communication_frequency text NOT NULL DEFAULT 'occasional'
    CHECK (communication_frequency IN ('important_only', 'occasional', 'monthly', 'weekly')),
  consent_source text,
  consent_evidence text,
  consent_granted_at timestamptz,
  consent_withdrawn_at timestamptz,
  last_verified_at timestamptz,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL DEFAULT auth.uid(),
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_marketing_profile_entity_check CHECK (
    (contact_id IS NOT NULL AND organization_id IS NULL)
    OR (contact_id IS NULL AND organization_id IS NOT NULL)
  ),
  CONSTRAINT customer_marketing_profile_basis_check CHECK (
    marketing_status <> 'subscribed' OR legal_basis <> 'none'
  ),
  CONSTRAINT customer_marketing_profile_consent_evidence_check CHECK (
    marketing_status <> 'subscribed' OR legal_basis <> 'consent' OR consent_granted_at IS NOT NULL
  ),
  CONSTRAINT customer_marketing_profile_budget_check CHECK (
    budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_marketing_profile_contact
  ON public.customer_marketing_profiles(contact_id) WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_marketing_profile_organization
  ON public.customer_marketing_profiles(organization_id) WHERE organization_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_marketing_segment_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL REFERENCES public.marketing_segments(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignment_source text NOT NULL DEFAULT 'manual'
    CHECK (assignment_source IN ('manual', 'automatic', 'import')),
  assigned_by uuid REFERENCES public.employees(id) ON DELETE SET NULL DEFAULT auth.uid(),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_segment_member_entity_check CHECK (
    (contact_id IS NOT NULL AND organization_id IS NULL)
    OR (contact_id IS NULL AND organization_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_segment_contact
  ON public.customer_marketing_segment_members(segment_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_segment_organization
  ON public.customer_marketing_segment_members(segment_id, organization_id) WHERE organization_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_marketing_consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.customer_marketing_profiles(id) ON DELETE CASCADE,
  previous_state jsonb,
  new_state jsonb NOT NULL,
  changed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL DEFAULT auth.uid(),
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_marketing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_marketing_segment_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_marketing_consent_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_segments_select ON public.marketing_segments;
CREATE POLICY marketing_segments_select ON public.marketing_segments
  FOR SELECT TO authenticated USING (public.can_view_customer_segmentation());
DROP POLICY IF EXISTS marketing_segments_manage ON public.marketing_segments;
CREATE POLICY marketing_segments_manage ON public.marketing_segments
  FOR ALL TO authenticated USING (public.can_manage_customer360())
  WITH CHECK (public.can_manage_customer360());

DROP POLICY IF EXISTS customer_marketing_profiles_select ON public.customer_marketing_profiles;
CREATE POLICY customer_marketing_profiles_select ON public.customer_marketing_profiles
  FOR SELECT TO authenticated USING (public.can_view_customer_segmentation());
DROP POLICY IF EXISTS customer_marketing_profiles_manage ON public.customer_marketing_profiles;
CREATE POLICY customer_marketing_profiles_manage ON public.customer_marketing_profiles
  FOR ALL TO authenticated USING (public.can_manage_customer360())
  WITH CHECK (public.can_manage_customer360());

DROP POLICY IF EXISTS customer_segment_members_select ON public.customer_marketing_segment_members;
CREATE POLICY customer_segment_members_select ON public.customer_marketing_segment_members
  FOR SELECT TO authenticated USING (public.can_view_customer_segmentation());
DROP POLICY IF EXISTS customer_segment_members_manage ON public.customer_marketing_segment_members;
CREATE POLICY customer_segment_members_manage ON public.customer_marketing_segment_members
  FOR ALL TO authenticated USING (public.can_manage_customer360())
  WITH CHECK (public.can_manage_customer360());

DROP POLICY IF EXISTS customer_consent_log_select ON public.customer_marketing_consent_log;
CREATE POLICY customer_consent_log_select ON public.customer_marketing_consent_log
  FOR SELECT TO authenticated USING (public.can_manage_customer360());

CREATE OR REPLACE FUNCTION public.audit_customer_marketing_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  END IF;
  IF NEW.marketing_status IN ('unsubscribed', 'objected')
     AND (TG_OP = 'INSERT' OR NEW.marketing_status IS DISTINCT FROM OLD.marketing_status)
  THEN
    NEW.consent_withdrawn_at := COALESCE(NEW.consent_withdrawn_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_marketing_profile_prepare_audit ON public.customer_marketing_profiles;
CREATE TRIGGER customer_marketing_profile_prepare_audit
  BEFORE INSERT OR UPDATE ON public.customer_marketing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_customer_marketing_profile();

CREATE OR REPLACE FUNCTION public.log_customer_marketing_consent_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.marketing_status IS DISTINCT FROM OLD.marketing_status
     OR NEW.legal_basis IS DISTINCT FROM OLD.legal_basis
     OR NEW.consent_evidence IS DISTINCT FROM OLD.consent_evidence
  THEN
    INSERT INTO public.customer_marketing_consent_log(profile_id, previous_state, new_state, changed_by)
    VALUES (
      NEW.id,
      CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object(
        'marketing_status', OLD.marketing_status,
        'legal_basis', OLD.legal_basis,
        'consent_source', OLD.consent_source,
        'consent_evidence', OLD.consent_evidence,
        'consent_granted_at', OLD.consent_granted_at,
        'consent_withdrawn_at', OLD.consent_withdrawn_at
      ) ELSE NULL END,
      jsonb_build_object(
        'marketing_status', NEW.marketing_status,
        'legal_basis', NEW.legal_basis,
        'consent_source', NEW.consent_source,
        'consent_evidence', NEW.consent_evidence,
        'consent_granted_at', NEW.consent_granted_at,
        'consent_withdrawn_at', NEW.consent_withdrawn_at
      ),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_marketing_profile_log_consent ON public.customer_marketing_profiles;
CREATE TRIGGER customer_marketing_profile_log_consent
  AFTER INSERT OR UPDATE ON public.customer_marketing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_customer_marketing_consent_change();

INSERT INTO public.marketing_segments(name, slug, description, color, is_system)
VALUES
  ('Wesela', 'wesela', 'Klienci zainteresowani obsługą wesel', '#d3bb73', true),
  ('Eventy firmowe', 'eventy-firmowe', 'Firmy zainteresowane eventami i integracjami', '#60a5fa', true),
  ('Studniówki i bale', 'studniowki-i-bale', 'Szkoły i komitety organizujące bale', '#a78bfa', true),
  ('Imprezy prywatne', 'imprezy-prywatne', 'Urodziny, jubileusze i uroczystości rodzinne', '#f472b6', true),
  ('Klienci Event Rulers', 'event-rulers', 'Zapytania pozyskane przez Event Rulers', '#f59e0b', true),
  ('Klienci Mavinci', 'mavinci', 'Zapytania pozyskane przez Mavinci', '#34d399', true)
ON CONFLICT (slug) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_inquiry_customer_segmentation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_id_value uuid;
  event_type_value text;
  source_value text;
  segment_slugs text[] := '{}'::text[];
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true
     OR (NEW.contact_id IS NULL AND NEW.organization_id IS NULL)
  THEN RETURN NEW; END IF;

  event_type_value := lower(btrim(COALESCE(NEW.inquiry_details ->> 'event_type', '')));
  source_value := lower(btrim(COALESCE(
    NEW.inquiry_details ->> 'source_slug', NEW.inquiry_details ->> 'source_name', ''
  )));

  IF NEW.contact_id IS NOT NULL THEN
    INSERT INTO public.customer_marketing_profiles(contact_id, event_types)
    VALUES (NEW.contact_id, CASE WHEN event_type_value = '' THEN '{}'::text[] ELSE ARRAY[event_type_value] END)
    ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL DO UPDATE SET
      event_types = ARRAY(
        SELECT DISTINCT value FROM unnest(
          COALESCE(public.customer_marketing_profiles.event_types, '{}'::text[])
          || EXCLUDED.event_types
        ) value WHERE value <> ''
      ),
      updated_at = now()
    RETURNING id INTO profile_id_value;
  ELSE
    INSERT INTO public.customer_marketing_profiles(organization_id, event_types)
    VALUES (NEW.organization_id, CASE WHEN event_type_value = '' THEN '{}'::text[] ELSE ARRAY[event_type_value] END)
    ON CONFLICT (organization_id) WHERE organization_id IS NOT NULL DO UPDATE SET
      event_types = ARRAY(
        SELECT DISTINCT value FROM unnest(
          COALESCE(public.customer_marketing_profiles.event_types, '{}'::text[])
          || EXCLUDED.event_types
        ) value WHERE value <> ''
      ),
      updated_at = now()
    RETURNING id INTO profile_id_value;
  END IF;

  IF event_type_value ~ '(wesele|wedding)' THEN segment_slugs := array_append(segment_slugs, 'wesela'); END IF;
  IF event_type_value ~ '(firm|corporate|konferenc|integrac)' THEN segment_slugs := array_append(segment_slugs, 'eventy-firmowe'); END IF;
  IF event_type_value ~ '(studni|bal|szko)' THEN segment_slugs := array_append(segment_slugs, 'studniowki-i-bale'); END IF;
  IF event_type_value ~ '(urodzin|jubile|prywat)' THEN segment_slugs := array_append(segment_slugs, 'imprezy-prywatne'); END IF;
  IF source_value ~ 'event.?rulers' THEN segment_slugs := array_append(segment_slugs, 'event-rulers'); END IF;
  IF source_value ~ 'mavinci' THEN segment_slugs := array_append(segment_slugs, 'mavinci'); END IF;

  INSERT INTO public.customer_marketing_segment_members(
    segment_id, contact_id, organization_id, assignment_source
  )
  SELECT segment.id, NEW.contact_id, NEW.organization_id, 'automatic'
  FROM public.marketing_segments segment
  WHERE segment.slug = ANY(segment_slugs)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_inquiry_customer_segmentation_after_write ON public.tasks;
CREATE TRIGGER sync_inquiry_customer_segmentation_after_write
  AFTER INSERT OR UPDATE OF contact_id, organization_id, inquiry_details
  ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_inquiry_customer_segmentation();

CREATE OR REPLACE FUNCTION public.get_marketing_eligible_recipients(
  p_segment_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  entity_type text,
  entity_id uuid,
  display_name text,
  email text,
  profile_id uuid,
  legal_basis text,
  segment_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_customer360() THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
  RETURN QUERY
  SELECT
    CASE WHEN profile.contact_id IS NOT NULL THEN 'contact' ELSE 'organization' END,
    COALESCE(profile.contact_id, profile.organization_id),
    COALESCE(contact.full_name, organization.name),
    lower(btrim(COALESCE(contact.email, organization.email))),
    profile.id,
    profile.legal_basis,
    COALESCE(array_agg(member.segment_id) FILTER (WHERE member.segment_id IS NOT NULL), '{}'::uuid[])
  FROM public.customer_marketing_profiles profile
  LEFT JOIN public.contacts contact ON contact.id = profile.contact_id
  LEFT JOIN public.organizations organization ON organization.id = profile.organization_id
  LEFT JOIN public.customer_marketing_segment_members member
    ON member.contact_id = profile.contact_id OR member.organization_id = profile.organization_id
  WHERE profile.marketing_status = 'subscribed'
    AND profile.legal_basis <> 'none'
    AND profile.email_deliverability NOT IN ('bounced', 'invalid')
    AND NULLIF(btrim(COALESCE(contact.email, organization.email)), '') IS NOT NULL
    AND COALESCE(contact.status::text, organization.status::text) = 'active'
    AND (
      p_segment_ids IS NULL OR cardinality(p_segment_ids) = 0
      OR EXISTS (
        SELECT 1 FROM public.customer_marketing_segment_members selected
        WHERE (selected.contact_id = profile.contact_id OR selected.organization_id = profile.organization_id)
          AND selected.segment_id = ANY(p_segment_ids)
      )
    )
  GROUP BY profile.id, profile.contact_id, profile.organization_id,
    contact.full_name, contact.email, organization.name, organization.email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_marketing_eligible_recipients(uuid[]) TO authenticated;

-- Zasilenie profili i segmentów historycznymi zapytaniami bez nadawania zgód.
UPDATE public.tasks
SET inquiry_details = inquiry_details
WHERE is_inquiry = true
  AND (contact_id IS NOT NULL OR organization_id IS NOT NULL);

COMMENT ON TABLE public.customer_marketing_profiles IS
  'Profil zainteresowań i podstawy komunikacji. Segmentacja nie oznacza zgody na mailing.';
COMMENT ON FUNCTION public.get_marketing_eligible_recipients(uuid[]) IS
  'Zwraca wyłącznie aktywnych odbiorców z dopuszczoną komunikacją marketingową.';
