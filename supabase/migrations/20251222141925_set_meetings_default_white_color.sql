/*
  # Set meetings to have white color by default
  
  1. Change default color to white (#FFFFFF)
  2. Update existing meetings without color to white
*/

-- Update default value for color column
ALTER TABLE meetings 
  ALTER COLUMN color SET DEFAULT '#FFFFFF';

-- Update existing meetings that don't have a color set
UPDATE meetings 
SET color = '#FFFFFF' 
WHERE color IS NULL OR color = '';

COMMENT ON COLUMN meetings.color IS 'Event color for calendar display - defaults to white';
