/*
  # Couple social profile in the canonical wedding card

  Contact and Instagram data belongs to the bride and groom records. Other
  wedding participants remain simple named records. The same columns are read
  and written by CRM and the Event Rulers wedding portal through the existing
  authenticated webhook.
*/

BEGIN;

ALTER TABLE public.wedding_card_people
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS instagram_tag_consent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.wedding_card_people.instagram_handle IS
  'Instagram username for the bride or groom, stored without requiring the @ prefix.';

COMMENT ON COLUMN public.wedding_card_people.instagram_tag_consent IS
  'Explicit consent from the bride or groom to be tagged by Event Rulers on Instagram.';

COMMIT;
