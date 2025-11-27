/*
  # Add related services selection for conferences page

  1. New Table
    - `conferences_related_services` - Junction table for selected service items
      - `id` (uuid, primary key)
      - `service_item_id` (uuid, references conferences_service_items)
      - `display_order` (integer)
      - `is_active` (boolean)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS
    - Public can read active items
    - Admins can manage
*/

CREATE TABLE IF NOT EXISTS conferences_related_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_item_id uuid NOT NULL REFERENCES conferences_service_items(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_item_id)
);

ALTER TABLE conferences_related_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active related services"
  ON conferences_related_services
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage related services"
  ON conferences_related_services
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    )
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE conferences_related_services;
