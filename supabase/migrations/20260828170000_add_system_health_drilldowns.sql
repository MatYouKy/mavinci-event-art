/*
  Szczegóły diagnostyki CRM.

  Liczniki z get_crm_data_quality/get_crm_security_health są przydatne do
  monitoringu, ale nie wskazują rekordów wymagających działania. Ta funkcja
  zwraca wyłącznie administratorowi listy obiektów, linki do CRM i bezpieczne
  propozycje SQL. Nie wykonuje automatycznych zmian w danych ani politykach.
*/

CREATE OR REPLACE FUNCTION public.get_crm_health_details()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'data_quality', jsonb_build_object(
      'duplicate_contact_emails', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', duplicate.email_key,
          'title', duplicate.email_key,
          'subtitle', format('%s kontakty z tym samym adresem', duplicate.record_count),
          'records', duplicate.records
        ) ORDER BY duplicate.email_key)
        FROM (
          SELECT
            lower(trim(contact.email)) AS email_key,
            COUNT(*) AS record_count,
            jsonb_agg(jsonb_build_object(
              'id', contact.id,
              'title', COALESCE(NULLIF(trim(contact.full_name), ''), trim(concat_ws(' ', contact.first_name, contact.last_name)), 'Kontakt bez nazwy'),
              'subtitle', concat_ws(' · ', NULLIF(contact.email, ''), NULLIF(COALESCE(contact.phone, contact.mobile), '')),
              'href', '/crm/contacts/' || contact.id
            ) ORDER BY contact.created_at) AS records
          FROM public.contacts contact
          WHERE NULLIF(lower(trim(contact.email)), '') IS NOT NULL
          GROUP BY lower(trim(contact.email))
          HAVING COUNT(*) > 1
        ) duplicate
      ), '[]'::jsonb),
      'duplicate_contact_phones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', duplicate.phone_key,
          'title', duplicate.display_phone,
          'subtitle', format('%s kontakty z tym samym numerem', duplicate.record_count),
          'records', duplicate.records
        ) ORDER BY duplicate.phone_key)
        FROM (
          SELECT
            regexp_replace(contact.phone, '\D', '', 'g') AS phone_key,
            MIN(contact.phone) AS display_phone,
            COUNT(*) AS record_count,
            jsonb_agg(jsonb_build_object(
              'id', contact.id,
              'title', COALESCE(NULLIF(trim(contact.full_name), ''), trim(concat_ws(' ', contact.first_name, contact.last_name)), 'Kontakt bez nazwy'),
              'subtitle', concat_ws(' · ', NULLIF(contact.phone, ''), NULLIF(contact.email, '')),
              'href', '/crm/contacts/' || contact.id
            ) ORDER BY contact.created_at) AS records
          FROM public.contacts contact
          WHERE NULLIF(regexp_replace(COALESCE(contact.phone, ''), '\D', '', 'g'), '') IS NOT NULL
          GROUP BY regexp_replace(contact.phone, '\D', '', 'g')
          HAVING COUNT(*) > 1
        ) duplicate
      ), '[]'::jsonb),
      'duplicate_organization_nips', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', duplicate.nip_key,
          'title', duplicate.display_nip,
          'subtitle', format('%s organizacje z tym samym NIP', duplicate.record_count),
          'records', duplicate.records
        ) ORDER BY duplicate.nip_key)
        FROM (
          SELECT
            regexp_replace(organization.nip, '\D', '', 'g') AS nip_key,
            MIN(organization.nip) AS display_nip,
            COUNT(*) AS record_count,
            jsonb_agg(jsonb_build_object(
              'id', organization.id,
              'title', COALESCE(NULLIF(trim(organization.name), ''), 'Organizacja bez nazwy'),
              'subtitle', concat_ws(' · ', NULLIF(organization.nip, ''), NULLIF(organization.email, '')),
              'href', '/crm/contacts/' || organization.id
            ) ORDER BY organization.created_at) AS records
          FROM public.organizations organization
          WHERE NULLIF(regexp_replace(COALESCE(organization.nip, ''), '\D', '', 'g'), '') IS NOT NULL
          GROUP BY regexp_replace(organization.nip, '\D', '', 'g')
          HAVING COUNT(*) > 1
        ) duplicate
      ), '[]'::jsonb),
      'upcoming_events_missing_contact', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', event.id,
          'title', event.name,
          'subtitle', 'Termin: ' || to_char(event.event_date AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'),
          'href', '/crm/events/' || event.id
        ) ORDER BY event.event_date)
        FROM public.events event
        WHERE event.event_date BETWEEN now() AND now() + interval '60 days'
          AND event.contact_person_id IS NULL
          AND event.organization_id IS NULL
          AND event.status::text <> 'cancelled'
      ), '[]'::jsonb),
      'upcoming_events_missing_location', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', event.id,
          'title', event.name,
          'subtitle', 'Termin: ' || to_char(event.event_date AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'),
          'href', '/crm/events/' || event.id
        ) ORDER BY event.event_date)
        FROM public.events event
        WHERE event.event_date BETWEEN now() AND now() + interval '60 days'
          AND NULLIF(trim(COALESCE(event.location, '')), '') IS NULL
          AND event.status::text <> 'cancelled'
      ), '[]'::jsonb),
      'upcoming_events_missing_owner', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', event.id,
          'title', event.name,
          'subtitle', 'Termin: ' || to_char(event.event_date AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'),
          'href', '/crm/events/' || event.id
        ) ORDER BY event.event_date)
        FROM public.events event
        WHERE event.event_date BETWEEN now() AND now() + interval '60 days'
          AND event.created_by IS NULL
          AND event.status::text <> 'cancelled'
      ), '[]'::jsonb),
      'inactive_employees_on_future_events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', issue.employee_id,
          'title', issue.employee_name,
          'subtitle', format('%s przyszłe przypisania', issue.event_count),
          'href', '/crm/employees/' || issue.employee_id,
          'records', issue.records
        ) ORDER BY issue.employee_name)
        FROM (
          SELECT
            employee.id AS employee_id,
            trim(concat_ws(' ', employee.name, employee.surname)) AS employee_name,
            COUNT(DISTINCT event.id) AS event_count,
            jsonb_agg(jsonb_build_object(
              'id', event.id,
              'title', event.name,
              'subtitle', to_char(event.event_date AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'),
              'href', '/crm/events/' || event.id
            ) ORDER BY event.event_date) AS records
          FROM public.employee_assignments assignment
          JOIN public.employees employee ON employee.id = assignment.employee_id
          JOIN public.events event ON event.id = assignment.event_id
          WHERE employee.is_active = false
            AND event.event_date > now()
            AND COALESCE(assignment.status, 'accepted') <> 'rejected'
          GROUP BY employee.id, employee.name, employee.surname
        ) issue
      ), '[]'::jsonb)
    ),
    'security', jsonb_build_object(
      'tables_without_rls', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', relation.relname,
          'title', 'public.' || relation.relname,
          'subtitle', 'Tabela jest dostępna bez ochrony Row Level Security',
          'sql', format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', relation.relname)
        ) ORDER BY relation.relname)
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind = 'r'
          AND relation.relrowsecurity = false
          AND relation.relname NOT LIKE 'spatial_ref_sys'
      ), '[]'::jsonb),
      'public_storage_buckets', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', bucket.id,
          'title', bucket.name,
          'subtitle', 'Bucket publiczny — każdy znający URL może pobrać plik',
          'href', '/crm/settings/storage',
          'sql', format('UPDATE storage.buckets SET public = false WHERE id = %L;', bucket.id)
        ) ORDER BY bucket.name)
        FROM storage.buckets bucket
        WHERE bucket.public = true
      ), '[]'::jsonb),
      'active_employees_without_auth_mapping', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', employee.id,
          'title', trim(concat_ws(' ', employee.name, employee.surname)),
          'subtitle', COALESCE(employee.email, 'Brak adresu e-mail'),
          'href', '/crm/employees/' || employee.id
        ) ORDER BY employee.name, employee.surname)
        FROM public.employees employee
        WHERE employee.is_active = true
          AND employee.auth_user_id IS NULL
          AND employee.id NOT IN (SELECT user_account.id FROM auth.users user_account)
      ), '[]'::jsonb),
      'security_definer_without_fixed_search_path', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', procedure.oid::text,
          'title', procedure.proname || '(' || pg_get_function_identity_arguments(procedure.oid) || ')',
          'subtitle', 'SECURITY DEFINER bez jawnego search_path',
          'sql', format(
            'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp;',
            procedure.proname,
            pg_get_function_identity_arguments(procedure.oid)
          )
        ) ORDER BY procedure.proname, pg_get_function_identity_arguments(procedure.oid))
        FROM pg_proc procedure
        JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.prosecdef = true
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(COALESCE(procedure.proconfig, '{}'::text[])) config
            WHERE config LIKE 'search_path=%'
          )
      ), '[]'::jsonb)
    )
  )
  WHERE public.is_crm_admin();
$$;

REVOKE ALL ON FUNCTION public.get_crm_health_details() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crm_health_details() TO authenticated;

COMMENT ON FUNCTION public.get_crm_health_details() IS
  'Administracyjny drill-down jakości danych i bezpieczeństwa; nie wykonuje automatycznych napraw.';
