/*
  # Dodanie UNIQUE constraints i danych hero dla stron ofert

  1. Constraints
    - Dodanie UNIQUE(section) dla wszystkich tabel page_images
  
  2. Dane
    - Dodanie hero images dla wszystkich ofert
*/

-- Dodaj UNIQUE constraints
ALTER TABLE naglosnienie_page_images ADD CONSTRAINT naglosnienie_page_images_section_key UNIQUE (section);
ALTER TABLE kasyno_page_images ADD CONSTRAINT kasyno_page_images_section_key UNIQUE (section);
ALTER TABLE streaming_page_images ADD CONSTRAINT streaming_page_images_section_key UNIQUE (section);
ALTER TABLE "quizy-teleturnieje_page_images" ADD CONSTRAINT quizy_teleturnieje_page_images_section_key UNIQUE (section);
ALTER TABLE "symulatory-vr_page_images" ADD CONSTRAINT symulatory_vr_page_images_section_key UNIQUE (section);
ALTER TABLE "technika-sceniczna_page_images" ADD CONSTRAINT technika_sceniczna_page_images_section_key UNIQUE (section);
ALTER TABLE "wieczory-tematyczne_page_images" ADD CONSTRAINT wieczory_tematyczne_page_images_section_key UNIQUE (section);
ALTER TABLE integracje_page_images ADD CONSTRAINT integracje_page_images_section_key UNIQUE (section);

-- Nagłośnienie
INSERT INTO naglosnienie_page_images (
  id, section, name, title, description, label_text, label_icon,
  image_url, alt_text, opacity, white_words_count, is_active, order_index
) VALUES (
  gen_random_uuid(), 'hero', 'Nagłośnienie - Hero',
  'Nagłośnienie Eventów',
  'Dostarczamy profesjonalne systemy nagłośnieniowe najwyższej klasy. Nasz sprzęt i doświadczony zespół techniczny gwarantują krystalicznie czysty dźwięk na każdym evencie.',
  'Profesjonalne Nagłośnienie', 'Music',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Profesjonalne nagłośnienie eventowe', 0.2, 1, true, 1
) ON CONFLICT (section) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  label_text = EXCLUDED.label_text,
  label_icon = EXCLUDED.label_icon,
  updated_at = now();

-- Kasyno
INSERT INTO kasyno_page_images (
  id, section, name, title, description, label_text, label_icon,
  image_url, alt_text, opacity, white_words_count, is_active, order_index
) VALUES (
  gen_random_uuid(), 'hero', 'Kasyno - Hero',
  'Kasyno Eventowe',
  'Klimat prawdziwego kasyna, profesjonalni krupierzy i niezapomniana atmosfera gier w bezpiecznym środowisku eventowym bez hazardu.',
  'Wieczory w Kasynie', 'Dices',
  'https://images.pexels.com/photos/262508/pexels-photo-262508.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Kasyno eventowe z profesjonalnymi stołami', 0.2, 1, true, 1
) ON CONFLICT (section) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  label_text = EXCLUDED.label_text,
  label_icon = EXCLUDED.label_icon,
  updated_at = now();

-- Streaming
INSERT INTO streaming_page_images (
  id, section, name, title, description, label_text, label_icon,
  image_url, alt_text, opacity, white_words_count, is_active, order_index
) VALUES (
  gen_random_uuid(), 'hero', 'Streaming - Hero',
  'Streaming Eventów',
  'Realizujemy profesjonalne transmisje online Twoich wydarzeń. Dotrzyjmy razem do szerszej publiczności dzięki wysokiej jakości streamingowi na żywo.',
  'Transmisje Online', 'Video',
  'https://images.pexels.com/photos/3184360/pexels-photo-3184360.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Profesjonalny streaming eventów', 0.2, 1, true, 1
) ON CONFLICT (section) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  label_text = EXCLUDED.label_text,
  label_icon = EXCLUDED.label_icon,
  updated_at = now();

