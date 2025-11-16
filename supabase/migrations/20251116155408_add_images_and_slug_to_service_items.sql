/*
  # Dodanie obrazów i slugów do usług

  1. Changes
    - Dodanie slug do conferences_service_items (unique)
    - Dodanie hero_image_url (główne zdjęcie, max 1.2MB)
    - Dodanie thumbnail_url (miniaturka 400px)
    - Dodanie image_metadata (JSONB z informacjami o obrazach)
    - Dodanie long_description (szczegółowy opis)
    - Dodanie features (JSON array z cechami usługi)
    - Dodanie technical_specs (JSON z specyfikacją techniczną)

  2. Security
    - RLS już istnieje dla tej tabeli
*/

-- Add new columns to conferences_service_items
ALTER TABLE conferences_service_items 
ADD COLUMN IF NOT EXISTS slug text UNIQUE,
ADD COLUMN IF NOT EXISTS hero_image_url text,
ADD COLUMN IF NOT EXISTS thumbnail_url text,
ADD COLUMN IF NOT EXISTS image_metadata jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS long_description text,
ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '[]',
ADD COLUMN IF NOT EXISTS technical_specs jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS seo_title text,
ADD COLUMN IF NOT EXISTS seo_description text,
ADD COLUMN IF NOT EXISTS seo_keywords text;

-- Generate slugs for existing items (kebab-case from name)
UPDATE conferences_service_items
SET slug = lower(regexp_replace(
  regexp_replace(
    regexp_replace(name, '[ąĄ]', 'a', 'g'),
    '[ćĆ]', 'c', 'g'
  ),
  '[^a-z0-9]+', '-', 'g'
))
WHERE slug IS NULL;

-- Create index for slug lookups
CREATE INDEX IF NOT EXISTS idx_service_items_slug ON conferences_service_items(slug);

-- Add sample data for first few services (ekrany LED)
UPDATE conferences_service_items
SET 
  hero_image_url = 'https://images.pexels.com/photos/2833037/pexels-photo-2833037.jpeg?auto=compress&cs=tinysrgb&w=1920',
  thumbnail_url = 'https://images.pexels.com/photos/2833037/pexels-photo-2833037.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop',
  long_description = 'Profesjonalne ekrany LED indoor i outdoor w różnych rozdzielczościach. Oferujemy panele od 2mm do 10mm pitch, idealne do konferencji, eventów outdoor, koncertów i realizacji scenicznych. Możliwość budowania ścian LED w dowolnych konfiguracjach.',
  features = '["Rozdzielczość od 2mm do 10mm pitch", "Możliwość budowania dowolnych konfiguracji", "Brightness do 5000 nits (outdoor)", "Wsparcie 4K i HDR", "Szybki montaż/demontaż", "Flight case transport"]'::jsonb,
  technical_specs = '{"brightness": "1500-5000 nits", "refresh_rate": "3840Hz", "viewing_angle": "160°", "power": "300W/m²", "weight": "15kg/m²"}'::jsonb,
  seo_title = 'Wynajem Ekranów LED Indoor/Outdoor - MAVINCI',
  seo_description = 'Profesjonalne ekrany LED do wynajęcia: indoor 2-4mm, outdoor 4-10mm. Dowolne konfiguracje, wsparcie 4K. Warszawa, Gdańsk, Bydgoszcz.',
  seo_keywords = 'wynajem ekranów led, ekran led indoor, ekran led outdoor, ściana led, ekran konferencyjny'
WHERE name = 'Ekrany LED indoor i outdoor';

-- Ściany LED
UPDATE conferences_service_items
SET 
  hero_image_url = 'https://images.pexels.com/photos/2102568/pexels-photo-2102568.jpeg?auto=compress&cs=tinysrgb&w=1920',
  thumbnail_url = 'https://images.pexels.com/photos/2102568/pexels-photo-2102568.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop',
  long_description = 'Ściany LED premium do konferencji i gal. Duże formaty ekranów LED tworzące efektowne tło dla prezentacji, koncertów i eventów korporacyjnych. Możliwość realizacji ścian od 3x2m do 10x6m.',
  features = '["Formaty od 3x2m do 10x6m", "Pitch 2.9mm - 4mm", "Seamless - brak widocznych łączeń", "Curved configurations", "Obsługa 4K/8K content", "Profesjonalna kalibracja kolorów"]'::jsonb,
  technical_specs = '{"pitch": "2.9mm - 4mm", "brightness": "1500 nits", "refresh": "3840Hz", "cabinet_size": "500x500mm", "depth": "80mm"}'::jsonb,
  seo_title = 'Ściany LED do Konferencji i Gal - Wynajem | MAVINCI',
  seo_description = 'Duże ściany LED premium do eventów. Formaty od 3x2m do 10x6m, pitch 2.9-4mm, wsparcie 4K/8K. Warszawa, Gdańsk.',
  seo_keywords = 'ściana led konferencja, ściana led event, duży ekran led, tło led scena, led wall wynajem'
