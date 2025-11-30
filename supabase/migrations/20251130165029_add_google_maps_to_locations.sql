/*
  # Add Google Maps Integration to Locations

  1. New Columns
    - `latitude` (numeric) - Szerokość geograficzna
    - `longitude` (numeric) - Długość geograficzna
    - `google_maps_url` (text) - Link do Google Maps
    - `google_place_id` (text) - ID miejsca z Google Places API
    - `formatted_address` (text) - Pełny adres z Google Places

  2. Purpose
    - Umożliwienie zaznaczania lokalizacji na mapie Google
    - Przechowywanie współrzędnych GPS
    - Integracja z Google Places API
    - Auto-wypełnianie danych adresowych

  3. Changes
    - Dodano pola do przechowywania danych z Google Maps
    - Współrzędne umożliwiają wyświetlanie mapy i nawigację
    - Google Place ID pozwala na pobieranie dodatkowych informacji
*/

-- Add Google Maps related columns to locations
ALTER TABLE locations
ADD COLUMN IF NOT EXISTS latitude NUMERIC,
ADD COLUMN IF NOT EXISTS longitude NUMERIC,
ADD COLUMN IF NOT EXISTS google_maps_url TEXT,
ADD COLUMN IF NOT EXISTS google_place_id TEXT,
ADD COLUMN IF NOT EXISTS formatted_address TEXT;

-- Add index for coordinate-based queries
CREATE INDEX IF NOT EXISTS idx_locations_coordinates ON locations(latitude, longitude);

-- Add index for Google Place ID
CREATE INDEX IF NOT EXISTS idx_locations_place_id ON locations(google_place_id);

-- Add comment
COMMENT ON COLUMN locations.latitude IS 'Szerokość geograficzna z Google Maps';
COMMENT ON COLUMN locations.longitude IS 'Długość geograficzna z Google Maps';
COMMENT ON COLUMN locations.google_maps_url IS 'Link do lokalizacji w Google Maps';
COMMENT ON COLUMN locations.google_place_id IS 'ID miejsca z Google Places API';
COMMENT ON COLUMN locations.formatted_address IS 'Pełny adres z Google Places API';
