/*
  # Sekcja Usług dla Konferencji - Kompletny System

  1. New Tables
    - `conferences_service_categories` - kategorie usług (Ekrany, Audio, Oświetlenie, etc.)
    - `conferences_service_items` - szczegółowe usługi w każdej kategorii
  
  2. Security
    - Enable RLS
    - Public read access
    - Admin write access
*/

-- Create service categories table
CREATE TABLE IF NOT EXISTS conferences_service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  icon text NOT NULL,
  description text,
  display_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create service items table
CREATE TABLE IF NOT EXISTS conferences_service_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES conferences_service_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  icon text,
  is_premium boolean DEFAULT false,
  display_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE conferences_service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferences_service_items ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "Anyone can read active service categories"
  ON conferences_service_categories FOR SELECT
  USING (is_active = true);

CREATE POLICY "Anyone can read active service items"
  ON conferences_service_items FOR SELECT
  USING (is_active = true);

-- Create indexes
CREATE INDEX idx_service_categories_order ON conferences_service_categories(display_order);
CREATE INDEX idx_service_items_category ON conferences_service_items(category_id);
CREATE INDEX idx_service_items_order ON conferences_service_items(display_order);

-- Insert categories
INSERT INTO conferences_service_categories (name, slug, icon, description, display_order) VALUES
('Ekrany i Wizualizacje', 'ekrany-wizualizacje', 'Monitor', 'Ekrany LED, projekcje, promptery i systemy wizualizacji dla konferencji i gal', 1),
('Nagłośnienie i Audio', 'naglosnienie-audio', 'Mic', 'Systemy nagłośnieniowe premium, mikrofony i realizacja dźwięku', 2),
('Oświetlenie', 'oswietlenie', 'Lightbulb', 'Oświetlenie konferencyjne, sceniczne i dekoracyjne z pełnym sterowaniem DMX', 3),
('Scena i Konstrukcje', 'scena-konstrukcje', 'Package', 'Podesty sceniczne, konstrukcje kratowe i elementy wystawiennicze', 4),
('Kamery i Produkcja Wideo', 'kamery-produkcja', 'Camera', 'Realizacja wielokamerowa 4K, reżyserka wideo, nagrania i montaże', 5),
('Streaming i Transmisje', 'streaming-transmisje', 'Wifi', 'Profesjonalny streaming FullHD/4K na platformy online i telemosy', 6),
('Interakcje i Quizy', 'interakcje-quizy', 'Play', 'QuizXpress, Familiada, głosowania i systemy interakcji z publicznością', 7),
('Rozrywka i Oprawa', 'rozrywka-oprawa', 'Music', 'DJ-e, performerzy, konferansjerzy i oprawa artystyczna eventów', 8),
('Foto i Video Atrakcje', 'foto-atrakcje', 'Camera', 'Fotolustro, fotobudka AI, branding i atrakcje fotograficzne', 9),
('Multimedia i Prezentacje', 'multimedia-prezentacje', 'FileText', 'Obsługa prezentacji, operowanie slajdami i przygotowanie materiałów', 10),
('Koordynacja i Realizacja', 'koordynacja-realizacja', 'Settings', 'Stage manager, doradztwo techniczne, projekty 3D i kompleksowa obsługa', 11),
('Innowacje i Efekty', 'innowacje-efekty', 'Award', 'Hologramy, mapping 3D, ekrany transparentne i najnowsze technologie eventowe', 12);

-- Insert service items for each category
-- Ekrany i Wizualizacje
INSERT INTO conferences_service_items (category_id, name, description, display_order) 
SELECT id, 'Ekrany LED indoor i outdoor', 'Różne rozdzielczości i konfiguracje - od 2mm do 10mm pitch', 1
FROM conferences_service_categories WHERE slug = 'ekrany-wizualizacje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Ściany LED do konferencji i gal', 'Duże formaty LED do prezentacji i eventów premium', 2
FROM conferences_service_categories WHERE slug = 'ekrany-wizualizacje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Telewizory 65" i większe', 'Monitory wysokiej rozdzielczości do prezentacji i digital signage', 3
FROM conferences_service_categories WHERE slug = 'ekrany-wizualizacje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Ekrany do tylnego rzutu', 'Projekcje fast-fold i rear projection dla profesjonalnych wydarzeń', 4
FROM conferences_service_categories WHERE slug = 'ekrany-wizualizacje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Promptery i Comfort Monitory', 'Ekrany dla prelegentów, promptery prezentacji i zwrotne monitory', 5
FROM conferences_service_categories WHERE slug = 'ekrany-wizualizacje';

