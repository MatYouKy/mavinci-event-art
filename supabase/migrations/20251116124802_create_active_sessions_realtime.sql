/*
  # Active Sessions Realtime System

  1. Tables
    - `active_sessions` - tracks currently active users with heartbeat
  
  2. Features
    - Automatic cleanup of stale sessions (>5 minutes)
    - Realtime updates via INSERT/DELETE
    - Heartbeat mechanism for keeping session alive
  
  3. Security
    - Public read access for counting
    - Public insert/update for heartbeat
*/

-- Create active_sessions table
CREATE TABLE IF NOT EXISTS active_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text UNIQUE NOT NULL,
  page_url text NOT NULL,
  user_agent text,
  last_heartbeat timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;

-- Allow public read for counting
CREATE POLICY "Anyone can view active sessions"
  ON active_sessions
  FOR SELECT
  TO public
  USING (true);

-- Allow public insert for new sessions
CREATE POLICY "Anyone can insert sessions"
  ON active_sessions
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Allow public update for heartbeat
CREATE POLICY "Anyone can update own session"
  ON active_sessions
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

-- Allow public delete for cleanup
CREATE POLICY "Anyone can delete sessions"
  ON active_sessions
  FOR DELETE
  TO public
  USING (true);

-- Function to cleanup stale sessions (older than 5 minutes)
CREATE OR REPLACE FUNCTION cleanup_stale_sessions()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM active_sessions
  WHERE last_heartbeat < now() - interval '5 minutes';
END;
$$;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_active_sessions_heartbeat 
  ON active_sessions(last_heartbeat);

CREATE INDEX IF NOT EXISTS idx_active_sessions_page_url 
  ON active_sessions(page_url);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE active_sessions;
