/*
  # Add Image Metadata Support

  ## Overview
  This migration adds support for advanced image metadata including position, scale, and device-specific settings
  for team member photos and portfolio project images.

  ## Changes

  ### Modified Columns
  1. `team_members.image`
    - Changed from simple text URL to JSONB containing full metadata
    - Supports desktop and mobile specific configurations
    - Includes position (posX, posY, scale) for precise image control

  2. `portfolio_projects.image`
    - Changed from simple text URL to JSONB containing full metadata
    - Supports desktop and mobile specific configurations
    - Includes position (posX, posY, scale) for precise image control

  ### New Fields
  Both tables now support:
  - `alt` (text) - Accessibility description for images
  - `image_metadata` (jsonb) - Structured metadata:
    ```json
    {
      "desktop": {
        "src": "url_to_image",
        "position": {
          "posX": 0,
          "posY": 0,
          "scale": 1
        }
      },
      "mobile": {
        "src": "url_to_image",
        "position": {
          "posX": 0,
          "posY": 0,
          "scale": 1
        }
      }
    }
    ```

  ## Data Migration
  - Existing `image` URLs are automatically migrated to the new JSONB format
  - Default positions are set (posX: 0, posY: 0, scale: 1)
  - Both desktop and mobile configurations are created from the original URL

  ## Security
  - No changes to RLS policies
  - Existing security rules remain in place

  ## Notes
  - JSONB format allows flexible metadata without schema changes
  - Position values support precise image cropping and positioning
  - Separate desktop/mobile configs enable responsive design optimization
*/

-- Add alt column to team_members if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_members' AND column_name = 'alt'
  ) THEN
    ALTER TABLE team_members ADD COLUMN alt text DEFAULT '';
  END IF;
END $$;

-- Add image_metadata column to team_members
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_members' AND column_name = 'image_metadata'
  ) THEN
    ALTER TABLE team_members ADD COLUMN image_metadata jsonb;
  END IF;
END $$;

-- Migrate existing team_members data
UPDATE team_members
SET image_metadata = jsonb_build_object(
  'desktop', jsonb_build_object(
    'src', image,
    'position', jsonb_build_object('posX', 0, 'posY', 0, 'scale', 1)
  ),
  'mobile', jsonb_build_object(
    'src', image,
    'position', jsonb_build_object('posX', 0, 'posY', 0, 'scale', 1)
  )
)
WHERE image_metadata IS NULL AND image IS NOT NULL;

-- Add alt column to portfolio_projects if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_projects' AND column_name = 'alt'
  ) THEN
    ALTER TABLE portfolio_projects ADD COLUMN alt text DEFAULT '';
  END IF;
END $$;

-- Add image_metadata column to portfolio_projects
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_projects' AND column_name = 'image_metadata'
  ) THEN
    ALTER TABLE portfolio_projects ADD COLUMN image_metadata jsonb;
  END IF;
END $$;

-- Migrate existing portfolio_projects data
UPDATE portfolio_projects
SET image_metadata = jsonb_build_object(
  'desktop', jsonb_build_object(
    'src', image,
    'position', jsonb_build_object('posX', 0, 'posY', 0, 'scale', 1)
  ),
  'mobile', jsonb_build_object(
    'src', image,
    'position', jsonb_build_object('posX', 0, 'posY', 0, 'scale', 1)
  )
)
WHERE image_metadata IS NULL AND image IS NOT NULL;
