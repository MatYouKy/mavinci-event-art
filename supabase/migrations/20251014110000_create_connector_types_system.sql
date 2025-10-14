/*
  # System typów wtyków (connector types)

  ## Opis
  System zarządzania typami wtyków używanych w przewodach audio/wideo.
  Umożliwia tworzenie bazy wtyków z opisami i zastosowaniami.

  ## Nowe tabele

  1. `connector_types` - Typy wtyków
     - `id` (uuid, primary key)
     - `name` (text, unique) - nazwa wtyczki (np. "XLR Male")
     - `description` (text) - opis wtyczki
     - `common_uses` (text) - typowe zastosowania
     - `is_active` (boolean) - czy typ jest aktywny
     - `created_at` (timestamptz)
     - `updated_at` (timestamptz)

  ## Zabezpieczenia
  - RLS włączony
  - Wszyscy mogą czytać aktywne typy
  - Tylko zalogowani mogą dodawać/edytować

  ## Przykładowe dane
  - XLR Male/Female (mikrofony, wzmacniacze)
  - Jack 6.3mm (instrumenty, sprzęt audio)
  - RCA (sprzęt audio/video)
  - Speakon (głośniki)
*/

-- Tworzenie tabeli connector_types
CREATE TABLE IF NOT EXISTS connector_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  common_uses text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE connector_types ENABLE ROW LEVEL SECURITY;

-- Polityki RLS - wszyscy mogą czytać aktywne typy
CREATE POLICY "Anyone can view active connector types"
  ON connector_types
  FOR SELECT
  USING (is_active = true);

-- Zalogowani mogą dodawać typy wtyków
CREATE POLICY "Authenticated users can insert connector types"
  ON connector_types
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Zalogowani mogą aktualizować typy wtyków
CREATE POLICY "Authenticated users can update connector types"
  ON connector_types
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Zalogowani mogą usuwać typy wtyków
CREATE POLICY "Authenticated users can delete connector types"
  ON connector_types
  FOR DELETE
  TO authenticated
  USING (true);

-- Trigger dla updated_at
CREATE OR REPLACE FUNCTION update_connector_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_connector_types_updated_at
  BEFORE UPDATE ON connector_types
  FOR EACH ROW
  EXECUTE FUNCTION update_connector_types_updated_at();

-- Przykładowe dane - najpopularniejsze typy wtyków
INSERT INTO connector_types (name, description, common_uses) VALUES
  ('XLR Male', 'Wtyk XLR męski, 3-pinowy', 'Mikrofony, sygnały audio balanced, DMX'),
  ('XLR Female', 'Wtyk XLR żeński, 3-pinowy', 'Wejścia mikrofonowe, mikser audio, DMX'),
  ('Jack 6.3mm TRS', 'Jack stereo 6.3mm (Tip-Ring-Sleeve)', 'Słuchawki studyjne, instrumenty klawiszowe, balanced audio'),
  ('Jack 6.3mm TS', 'Jack mono 6.3mm (Tip-Sleeve)', 'Gitary elektryczne, basy, unbalanced audio'),
  ('Jack 3.5mm TRS', 'Mini jack stereo 3.5mm', 'Słuchawki, urządzenia mobilne, komputery'),
  ('RCA', 'Wtyk RCA (Cinch)', 'Sprzęt audio/video hi-fi, gramofony, odtwarzacze CD'),
  ('Speakon NL2', 'Wtyk głośnikowy Speakon 2-polowy', 'Podłączenie głośników pasywnych (niskotonowe)'),
  ('Speakon NL4', 'Wtyk głośnikowy Speakon 4-polowy', 'Podłączenie głośników pasywnych (bi-amping)'),
  ('powerCON', 'Wtyk zasilający powerCON', 'Zasilanie sprzętu scenicznego (do 20A)'),
  ('BNC', 'Wtyk BNC (Bayonet Neill-Concelman)', 'Video SDI, wordclock, timecode'),
  ('USB-A', 'Wtyk USB Type-A', 'Interfejsy audio, kontrolery MIDI, komputery'),
  ('USB-B', 'Wtyk USB Type-B', 'Interfejsy audio, drukarki, urządzenia peryferyjne'),
  ('HDMI', 'Wtyk HDMI', 'Przesył sygnału video/audio cyfrowego HD/4K'),
  ('Ethercon', 'Wtyk Ethercon (RJ45 w obudowie XLR)', 'Sieci audio Dante, AES67, AVB'),
  ('Banana', 'Wtyk bananowy', 'Podłączenie głośników hi-fi, testy elektryczne')
ON CONFLICT (name) DO NOTHING;

-- Indeks dla szybszego wyszukiwania po nazwie
CREATE INDEX IF NOT EXISTS idx_connector_types_name ON connector_types (name);
CREATE INDEX IF NOT EXISTS idx_connector_types_active ON connector_types (is_active);