WHERE name = 'Ściany LED do konferencji i gal';

-- CODA N-Ray
UPDATE conferences_service_items
SET 
  hero_image_url = 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920',
  thumbnail_url = 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop',
  long_description = 'System nagłośnieniowy CODA Audio N-Ray - topowy line-array dla dużych konferencji, koncertów i eventów premium. Krystalicznie czysty dźwięk, ogromna moc i precyzyjne pokrycie akustyczne. Idealny dla sal od 500 do 5000 osób.',
  features = '["CODA Audio N-Ray line-array", "130dB SPL max", "Pokrycie do 5000 osób", "Precyzyjne targetowanie akustyczne", "Subwoofery SCV-F", "Konsola Yamaha CL5/Rivage", "Bezprzewodowe mikrofony Shure Axient"]'::jsonb,
  technical_specs = '{"type": "Line Array", "spl_max": "130dB", "frequency": "50Hz - 18kHz", "coverage": "90° x 10°", "amplifier": "Class D 2000W", "weight": "29kg"}'::jsonb,
  seo_title = 'Nagłośnienie CODA Audio N-Ray - Wynajem | MAVINCI',
  seo_description = 'Premium nagłośnienie CODA N-Ray line-array do wynajęcia. 130dB SPL, pokrycie do 5000 osób. Warszawa, Gdańsk, Bydgoszcz.',
  seo_keywords = 'coda audio, line array wynajem, nagłośnienie premium, nagłośnienie konferencja, system line array'
WHERE name = 'Systemy line-array CODA N-Ray';

-- Kamery 4K
UPDATE conferences_service_items
SET 
  hero_image_url = 'https://images.pexels.com/photos/66134/pexels-photo-66134.jpeg?auto=compress&cs=tinysrgb&w=1920',
  thumbnail_url = 'https://images.pexels.com/photos/66134/pexels-photo-66134.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop',
  long_description = 'Profesjonalne kamery 4K Blackmagic Design do realizacji eventów. Realizacja wielokamerowa z pełną reżyserką wideo, streaming i nagrywanie w najwyższej jakości. Doświadczeni operatorzy i kompletny setup z obiektywami.',
  features = '["Blackmagic URSA 4K/6K", "Obiektywy Canon/Sigma", "Doświadczeni operatorzy", "Stabilizatory i statywy fluid", "Wireless follow focus", "Monitoring wideo SDI"]'::jsonb,
  technical_specs = '{"resolution": "4K UHD (3840x2160)", "sensor": "Super 35", "fps": "24/25/30/50/60", "codec": "ProRes/RAW", "dynamic_range": "13 stops", "iso": "200-3200"}'::jsonb,
  seo_title = 'Kamery 4K Blackmagic - Realizacja Wideo | MAVINCI',
  seo_description = 'Wynajem kamer 4K Blackmagic z operatorami. Realizacja wielokamerowa, streaming, nagrania premium. Warszawa, Gdańsk.',
  seo_keywords = 'kamery 4k wynajem, blackmagic camera, realizacja wideo 4k, kamera event, nagrywanie konferencji'
WHERE name = 'Kamery 4K Blackmagic';

-- Streaming 4K
UPDATE conferences_service_items
SET 
  hero_image_url = 'https://images.pexels.com/photos/3184424/pexels-photo-3184424.jpeg?auto=compress&cs=tinysrgb&w=1920',
  thumbnail_url = 'https://images.pexels.com/photos/3184424/pexels-photo-3184424.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop',
  long_description = 'Profesjonalny streaming FullHD i 4K na żywo dla konferencji, webinarów i eventów hybrydowych. Transmisje na YouTube, Vimeo, Teams, Zoom z pełną reżyserką wideo, grafiką i przełączaniem źródeł. Stabilny stream bez opóźnień.',
  features = '["Streaming do 4K 60fps", "Multi-platform: YouTube, Vimeo, Teams, Zoom", "Reżyserka Blackmagic ATEM", "Grafika i lower thirds na żywo", "Backup stream (redundancja)", "Statystyki widzów realtime", "Nagrywanie backup"]'::jsonb,
  technical_specs = '{"resolution": "1080p / 4K", "bitrate": "6-25 Mbps", "latency": "<3s", "encoder": "Hardware H.264/HEVC", "bandwidth": "100Mbps uplink", "platforms": "wszystkie"}'::jsonb,
  seo_title = 'Streaming 4K Konferencji na Żywo - MAVINCI',
  seo_description = 'Profesjonalny streaming FullHD/4K: YouTube, Vimeo, Teams. Realizacja live, reżyserka wideo, backup. Warszawa, Gdańsk.',
  seo_keywords = 'streaming konferencji, streaming 4k, streaming youtube, transmisja online event, webinar streaming'
WHERE name = 'Streaming FullHD/4K';
