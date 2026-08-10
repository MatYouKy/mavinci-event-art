/*
  # Employee notification subscriptions

  Access to CRM data and delivery of notifications are deliberately separate:
  - permissions/RLS decide what an employee may open,
  - these settings decide which notifications are delivered.

  Administrators retain access to all data. They receive notifications by default,
  but can opt out globally or for an individual webhook source.
  Non-admin employees require both data access and an explicit opt-in.
*/

CREATE TABLE IF NOT EXISTS public.employee_notification_settings (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  contact_form_enabled boolean NOT NULL DEFAULT false,
  webhook_notifications_enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_webhook_notification_settings (
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.webhook_sources(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_webhook_notification_settings_source
  ON public.employee_webhook_notification_settings(source_id, is_enabled);

CREATE OR REPLACE FUNCTION public.can_manage_employee_notification_settings()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = auth.uid()
      AND e.is_active = true
      AND (
        e.role = 'admin'
        OR e.access_level = 'admin'
        OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_employee_notification_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_employee_notification_settings() TO authenticated;

ALTER TABLE public.employee_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_webhook_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_settings_select" ON public.employee_notification_settings;
CREATE POLICY "notification_settings_select"
  ON public.employee_notification_settings
  FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR public.can_manage_employee_notification_settings()
  );

DROP POLICY IF EXISTS "notification_settings_insert" ON public.employee_notification_settings;
CREATE POLICY "notification_settings_insert"
  ON public.employee_notification_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_employee_notification_settings());

DROP POLICY IF EXISTS "notification_settings_update" ON public.employee_notification_settings;
CREATE POLICY "notification_settings_update"
  ON public.employee_notification_settings
  FOR UPDATE TO authenticated
  USING (public.can_manage_employee_notification_settings())
  WITH CHECK (public.can_manage_employee_notification_settings());

DROP POLICY IF EXISTS "notification_settings_delete" ON public.employee_notification_settings;
CREATE POLICY "notification_settings_delete"
  ON public.employee_notification_settings
  FOR DELETE TO authenticated
  USING (public.can_manage_employee_notification_settings());

DROP POLICY IF EXISTS "webhook_notification_settings_select" ON public.employee_webhook_notification_settings;
CREATE POLICY "webhook_notification_settings_select"
  ON public.employee_webhook_notification_settings
  FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR public.can_manage_employee_notification_settings()
  );

DROP POLICY IF EXISTS "webhook_notification_settings_insert" ON public.employee_webhook_notification_settings;
CREATE POLICY "webhook_notification_settings_insert"
  ON public.employee_webhook_notification_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_employee_notification_settings());

DROP POLICY IF EXISTS "webhook_notification_settings_update" ON public.employee_webhook_notification_settings;
CREATE POLICY "webhook_notification_settings_update"
  ON public.employee_webhook_notification_settings
  FOR UPDATE TO authenticated
  USING (public.can_manage_employee_notification_settings())
  WITH CHECK (public.can_manage_employee_notification_settings());

DROP POLICY IF EXISTS "webhook_notification_settings_delete" ON public.employee_webhook_notification_settings;
CREATE POLICY "webhook_notification_settings_delete"
  ON public.employee_webhook_notification_settings
  FOR DELETE TO authenticated
  USING (public.can_manage_employee_notification_settings());

CREATE OR REPLACE FUNCTION public.set_employee_notification_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_employee_notification_settings_updated_at
  ON public.employee_notification_settings;
CREATE TRIGGER set_employee_notification_settings_updated_at
  BEFORE UPDATE ON public.employee_notification_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_employee_notification_settings_updated_at();

DROP TRIGGER IF EXISTS set_employee_webhook_notification_settings_updated_at
  ON public.employee_webhook_notification_settings;
CREATE TRIGGER set_employee_webhook_notification_settings_updated_at
  BEFORE UPDATE ON public.employee_webhook_notification_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_employee_notification_settings_updated_at();

-- Preserve explicit legacy contact-form choices. Admin notifications default to enabled.
INSERT INTO public.employee_notification_settings (
  employee_id,
  contact_form_enabled,
  webhook_notifications_enabled
)
SELECT
  e.id,
  CASE
    WHEN e.role = 'admin'
      OR e.access_level = 'admin'
      OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
    THEN COALESCE(
      (e.preferences->'notifications'->>'contact_form_messages')::boolean,
      true
    )
    ELSE COALESCE(e.can_receive_contact_forms, false)
      AND COALESCE(
        (e.preferences->'notifications'->>'contact_form_messages')::boolean,
        true
      )
  END,
  CASE
    WHEN e.role = 'admin'
      OR e.access_level = 'admin'
      OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
    THEN true
    ELSE false
  END
FROM public.employees e
ON CONFLICT (employee_id) DO NOTHING;

-- Existing administrators receive existing webhook sources by default.
INSERT INTO public.employee_webhook_notification_settings (
  employee_id,
  source_id,
  is_enabled
)
SELECT e.id, ws.id, true
FROM public.employees e
CROSS JOIN public.webhook_sources ws
WHERE e.is_active = true
  AND (
    e.role = 'admin'
    OR e.access_level = 'admin'
    OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
  )
ON CONFLICT (employee_id, source_id) DO NOTHING;

