/*
  # Add Phase Assignment Entity Types

  Dodaje event_phase_assignment i employee_assignment do dozwolonych typów encji.
*/

ALTER TABLE notifications 
DROP CONSTRAINT IF EXISTS notifications_related_entity_type_check;

ALTER TABLE notifications 
ADD CONSTRAINT notifications_related_entity_type_check 
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
  'absence'::text,
  'employee_assignment'::text,
  'event_phase_assignment'::text
]));