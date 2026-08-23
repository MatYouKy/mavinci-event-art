BEGIN;

ALTER TABLE public.wedding_card_people
  DROP CONSTRAINT IF EXISTS wedding_card_people_role_check;

ALTER TABLE public.wedding_card_people
  ADD CONSTRAINT wedding_card_people_role_check CHECK (role IN (
    'bride', 'groom', 'witness', 'mother', 'father', 'godparent',
    'guardian', 'subcontractor', 'venue_contact', 'other'
  ));

COMMENT ON COLUMN public.wedding_card_people.role IS
  'Couple, family and operational contacts including witnesses, godparents, subcontractors and venue representatives.';

COMMIT;
