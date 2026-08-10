-- Users who receive website/contact messages must also be able to open
-- the underlying inbound event from the mobile CRM.
CREATE OR REPLACE FUNCTION can_view_webhooks()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM employees
    WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR access_level = 'admin'
        OR 'webhooks_manage' = ANY(permissions)
        OR 'webhooks_view' = ANY(permissions)
        OR 'messages_manage' = ANY(permissions)
        OR 'messages_view' = ANY(permissions)
      )
  );
$$;
