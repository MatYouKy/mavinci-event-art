ALTER TABLE events
  ADD COLUMN IF NOT EXISTS planned_setup_at timestamptz,
  ADD COLUMN IF NOT EXISTS planned_teardown_at timestamptz;

COMMENT ON COLUMN events.planned_setup_at IS
  'Planowany termin rozpoczecia montazu, przeznaczony m.in. do umow.';

COMMENT ON COLUMN events.planned_teardown_at IS
  'Planowany termin rozpoczecia demontazu, przeznaczony m.in. do umow.';
