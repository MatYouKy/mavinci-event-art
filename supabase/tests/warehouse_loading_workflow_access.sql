-- Regression for the reported warehouse account; psql test, all changes roll back.
BEGIN;
SELECT set_config('request.jwt.claim.sub','3c773159-1c1e-4439-b1c5-59509aabe4e1',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT id AS equipment_id FROM event_equipment WHERE event_id='5390fc54-5186-48c9-ae83-a63251c3f675' LIMIT 1 \gset
SET LOCAL ROLE authenticated;
SELECT public.set_event_equipment_loaded(:'equipment_id',true);
SELECT public.set_event_equipment_loaded(:'equipment_id',false);
DO $$ BEGIN
 BEGIN
  PERFORM public.sync_event_workflow_tasks('5390fc54-5186-48c9-ae83-a63251c3f675');
  RAISE EXCEPTION 'Magazyn uzyskał niezamierzone uprawnienie do zarządzania procesem';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END; $$;
ROLLBACK;
