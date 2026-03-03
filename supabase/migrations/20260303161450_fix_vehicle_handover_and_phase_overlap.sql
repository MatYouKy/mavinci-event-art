/*
  # Fix Vehicle Handover and Phase Overlap Issues

  1. Vehicle Handover Fix
    - Update trigger to properly zero return_timestamp on pickup
    - This ensures is_in_use flag works correctly
    
  2. Phase Overlap Fix  
    - Remove strict no-overlap constraint
    - Phases can overlap (e.g., setup overlaps with rehearsal)
    - Only validate that end_time > start_time

  3. Data Repair
    - Update existing vehicle records based on last handover
*/

-- =====================================================
-- FIX 1: Update vehicle handover trigger
-- =====================================================

CREATE OR REPLACE FUNCTION update_event_vehicle_on_handover()
RETURNS TRIGGER AS $$
BEGIN
  -- Aktualizuj event_vehicles w zależności od typu handover
  IF NEW.handover_type = 'pickup' THEN
    -- PICKUP: ustaw pickup, WYZERUJ return (pojazd jest teraz w użyciu)
    UPDATE event_vehicles
    SET
      pickup_timestamp = NEW.timestamp,
      pickup_odometer = NEW.odometer_reading,
      return_timestamp = NULL,
      return_odometer = NULL,
      return_notes = NULL
    WHERE id = NEW.event_vehicle_id;
    
  ELSIF NEW.handover_type = 'return' THEN
    -- RETURN: ustaw return, ZACHOWAJ pickup
    UPDATE event_vehicles
    SET
      return_timestamp = NEW.timestamp,
      return_odometer = NEW.odometer_reading,
      return_notes = NEW.notes
    WHERE id = NEW.event_vehicle_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_event_vehicle_on_handover IS 'Aktualizuje timestamps w event_vehicles przy handover. Pickup zeruje return, aby is_in_use działało poprawnie.';

-- =====================================================
-- FIX 2: Remove strict phase overlap constraint
-- =====================================================

-- Drop the overly strict trigger
DROP TRIGGER IF EXISTS ensure_phases_no_overlap ON event_phases;

-- Create a more permissive validation
CREATE OR REPLACE FUNCTION validate_phase_times()
RETURNS trigger AS $$
BEGIN
  -- Only validate that end_time is after start_time
  IF NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'Phase end time must be after start time';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_phase_times_trigger
  BEFORE INSERT OR UPDATE ON event_phases
  FOR EACH ROW
  EXECUTE FUNCTION validate_phase_times();

COMMENT ON FUNCTION validate_phase_times IS 'Waliduje tylko że end_time > start_time. Fazy mogą się nakładać (np. setup i rehearsal).';

-- =====================================================
-- FIX 3: Repair existing vehicle data
-- =====================================================

-- Update is_in_use based on latest handover for each event_vehicle
DO $$
DECLARE
  rec RECORD;
  last_handover RECORD;
BEGIN
  FOR rec IN 
    SELECT DISTINCT event_vehicle_id 
    FROM vehicle_handovers
  LOOP
    -- Get the latest handover
    SELECT * INTO last_handover
    FROM vehicle_handovers
    WHERE event_vehicle_id = rec.event_vehicle_id
    ORDER BY timestamp DESC
    LIMIT 1;
    
    IF FOUND THEN
      IF last_handover.handover_type = 'pickup' THEN
        -- Last action was pickup - vehicle is in use
        UPDATE event_vehicles
        SET
          pickup_timestamp = last_handover.timestamp,
          pickup_odometer = last_handover.odometer_reading,
          return_timestamp = NULL,
          return_odometer = NULL,
          return_notes = NULL
        WHERE id = rec.event_vehicle_id;
        
      ELSIF last_handover.handover_type = 'return' THEN
        -- Last action was return - find the pickup before it
        DECLARE
          last_pickup RECORD;
        BEGIN
          SELECT * INTO last_pickup
          FROM vehicle_handovers
          WHERE event_vehicle_id = rec.event_vehicle_id
            AND handover_type = 'pickup'
            AND timestamp < last_handover.timestamp
          ORDER BY timestamp DESC
          LIMIT 1;
          
          IF FOUND THEN
            UPDATE event_vehicles
            SET
              pickup_timestamp = last_pickup.timestamp,
              pickup_odometer = last_pickup.odometer_reading,
              return_timestamp = last_handover.timestamp,
              return_odometer = last_handover.odometer_reading,
              return_notes = last_handover.notes
            WHERE id = rec.event_vehicle_id;
          END IF;
        END;
      END IF;
    END IF;
  END LOOP;
END $$;

-- Force update of is_in_use flag for all event_vehicles
UPDATE event_vehicles
SET is_in_use = (pickup_timestamp IS NOT NULL AND return_timestamp IS NULL);
