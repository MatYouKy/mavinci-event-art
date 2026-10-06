-- Zdalne usuwanie pozycji pokazu z Mavinci LIVE.
-- Polecenie wykonuje samo urządzenie, dzięki czemu najpierw aktualizuje projekt,
-- a dopiero potem usuwa nieużywane pliki z jego pamięci.

ALTER TABLE public.mavinci_view_commands
  DROP CONSTRAINT IF EXISTS mavinci_view_commands_command_check;

ALTER TABLE public.mavinci_view_commands
  ADD CONSTRAINT mavinci_view_commands_command_check CHECK (command IN (
    'add_assets', 'set_order', 'delete_slides',
    'play', 'pause', 'resume', 'stop', 'next', 'previous', 'go_to'
  ));
