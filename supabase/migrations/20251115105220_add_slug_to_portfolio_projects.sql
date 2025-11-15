/*
  # Add slug column to portfolio_projects

  1. Changes
    - Add `slug` column to `portfolio_projects` table
    - Generate slugs from existing titles
    - Add unique constraint to slug
    - Create index for faster lookups
  
  2. Security
    - No RLS changes needed
*/

-- Add slug column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'portfolio_projects' AND column_name = 'slug'
  ) THEN
    ALTER TABLE portfolio_projects ADD COLUMN slug text;
  END IF;
END $$;

-- Function to generate slug from text
CREATE OR REPLACE FUNCTION generate_slug(text_input text) 
RETURNS text AS $$
DECLARE
  slug_output text;
BEGIN
  slug_output := lower(trim(text_input));
  
  -- Polish characters to ASCII
  slug_output := translate(slug_output, 
    'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 
    'acelnoszzACELNOSZZ'
  );
  
  -- Replace spaces and special chars with hyphens
  slug_output := regexp_replace(slug_output, '[^a-z0-9]+', '-', 'g');
  
  -- Remove leading/trailing hyphens
  slug_output := regexp_replace(slug_output, '^-+|-+$', '', 'g');
  
  RETURN slug_output;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Generate slugs for existing projects
UPDATE portfolio_projects
SET slug = generate_slug(title)
WHERE slug IS NULL OR slug = '';

-- Make slug NOT NULL and UNIQUE
ALTER TABLE portfolio_projects 
  ALTER COLUMN slug SET NOT NULL;

-- Add unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'portfolio_projects_slug_key'
  ) THEN
    ALTER TABLE portfolio_projects 
      ADD CONSTRAINT portfolio_projects_slug_key UNIQUE (slug);
  END IF;
END $$;

-- Create index for faster slug lookups
CREATE INDEX IF NOT EXISTS idx_portfolio_projects_slug 
  ON portfolio_projects(slug);