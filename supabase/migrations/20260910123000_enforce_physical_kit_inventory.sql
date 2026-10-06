-- Physical kits share a finite inventory. All writes use one transaction lock;
-- deferred checks see the final composition, including atomic replacement.
BEGIN;
CREATE OR REPLACE FUNCTION public.lock_kit_inventory()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(719204, 1);
  RETURN NULL;
END; $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['equipment_kits','equipment_kit_items','equipment_units','equipment_items','cables'] LOOP
    EXECUTE format('CREATE TRIGGER serialize_kit_inventory BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.lock_kit_inventory()', t);
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.kit_component_usable_stock(p_equipment_id uuid, p_cable_id uuid)
RETURNS numeric LANGUAGE sql SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_equipment_id IS NOT NULL THEN COALESCE((
    SELECT CASE WHEN EXISTS (SELECT 1 FROM equipment_units u WHERE u.equipment_id = e.id)
      THEN (SELECT count(*) FROM equipment_units u WHERE u.equipment_id = e.id
        AND u.status::text IN ('available','reserved','in_use'))
      ELSE greatest(coalesce(e.total_quantity,0),0) END
    FROM equipment_items e WHERE e.id = p_equipment_id AND e.is_active
  ),0) ELSE COALESCE((SELECT greatest(coalesce(c.stock_quantity,0),0)
    FROM cables c WHERE c.id = p_cable_id AND c.is_active AND c.deleted_at IS NULL),0) END;
$$;

CREATE OR REPLACE FUNCTION public.validate_physical_kit_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_component record; v_need numeric; v_stock numeric; v_name text;
BEGIN
  IF TG_TABLE_NAME = 'equipment_kits' THEN v_id := NEW.id;
  ELSE v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.kit_id ELSE NEW.kit_id END; END IF;
  IF NOT EXISTS (SELECT 1 FROM equipment_kits k WHERE k.id = v_id AND k.is_active AND k.deleted_at IS NULL) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM equipment_kit_items i WHERE i.kit_id = v_id) THEN
    RAISE EXCEPTION 'Zestaw musi zawierać przynajmniej jeden składnik.' USING ERRCODE = '23514';
  END IF;
  FOR v_component IN SELECT DISTINCT equipment_id, cable_id FROM equipment_kit_items WHERE kit_id = v_id LOOP
    SELECT coalesce(sum(k.quantity::numeric * i.quantity),0) INTO v_need
    FROM equipment_kit_items i JOIN equipment_kits k ON k.id = i.kit_id
    WHERE k.is_active AND k.deleted_at IS NULL
      AND i.equipment_id IS NOT DISTINCT FROM v_component.equipment_id
      AND i.cable_id IS NOT DISTINCT FROM v_component.cable_id;
    v_stock := public.kit_component_usable_stock(v_component.equipment_id, v_component.cable_id);
    SELECT coalesce((SELECT name FROM equipment_items WHERE id = v_component.equipment_id),
                    (SELECT name FROM cables WHERE id = v_component.cable_id),'Składnik') INTO v_name;
    IF v_need > v_stock THEN
      RAISE EXCEPTION '%: wszystkie zestawy wymagają %, sprawnych w magazynie %, brakuje %.', v_name, v_need, v_stock, v_need - v_stock USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER physical_kit_stock AFTER INSERT OR UPDATE ON public.equipment_kits
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_physical_kit_inventory();
CREATE CONSTRAINT TRIGGER physical_kit_component_stock AFTER INSERT OR UPDATE OR DELETE ON public.equipment_kit_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_physical_kit_inventory();

