/*
  # Add my_company_id to events

  Allows an event to be linked to a specific `my_companies` entry (the legal
  entity that will issue contracts, offers, calculations and invoices for it).
  Downstream document generators use this to pick up the correct logo, legal
  details and branding.

  1. Changes
    - `events.my_company_id` (uuid, nullable) — FK -> `my_companies(id)` ON DELETE SET NULL

  2. Security
    - No RLS changes; existing policies on `events` cover the new column.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'my_company_id'
  ) THEN
    ALTER TABLE events
      ADD COLUMN my_company_id uuid REFERENCES my_companies(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_events_my_company_id ON events(my_company_id);
  END IF;
END $$;
