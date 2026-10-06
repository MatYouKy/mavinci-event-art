BEGIN;
-- NULL denotes one administrator-owned catalog token, not an unscoped public token.
-- Every request rechecks that its owner is active and still an administrator.
ALTER TABLE public.mac_sync_bindings ALTER COLUMN event_id DROP NOT NULL;
COMMENT ON COLUMN public.mac_sync_bindings.event_id IS
  'NULL: administrator CRM root catalog; UUID: legacy single-event binding. Tokens remain private and revocable.';
COMMIT;
