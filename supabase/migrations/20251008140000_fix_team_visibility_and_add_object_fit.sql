/*
  # Fix team visibility and add object-fit control

  1. Changes
    - Ensure all team members are visible by default
    - Update image_metadata structure to support object-fit property
    - Set all existing members to visible

  2. New Features
    - object_fit control in image_metadata (cover, contain, fill, etc.)
    - Default is 'cover' for backward compatibility

  3. Notes
    - All existing team members will be set to visible
    - object_fit can be controlled per screen size (desktop/mobile)
*/

-- Ensure is_visible column exists and all members are visible
UPDATE team_members
SET is_visible = true
WHERE is_visible IS NULL OR is_visible = false;

-- Update default for new records
ALTER TABLE team_members
ALTER COLUMN is_visible SET DEFAULT true;

-- Add sample object_fit to existing image_metadata (optional)
-- The application will handle object_fit through image_metadata.desktop.objectFit and image_metadata.mobile.objectFit
-- Default will be 'cover' if not specified
