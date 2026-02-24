/*
  # Dodaj kategorię vehicle_conflict do notifications

  1. Problem
    - Funkcje check_vehicle_availability_on_assign i check_unreturned_vehicles
    - Próbują użyć kategorii 'vehicle_conflict' która nie jest dozwolona w check constraint
    
  2. Rozwiązanie
    - Dodać 'vehicle_conflict' do dozwolonych kategorii w constraint
*/

-- Usuń stary constraint
ALTER TABLE notifications 
DROP CONSTRAINT IF EXISTS notifications_category_check;

-- Dodaj nowy constraint z vehicle_conflict
ALTER TABLE notifications 
ADD CONSTRAINT notifications_category_check 
CHECK (category = ANY (ARRAY[
  'client'::text, 
  'event'::text, 
  'offer'::text, 
  'employee'::text, 
  'system'::text, 
  'global'::text, 
  'contact_form'::text, 
  'tasks'::text, 
  'event_assignment'::text, 
  'event_update'::text, 
  'message_assignment'::text, 
  'email_received'::text,
  'vehicle_conflict'::text
]));