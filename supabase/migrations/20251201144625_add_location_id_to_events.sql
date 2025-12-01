/*
  # Add location_id to events table

  1. Changes
    - Add `location_id` column to events table as foreign key to locations
    - Keep `location` text field for backward compatibility and quick text entry
    - location_id is optional - allows both:
      * Linking to saved location (with full details)
      * Quick text entry (just address as text)

  2. Security
    - No RLS changes needed (events already have RLS)
    - Foreign key ensures data integrity
*/

-- Add location_id column to events
ALTER TABLE events
ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_events_location_id ON events(location_id);

-- Add comment
COMMENT ON COLUMN events.location_id IS 'Reference to locations table. Optional - if null, use location text field instead.';