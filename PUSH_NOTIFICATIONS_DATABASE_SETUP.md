# Push Notifications: Required Database Setup

The Supabase MCP tools are currently returning a provisioning error, so these SQL statements
must be run manually in the **Supabase Dashboard > SQL Editor**.

## Step 1: Create push_tokens table

```sql
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

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_push_tokens" ON push_tokens;
CREATE POLICY "select_own_push_tokens" ON push_tokens FOR SELECT
  TO authenticated USING (auth.uid() = employee_id);

DROP POLICY IF EXISTS "insert_own_push_tokens" ON push_tokens;
CREATE POLICY "insert_own_push_tokens" ON push_tokens FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = employee_id);

DROP POLICY IF EXISTS "update_own_push_tokens" ON push_tokens;
CREATE POLICY "update_own_push_tokens" ON push_tokens FOR UPDATE
  TO authenticated USING (auth.uid() = employee_id) WITH CHECK (auth.uid() = employee_id);

DROP POLICY IF EXISTS "delete_own_push_tokens" ON push_tokens;
CREATE POLICY "delete_own_push_tokens" ON push_tokens FOR DELETE
  TO authenticated USING (auth.uid() = employee_id);
```

## Step 2: Enable REPLICA IDENTITY FULL on employee_messages

```sql
ALTER TABLE employee_messages REPLICA IDENTITY FULL;
```

## Step 3: Add employee_messages to realtime publication (if not already)

```sql
-- Check first:
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'employee_messages';

-- If not present:
ALTER PUBLICATION supabase_realtime ADD TABLE employee_messages;
```

## Step 4: Deploy the send-chat-push edge function

The function code is at `supabase/functions/send-chat-push/index.ts`.
Deploy via Supabase Dashboard > Edge Functions, or using:
```bash
supabase functions deploy send-chat-push --no-verify-jwt
```

## Verification

After setup, test the flow:
1. Mobile app logs in → registers push token → check `push_tokens` table has a row
2. Send a message from device A
3. `ChatConversationView.tsx` (web) or `ChatScreen.tsx` (mobile) calls the edge function
4. Edge function logs should show: payload received → participants found → tokens found → push sent
5. Device B receives native notification with sound
