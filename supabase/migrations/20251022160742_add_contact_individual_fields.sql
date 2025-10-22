/*
  # Dodanie pól dla kontaktów i osób prywatnych

  1. Nowe pola dla kontaktów:
    - `nip` - NIP dla kontaktów z JDG
    - `position` - stanowisko
    - `business_phone` - telefon firmowy (dotychczasowy `phone` to prywatny)
    
  2. Nowe pola dla osób prywatnych:
    - `pesel` - numer PESEL
    - `id_number` - numer dowodu osobistego
    - `event_type` - typ uroczystości (wesele, urodziny, dodatki, inne)
    - `event_details` - szczegóły uroczystości
*/

-- Dodaj pola dla kontaktów
ALTER TABLE contacts 
  ADD COLUMN IF NOT EXISTS nip text,
  ADD COLUMN IF NOT EXISTS position text,
  ADD COLUMN IF NOT EXISTS business_phone text;

-- Dodaj pola dla osób prywatnych
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS pesel text,
  ADD COLUMN IF NOT EXISTS id_number text,
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS event_details text;

-- Dodaj komentarze
COMMENT ON COLUMN contacts.nip IS 'NIP dla kontaktów prowadzących JDG';
COMMENT ON COLUMN contacts.position IS 'Stanowisko kontaktu w organizacji';
COMMENT ON COLUMN contacts.business_phone IS 'Telefon firmowy';
COMMENT ON COLUMN contacts.pesel IS 'PESEL osoby prywatnej';
COMMENT ON COLUMN contacts.id_number IS 'Numer dowodu osobistego';
COMMENT ON COLUMN contacts.event_type IS 'Typ uroczystości: wesele, urodziny, dodatki, inne';
COMMENT ON COLUMN contacts.event_details IS 'Szczegółowy opis uroczystości';
