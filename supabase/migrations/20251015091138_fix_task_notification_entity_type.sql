/*
  # Napraw typ encji notyfikacji zadań

  1. Problem
    - Trigger używa related_entity_type='task' która nie jest dozwolona
    - Constraint pozwala tylko na: client, event, offer, employee, equipment, contact_messages
    
  2. Rozwiązanie
    - Dodaj 'task' do constraint related_entity_type_check
*/

-- Drop old constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_related_entity_type_check;

-- Add new constraint with 'task' included
ALTER TABLE notifications ADD CONSTRAINT notifications_related_entity_type_check 
  CHECK (related_entity_type = ANY (ARRAY[
    'client'::text, 
    'event'::text, 
    'offer'::text, 
    'employee'::text, 
    'equipment'::text, 
    'contact_messages'::text,
    'task'::text
  ]));

COMMENT ON CONSTRAINT notifications_related_entity_type_check ON notifications IS 'Dozwolone typy encji w notyfikacjach';
