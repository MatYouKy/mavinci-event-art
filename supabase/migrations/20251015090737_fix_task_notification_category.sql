/*
  # Napraw kategorię notyfikacji zadań

  1. Problem
    - Trigger używa category='tasks' która nie jest dozwolona
    - Constraint pozwala tylko na: client, event, offer, employee, system, global, contact_form
    
  2. Rozwiązanie
    - Dodaj 'tasks' do constraint category
    - Lub użyj 'system' jako kategoria dla zadań
    
  3. Wybrana opcja
    - Dodaj 'tasks' do dozwolonych kategorii (lepsze dla filtrowania)
*/

-- Drop old constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;

-- Add new constraint with 'tasks' included
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check 
  CHECK (category = ANY (ARRAY[
    'client'::text, 
    'event'::text, 
    'offer'::text, 
    'employee'::text, 
    'system'::text, 
    'global'::text, 
    'contact_form'::text,
    'tasks'::text
  ]));

COMMENT ON CONSTRAINT notifications_category_check ON notifications IS 'Dozwolone kategorie notyfikacji';
