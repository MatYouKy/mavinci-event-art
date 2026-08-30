BEGIN;

ALTER TABLE public.wedding_card_people
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS instagram_tag_consent boolean NOT NULL DEFAULT false;

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

COMMENT ON COLUMN public.wedding_card_people.role IS
  'Role of a person in the wedding card, including venue contacts and subcontractors.';

COMMENT ON COLUMN public.wedding_card_people.instagram_handle IS
  'Instagram username of the bride or groom, stored without the @ prefix.';

COMMENT ON COLUMN public.wedding_card_people.instagram_tag_consent IS
  'Explicit consent from the bride or groom to be tagged by Event Rulers.';

CREATE OR REPLACE FUNCTION public.replace_wedding_card_people(
  p_wedding_card_id uuid,
  p_people jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(COALESCE(p_people, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'People payload must be a JSON array';
  END IF;

  DELETE FROM public.wedding_card_people
  WHERE wedding_card_id = p_wedding_card_id;

  INSERT INTO public.wedding_card_people (
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
    p_wedding_card_id,
    person.value ->> 'side',
    person.value ->> 'role',
    person.value ->> 'first_name',
    NULLIF(person.value ->> 'last_name', ''),
    NULLIF(person.value ->> 'phone', ''),
    NULLIF(person.value ->> 'email', ''),
    NULLIF(person.value ->> 'instagram_handle', ''),
    COALESCE((person.value ->> 'instagram_tag_consent')::boolean, false),
    NULLIF(person.value ->> 'notes', ''),
    (person.position - 1)::integer,
    'event_rulers'
  FROM jsonb_array_elements(COALESCE(p_people, '[]'::jsonb))
    WITH ORDINALITY AS person(value, position);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_wedding_card_people(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_wedding_card_people(uuid, jsonb) TO service_role;

-- Make the new RPC visible to PostgREST immediately after running the
-- migration from the Supabase SQL editor as well as through the CLI.
NOTIFY pgrst, 'reload schema';

COMMIT;
