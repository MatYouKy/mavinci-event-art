/*
  # Update Active Sessions Cleanup Time

  1. Changes
    - Reduce cleanup time from 5 minutes to 30 seconds
    - This allows faster detection of closed tabs/windows
  
  2. Security
    - No changes to RLS policies
*/

-- Update cleanup function to 30 seconds
CREATE OR REPLACE FUNCTION cleanup_stale_sessions()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM active_sessions
  WHERE last_heartbeat < now() - interval '30 seconds';
END;
$$;
