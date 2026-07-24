/*
  # Add is_loaded column to event_equipment

  1. Changes
    - Add `is_loaded` (boolean, default false) to `event_equipment` table
    - Add `loaded_at` (timestamptz, nullable) to track when item was loaded
    - Add `loaded_by` (uuid, nullable) to track who loaded the item

  2. Purpose
    - Allows mobile app to persist "equipment loaded" state across sessions
    - Enables web app to show real-time loaded status with green border
    - Survives page/app refresh

  3. Realtime
    - Enable realtime on event_equipment for instant updates
*/

ALTER TABLE event_equipment
ADD COLUMN IF NOT EXISTS is_loaded boolean NOT NULL DEFAULT false;

ALTER TABLE event_equipment
ADD COLUMN IF NOT EXISTS loaded_at timestamptz;

ALTER TABLE event_equipment
ADD COLUMN IF NOT EXISTS loaded_by uuid REFERENCES auth.users(id);

-- Enable realtime for event_equipment (ignore error if already added)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE event_equipment;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
