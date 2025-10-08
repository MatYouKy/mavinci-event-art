-- Fix team member images with working Pexels URLs
UPDATE team_members
SET image = 'https://images.pexels.com/photos/2182970/pexels-photo-2182970.jpeg?auto=compress&cs=tinysrgb&w=800'
WHERE name = 'Mateusz Kwiatkowski';

UPDATE team_members
SET image = 'https://images.pexels.com/photos/1516680/pexels-photo-1516680.jpeg?auto=compress&cs=tinysrgb&w=800'
WHERE name = 'Roman Paździoch';
