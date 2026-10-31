BEGIN;
SET LOCAL lock_timeout='3s';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS equipment_checklist_note_items jsonb;
COMMENT ON COLUMN public.events.equipment_checklist_note_items IS 'Punkty checklisty: id, text, checked. NULL oznacza dotychczasowe notatki tekstowe.';
NOTIFY pgrst,'reload schema';
COMMIT;
