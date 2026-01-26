/*
  # Add Equipment Checklist PDF Tracking

  1. Changes
    - Add columns to `events` table for equipment checklist PDF tracking
      - `equipment_checklist_pdf_path` (text) - path to generated PDF
      - `equipment_checklist_pdf_at` (timestamptz) - when PDF was generated
      - `equipment_checklist_modified` (boolean) - if modified after generation

  2. Triggers
    - Automatically set `equipment_checklist_modified` to true when equipment changes
*/

-- Add columns to events table
ALTER TABLE events
ADD COLUMN IF NOT EXISTS equipment_checklist_pdf_path text,
ADD COLUMN IF NOT EXISTS equipment_checklist_pdf_at timestamptz,
ADD COLUMN IF NOT EXISTS equipment_checklist_modified boolean DEFAULT false;

-- Trigger to mark checklist as modified when equipment changes
CREATE OR REPLACE FUNCTION mark_equipment_checklist_modified()
RETURNS TRIGGER AS $$
BEGIN
  -- Mark the event's checklist as modified if it has a generated PDF
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    UPDATE events
    SET equipment_checklist_modified = true
    WHERE id = COALESCE(NEW.event_id, OLD.event_id)
      AND equipment_checklist_pdf_path IS NOT NULL;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS event_equipment_mark_checklist_modified ON event_equipment;

-- Create trigger on event_equipment
CREATE TRIGGER event_equipment_mark_checklist_modified
  AFTER INSERT OR UPDATE OR DELETE ON event_equipment
  FOR EACH ROW
  EXECUTE FUNCTION mark_equipment_checklist_modified();