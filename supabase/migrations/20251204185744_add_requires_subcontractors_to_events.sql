/*
  # Dodanie pola requires_subcontractors do tabeli events

  1. Zmiany
    - Dodanie kolumny `requires_subcontractors` (boolean) do tabeli `events`
    - Domyślna wartość: false
    - Pole określa czy event wymaga podwykonawców

  2. Bezpieczeństwo
    - Pole jest dostępne przez istniejące RLS policies na tabeli events
*/

-- Dodaj kolumnę określającą zapotrzebowanie na podwykonawców
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS requires_subcontractors boolean DEFAULT false;

-- Dodaj komentarz do kolumny
COMMENT ON COLUMN events.requires_subcontractors IS 'Określa czy event wymaga podwykonawców (pokazuje zakładkę Podwykonawcy)';