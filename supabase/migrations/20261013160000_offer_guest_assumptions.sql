BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
-- Work only on NEW: no recursive offer update, joins, or additional repricing.
CREATE OR REPLACE FUNCTION public.sync_offer_guest_assumptions()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
  original jsonb := NEW.event_assumption_items;
  items jsonb := CASE WHEN jsonb_typeof(NEW.event_assumption_items)='array' THEN NEW.event_assumption_items ELSE '[]'::jsonb END;
  card jsonb;
  target_index integer := -1;
  empty_index integer := -1;
  pos integer := 0;
  count_cleared boolean := false;
BEGIN
  IF TG_OP='UPDATE' THEN
    count_cleared := OLD.guest_count IS NOT NULL AND NEW.guest_count IS NULL;
  END IF;
  IF NEW.guest_count IS NULL AND NOT count_cleared THEN RETURN NEW; END IF;
  IF jsonb_array_length(items)=0 AND NEW.guest_count IS NOT NULL THEN
    items := jsonb_build_array(
      jsonb_build_object('key','guest_count','label','Liczba gości','value','','badge_value',''),
      jsonb_build_object('key','event_hours','label','Godziny wydarzenia','value','','badge_value',''),
      jsonb_build_object('key','client_needs','label','Przebieg i potrzeby klienta','value',coalesce(NEW.event_assumptions,''),'badge_value','')
    );
  END IF;
  FOR card IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF card->>'key'='guest_count' THEN target_index:=pos; EXIT; END IF;
    IF empty_index=-1 AND btrim(coalesce(card->>'value',''))='' AND btrim(coalesce(card->>'badge_value',''))='' THEN empty_index:=pos; END IF;
    pos:=pos+1;
  END LOOP;
  IF NEW.guest_count IS NOT NULL THEN
    card:=jsonb_build_object('key','guest_count','label','Liczba gości','value',NEW.guest_count::text||' osób','badge_value',NEW.guest_count::text);
    IF target_index=-1 THEN target_index:=empty_index; END IF;
    IF target_index>=0 THEN
      items:=jsonb_set(items,ARRAY[target_index::text],card);
    ELSIF jsonb_array_length(items)<3 THEN
      items:=items||jsonb_build_array(card);
    END IF;
  ELSIF target_index>=0 THEN
    items:=jsonb_set(items,ARRAY[target_index::text],(items->target_index)||jsonb_build_object('value','','badge_value',''));
  END IF;
  IF items IS DISTINCT FROM original THEN
    NEW.event_assumption_items:=items;
    SELECT string_agg(coalesce(nullif(btrim(value->>'label'),''),'Założenie')||': '||btrim(value->>'value'), E'\n' ORDER BY ord)
      INTO NEW.event_assumptions
      FROM jsonb_array_elements(items) WITH ORDINALITY AS a(value,ord)
      WHERE btrim(coalesce(value->>'value',''))<>'';
  END IF;
  RETURN NEW;
END;
$$;
-- After inquiry inheritance, before audience/revision/PDF guards.
DROP TRIGGER IF EXISTS zyz_offer_guest_assumptions ON public.offers;
CREATE TRIGGER zyz_offer_guest_assumptions
BEFORE INSERT OR UPDATE OF guest_count,event_assumption_items ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.sync_offer_guest_assumptions();
COMMIT;