-- Nagłośnienie i Audio
INSERT INTO conferences_service_items (category_id, name, description, is_premium, display_order)
SELECT id, 'Systemy line-array CODA N-Ray', 'Premium nagłośnienie dla dużych konferencji i eventów', true, 1
FROM conferences_service_categories WHERE slug = 'naglosnienie-audio';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Systemy point-source', 'Nagłośnienie dla małych i średnich konferencji', 2
FROM conferences_service_categories WHERE slug = 'naglosnienie-audio';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Monitory sceniczne', 'Odsłuchy dla prelegentów i wykonawców', 3
FROM conferences_service_categories WHERE slug = 'naglosnienie-audio';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Miksery audio Yamaha i Allen&Heath', 'Profesjonalne konsole cyfrowe z pełną kontrolą DSP', 4
FROM conferences_service_categories WHERE slug = 'naglosnienie-audio';

INSERT INTO conferences_service_items (category_id, name, description, is_premium, display_order)
SELECT id, 'Mikrofony Shure Axient Digital', 'Wieloczęstotliwościowe mikrofony premium - doręczne, nagłowne, krawatowe', true, 5
FROM conferences_service_categories WHERE slug = 'naglosnienie-audio';

-- Oświetlenie
INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Oświetlenie konferencyjne (face light)', 'Profesjonalne oświetlenie dla prelegentów i prezenterów', 1
FROM conferences_service_categories WHERE slug = 'oswietlenie';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Oświetlenie teatralne i sceniczne', 'Reflektory LED z pełnym spektrum barw', 2
FROM conferences_service_categories WHERE slug = 'oswietlenie';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Oświetlenie dekoracyjne i architektoniczne', 'Podświetlenie ścian, kolumn i elementów architektonicznych', 3
FROM conferences_service_categories WHERE slug = 'oswietlenie';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Oświetlenie gal i ceremonii', 'Eleganckie oświetlenie dla wydarzeń premium', 4
FROM conferences_service_categories WHERE slug = 'oswietlenie';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Sterowanie DMX i realizacja', 'Pełna kontrola oświetlenia, programowanie pokazów', 5
FROM conferences_service_categories WHERE slug = 'oswietlenie';

-- Scena i Konstrukcje
INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Podesty sceniczne i sceny modułowe', 'Sceny od 2x3m do dużych konstrukcji scenicznych', 1
FROM conferences_service_categories WHERE slug = 'scena-konstrukcje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Konstrukcje kratowe (truss)', 'Ground support i systemy kratowe pod LED, audio, oświetlenie', 2
FROM conferences_service_categories WHERE slug = 'scena-konstrukcje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Bramy wejściowe i konstrukcje LED', 'Konstrukcje brandingowe i pod zawieszenie ekranów', 3
FROM conferences_service_categories WHERE slug = 'scena-konstrukcje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Blackbox i kurtyny eventowe', 'Systemy zaciemniające i separujące przestrzeń', 4
FROM conferences_service_categories WHERE slug = 'scena-konstrukcje';

-- Kamery i Produkcja Wideo
INSERT INTO conferences_service_items (category_id, name, description, is_premium, display_order)
SELECT id, 'Kamery 4K Blackmagic', 'Profesjonalne kamery do realizacji eventów', true, 1
FROM conferences_service_categories WHERE slug = 'kamery-produkcja';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Realizacja wielokamerowa', 'Od 2 do 6 kamer z pełną reżyserką', 2
FROM conferences_service_categories WHERE slug = 'kamery-produkcja';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Operatorzy kamer', 'Doświadczeni operatorzy z własnym sprzętem', 3
FROM conferences_service_categories WHERE slug = 'kamery-produkcja';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'PIP (obraz w obrazie)', 'Prezentacja + prelegent w jednym kadrze', 4
FROM conferences_service_categories WHERE slug = 'kamery-produkcja';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Reżyserka wideo ATEM', 'Profesjonalne miksy wideo Blackmagic Design', 5
FROM conferences_service_categories WHERE slug = 'kamery-produkcja';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Nagrania, montaże, realizacja hybrydowa', 'Kompleksowa produkcja wideo dla eventów', 6
FROM conferences_service_categories WHERE slug = 'kamery-produkcja';

