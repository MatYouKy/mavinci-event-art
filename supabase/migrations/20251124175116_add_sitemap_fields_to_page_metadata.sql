/*
  # Add Sitemap Fields to Page Metadata

  1. Changes
    - Add `priority` column (0.0 to 1.0) for sitemap priority
    - Add `change_frequency` column for sitemap changefreq
    - Set default values for existing records
  
  2. Notes
    - Priority: 1.0 = highest, 0.0 = lowest
    - Change frequency: daily, weekly, monthly, yearly
    - Home page gets priority 1.0
    - Main pages get 0.8-0.9
    - Subpages get 0.5-0.7
*/

-- Add priority column (0.0 to 1.0)
ALTER TABLE schema_org_page_metadata
ADD COLUMN IF NOT EXISTS priority DECIMAL(2,1) DEFAULT 0.8 CHECK (priority >= 0.0 AND priority <= 1.0);

-- Add change_frequency column
ALTER TABLE schema_org_page_metadata
ADD COLUMN IF NOT EXISTS change_frequency TEXT DEFAULT 'weekly' CHECK (change_frequency IN ('always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'));

-- Set specific priorities for existing pages
UPDATE schema_org_page_metadata SET priority = 1.0, change_frequency = 'daily' WHERE page_slug = 'home';
UPDATE schema_org_page_metadata SET priority = 0.9, change_frequency = 'weekly' WHERE page_slug IN ('oferta', 'portfolio');
UPDATE schema_org_page_metadata SET priority = 0.8, change_frequency = 'monthly' WHERE page_slug IN ('o-nas', 'zespol');
UPDATE schema_org_page_metadata SET priority = 0.7, change_frequency = 'weekly' WHERE page_slug LIKE 'uslugi%' OR page_slug LIKE 'oferta%';

-- Comment on columns
COMMENT ON COLUMN schema_org_page_metadata.priority IS 'Sitemap priority (0.0 to 1.0, default 0.8)';
COMMENT ON COLUMN schema_org_page_metadata.change_frequency IS 'How frequently the page changes (always, hourly, daily, weekly, monthly, yearly, never)';
