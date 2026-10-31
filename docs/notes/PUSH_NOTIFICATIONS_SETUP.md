# Push Notifications Setup - Required Database Migration

Run the following SQL in your Supabase SQL Editor (Dashboard > SQL Editor):

```sql
-- =============================================
-- 1. Create push_tokens table
-- =============================================
CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'unknown',
  device_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_tokens_employee_token_unique UNIQUE (employee_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_employee_id ON push_tokens(employee_id);

-- =============================================
-- 2. Enable RLS
-- =============================================
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_push_tokens" ON push_tokens;
CREATE POLICY "select_own_push_tokens" ON push_tokens FOR SELECT
  TO authenticated
  USING (employee_id IN (SELECT e.id FROM employees e WHERE e.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_push_tokens" ON push_tokens;
CREATE POLICY "insert_own_push_tokens" ON push_tokens FOR INSERT
  TO authenticated
  WITH CHECK (employee_id IN (SELECT e.id FROM employees e WHERE e.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_push_tokens" ON push_tokens;
CREATE POLICY "update_own_push_tokens" ON push_tokens FOR UPDATE
  TO authenticated
  USING (employee_id IN (SELECT e.id FROM employees e WHERE e.user_id = auth.uid()))
  WITH CHECK (employee_id IN (SELECT e.id FROM employees e WHERE e.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_push_tokens" ON push_tokens;
CREATE POLICY "delete_own_push_tokens" ON push_tokens FOR DELETE
  TO authenticated
  USING (employee_id IN (SELECT e.id FROM employees e WHERE e.user_id = auth.uid()));

-- =============================================
-- 3. Ensure employee_messages is in realtime publication
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'employee_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE employee_messages;
  END IF;
END $$;

-- =============================================
-- 4. Optional: Set REPLICA IDENTITY FULL for unfiltered realtime
--    (needed if you want realtime subscriptions without filter)
-- =============================================
ALTER TABLE employee_messages REPLICA IDENTITY FULL;
```

After running this SQL:
1. The mobile app will be able to save push tokens
2. The Edge Function (send-chat-push) will be able to read those tokens
3. Realtime subscriptions without filters will work for employee_messages
