ALTER TABLE public.events ADD COLUMN IF NOT EXISTS equipment_checklist_notes text;
COMMENT ON COLUMN public.events.equipment_checklist_notes IS 'Dodatkowe notatki dla zespołu, dołączane do checklisty sprzętu.';
