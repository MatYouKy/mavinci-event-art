/*
  # Add CV/attachment support to contact messages

  1. Changes
    - Add `cv_url` column for career applications
    - Add `cv_filename` column to store original filename
    - Add `attachment_url` column for general attachments
    - Add `attachment_filename` column for attachment name
  
  2. Purpose
    - Support CV uploads for career/team_join inquiries
    - Support general file attachments for other message types
    - Store both URL and original filename for better UX
*/

-- Add CV and attachment columns
ALTER TABLE contact_messages
ADD COLUMN IF NOT EXISTS cv_url TEXT,
ADD COLUMN IF NOT EXISTS cv_filename TEXT,
ADD COLUMN IF NOT EXISTS attachment_url TEXT,
ADD COLUMN IF NOT EXISTS attachment_filename TEXT;

-- Add comment
COMMENT ON COLUMN contact_messages.cv_url IS 'URL to uploaded CV file (for team_join category)';
COMMENT ON COLUMN contact_messages.cv_filename IS 'Original filename of uploaded CV';
COMMENT ON COLUMN contact_messages.attachment_url IS 'URL to any attachment file';
COMMENT ON COLUMN contact_messages.attachment_filename IS 'Original filename of attachment';
