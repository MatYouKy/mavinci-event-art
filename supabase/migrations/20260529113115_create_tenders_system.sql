/*
  # Tenders Monitoring System

  1. New Tables
    - `tenders` - Main table storing all tender/procurement notices
      - `id` (uuid, primary key)
      - `external_id` (text) - ID from source system
      - `source` (text) - 'bzp', 'ted', 'baza_konkurencyjnosci'
      - `title` (text) - Tender title
      - `description` (text) - Full description
      - `contracting_authority` (text) - Zamawiajacy name
      - `cpv_codes` (text[]) - CPV code array
      - `location` (text) - Location/region
      - `publication_date` (timestamptz) - When published
      - `submission_deadline` (timestamptz) - Deadline for offers
      - `estimated_value` (numeric) - Estimated value if available
      - `currency` (text) - Currency code
      - `source_url` (text) - Direct link to source
      - `raw_data` (jsonb) - Original raw data from source
      - `relevance_score` (integer) - 0-100 relevance score
      - `is_matched` (boolean) - Whether it passes current filters
      - `status` (text) - User-assigned status
      - `is_watched` (boolean) - User watching this tender
      - `is_hidden` (boolean) - User hid this tender
      - `assigned_to` (uuid) - Assigned employee
      - `notes` (text) - User notes
      - `manual_relevance` (text) - Manual override: 'relevant', 'irrelevant', null
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `tender_filter_config` - Configurable filter settings
      - `id` (uuid, primary key)
      - `name` (text) - Config name
      - `positive_keywords` (text[]) - Keywords that increase relevance
      - `negative_keywords` (text[]) - Keywords that decrease relevance
      - `cpv_codes` (text[]) - Target CPV codes
      - `locations` (text[]) - Target locations
      - `sources` (text[]) - Active sources
      - `min_relevance_score` (integer) - Minimum score to show
      - `max_days_to_deadline` (integer) - Max days until deadline
      - `is_active` (boolean) - Whether this config is active
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `tender_import_logs` - Import execution logs
      - `id` (uuid, primary key)
      - `source` (text) - Which source was imported
      - `started_at` (timestamptz)
      - `finished_at` (timestamptz)
      - `status` (text) - 'running', 'success', 'error'
      - `records_fetched` (integer)
      - `records_new` (integer)
      - `records_updated` (integer)
      - `error_message` (text)
      - `details` (jsonb)

  2. Security
    - Enable RLS on all tables
    - Policies for authenticated users
*/

-- Tenders main table
CREATE TABLE IF NOT EXISTS tenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  source text NOT NULL DEFAULT 'bzp',
  title text NOT NULL DEFAULT '',
  description text DEFAULT '',
  contracting_authority text DEFAULT '',
  cpv_codes text[] DEFAULT '{}',
  location text DEFAULT '',
  publication_date timestamptz,
  submission_deadline timestamptz,
  estimated_value numeric DEFAULT 0,
  currency text DEFAULT 'PLN',
  source_url text DEFAULT '',
  raw_data jsonb DEFAULT '{}',
  relevance_score integer DEFAULT 0,
  is_matched boolean DEFAULT false,
  status text DEFAULT 'new',
  is_watched boolean DEFAULT false,
  is_hidden boolean DEFAULT false,
  assigned_to uuid REFERENCES employees(id),
  notes text DEFAULT '',
  manual_relevance text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT tenders_source_external_id_unique UNIQUE (source, external_id)
);

ALTER TABLE tenders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view tenders"
  ON tenders FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert tenders"
  ON tenders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update tenders"
  ON tenders FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete tenders"
  ON tenders FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Service role bypass for edge functions
CREATE POLICY "Service role full access to tenders"
  ON tenders FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tenders_source ON tenders(source);
CREATE INDEX IF NOT EXISTS idx_tenders_is_matched ON tenders(is_matched);
CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status);
CREATE INDEX IF NOT EXISTS idx_tenders_relevance_score ON tenders(relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_tenders_submission_deadline ON tenders(submission_deadline);
CREATE INDEX IF NOT EXISTS idx_tenders_publication_date ON tenders(publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_tenders_external_id ON tenders(external_id);

-- Filter configuration table
CREATE TABLE IF NOT EXISTS tender_filter_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Domyślna konfiguracja',
  positive_keywords text[] DEFAULT '{}',
  negative_keywords text[] DEFAULT '{}',
  cpv_codes text[] DEFAULT '{}',
  locations text[] DEFAULT '{}',
  sources text[] DEFAULT ARRAY['bzp', 'ted', 'baza_konkurencyjnosci'],
  min_relevance_score integer DEFAULT 30,
  max_days_to_deadline integer DEFAULT 60,
  is_active boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tender_filter_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view filter configs"
  ON tender_filter_config FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage filter configs"
  ON tender_filter_config FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update filter configs"
  ON tender_filter_config FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete filter configs"
  ON tender_filter_config FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role full access to filter configs"
  ON tender_filter_config FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Import logs table
CREATE TABLE IF NOT EXISTS tender_import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'bzp',
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  status text DEFAULT 'running',
  records_fetched integer DEFAULT 0,
  records_new integer DEFAULT 0,
  records_updated integer DEFAULT 0,
  error_message text,
  details jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tender_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view import logs"
  ON tender_import_logs FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role full access to import logs"
  ON tender_import_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Insert default filter configuration
INSERT INTO tender_filter_config (
  name,
  positive_keywords,
  negative_keywords,
  cpv_codes,
  sources,
  min_relevance_score,
  max_days_to_deadline,
  is_active
) VALUES (
  'Branża eventowa - konfiguracja domyślna',
  ARRAY[
    'organizacja wydarzenia', 'event', 'konferencja', 'kongres', 'szkolenie',
    'gala', 'piknik', 'festiwal', 'koncert', 'wydarzenie plenerowe',
    'obsługa techniczna', 'nagłośnienie', 'oświetlenie', 'scena', 'scenotechnika',
    'multimedia', 'transmisja', 'streaming', 'realizacja dźwięku',
    'oprawa muzyczna', 'obsługa artystyczna', 'wyjazd integracyjny',
    'promocja projektu', 'impreza', 'ceremonia', 'uroczystość',
    'obsługa audiowizualna', 'DJ', 'sprzęt sceniczny', 'realizacja wizualna'
  ],
  ARRAY[
    'roboty budowlane', 'dostawa żywności', 'catering bez wydarzenia',
    'remont', 'dokumentacja projektowa', 'odbiór odpadów',
    'zakup sprzętu bez obsługi', 'usługi medyczne', 'ochrona fizyczna bez wydarzenia',
    'roboty drogowe', 'projekt architektoniczny', 'utrzymanie zieleni'
  ],
  ARRAY[
    '79952000-2', '79951000-5', '79950000-8', '79952100-3',
    '92370000-5', '51313000-9', '92312100-2', '92312200-3', '92111250-9',
    '92312000-1', '92300000-4', '79956000-0', '79960000-1'
  ],
  ARRAY['bzp', 'ted', 'baza_konkurencyjnosci'],
  30,
  60,
  true
);
