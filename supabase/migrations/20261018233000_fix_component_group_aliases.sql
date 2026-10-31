BEGIN;
-- Qualify JSON set-returning columns so they cannot collide with PL/pgSQL loop variables g/i.
CREATE OR REPLACE FUNCTION public.validate_product_component_groups(c jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE groups jsonb:=c->'component_groups';parent record;g jsonb;i jsonb;names text[];group_ids text[];item_ids text[];equipment_ids text[];q numeric;lo numeric;hi numeric;count_all integer:=0;count_parent integer;
BEGIN
 IF groups IS NULL THEN RETURN; END IF;
 IF jsonb_typeof(groups) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Nieprawidłowe grupy komponentów.'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(groups))>200 THEN RAISE EXCEPTION 'Zbyt wiele komponentów w drzewie.'; END IF;
 FOR parent IN SELECT key,value FROM jsonb_each(groups) LOOP
  IF parent.key!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR jsonb_typeof(parent.value) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Nieprawidłowy komponent nadrzędny.'; END IF;
  IF jsonb_array_length(parent.value)>25 THEN RAISE EXCEPTION 'Komponent może mieć maksymalnie 25 grup.'; END IF;
  names:='{}';group_ids:='{}';item_ids:='{}';equipment_ids:='{}';count_parent:=0;
  FOR g IN SELECT value FROM jsonb_array_elements(parent.value) LOOP
   IF coalesce(g->>'id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR (g->>'id')=ANY(group_ids) OR jsonb_typeof(g->'name') IS DISTINCT FROM 'string' OR length(trim(g->>'name')) NOT BETWEEN 1 AND 100 OR trim(g->>'name')=ANY(names) OR coalesce(g->>'requirement','') NOT IN ('required','recommended','optional') OR jsonb_typeof(g->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Uzupełnij unikalną nazwę, wymaganie i elementy zagnieżdżenia.'; END IF;
   IF jsonb_array_length(g->'items')<1 THEN RAISE EXCEPTION 'Dodaj przynajmniej jeden element do grupy: %.',g->>'name'; END IF;
   group_ids:=array_append(group_ids,g->>'id');names:=array_append(names,trim(g->>'name'));
   FOR i IN SELECT value FROM jsonb_array_elements(g->'items') LOOP
    count_all:=count_all+1;count_parent:=count_parent+1;
    IF count_all>500 OR count_parent>50 THEN RAISE EXCEPTION 'Zbyt wiele elementów w zagnieżdżeniach.'; END IF;
    IF coalesce(i->>'id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR coalesce(i->>'equipment_id','')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR (i->>'id')=ANY(item_ids) OR (i->>'equipment_id')=ANY(equipment_ids) OR i->>'equipment_id'=parent.key OR coalesce(i->>'mode','') NOT IN ('per_item','fixed') THEN RAISE EXCEPTION 'Nieprawidłowy lub powtórzony element zagnieżdżenia.'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(c->'roots') r WHERE r->>'equipment_id'=i->>'equipment_id') THEN RAISE EXCEPTION 'Element całego produktu nie może być jednocześnie jego zagnieżdżonym składnikiem.'; END IF;
    item_ids:=array_append(item_ids,i->>'id');equipment_ids:=array_append(equipment_ids,i->>'equipment_id');
    q:=public.modular_numeric(i->'quantity','liczba elementów',false,1000);IF q<=0 THEN RAISE EXCEPTION 'Liczba elementów musi być dodatnia.'; END IF;
    lo:=public.modular_numeric(i->'min_height','minimalna wysokość',true,200,true);hi:=public.modular_numeric(i->'max_height','maksymalna wysokość',true,200,true);
    IF lo<1 OR hi<1 OR lo>hi THEN RAISE EXCEPTION 'Popraw zakres wysokości elementu.'; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 IF EXISTS (
  WITH RECURSIVE edges AS (
   SELECT parent_entry.key AS parent_id, item_entry.item_value->>'equipment_id' AS child_id
   FROM jsonb_each(groups) AS parent_entry
   CROSS JOIN LATERAL jsonb_array_elements(parent_entry.value) AS group_entry(group_value)
   CROSS JOIN LATERAL jsonb_array_elements(group_entry.group_value->'items') AS item_entry(item_value)
  ), walk(id,path,cycle) AS (
   SELECT k,ARRAY[k],false FROM jsonb_object_keys(groups) k
   UNION ALL
   SELECT e.child_id,w.path||e.child_id,e.child_id=ANY(w.path) FROM walk w JOIN edges e ON e.parent_id=w.id WHERE NOT w.cycle AND cardinality(w.path)<=8
  ) SELECT 1 FROM walk WHERE cycle OR cardinality(path)>8
 ) THEN RAISE EXCEPTION 'Drzewo zawiera pętlę lub przekracza 8 poziomów.'; END IF;
END $function$;
NOTIFY pgrst,'reload schema';
COMMIT;
