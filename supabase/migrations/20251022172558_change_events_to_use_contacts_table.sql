/*
  # Zmiana events aby używał tabeli contacts zamiast contact_persons
  
  1. Usuń stary foreign key do contact_persons
  2. Dodaj nowy foreign key do contacts
  3. Zachowaj istniejące dane
*/

-- Usuń stary foreign key constraint
ALTER TABLE events 
DROP CONSTRAINT IF EXISTS events_contact_person_id_fkey;

-- Dodaj nowy foreign key do contacts
ALTER TABLE events
ADD CONSTRAINT events_contact_person_id_fkey 
FOREIGN KEY (contact_person_id) 
REFERENCES contacts(id) 
ON DELETE SET NULL;

-- Dodaj komentarz
COMMENT ON COLUMN events.contact_person_id IS 'ID osoby kontaktowej z tabeli contacts';
