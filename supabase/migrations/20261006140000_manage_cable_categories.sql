BEGIN;
-- Existing RLS limits writes to employees managing equipment.
GRANT INSERT, UPDATE ON public.cable_categories TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_cable_category_hierarchy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE parent_category public.cable_categories;
BEGIN
 -- Serialize category edits to prevent concurrent reparenting from creating a cycle.
 PERFORM pg_advisory_xact_lock(20261006,1400);
 NEW.name:=btrim(NEW.name);
 IF NEW.name='' THEN RAISE EXCEPTION 'Podaj nazwę kategorii.'; END IF;
 IF NEW.color !~ '^#[0-9A-Fa-f]{6}$' THEN RAISE EXCEPTION 'Nieprawidłowy kolor kategorii.'; END IF;
 IF NEW.parent_id IS NOT NULL THEN
  IF NEW.parent_id=NEW.id THEN RAISE EXCEPTION 'Kategoria nie może być własną grupą nadrzędną.'; END IF;
  SELECT * INTO parent_category FROM public.cable_categories WHERE id=NEW.parent_id;
  IF NOT FOUND OR parent_category.parent_id IS NOT NULL THEN RAISE EXCEPTION 'Wybierz istniejącą grupę główną.'; END IF;
  IF NEW.is_active AND NOT parent_category.is_active THEN RAISE EXCEPTION 'Najpierw włącz grupę nadrzędną.'; END IF;
  IF EXISTS(SELECT 1 FROM public.cable_categories WHERE parent_id=NEW.id) THEN RAISE EXCEPTION 'Kategoria z podkategoriami musi pozostać grupą główną.'; END IF;
 END IF;
 IF NOT NEW.is_active AND EXISTS(SELECT 1 FROM public.cable_categories WHERE parent_id=NEW.id AND is_active) THEN
  RAISE EXCEPTION 'Najpierw wyłącz aktywne podkategorie tej grupy.';
 END IF;
 NEW.updated_at:=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_cable_category_hierarchy() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cable_category_hierarchy_guard BEFORE INSERT OR UPDATE ON public.cable_categories
 FOR EACH ROW EXECUTE FUNCTION public.guard_cable_category_hierarchy();
NOTIFY pgrst,'reload schema';
COMMIT;
