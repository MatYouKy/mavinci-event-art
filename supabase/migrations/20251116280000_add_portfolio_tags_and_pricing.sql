/*
  # Add portfolio tags and replace packages with pricing

  1. Changes
    - Update portfolio_projects with example tags
    - Create conferences_pricing table for pricing tiers
    - Sample data for pricing

  2. Data
    - Add tags to existing portfolio items: ['konferencje', 'eventy', 'gale', etc.]
    - Create pricing tiers instead of packages
*/

-- Add example tags to portfolio projects
UPDATE portfolio_projects
SET tags = ARRAY['konferencje', 'eventy', 'audio-video']
WHERE tags IS NULL OR array_length(tags, 1) IS NULL;

-- Create pricing table
CREATE TABLE IF NOT EXISTS conferences_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_name text NOT NULL,
  description text,
  base_price text NOT NULL,
  price_range text,
  attendee_count text,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  icon_name text DEFAULT 'Package',
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE conferences_pricing ENABLE ROW LEVEL SECURITY;

-- Pricing policies
CREATE POLICY "Anyone can view active pricing"
  ON conferences_pricing
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Anyone can insert pricing"
  ON conferences_pricing
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update pricing"
  ON conferences_pricing
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete pricing"
  ON conferences_pricing
  FOR DELETE
  USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE conferences_pricing;

-- Insert sample pricing data
INSERT INTO conferences_pricing (
  tier_name, description, base_price, price_range, attendee_count, features, display_order
) VALUES
  (
    'Konferencje małe',
    'Idealne dla warsztatów, szkoleń i spotkań biznesowych',
    '2500 zł',
    '2500 - 4000 zł',
    'do 50 osób',
    '{
      "included": [
        "Podstawowe nagłośnienie",
        "Mikrofony bezprzewodowe (2 szt.)",
        "Projektor Full HD",
        "Ekran projekcyjny",
        "Realizator na miejscu"
      ]
    }'::jsonb,
    1
  ),
  (
    'Konferencje średnie',
    'Dla konferencji, seminariów i eventów firmowych',
    '5500 zł',
    '5500 - 9000 zł',
    '50 - 150 osób',
    '{
      "included": [
        "Profesjonalne nagłośnienie",
        "Mikrofony bezprzewodowe (4 szt.)",
        "Projektor 4K",
        "Kamera Full HD + transmisja",
        "Oświetlenie LED",
        "Ekipa 2 osoby"
      ]
    }'::jsonb,
    2
  ),
  (
    'Konferencje duże',
    'Dla dużych konferencji, kongresów i gal',
    '12000 zł',
    '12000 - 25000 zł',
    '150+ osób',
    '{
      "included": [
        "System line array",
        "Mikrofony (8+ szt.)",
        "Ekran LED modułowy",
        "Rejestracja multi-kamerowa 4K",
        "Inteligentne oświetlenie",
        "Tłumaczenia symultaniczne",
        "Ekipa 4+ osób",
        "Backup sprzętowy"
      ]
    }'::jsonb,
    3
  );

-- Update trigger
CREATE TRIGGER update_conferences_pricing_updated_at
  BEFORE UPDATE ON conferences_pricing
  FOR EACH ROW
  EXECUTE FUNCTION update_conferences_updated_at();
