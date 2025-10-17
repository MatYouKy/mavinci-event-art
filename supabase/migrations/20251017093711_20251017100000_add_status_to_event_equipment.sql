/*
  # Dodanie statusu do rezerwacji sprzętu w wydarzeniach

  1. Zmiany
    - Dodaje kolumnę `status` do tabeli `event_equipment`
    - Wartości: 'reserved', 'in_use', 'returned', 'cancelled'
    - Domyślnie: 'reserved'

  2. Logika
    - 'reserved' - sprzęt zarezerwowany na wydarzenie
    - 'in_use' - sprzęt aktualnie używany podczas wydarzenia
    - 'returned' - sprzęt zwrócony po wydarzeniu
    - 'cancelled' - rezerwacja anulowana

  3. Notatki
    - Status pozwala śledzić cykl życia rezerwacji
    - Tylko sprzęt ze statusem 'reserved' lub 'in_use' blokuje dostępność
*/

-- Dodaj kolumnę status
ALTER TABLE event_equipment
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'reserved'
CHECK (status IN ('reserved', 'in_use', 'returned', 'cancelled'));

-- Dodaj indeks dla szybszego filtrowania
CREATE INDEX IF NOT EXISTS idx_event_equipment_status ON event_equipment(status);

-- Dodaj komentarz
COMMENT ON COLUMN event_equipment.status IS 'Status rezerwacji: reserved (zarezerwowane), in_use (w użyciu), returned (zwrócone), cancelled (anulowane)';
