/*
  # Add client type support to offers

  1. Changes
    - Add `contact_id` column to offers table for individual clients
    - Add `client_type` column to offers table
    - Add check constraint to ensure either organization_id or contact_id is set
    - Add foreign key constraint for contact_id

  2. Security
    - No changes to RLS policies needed - existing policies work with new columns
*/

-- Add contact_id for individual clients
ALTER TABLE offers
ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;

-- Add client_type enum
ALTER TABLE offers
ADD COLUMN IF NOT EXISTS client_type client_type_enum;

-- Add check constraint to ensure one client type is set
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'offers_client_check'
  ) THEN
    ALTER TABLE offers
    ADD CONSTRAINT offers_client_check CHECK (
      (client_type = 'business' AND organization_id IS NOT NULL AND contact_id IS NULL) OR
      (client_type = 'individual' AND contact_id IS NOT NULL AND organization_id IS NULL) OR
      (client_type IS NULL AND organization_id IS NULL AND contact_id IS NULL)
    );
  END IF;
END $$;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_offers_contact_id ON offers(contact_id);

-- Update existing offers to set client_type based on organization_id
UPDATE offers
SET client_type = 'business'
WHERE organization_id IS NOT NULL AND client_type IS NULL;
