-- Alias source conflicted with contacts.source in whole-row JSON conversion.
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
    'target', to_jsonb(target_contact),
    'source', to_jsonb(source_contact),
    'relations', jsonb_build_object(
      'inquiries', (SELECT count(*) FROM public.tasks WHERE contact_id = source_contact.id),
      'calls', (SELECT count(*) FROM public.crm_call_activities WHERE contact_id = source_contact.id),
      'offers', (SELECT count(*) FROM public.offers WHERE contact_id = source_contact.id),
      'events', (SELECT count(*) FROM public.events WHERE contact_person_id = source_contact.id),
      'meetings', (SELECT count(*) FROM public.meeting_participants WHERE contact_id = source_contact.id),
      'organizations', (SELECT count(*) FROM public.contact_organizations WHERE contact_id = source_contact.id),
      'contracts', (SELECT count(*) FROM public.contracts WHERE client_id = source_contact.id),
      'invoices', (SELECT count(*) FROM public.invoices WHERE contact_person_id = source_contact.id)
    )
  ) INTO result
  FROM public.contacts AS target_contact
  CROSS JOIN public.contacts AS source_contact
  WHERE target_contact.id = p_target_contact_id AND source_contact.id = p_source_contact_id;

  IF result IS NULL THEN RAISE EXCEPTION 'Nie znaleziono kontaktu'; END IF;
  RETURN result;
END;
$$;

