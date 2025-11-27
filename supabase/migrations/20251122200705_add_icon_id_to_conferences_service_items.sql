/*
  # Add icon_id to conferences_service_items

  1. Changes
    - Add `icon_id` (uuid) column to conferences_service_items
    - Foreign key to custom_icons(id)
    - ON DELETE SET NULL to preserve service if icon is deleted
    
  2. Purpose
    - Allow services to use custom icons from the icon library
    - Provides visual identification for services
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conferences_service_items' AND column_name = 'icon_id'
  ) THEN
    ALTER TABLE conferences_service_items 
    ADD COLUMN icon_id UUID REFERENCES custom_icons(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conferences_service_items_icon_id 
ON conferences_service_items(icon_id);
