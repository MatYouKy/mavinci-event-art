/*
  # Tabela substytucji sprzętu w ofertach

  1. Nowa tabela
    - `offer_equipment_substitutions` - przechowuje wybrane alternatywy sprzętu
    - `offer_id` - ID oferty
    - `from_item_id` - ID oryginalnego sprzętu (z konfliktem)
    - `to_item_id` - ID wybranej alternatywy
    - `qty` - ilość zamienionego sprzętu

  2. Bezpieczeństwo
    - Włączone RLS
    - Polityki dla authenticated użytkowników
*/

-- Tabela substytucji sprzętu
CREATE TABLE IF NOT EXISTS offer_equipment_substitutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  from_item_id uuid NOT NULL,
  to_item_id uuid NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT offer_equipment_substitutions_from_item_fkey
    FOREIGN KEY (from_item_id) REFERENCES equipment_items(id) ON DELETE CASCADE,
  CONSTRAINT offer_equipment_substitutions_to_item_fkey
    FOREIGN KEY (to_item_id) REFERENCES equipment_items(id) ON DELETE CASCADE
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_offer_equipment_substitutions_offer_id
  ON offer_equipment_substitutions(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_equipment_substitutions_from_item
  ON offer_equipment_substitutions(from_item_id);
CREATE INDEX IF NOT EXISTS idx_offer_equipment_substitutions_to_item
  ON offer_equipment_substitutions(to_item_id);

-- RLS
ALTER TABLE offer_equipment_substitutions ENABLE ROW LEVEL SECURITY;

-- Polityki RLS
CREATE POLICY "Allow authenticated users to view substitutions"
  ON offer_equipment_substitutions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert substitutions"
  ON offer_equipment_substitutions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update substitutions"
  ON offer_equipment_substitutions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete substitutions"
  ON offer_equipment_substitutions FOR DELETE
  TO authenticated
  USING (true);

-- Service role bypass
CREATE POLICY "Allow service_role full access to substitutions"
  ON offer_equipment_substitutions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE offer_equipment_substitutions IS
'Przechowuje wybrane alternatywy sprzętu przy rozwiązywaniu konfliktów dostępności w ofertach';
