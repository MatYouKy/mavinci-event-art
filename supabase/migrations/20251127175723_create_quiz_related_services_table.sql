/*
  # Create quiz related services table

  ## Description
  Creates a table to store related services that are commonly chosen by organizers
  for quiz and game show events. This enables the quiz page to display popular
  service combinations.

  ## Changes
  1. New Tables
    - `quiz_related_services`
      - `id` (uuid, primary key)
      - `service_item_id` (uuid, foreign key to conferences_service_items)
      - `display_order` (integer)
      - `is_active` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `quiz_related_services` table
    - Add policy for public SELECT access
    - Add policy for admin INSERT/UPDATE/DELETE access

  3. Indexes
    - Index on service_item_id for faster lookups
    - Index on display_order for sorting
*/

-- Create quiz_related_services table
CREATE TABLE IF NOT EXISTS quiz_related_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_item_id uuid NOT NULL REFERENCES conferences_service_items(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE quiz_related_services ENABLE ROW LEVEL SECURITY;

-- Public can view active related services
CREATE POLICY "Anyone can view active quiz related services"
  ON quiz_related_services
  FOR SELECT
  USING (is_active = true);

-- Admins can manage all related services
CREATE POLICY "Admins can insert quiz related services"
  ON quiz_related_services
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Admins can update quiz related services"
  ON quiz_related_services
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Admins can delete quiz related services"
  ON quiz_related_services
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'website_edit' = ANY(employees.permissions)
    )
  );

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_quiz_related_services_item_id ON quiz_related_services(service_item_id);
CREATE INDEX IF NOT EXISTS idx_quiz_related_services_display_order ON quiz_related_services(display_order);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_quiz_related_services_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_quiz_related_services_updated_at
  BEFORE UPDATE ON quiz_related_services
  FOR EACH ROW
  EXECUTE FUNCTION update_quiz_related_services_updated_at();