CREATE OR REPLACE FUNCTION public.save_equipment_kit_checked(p_kit_id uuid, p_kit jsonb, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_quantity integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.auth_user_id = auth.uid()
    AND (e.role::text = 'admin' OR 'admin' = ANY(coalesce(e.permissions,ARRAY[]::text[]))
      OR 'equipment_manage' = ANY(coalesce(e.permissions,ARRAY[]::text[])))
  ) THEN RAISE EXCEPTION 'Brak uprawnień do zarządzania magazynem.' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(719204,1);
  IF nullif(trim(p_kit->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Nazwa zestawu jest wymagana.' USING ERRCODE = '23514'; END IF;
  v_quantity := (p_kit->>'quantity')::integer;
  IF v_quantity IS NULL OR v_quantity < 1 THEN RAISE EXCEPTION 'Podaj dodatnią liczbę zestawów.' USING ERRCODE = '23514'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Dodaj przynajmniej jeden składnik.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) i WHERE
      coalesce((i->>'quantity')::numeric,0) <= 0 OR
      (i->>'quantity')::numeric <> trunc((i->>'quantity')::numeric) OR
      ((nullif(i->>'equipment_id','') IS NULL) = (nullif(i->>'cable_id','') IS NULL))) THEN
    RAISE EXCEPTION 'Każdy składnik wymaga jednego urządzenia lub przewodu i dodatniej całkowitej ilości.' USING ERRCODE = '23514';
  END IF;
  IF p_kit_id IS NULL THEN
    INSERT INTO equipment_kits(name,description,thumbnail_url,warehouse_category_id,quantity,created_by)
    VALUES(trim(p_kit->>'name'),nullif(p_kit->>'description',''),nullif(p_kit->>'thumbnail_url',''),
      nullif(p_kit->>'warehouse_category_id','')::uuid,v_quantity,(SELECT id FROM employees WHERE auth_user_id=auth.uid() LIMIT 1)) RETURNING id INTO v_id;
  ELSE
    UPDATE equipment_kits SET name=trim(p_kit->>'name'), description=nullif(p_kit->>'description',''),
      thumbnail_url=nullif(p_kit->>'thumbnail_url',''), warehouse_category_id=nullif(p_kit->>'warehouse_category_id','')::uuid,
      quantity=v_quantity WHERE id=p_kit_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Nie znaleziono zestawu lub brak uprawnień.' USING ERRCODE = '42501'; END IF;
    DELETE FROM equipment_kit_items WHERE kit_id=v_id;
  END IF;
  INSERT INTO equipment_kit_items(kit_id,equipment_id,cable_id,quantity,notes,order_index)
  SELECT v_id,nullif(i->>'equipment_id','')::uuid,nullif(i->>'cable_id','')::uuid,
    (i->>'quantity')::integer,nullif(i->>'notes',''),(n-1)::integer
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(i,n);
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_equipment_kit_checked(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_equipment_kit_checked(uuid,jsonb,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.kit_component_usable_stock(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kit_component_usable_stock(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.check_equipment_inventory_for_event(p_event_id uuid,p_start_date timestamptz,p_end_date timestamptz)
RETURNS TABLE(item_id uuid,item_type text,item_name text,total_quantity integer,reserved_quantity integer,available_quantity integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Wymagane logowanie.' USING ERRCODE='42501'; END IF;
  RETURN QUERY WITH overlapping_events AS (
    SELECT e.id FROM events e WHERE e.id <> p_event_id AND coalesce(e.status::text,'') <> 'cancelled'
    AND e.event_date < p_end_date AND coalesce(e.event_end_date,e.event_date+interval '1 day') > p_start_date
  ), reservations AS (
    SELECT ee.* FROM event_equipment ee WHERE ee.event_id IN (SELECT id FROM overlapping_events)
    AND coalesce(ee.status::text,'reserved') IN ('reserved','in_use')
    AND NOT coalesce(ee.removed_from_offer,false) AND NOT coalesce(ee.use_external_rental,false)
  ), demands AS (
    -- Keep the warehouse booking dates (including preparation/return buffers).
    SELECT b.equipment_id,b.quantity::numeric AS qty FROM equipment_bookings b
    JOIN events e ON e.id=b.event_id WHERE b.event_id <> p_event_id
      AND coalesce(e.status::text,'') <> 'cancelled'
      AND (b.start_date,b.end_date) OVERLAPS (p_start_date,p_end_date)
  ), equipment_stock AS (
    SELECT e.id,e.name,public.kit_component_usable_stock(e.id,NULL)::integer AS total,
      coalesce((SELECT sum(d.qty) FROM demands d WHERE d.equipment_id=e.id),0)::integer AS reserved
    FROM equipment_items e
  )
  SELECT e.id,'item'::text,e.name,e.total,e.reserved,greatest(e.total-e.reserved,0) FROM equipment_stock e
  UNION ALL
  SELECT k.id,'kit'::text,k.name,k.quantity,
    coalesce((SELECT sum(r.quantity) FROM reservations r WHERE r.kit_id=k.id),0)::integer,
    greatest(k.quantity-coalesce((SELECT sum(r.quantity) FROM reservations r WHERE r.kit_id=k.id),0),0)::integer
  FROM equipment_kits k WHERE k.is_active AND k.deleted_at IS NULL;
END; $$;
REVOKE ALL ON FUNCTION public.check_equipment_inventory_for_event(uuid,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_equipment_inventory_for_event(uuid,timestamptz,timestamptz) TO authenticated;

-- Enforce the same limits when a kit reservation is created or increased.
CREATE TRIGGER serialize_event_kit_inventory BEFORE INSERT OR UPDATE OR DELETE ON public.event_equipment
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_kit_inventory();
CREATE OR REPLACE FUNCTION public.validate_event_kit_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row event_equipment%ROWTYPE; v_event events%ROWTYPE; v_total numeric; v_stock numeric; v_component record; v_name text;
BEGIN
  SELECT * INTO v_row FROM event_equipment WHERE id=NEW.id;
  IF NOT FOUND OR v_row.kit_id IS NULL OR coalesce(v_row.use_external_rental,false)
    OR coalesce(v_row.removed_from_offer,false) OR coalesce(v_row.status::text,'reserved') NOT IN ('reserved','in_use') THEN RETURN NULL; END IF;
  -- Permit reducing an existing shortage and editing notes after a breakdown.
  IF TG_OP='UPDATE' THEN
    IF OLD.kit_id IS NOT DISTINCT FROM v_row.kit_id AND OLD.event_id=v_row.event_id
      AND OLD.quantity >= v_row.quantity AND NOT coalesce(OLD.use_external_rental,false)
      AND NOT coalesce(OLD.removed_from_offer,false) AND coalesce(OLD.status::text,'reserved') IN ('reserved','in_use') THEN RETURN NULL; END IF;
  END IF;
  SELECT * INTO v_event FROM events WHERE id=v_row.event_id;
  IF v_event.status::text='cancelled' THEN RETURN NULL; END IF;
  SELECT k.quantity,k.name INTO v_stock,v_name FROM equipment_kits k WHERE k.id=v_row.kit_id AND k.is_active AND k.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zestaw jest nieaktywny.' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(r.quantity),0) INTO v_total FROM event_equipment r JOIN events e ON e.id=r.event_id
  WHERE r.kit_id=v_row.kit_id AND NOT coalesce(r.use_external_rental,false) AND NOT coalesce(r.removed_from_offer,false)
    AND coalesce(r.status::text,'reserved') IN ('reserved','in_use') AND coalesce(e.status::text,'') <> 'cancelled'
    AND (e.id=v_event.id OR (e.event_date < coalesce(v_event.event_end_date,v_event.event_date+interval '1 day')
      AND coalesce(e.event_end_date,e.event_date+interval '1 day') > v_event.event_date));
  IF v_total > v_stock THEN RAISE EXCEPTION '%: rezerwacje wymagają % zestawów, posiadasz %.',v_name,v_total,v_stock USING ERRCODE='23514'; END IF;
  FOR v_component IN SELECT DISTINCT equipment_id,cable_id FROM equipment_kit_items WHERE kit_id=v_row.kit_id LOOP
    WITH active AS (
      SELECT r.* FROM event_equipment r JOIN events e ON e.id=r.event_id
      WHERE NOT coalesce(r.use_external_rental,false) AND NOT coalesce(r.removed_from_offer,false)
        AND coalesce(r.status::text,'reserved') IN ('reserved','in_use') AND coalesce(e.status::text,'') <> 'cancelled'
        AND (e.id=v_event.id OR (e.event_date < coalesce(v_event.event_end_date,v_event.event_date+interval '1 day')
          AND coalesce(e.event_end_date,e.event_date+interval '1 day') > v_event.event_date))
    ), demand AS (
      SELECT r.quantity::numeric AS qty FROM active r WHERE
        (v_component.equipment_id IS NOT NULL AND r.equipment_id=v_component.equipment_id)
        OR (v_component.cable_id IS NOT NULL AND r.cable_id=v_component.cable_id)
      UNION ALL
      SELECT r.quantity::numeric*i.quantity FROM active r JOIN equipment_kit_items i ON i.kit_id=r.kit_id
      WHERE i.equipment_id IS NOT DISTINCT FROM v_component.equipment_id AND i.cable_id IS NOT DISTINCT FROM v_component.cable_id
    ) SELECT coalesce(sum(qty),0) INTO v_total FROM demand;
    v_stock:=public.kit_component_usable_stock(v_component.equipment_id,v_component.cable_id);
    IF v_total > v_stock THEN
      SELECT coalesce((SELECT name FROM equipment_items WHERE id=v_component.equipment_id),(SELECT name FROM cables WHERE id=v_component.cable_id),'Składnik') INTO v_name;
      RAISE EXCEPTION '%: rezerwacje wymagają %, sprawnych %, brakuje %.',v_name,v_total,v_stock,v_total-v_stock USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER event_kit_stock AFTER INSERT OR UPDATE ON public.event_equipment
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_event_kit_inventory();

COMMIT;
