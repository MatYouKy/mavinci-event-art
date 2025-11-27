/*
  # Add SEO keywords and metadata

  1. Changes
    - Add keywords column to portfolio_projects (text[])
    - Add keywords column to conferences_hero (text[])
    - Add meta_description columns for better SEO
    
  2. Purpose
    - Hidden keywords for search engines
    - Better SEO without cluttering UI
*/

-- Add keywords to portfolio
ALTER TABLE portfolio_projects 
ADD COLUMN IF NOT EXISTS keywords text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS meta_description text;

-- Add keywords to conferences
ALTER TABLE conferences_hero
ADD COLUMN IF NOT EXISTS keywords text[] DEFAULT '{}';

-- Update existing portfolio with sample keywords
UPDATE portfolio_projects
SET keywords = ARRAY['konferencja', 'event', 'realizacja', 'audio', 'video', 'technika sceniczna']
WHERE keywords IS NULL OR array_length(keywords, 1) IS NULL;

-- Update conferences hero with sample keywords
UPDATE conferences_hero
SET keywords = ARRAY['konferencja', 'kongres', 'seminarium', 'szkolenie', 'event biznesowy', 'realizacja audio-video', 'transmisja live', 'streaming konferencji', 'nagłośnienie', 'oświetlenie sceniczne']
WHERE keywords IS NULL OR array_length(keywords, 1) IS NULL;
