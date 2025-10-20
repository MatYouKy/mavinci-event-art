/*
  # Napraw istniejące kategorie notyfikacji
  
  Problem:
  - Niektóre notyfikacje mają kategorie które nie są w constraint
  - Nie możemy dodać nowego constraint dopóki nie naprawimy danych
  
  Rozwiązanie:
  1. Zaktualizuj istniejące notyfikacje z niedozwolonymi kategoriami
  2. Usuń stary constraint
  3. Dodaj nowy constraint z dodatkowymi kategoriami
*/

-- Najpierw sprawdź jakie kategorie są używane
DO $$
BEGIN
  RAISE NOTICE 'Aktualizuję notyfikacje z niedozwolonymi kategoriami...';
END $$;

-- Zaktualizuj wszystkie notyfikacje z event_assignment na event
UPDATE notifications 
SET category = 'event'
WHERE category NOT IN ('client', 'event', 'offer', 'employee', 'system', 'global', 'contact_form', 'tasks');

-- Drop old constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;

-- Add new constraint with więcej kategorii
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check 
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
    'message_assignment'::text
  ]));

COMMENT ON CONSTRAINT notifications_category_check ON notifications IS 'Dozwolone kategorie notyfikacji';