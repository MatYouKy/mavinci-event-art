/*
  # Add client_type column to clients table

  1. Changes
    - Add client_type column with values: 'company' or 'individual'
    - Set default to 'company'
    - Update existing records based on company_name presence

  2. Notes
    - If company_name exists, set to 'company'
    - Otherwise set to 'individual'
*/

-- Add client_type column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clients' AND column_name = 'client_type'
  ) THEN
    ALTER TABLE clients 
    ADD COLUMN client_type TEXT DEFAULT 'company' CHECK (client_type IN ('company', 'individual'));
    
    -- Update existing records
    UPDATE clients 
    SET client_type = CASE 
      WHEN company_name IS NOT NULL AND company_name != '' THEN 'company'
      ELSE 'individual'
    END;
  END IF;
END $$;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_clients_type ON clients(client_type);
