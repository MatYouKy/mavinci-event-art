-- Powiadomienie o nowej wiadomości marketingowej (Facebook / Instagram) — poprawka wyzwalacza.
--
-- notify_new_marketing_message (20260903120000_create_multibrand_marketing_hub.sql) miała zmienną `notification_id`
-- o tej samej nazwie co kolumna w `ON CONFLICT (notification_id, user_id)`. PL/pgSQL odrzuca taki zapis jako
-- niejednoznaczny, a wyzwalacz AFTER INSERT cofa wtedy cały zapis wiadomości — webhook Meta i synchronizacja nie
-- zapisałyby żadnej wiadomości. Ten sam błąd poprawiono w notify_inquiry_owner_change (20261115190000).
-- Zmienne mają teraz przedrostek v_; treść, odbiorcy i link powiadomienia bez zmian.

CREATE OR REPLACE FUNCTION public.notify_new_marketing_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_notification_id uuid;
  v_company_name text;
BEGIN
  SELECT company.name INTO v_company_name
  FROM public.my_companies company
  WHERE company.id = NEW.company_id;

  INSERT INTO public.notifications (
    title, message, type, category, action_url, metadata, created_at
  ) VALUES (
    'Nowa wiadomość na Facebooku',
    format(
      '%s · %s: %s',
      COALESCE(v_company_name, 'Marka'),
      COALESCE(NULLIF(NEW.sender_name, ''), 'Nowy kontakt'),
      left(COALESCE(NEW.message_preview, ''), 180)
    ),
    'info',
    'system',
    '/crm/page?tab=marketing&company=' || NEW.company_id::text,
    jsonb_build_object(
      'kind', 'marketing_message',
      'company_id', NEW.company_id,
      'message_id', NEW.id,
      'provider', NEW.provider
    ),
    now()
  ) RETURNING id INTO v_notification_id;

  INSERT INTO public.notification_recipients(notification_id, user_id, is_read, created_at)
  SELECT v_notification_id, auth_user.id, false, now()
  FROM public.employees employee
  JOIN auth.users auth_user ON auth_user.id = COALESCE(employee.auth_user_id, employee.id)
  WHERE COALESCE(employee.is_active, true)
    AND (
      employee.role::text = 'admin'
      OR employee.access_level::text = 'admin'
      OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'marketing_campaigns_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'marketing_campaigns_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
    )
    AND (
      employee.role::text = 'admin'
      OR employee.access_level::text = 'admin'
      OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR cardinality(COALESCE(employee.my_company_ids, '{}'::uuid[])) = 0
      OR NEW.company_id = ANY(COALESCE(employee.my_company_ids, '{}'::uuid[]))
    )
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_new_marketing_message() FROM PUBLIC;