-- Streaming i Transmisje
INSERT INTO conferences_service_items (category_id, name, description, is_premium, display_order)
SELECT id, 'Streaming FullHD/4K', 'Transmisje online najwyższej jakości', true, 1
FROM conferences_service_categories WHERE slug = 'streaming-transmisje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'YouTube, Vimeo, Teams, Zoom', 'Streaming na wszystkie popularne platformy', 2
FROM conferences_service_categories WHERE slug = 'streaming-transmisje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Eventy zamknięte z hasłem', 'Bezpieczne transmisje dla firm i instytucji', 3
FROM conferences_service_categories WHERE slug = 'streaming-transmisje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Nagrywanie konferencji i gal', 'Archiwizacja eventów w najwyższej jakości', 4
FROM conferences_service_categories WHERE slug = 'streaming-transmisje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Studio live i telemosy', 'Łączenia online z prezenterami i gośćmi zdalnymi', 5
FROM conferences_service_categories WHERE slug = 'streaming-transmisje';

-- Interakcje i Quizy
INSERT INTO conferences_service_items (category_id, name, description, is_premium, display_order)
SELECT id, 'QuizXpress - profesjonalne teleturnieje', 'System quizowy używany w TVP i eventach korporacyjnych', true, 1
FROM conferences_service_categories WHERE slug = 'interakcje-quizy';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Familiada - quiz sceniczny', 'Teleturniej z pulpitami i pełną oprawą sceniczną', 2
FROM conferences_service_categories WHERE slug = 'interakcje-quizy';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Piloty QOMO QRF300', 'Głosowania, feedbacki i interakcja z publicznością', 3
FROM conferences_service_categories WHERE slug = 'interakcje-quizy';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Integracje eventowe', 'Gry i konkursy z udziałem uczestników', 4
FROM conferences_service_categories WHERE slug = 'interakcje-quizy';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Systemy losowań', 'Elektroniczne losowania nagród i uczestników', 5
FROM conferences_service_categories WHERE slug = 'interakcje-quizy';

-- Rozrywka i Oprawa
INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'DJ-e eventowi i klubowi', 'Profesjonalni DJ-e z własnym sprzętem', 1
FROM conferences_service_categories WHERE slug = 'rozrywka-oprawa';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Oprawa muzyczna eventów', 'Setlisty dopasowane do charakteru wydarzenia', 2
FROM conferences_service_categories WHERE slug = 'rozrywka-oprawa';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Tancerki i performerzy', 'Profesjonalne pokazy taneczne i artystyczne', 3
FROM conferences_service_categories WHERE slug = 'rozrywka-oprawa';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Konferansjerzy i prowadzący', 'Doświadczeni prezenterzy eventowi', 4
FROM conferences_service_categories WHERE slug = 'rozrywka-oprawa';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Oprawa gal i ceremonii', 'Elegancka oprawa uroczystości i wydarzeń premium', 5
FROM conferences_service_categories WHERE slug = 'rozrywka-oprawa';

-- Foto i Video Atrakcje
INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Fotolustro interaktywne', 'Automatyczne foto z natychmiastowymi wydrukami', 1
FROM conferences_service_categories WHERE slug = 'foto-atrakcje';

INSERT INTO conferences_service_items (category_id, name, description, is_premium, display_order)
SELECT id, 'Fotobudka AI', 'Automatyczne generowanie stylów i filtrów AI', true, 2
FROM conferences_service_categories WHERE slug = 'foto-atrakcje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Branding pod event', 'Personalizowane szablony z logo firmy', 3
FROM conferences_service_categories WHERE slug = 'foto-atrakcje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Wydruki foto', 'Natychmiastowe wydruki 10x15 i 15x20', 4
FROM conferences_service_categories WHERE slug = 'foto-atrakcje';

