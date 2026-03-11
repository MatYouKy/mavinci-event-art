/*
  # Enable Realtime for Time Entries History

  1. Changes
    - Enable realtime for time_entries_history table
    - Allows frontend to receive instant updates when history changes

  2. Purpose
    - Real-time updates when time entries are edited
    - Automatic UI refresh without polling
    - Better user experience for tracking changes
*/

-- Enable realtime for time_entries_history
ALTER PUBLICATION supabase_realtime ADD TABLE time_entries_history;
