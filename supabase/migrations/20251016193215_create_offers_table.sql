/*
  # Create offers table

  1. New Tables
    - `offers`
      - `id` (uuid, primary key)
      - `offer_number` (text, unique) - numer oferty
      - `event_id` (uuid) - powiązanie z wydarzeniem
      - `client_id` (uuid) - powiązanie z klientem
      - `created_by` (uuid) - pracownik który stworzył ofertę
      - `total_amount` (numeric) - całkowita kwota
      - `valid_until` (timestamptz) - data ważności
      - `status` (text) - status oferty
      - `pdf_url` (text) - link do PDF
      - `notes` (text) - notatki
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `offers` table
    - Add policies for employees based on permissions
    - Employees can see their own offers
    - Admins can see all offers
*/

-- Create offers table
CREATE TABLE IF NOT EXISTS offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_number text UNIQUE,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  total_amount numeric(10, 2) DEFAULT 0,
  valid_until timestamptz,
  status text DEFAULT 'draft',
  pdf_url text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_offers_event_id ON offers(event_id);
CREATE INDEX IF NOT EXISTS idx_offers_client_id ON offers(client_id);
CREATE INDEX IF NOT EXISTS idx_offers_created_by ON offers(created_by);
CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);

-- Enable RLS
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;

-- Policies: View - Admins see all, others see only their own
CREATE POLICY "Employees can view offers"
  ON offers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'offers_manage' = ANY(employees.permissions)
        OR offers.created_by = employees.id
      )
    )
  );

-- Policies: Insert - Anyone with offers_manage permission
CREATE POLICY "Employees can insert offers"
  ON offers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'offers_manage' = ANY(employees.permissions)
      )
    )
  );

-- Policies: Update - Creator can update draft, admins can update all
CREATE POLICY "Employees can update offers"
  ON offers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'offers_manage' = ANY(employees.permissions)
        OR (offers.created_by = employees.id AND offers.status = 'draft')
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'offers_manage' = ANY(employees.permissions)
        OR (offers.created_by = employees.id AND offers.status = 'draft')
      )
    )
  );

-- Policies: Delete - Only admins
CREATE POLICY "Admins can delete offers"
  ON offers FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_offers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_offers_updated_at_trigger
  BEFORE UPDATE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION update_offers_updated_at();