INSERT INTO conferences_service_items (category_id, name, description, is_premium, display_order)
SELECT id, 'AI generator live-photo', 'Zdjęcia z AI w czasie rzeczywistym', true, 5
FROM conferences_service_categories WHERE slug = 'foto-atrakcje';

-- Multimedia i Prezentacje
INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Obsługa prezentacji PowerPoint/Keynote', 'Profesjonalne operowanie slajdami', 1
FROM conferences_service_categories WHERE slug = 'multimedia-prezentacje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Operowanie materiałami wideo', 'Odtwarzanie filmów i animacji', 2
FROM conferences_service_categories WHERE slug = 'multimedia-prezentacje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Przygotowanie multimediów', 'Pre-check i optymalizacja materiałów', 3
FROM conferences_service_categories WHERE slug = 'multimedia-prezentacje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Clickery Logitech Spotlight', 'Profesjonalne sterowanie prezentacjami', 4
FROM conferences_service_categories WHERE slug = 'multimedia-prezentacje';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Pre-check techniczny prelegentów', 'Sprawdzenie sprzętu przed wystąpieniem', 5
FROM conferences_service_categories WHERE slug = 'multimedia-prezentacje';

-- Koordynacja i Realizacja
INSERT INTO conferences_service_items (category_id, name, description, is_premium, display_order)
SELECT id, 'Kierownik techniczny (stage manager)', 'Koordynacja całości od strony technicznej', true, 1
FROM conferences_service_categories WHERE slug = 'koordynacja-realizacja';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Kompleksowa obsługa techniczna', 'Pełen zespół realizatorów i techników', 2
FROM conferences_service_categories WHERE slug = 'koordynacja-realizacja';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Montaż, demontaż, transport', 'Logistyka i obsługa sprzętu', 3
FROM conferences_service_categories WHERE slug = 'koordynacja-realizacja';

INSERT INTO conferences_service_items (category_id, name, description, is_premium, display_order)
SELECT id, 'Projekty techniczne i wizualizacje 3D', 'Planowanie rozmieszczenia sprzętu i scenografii', true, 4
FROM conferences_service_categories WHERE slug = 'koordynacja-realizacja';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Doradztwo techniczne', 'Konsultacje dla hoteli, firm i instytucji', 5
FROM conferences_service_categories WHERE slug = 'koordynacja-realizacja';

-- Innowacje i Efekty
INSERT INTO conferences_service_items (category_id, name, description, is_premium, display_order)
SELECT id, 'Hologramy i hologram-fan', 'Efekty holograficzne 3D dla wow-efektu', true, 1
FROM conferences_service_categories WHERE slug = 'innowacje-efekty';

INSERT INTO conferences_service_items (category_id, name, description, is_premium, display_order)
SELECT id, 'Mapping 3D na scenę lub LED', 'Projekcje space-mapped dostosowane do scenografii', true, 2
FROM conferences_service_categories WHERE slug = 'innowacje-efekty';

INSERT INTO conferences_service_items (category_id, name, description, is_premium, display_order)
SELECT id, 'Ekrany transparentne i siatki projekcyjne', 'Nowoczesne rozwiązania wystawiennicze', true, 3
FROM conferences_service_categories WHERE slug = 'innowacje-efekty';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Systemy rejestracji uczestników', 'Check-in elektroniczny i badging', 4
FROM conferences_service_categories WHERE slug = 'innowacje-efekty';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Branding LED i scenografia', 'Scenografie z logo i brandingiem klienta', 5
FROM conferences_service_categories WHERE slug = 'innowacje-efekty';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Ściany multimedialne interaktywne', 'Touchscreeny i interaktywne instalacje', 6
FROM conferences_service_categories WHERE slug = 'innowacje-efekty';

INSERT INTO conferences_service_items (category_id, name, description, display_order)
SELECT id, 'Efekty specjalne (dym, haze, sparkular)', 'Efekty wizualne dla eventów premium', 7
FROM conferences_service_categories WHERE slug = 'innowacje-efekty';
