/*
  # Add Absence Entity Type to Notifications

  1. Changes
    - Update notifications_related_entity_type_check constraint to include absence
*/

-- Drop old constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_related_entity_type_check;

-- Add new constraint with absence entity type
ALTER TABLE notifications ADD CONSTRAINT notifications_related_entity_type_check 
  CHECK (related_entity_type = ANY (ARRAY[
    'client'::text,
    'event'::text,
    'offer'::text,
    'employee'::text,
    'equipment'::text,
    'contact_messages'::text,
    'task'::text,
    'vehicle'::text,
    'event_vehicle'::text,
    'maintenance_record'::text,
    'insurance_policy'::text,
    'fuel_entry'::text,
    'absence'::text
  ]));
