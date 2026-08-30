/*
  # Atomic wedding people and schedule save

  New people created in the CRM receive their database UUID before insertion.
  The complete people/schedule edit is committed in one transaction so an
  invalid row can no longer leave the wedding card partially empty.
*/

BEGIN;

ALTER TABLE public.wedding_card_people
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.wedding_schedule_items
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.wedding_card_people
  DROP CONSTRAINT IF EXISTS wedding_card_people_role_check;

ALTER TABLE public.wedding_card_people
  ADD CONSTRAINT wedding_card_people_role_check CHECK (role IN (
    'bride',
    'groom',
    'witness',
    'mother',
    'father',
    'godparent',
    'guardian',
    'subcontractor',
    'venue_contact',
    'other'
  ));

CREATE OR REPLACE FUNCTION public.replace_wedding_people_and_schedule(
  p_wedding_card_id uuid,
  p_people jsonb DEFAULT '[]'::jsonb,
  p_schedule jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF jsonb_typeof(COALESCE(p_people, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'People payload must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_schedule, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Schedule payload must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT wc.event_id
  INTO v_event_id
  FROM public.wedding_cards wc
  WHERE wc.id = p_wedding_card_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Wedding card not found' USING ERRCODE = 'P0002';
  END IF;

  IF auth.role() <> 'service_role'
    AND NOT public.can_user_edit_event(v_event_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed to edit this wedding card' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.wedding_card_people
  WHERE wedding_card_id = p_wedding_card_id;

  INSERT INTO public.wedding_card_people (
    id,
    wedding_card_id,
    side,
    role,
    first_name,
    last_name,
    phone,
    email,
    instagram_handle,
    instagram_tag_consent,
    notes,
    sort_order,
    source
  )
  SELECT
    CASE
      WHEN COALESCE(person.value ->> 'id', '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN (person.value ->> 'id')::uuid
      ELSE gen_random_uuid()
    END,
    p_wedding_card_id,
    person.value ->> 'side',
    person.value ->> 'role',
    NULLIF(BTRIM(person.value ->> 'first_name'), ''),
    NULLIF(BTRIM(person.value ->> 'last_name'), ''),
    NULLIF(BTRIM(person.value ->> 'phone'), ''),
    NULLIF(BTRIM(person.value ->> 'email'), ''),
    NULLIF(BTRIM(person.value ->> 'instagram_handle'), ''),
    COALESCE((person.value ->> 'instagram_tag_consent')::boolean, false),
    NULLIF(BTRIM(person.value ->> 'notes'), ''),
    (person.position - 1)::integer,
    'crm'
  FROM jsonb_array_elements(COALESCE(p_people, '[]'::jsonb))
    WITH ORDINALITY AS person(value, position);

  DELETE FROM public.wedding_schedule_items
  WHERE wedding_card_id = p_wedding_card_id;

  INSERT INTO public.wedding_schedule_items (
    id,
    wedding_card_id,
    title,
    scheduled_at,
    category,
    location,
    responsible_person,
    notes,
    is_confirmed,
    sort_order,
    source
  )
  SELECT
    CASE
      WHEN COALESCE(item.value ->> 'id', '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN (item.value ->> 'id')::uuid
      ELSE gen_random_uuid()
    END,
    p_wedding_card_id,
    NULLIF(BTRIM(item.value ->> 'title'), ''),
    NULLIF(item.value ->> 'scheduled_at', '')::timestamptz,
    COALESCE(NULLIF(item.value ->> 'category', ''), 'other'),
    NULLIF(BTRIM(item.value ->> 'location'), ''),
    NULLIF(BTRIM(item.value ->> 'responsible_person'), ''),
    NULLIF(BTRIM(item.value ->> 'notes'), ''),
    COALESCE((item.value ->> 'is_confirmed')::boolean, false),
    (item.position - 1)::integer,
    'crm'
  FROM jsonb_array_elements(COALESCE(p_schedule, '[]'::jsonb))
    WITH ORDINALITY AS item(value, position);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_wedding_people_and_schedule(uuid, jsonb, jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_wedding_people_and_schedule(uuid, jsonb, jsonb)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_wedding_people_and_schedule(uuid, jsonb, jsonb)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
