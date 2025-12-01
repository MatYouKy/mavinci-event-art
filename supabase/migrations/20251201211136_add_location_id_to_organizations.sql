/*
  # Add location reference to organizations

  ## Changes
  1. Add location_id column to organizations table
  2. Add foreign key constraint
  3. Create index for performance
  
  ## Notes
  - Organizations can now be linked to locations from locations table
  - This allows centralized location management
  - Existing address fields remain for backward compatibility
*/

-- Add location_id column
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_organizations_location_id ON organizations(location_id);

-- Add helpful comment
COMMENT ON COLUMN organizations.location_id IS 'Reference to locations table for centralized location management';
