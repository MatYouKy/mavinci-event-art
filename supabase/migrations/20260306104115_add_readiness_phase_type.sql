/*
  # Dodanie fazy "Gotowość" do typów faz

  1. Nowy typ fazy
    - Gotowość - Sprawdzenie sprzętu i przygotowanie do realizacji
    - Kolejność: między Montaż a Realizacja (sequence_priority: 3.5)
    - Kolor: żółty (#eab308)
    - Domyślny czas: 1 godzina
*/

-- Dodaj fazę Gotowość
INSERT INTO event_phase_types (name, description, color, sequence_priority, default_duration_hours)
VALUES ('Gotowość', 'Sprawdzenie sprzętu i przygotowanie do realizacji', '#eab308', 3.5, 1)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE event_phase_types IS
  'Typy faz wydarzeń: Załadunek, Dojazd, Montaż, Gotowość, Realizacja, Demontaż, Powrót, Rozładunek';