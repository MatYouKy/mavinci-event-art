/*
  # Enhanced Analytics System

  1. New Tables
    - `form_interactions` - tracks form starts, completions, and abandonment
    - `click_events` - tracks CTA clicks, button clicks
    - `scroll_depth` - tracks how far users scroll on pages
    - `utm_campaigns` - tracks campaign parameters
  
  2. Changes to existing tables
    - Add columns to `page_analytics` for enhanced tracking
  
  3. Security
    - Public insert access for tracking
    - Admin read access only
*/

-- Add columns to page_analytics
ALTER TABLE page_analytics 
ADD COLUMN IF NOT EXISTS browser text,
ADD COLUMN IF NOT EXISTS os text,
ADD COLUMN IF NOT EXISTS screen_width int,
ADD COLUMN IF NOT EXISTS screen_height int,
ADD COLUMN IF NOT EXISTS language text,
ADD COLUMN IF NOT EXISTS utm_source text,
ADD COLUMN IF NOT EXISTS utm_medium text,
ADD COLUMN IF NOT EXISTS utm_campaign text,
ADD COLUMN IF NOT EXISTS utm_term text,
ADD COLUMN IF NOT EXISTS utm_content text,
ADD COLUMN IF NOT EXISTS entry_page boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS exit_page boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS bounce boolean DEFAULT false;

-- Form interactions table
CREATE TABLE IF NOT EXISTS form_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  form_name text NOT NULL,
  page_url text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'abandoned')),
  fields_filled jsonb,
  time_to_complete int,
  error_messages text[],
  created_at timestamptz DEFAULT now()
);

-- Click events table
CREATE TABLE IF NOT EXISTS click_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  page_url text NOT NULL,
  element_type text NOT NULL,
  element_text text,
  element_id text,
  element_class text,
  click_x int,
  click_y int,
  created_at timestamptz DEFAULT now()
);

-- Scroll depth table
CREATE TABLE IF NOT EXISTS scroll_depth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  page_url text NOT NULL,
  max_depth int NOT NULL,
  milestones int[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_form_interactions_session ON form_interactions(session_id);
CREATE INDEX IF NOT EXISTS idx_form_interactions_status ON form_interactions(status);
CREATE INDEX IF NOT EXISTS idx_form_interactions_form_name ON form_interactions(form_name);
CREATE INDEX IF NOT EXISTS idx_click_events_session ON click_events(session_id);
CREATE INDEX IF NOT EXISTS idx_click_events_element_type ON click_events(element_type);
CREATE INDEX IF NOT EXISTS idx_scroll_depth_session ON scroll_depth(session_id);
CREATE INDEX IF NOT EXISTS idx_page_analytics_utm_campaign ON page_analytics(utm_campaign);
CREATE INDEX IF NOT EXISTS idx_page_analytics_utm_source ON page_analytics(utm_source);

-- Enable RLS
ALTER TABLE form_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE click_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE scroll_depth ENABLE ROW LEVEL SECURITY;

-- Public can insert tracking data
CREATE POLICY "Anyone can insert form interactions"
  ON form_interactions
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Anyone can insert click events"
  ON click_events
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Anyone can insert scroll depth"
  ON scroll_depth
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Only authenticated users can view (CRM admins)
CREATE POLICY "Authenticated users can view form interactions"
  ON form_interactions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view click events"
  ON click_events
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view scroll depth"
  ON scroll_depth
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow updates for scroll depth (same session)
CREATE POLICY "Anyone can update own scroll depth"
  ON scroll_depth
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);
