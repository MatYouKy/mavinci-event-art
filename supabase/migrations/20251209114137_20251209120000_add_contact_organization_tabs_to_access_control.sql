/*
  # Dodaj kontrolę dostępu dla kontaktów i organizacji

  1. Zmiany
    - Dodaj `contact_tabs` do tabeli `access_levels`
    - Dodaj `organization_tabs` do tabeli `access_levels`
    - Dodaj `contact_tabs` do tabeli `employees` (dla indywidualnych ustawień)
    - Dodaj `organization_tabs` do tabeli `employees` (dla indywidualnych ustawień)
  
  2. Zakładki kontaktu
    - details: Szczegóły kontaktu
    - notes: Notatki
    - history: Historia
  
  3. Zakładki organizacji
    - details: Szczegóły organizacji
    - contacts: Osoby kontaktowe
    - invoices: Faktury
    - events: Realizacje (eventy)
    - notes: Notatki
    - history: Historia
  
  4. Domyślne wartości
    - Admin: wszystkie zakładki
    - Pozostali: tylko details
*/

-- Dodaj kolumny do access_levels
ALTER TABLE access_levels
ADD COLUMN IF NOT EXISTS contact_tabs text[] DEFAULT ARRAY['details', 'notes', 'history'],
ADD COLUMN IF NOT EXISTS organization_tabs text[] DEFAULT ARRAY['details', 'contacts', 'invoices', 'events', 'notes', 'history'];

-- Dodaj kolumny do employees
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS contact_tabs text[],
ADD COLUMN IF NOT EXISTS organization_tabs text[];

-- Ustaw domyślne wartości dla istniejących poziomów dostępu
UPDATE access_levels
SET 
  contact_tabs = ARRAY['details', 'notes', 'history'],
  organization_tabs = ARRAY['details', 'contacts', 'invoices', 'events', 'notes', 'history']
WHERE contact_tabs IS NULL OR organization_tabs IS NULL;

COMMENT ON COLUMN access_levels.contact_tabs IS 'Zakładki dostępne dla kontaktów: details, notes, history';
COMMENT ON COLUMN access_levels.organization_tabs IS 'Zakładki dostępne dla organizacji: details, contacts, invoices, events, notes, history';
COMMENT ON COLUMN employees.contact_tabs IS 'Indywidualne ustawienia zakładek dla kontaktów (nadpisuje access_level)';
COMMENT ON COLUMN employees.organization_tabs IS 'Indywidualne ustawienia zakładek dla organizacji (nadpisuje access_level)';
