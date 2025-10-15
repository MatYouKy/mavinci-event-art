/*
  # Enable Realtime for notification_recipients

  ## Purpose
  - Enable real-time subscriptions for notification_recipients table
  - Users will see new notifications immediately
  - Read status updates in real-time
*/

ALTER PUBLICATION supabase_realtime ADD TABLE notification_recipients;