-- Notification preferences must never remove read access. Access is controlled only
-- by role/permissions and the legacy explicit contact-form access flag.
DROP POLICY IF EXISTS "Authenticated users can read contact messages" ON public.contact_messages;
DROP POLICY IF EXISTS "Users with messages_manage can view contact messages" ON public.contact_messages;
DROP POLICY IF EXISTS "Users can view contact messages based on permissions and preferences" ON public.contact_messages;
DROP POLICY IF EXISTS "Users with contact form access can view messages" ON public.contact_messages;

CREATE POLICY "Authorized employees can view contact messages"
  ON public.contact_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE e.id = auth.uid()
        AND e.is_active = true
        AND (
          e.role = 'admin'
          OR e.access_level = 'admin'
          OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
          OR 'messages_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
          OR 'messages_view' = ANY(COALESCE(e.permissions, '{}'::text[]))
          OR COALESCE(e.can_receive_contact_forms, false)
        )
    )
  );

-- One canonical notification is generated when contact_messages receives a row.
CREATE OR REPLACE FUNCTION public.notify_new_contact_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  category_pl text;
  new_notification_id uuid;
  recipient_count integer;
BEGIN
  BEGIN
    CASE NEW.category
      WHEN 'event_inquiry' THEN category_pl := 'Zapytanie o event';
      WHEN 'form_submission' THEN category_pl := 'Formularz kontaktowy';
      WHEN 'team_join' THEN category_pl := 'Rekrutacja';
      WHEN 'general' THEN category_pl := 'Ogólna';
      ELSE category_pl := NEW.category;
    END CASE;

    INSERT INTO public.notifications (
      title,
      message,
      type,
      category,
      action_url,
      related_entity_type,
      related_entity_id,
      created_at
    )
    VALUES (
      'Nowa wiadomość kontaktowa',
      format('Od: %s (%s) - Kategoria: %s', NEW.name, NEW.email, category_pl),
      'info',
      'contact_form',
      format('/crm/messages/%s?type=contact_form', NEW.id),
      'contact_messages',
      NEW.id::text,
      now()
    )
    RETURNING id INTO new_notification_id;

    INSERT INTO public.notification_recipients (
      notification_id,
      user_id,
      is_read,
      created_at
    )
    SELECT
      new_notification_id,
      e.id,
      false,
      now()
    FROM public.employees e
    LEFT JOIN public.employee_notification_settings ens
      ON ens.employee_id = e.id
    WHERE e.is_active = true
      AND (
        e.role = 'admin'
        OR e.access_level = 'admin'
        OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'messages_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'messages_view' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR COALESCE(e.can_receive_contact_forms, false)
      )
      AND COALESCE(
        ens.contact_form_enabled,
        e.role = 'admin'
          OR e.access_level = 'admin'
          OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
      ) = true
    ON CONFLICT (notification_id, user_id) DO NOTHING;

    GET DIAGNOSTICS recipient_count = ROW_COUNT;

    IF recipient_count = 0 THEN
      DELETE FROM public.notifications WHERE id = new_notification_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- A notification failure must never block saving the customer's message.
    RAISE NOTICE 'Error in notify_new_contact_message trigger: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- contact_form_submissions is converted into contact_messages. The INSERT above fires
-- notify_new_contact_message, so this function must not create a second notification.
CREATE OR REPLACE FUNCTION public.process_contact_form_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_message_id uuid;
  metadata_text text;
BEGIN
  metadata_text := format(
    'Source: %s | Section: %s | City: %s | Event Type: %s | UTM Source: %s | UTM Medium: %s | UTM Campaign: %s | Referrer: %s | Submission ID: %s',
    COALESCE(NEW.source_page, 'Unknown'),
    COALESCE(NEW.source_section, 'N/A'),
    COALESCE(NEW.city_interest, 'N/A'),
    COALESCE(NEW.event_type, 'N/A'),
    COALESCE(NEW.utm_source, 'N/A'),
    COALESCE(NEW.utm_medium, 'N/A'),
    COALESCE(NEW.utm_campaign, 'N/A'),
    COALESCE(NEW.referrer, 'N/A'),
    NEW.id::text
  );

  INSERT INTO public.contact_messages (
    name,
    email,
    phone,
    message,
    source_page,
    status,
    priority,
    category,
    subject,
    notes,
    ip_address,
    user_agent,
    created_at
  )
  VALUES (
    NEW.name,
    NEW.email,
    NEW.phone,
    NEW.message,
    COALESCE(NEW.source_page, 'Website Form'),
    'unread',
    'normal',
    'form_submission',
    COALESCE(NEW.source_section, 'Contact Form'),
    metadata_text,
    NULL,
    NULL,
    NEW.created_at
  )
  RETURNING id INTO new_message_id;

  UPDATE public.contact_form_submissions
  SET metadata = COALESCE(metadata, '{}'::jsonb)
    || jsonb_build_object('message_id', new_message_id)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

COMMENT ON TABLE public.employee_notification_settings IS
  'Per-employee notification delivery settings. These settings do not grant data access.';
COMMENT ON TABLE public.employee_webhook_notification_settings IS
  'Per-employee opt-in/opt-out for each external webhook source.';
COMMENT ON FUNCTION public.notify_new_contact_message() IS
  'Creates one contact-form notification and only for authorized, subscribed employees.';
COMMENT ON FUNCTION public.process_contact_form_submission() IS
  'Converts a tracked form submission to contact_messages; notification is generated by the contact_messages trigger.';
