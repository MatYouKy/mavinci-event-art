# Instrukcja - Ręczna Migracja Bazy Danych

## Problem
Tabela `site_images` nie ma kolumn `opacity` i `image_metadata`, które są wymagane do działania PageHeroImage.

## Rozwiązanie
Wykonaj poniższy SQL w Supabase Dashboard (SQL Editor):

### Krok 1: Otwórz Supabase Dashboard
1. Przejdź do: https://gyouisoyfbslsmbhkjhf.supabase.co
2. Zaloguj się
3. Wybierz projekt
4. Przejdź do zakładki **SQL Editor** w menu po lewej

### Krok 2: Wykonaj SQL

Skopiuj i wklej poniższy kod SQL, a następnie kliknij **Run**:

```sql
-- Add image_metadata column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'site_images' AND column_name = 'image_metadata'
  ) THEN
    ALTER TABLE site_images ADD COLUMN image_metadata jsonb DEFAULT '{
      "desktop": {
        "position": {"posX": 0, "posY": 0, "scale": 1},
        "objectFit": "cover"
      },
      "mobile": {
        "position": {"posX": 0, "posY": 0, "scale": 1},
        "objectFit": "cover"
      }
    }'::jsonb;
  END IF;
END $$;

-- Add opacity column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'site_images' AND column_name = 'opacity'
  ) THEN
    ALTER TABLE site_images ADD COLUMN opacity numeric(3,2) DEFAULT 0.20 CHECK (opacity >= 0 AND opacity <= 1);
  END IF;
END $$;
```

### Krok 3: Sprawdź wynik
Po wykonaniu SQL, powinieneś zobaczyć komunikat "Success. No rows returned".

### Krok 4: Zweryfikuj
Wykonaj następujące zapytanie, aby sprawdzić czy kolumny zostały dodane:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'site_images'
ORDER BY ordinal_position;
```

Powinieneś zobaczyć w wynikach:
- `image_metadata` (jsonb)
- `opacity` (numeric)

### Krok 5: Gotowe!
Po zastosowaniu migracji, aplikacja będzie mogła zapisywać:
- Pozycję obrazu (posX, posY, scale)
- Przezroczystość obrazu (opacity)

Teraz wgrywanie zdjęć i zapisywanie ustawień powinno działać poprawnie.
