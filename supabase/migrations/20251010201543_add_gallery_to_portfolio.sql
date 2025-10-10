/*
  # Dodanie galerii do projektów portfolio

  ## Zmiany
  
  1. Dodanie kolumny `gallery` do tabeli `portfolio_projects`
     - Przechowuje tablicę zdjęć w formacie JSONB
     - Każde zdjęcie ma src, alt, i metadata pozycji
     - Umożliwia prezentację relacji z wydarzeń
  
  2. Dodanie kolumny `hero_image_section`
     - Identyfikator sekcji dla EditableImageSection
     - Pozwala na edycję hero image każdego projektu
  
  3. Dodanie kolumny `location`
     - Lokalizacja wydarzenia (miasto/region)
  
  4. Dodanie kolumny `event_date`
     - Data realizacji wydarzenia
*/

-- Dodaj nowe kolumny do portfolio_projects
ALTER TABLE portfolio_projects 
ADD COLUMN IF NOT EXISTS gallery JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS hero_image_section TEXT,
ADD COLUMN IF NOT EXISTS location TEXT DEFAULT 'Polska',
ADD COLUMN IF NOT EXISTS event_date DATE DEFAULT CURRENT_DATE;

-- Dodaj indeks na gallery dla szybszego dostępu
CREATE INDEX IF NOT EXISTS idx_portfolio_projects_gallery 
ON portfolio_projects USING gin(gallery);

-- Dodaj komentarze dokumentujące strukturę
COMMENT ON COLUMN portfolio_projects.gallery IS 
'Galeria zdjęć z wydarzenia w formacie: [{"src": "url", "alt": "opis", "image_metadata": {...}}]';

COMMENT ON COLUMN portfolio_projects.hero_image_section IS 
'Identyfikator sekcji dla EditableImageSection do edycji hero image';

COMMENT ON COLUMN portfolio_projects.location IS 
'Lokalizacja wydarzenia (miasto, region)';

COMMENT ON COLUMN portfolio_projects.event_date IS 
'Data realizacji wydarzenia';
