/*
  # Fix team members images

  1. Changes
    - Add default images for team members without images
    - Update Mateusz and Roman with proper image URLs

  2. Notes
    - Uses high-quality professional photos from Pexels
    - Ensures all team members have visible images
*/

-- Update Mateusz Kwiatkowski with professional image
UPDATE team_members
SET
  image = 'https://images.pexels.com/photos/2182970/pexels-photo-2182970.jpeg?auto=compress&cs=tinysrgb&w=800',
  alt = 'Mateusz Kwiatkowski - CEO'
WHERE name = 'Mateusz Kwiatkowski' AND (image IS NULL OR image = '');

-- Update Roman Paździoch with professional image
UPDATE team_members
SET
  image = 'https://images.pexels.com/photos/1516680/pexels-photo-1516680.jpeg?auto=compress&cs=tinysrgb&w=800',
  alt = 'Roman Paździoch - Event Manager'
WHERE name = 'Roman Paździoch' AND (image IS NULL OR image = '');

-- Set default image for any other team members without images
UPDATE team_members
SET
  image = 'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=800',
  alt = name || ' - ' || role
WHERE image IS NULL OR image = '';
