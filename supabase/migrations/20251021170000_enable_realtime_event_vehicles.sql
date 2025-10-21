/*
  # Włączenie Realtime dla event_vehicles

  1. Zmiany
    - Dodanie tabeli event_vehicles do publikacji realtime
    - Umożliwi aktualizację badge "W użytkowaniu" w czasie rzeczywistym dla wszystkich użytkowników

  2. Bezpieczeństwo
    - Istniejące polityki RLS pozostają bez zmian
*/

-- Włącz realtime dla event_vehicles
ALTER PUBLICATION supabase_realtime ADD TABLE event_vehicles;