-- Quizy
INSERT INTO "quizy-teleturnieje_page_images" (
  id, section, name, title, description, label_text, label_icon,
  image_url, alt_text, opacity, white_words_count, is_active, order_index
) VALUES (
  gen_random_uuid(), 'hero', 'Quizy - Hero',
  'Quizy i Teleturnieje',
  'Organizujemy interaktywne quizy i teleturnieje, które integrują zespoły i dostarczają niezapomnianych wrażeń. Profesjonalna realizacja z pełnym zapleczem technicznym.',
  'Interaktywna Rozrywka', 'Gamepad2',
  'https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Interaktywne quizy i teleturnieje', 0.2, 2, true, 1
) ON CONFLICT (section) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  label_text = EXCLUDED.label_text,
  label_icon = EXCLUDED.label_icon,
  updated_at = now();

-- Symulatory VR
INSERT INTO "symulatory-vr_page_images" (
  id, section, name, title, description, label_text, label_icon,
  image_url, alt_text, opacity, white_words_count, is_active, order_index
) VALUES (
  gen_random_uuid(), 'hero', 'VR - Hero',
  'Symulatory i VR',
  'Oferujemy profesjonalne symulatory wyścigowe, lotnicze oraz gogle VR najnowszej generacji. Zapewniamy niezapomniane wrażenia i emocje na Twoim evencie.',
  'Nowoczesne Technologie', 'Glasses',
  'https://images.pexels.com/photos/2007647/pexels-photo-2007647.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Symulatory VR i racing', 0.2, 2, true, 1
) ON CONFLICT (section) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  label_text = EXCLUDED.label_text,
  label_icon = EXCLUDED.label_icon,
  updated_at = now();

-- Technika Sceniczna
INSERT INTO "technika-sceniczna_page_images" (
  id, section, name, title, description, label_text, label_icon,
  image_url, alt_text, opacity, white_words_count, is_active, order_index
) VALUES (
  gen_random_uuid(), 'hero', 'Technika - Hero',
  'Technika Sceniczna',
  'Dostarczamy kompletną technikę sceniczną - od oświetlenia po systemy audio. Nasz profesjonalny sprzęt i doświadczony zespół techniczny zapewnią sukces Twojego eventu.',
  'Profesjonalny Sprzęt', 'Lightbulb',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Profesjonalna technika sceniczna', 0.2, 1, true, 1
) ON CONFLICT (section) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  label_text = EXCLUDED.label_text,
  label_icon = EXCLUDED.label_icon,
  updated_at = now();

-- Wieczory Tematyczne
INSERT INTO "wieczory-tematyczne_page_images" (
  id, section, name, title, description, label_text, label_icon,
  image_url, alt_text, opacity, white_words_count, is_active, order_index
) VALUES (
  gen_random_uuid(), 'hero', 'Wieczory - Hero',
  'Wieczory Tematyczne',
  'Tworzymy niezapomniane wieczory tematyczne z pełną scenografią i oprawą. Gatsby, Las Vegas, Hollywood - przenieś swoich gości do innej epoki lub świata.',
  'Stylizowane Eventy', 'Wine',
  'https://images.pexels.com/photos/1679618/pexels-photo-1679618.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Stylizowane wieczory tematyczne', 0.2, 1, true, 1
) ON CONFLICT (section) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  label_text = EXCLUDED.label_text,
  label_icon = EXCLUDED.label_icon,
  updated_at = now();

-- Integracje
INSERT INTO integracje_page_images (
  id, section, name, title, description, label_text, label_icon,
  image_url, alt_text, opacity, white_words_count, is_active, order_index
) VALUES (
  gen_random_uuid(), 'hero', 'Integracje - Hero',
  'Integracje Firmowe',
  'Organizujemy imprezy integracyjne, które budują więzi w zespole i tworzą wspaniałą atmosferę. Pikniki, zabawy i wydarzenia okolicznościowe z pełną obsługą.',
  'Imprezy Firmowe', 'PartyPopper',
  'https://images.pexels.com/photos/1395967/pexels-photo-1395967.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'Imprezy integracyjne dla firm', 0.2, 1, true, 1
) ON CONFLICT (section) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  label_text = EXCLUDED.label_text,
  label_icon = EXCLUDED.label_icon,
  updated_at = now();
