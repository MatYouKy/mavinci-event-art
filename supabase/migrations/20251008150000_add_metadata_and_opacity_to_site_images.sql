/*
  # Add Image Metadata and Opacity to Site Images

  1. Schema Changes
    - Add `image_metadata` (jsonb) to `site_images` table
      - Stores position (posX, posY, scale) for desktop and mobile
      - Stores objectFit setting
    - Add `opacity` (numeric) to `site_images` table
      - Range: 0.0 to 1.0 (default 0.2 for hero backgrounds)

  2. Purpose
    - Allows precise positioning and scaling of hero images
    - Adds opacity control for background overlays
    - Consistent with team_members image_metadata structure
*/

-- Add image_metadata column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'site_images' AND column_name = 'image_metadata'
  ) THEN
    ALTER TABLE site_images ADD COLUMN image_metadata jsonb DEFAULT '{
      "desktop": {
        "position": {"posX": 0, "posY": 0, "scale": 1},
        "objectFit": "cover"
      },
      "mobile": {
        "position": {"posX": 0, "posY": 0, "scale": 1},
        "objectFit": "cover"
      }
    }'::jsonb;
  END IF;
END $$;

-- Add opacity column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'site_images' AND column_name = 'opacity'
  ) THEN
    ALTER TABLE site_images ADD COLUMN opacity numeric(3,2) DEFAULT 0.20 CHECK (opacity >= 0 AND opacity <= 1);
  END IF;
END $$;
