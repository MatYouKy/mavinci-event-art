/*
  # Add Location Coordinates and Google Maps Integration

  1. Changes
    - Add `latitude` (numeric) - Szerokość geograficzna
    - Add `longitude` (numeric) - Długość geograficzna
    - Add `formatted_address` (text) - Pełny adres z Google
    - Add `google_place_id` (text) - ID miejsca w Google
    - Add `google_maps_url` (text) - Link do Google Maps

  2. Updates
    - Update existing sample locations with coordinates
*/

-- Add new columns for coordinates and Google Maps data
ALTER TABLE locations ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS longitude numeric;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS formatted_address text;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS google_place_id text;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS google_maps_url text;

-- Create index for coordinate searches
CREATE INDEX IF NOT EXISTS idx_locations_coordinates ON locations(latitude, longitude);

-- Update sample data with coordinates
UPDATE locations SET
  latitude = 52.228329,
  longitude = 21.003042,
  google_maps_url = 'https://www.google.com/maps?q=52.228329,21.003042'
WHERE name = 'Hotel Marriott Warsaw';

UPDATE locations SET
  latitude = 52.232689,
  longitude = 20.984534,
  google_maps_url = 'https://www.google.com/maps?q=52.232689,20.984534'
WHERE name = 'Centrum Konferencyjne Golden Floor Tower';

UPDATE locations SET
  latitude = 52.231667,
  longitude = 21.006111,
  google_maps_url = 'https://www.google.com/maps?q=52.231667,21.006111'
WHERE name = 'Sala Kongresowa PKiN';

UPDATE locations SET
  latitude = 50.057678,
  longitude = 19.944544,
  google_maps_url = 'https://www.google.com/maps?q=50.057678,19.944544'
WHERE name = 'Hotel Sheraton Grand Kraków';

UPDATE locations SET
  latitude = 52.239569,
  longitude = 21.046173,
  google_maps_url = 'https://www.google.com/maps?q=52.239569,21.046173'
WHERE name = 'Stadion Narodowy';
