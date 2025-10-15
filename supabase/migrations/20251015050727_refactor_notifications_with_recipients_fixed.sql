/*
  # Refactor Notifications System - Individual Read Status

  ## Problem
  - Current: notifications have is_read boolean
  - When one user marks as read, it affects everyone
  - Multiple duplicate notifications for same event
  
  ## Solution
  - Create notification_recipients junction table
  - Each notification can have multiple recipients
  - Each recipient has individual is_read status
  - Remove is_read from notifications table
  
  ## New Schema
  
  ### notifications table
  - id (uuid, PK)
  - title (text)
  - message (text)
  - type (text)
  - category (text)
  - action_url (text)
  - related_entity_type (text)
  - related_entity_id (text)
  - created_at (timestamptz)
  - metadata (jsonb)
  
  ### notification_recipients table (NEW)
  - id (uuid, PK)
  - notification_id (uuid, FK → notifications.id)
  - user_id (uuid, FK → auth.users.id)
  - is_read (boolean, default false)
  - read_at (timestamptz, nullable)
  - created_at (timestamptz)
  
  ## Migration Strategy
  1. Create new notification_recipients table
  2. Migrate existing data (create recipient rows from existing notifications)
  3. Drop is_read column from notifications
  4. Update RLS policies
*/

-- Create notification_recipients table
CREATE TABLE IF NOT EXISTS notification_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_read boolean DEFAULT false,
  read_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(notification_id, user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_notification_recipients_user 
  ON notification_recipients(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notification_recipients_notification 
  ON notification_recipients(notification_id);

-- Migrate existing notification data
-- For each notification with user_id, create a recipient record
INSERT INTO notification_recipients (notification_id, user_id, is_read, read_at, created_at)
SELECT 
  id as notification_id,
  user_id,
  is_read,
  CASE WHEN is_read THEN created_at ELSE NULL END as read_at,
  created_at
FROM notifications
WHERE user_id IS NOT NULL
ON CONFLICT (notification_id, user_id) DO NOTHING;

-- Drop columns that are now in junction table
ALTER TABLE notifications DROP COLUMN IF EXISTS is_read CASCADE;
ALTER TABLE notifications DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE notifications DROP COLUMN IF EXISTS is_global CASCADE;

-- Enable RLS on notification_recipients
ALTER TABLE notification_recipients ENABLE ROW LEVEL SECURITY;

-- RLS Policies for notification_recipients
CREATE POLICY "Users can view their own notification recipients"
  ON notification_recipients FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notification recipients"
  ON notification_recipients FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Update notifications RLS - now anyone authenticated can see notifications
-- The filtering happens via notification_recipients
DROP POLICY IF EXISTS "Users can read their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
DROP POLICY IF EXISTS "Authenticated users can view all notifications" ON notifications;

CREATE POLICY "Authenticated users can view notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM notification_recipients nr
      WHERE nr.notification_id = notifications.id
        AND nr.user_id = auth.uid()
    )
  );
