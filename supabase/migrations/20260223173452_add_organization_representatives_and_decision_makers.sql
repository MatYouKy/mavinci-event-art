/*
  # Add Organization Representatives and Decision Makers
  
  1. Changes to organizations table
    - `primary_contact_id` (uuid) - Główna osoba kontaktowa (FK do contacts)
    - `legal_representative_id` (uuid) - Reprezentant prawny (FK do contacts)
    - `legal_representative_title` (text) - Stanowisko reprezentanta (np. Prezes Zarządu)
    - `contact_is_representative` (boolean) - Czy osoba kontaktowa jest też reprezentantem
  
  2. New Tables
    - `organization_decision_makers`
      - `id` (uuid, primary key)
      - `organization_id` (uuid, FK) - Organizacja
      - `contact_id` (uuid, FK) - Osoba decyzyjna
      - `title` (text) - Stanowisko/rola (np. Prokurent)
      - `can_sign_contracts` (boolean) - Czy może podpisywać umowy
      - `notes` (text) - Notatki
      - `created_at` (timestamptz)
  
  3. Security
    - Enable RLS
    - Add policies for authenticated users
*/

-- Add fields to organizations
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS primary_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS legal_representative_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS legal_representative_title text,
ADD COLUMN IF NOT EXISTS contact_is_representative boolean DEFAULT false;

-- Create organization_decision_makers table
CREATE TABLE IF NOT EXISTS organization_decision_makers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title text,
  can_sign_contracts boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, contact_id)
);

-- Enable RLS
ALTER TABLE organization_decision_makers ENABLE ROW LEVEL SECURITY;

-- Policies for organization_decision_makers
CREATE POLICY "Authenticated users can view decision makers"
  ON organization_decision_makers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert decision makers"
  ON organization_decision_makers FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update decision makers"
  ON organization_decision_makers FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete decision makers"
  ON organization_decision_makers FOR DELETE
  TO authenticated
  USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_organization_decision_makers_org ON organization_decision_makers(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_decision_makers_contact ON organization_decision_makers(contact_id);
CREATE INDEX IF NOT EXISTS idx_organizations_primary_contact ON organizations(primary_contact_id);
CREATE INDEX IF NOT EXISTS idx_organizations_legal_representative ON organizations(legal_representative_id);

-- Add comment
COMMENT ON TABLE organization_decision_makers IS 'Osoby decyzyjne w organizacji (prokurenci, osoby uprawnione do podejmowania decyzji podczas eventów)';
COMMENT ON COLUMN organizations.primary_contact_id IS 'Główna osoba kontaktowa';
COMMENT ON COLUMN organizations.legal_representative_id IS 'Reprezentant prawny (osoba podpisująca umowy)';
COMMENT ON COLUMN organizations.legal_representative_title IS 'Stanowisko reprezentanta prawnego (np. Prezes Zarządu)';
COMMENT ON COLUMN organizations.contact_is_representative IS 'Czy osoba kontaktowa jest jednocześnie reprezentantem prawnym';