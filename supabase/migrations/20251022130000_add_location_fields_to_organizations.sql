/*
  # Dodanie pól lokalizacji do tabeli organizations

  1. Zmiany
    - Dodanie google_maps_url dla linku do Google Maps
    - Dodanie latitude i longitude dla współrzędnych
    - Dodanie location_notes dla dodatkowych informacji o lokalizacji
*/

-- Dodaj pola lokalizacji do organizations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'google_maps_url'
  ) THEN
    ALTER TABLE organizations ADD COLUMN google_maps_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'latitude'
  ) THEN
    ALTER TABLE organizations ADD COLUMN latitude decimal(10, 8);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'longitude'
  ) THEN
    ALTER TABLE organizations ADD COLUMN longitude decimal(11, 8);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'location_notes'
  ) THEN
    ALTER TABLE organizations ADD COLUMN location_notes text;
  END IF;
END $$;

-- Dodaj indeks dla wyszukiwania po współrzędnych
CREATE INDEX IF NOT EXISTS idx_organizations_location ON organizations(latitude, longitude);
