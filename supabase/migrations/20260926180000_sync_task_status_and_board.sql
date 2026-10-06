-- Keep ordinary tasks consistent regardless of which board or integration writes them.
-- Inquiry sales stages have their own mapping and must remain independent.
BEGIN;
CREATE OR REPLACE FUNCTION public.normalize_task_board_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.is_inquiry IS TRUE THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.board_column, 'todo') = 'todo' AND NEW.status::text <> 'todo' THEN
      NEW.board_column := NEW.status::text;
    END IF;
  ELSIF NEW.board_column IS NOT DISTINCT FROM OLD.board_column
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.board_column := NEW.status::text;
  END IF;
  CASE NEW.board_column
    WHEN 'todo' THEN NEW.status := 'todo';
    WHEN 'in_progress' THEN NEW.status := 'in_progress';
    WHEN 'review' THEN NEW.status := 'in_progress'; -- Legacy task_status has no review value.
    WHEN 'completed' THEN NEW.status := 'completed';
    WHEN 'cancelled' THEN NEW.status := 'cancelled';
    ELSE RETURN NEW;
  END CASE;
  IF NEW.board_column <> 'in_progress' THEN NEW.currently_working_by := NULL; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER normalize_task_board_status
  BEFORE INSERT OR UPDATE OF board_column, status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.normalize_task_board_status();

-- The original private-to-global synchronizer also inserted notifications using
-- obsolete related_id/employee_id columns. Notifications already have their own
-- trigger (notify_task_status_change); keep this function responsible only for sync.
CREATE OR REPLACE FUNCTION public.sync_private_to_global()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.is_private IS TRUE AND NEW.parent_task_id IS NOT NULL
    AND (OLD.board_column IS DISTINCT FROM NEW.board_column OR OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.tasks
       SET board_column = NEW.board_column, status = NEW.status, updated_at = now()
     WHERE id = NEW.parent_task_id AND is_private IS FALSE
       AND (board_column IS DISTINCT FROM NEW.board_column OR status IS DISTINCT FROM NEW.status);
  END IF;
  RETURN NEW;
END;
$$;
COMMIT;
