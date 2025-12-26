/*
  # Dodaj pole is_optional do equipment_components

  1. Zmiany
    - Dodanie kolumny `is_optional` do tabeli `equipment_components`
    - Komponent może być opcjonalny (nie wliczony domyślnie w zestaw)
    - Opcjonalne komponenty będą wyświetlane w sekcji "Skład opcjonalny"
*/

ALTER TABLE equipment_components
ADD COLUMN IF NOT EXISTS is_optional boolean DEFAULT false;

COMMENT ON COLUMN equipment_components.is_optional IS 'True = komponent opcjonalny (nie wliczony domyślnie), False = komponent podstawowy (wliczony w zestaw)';
