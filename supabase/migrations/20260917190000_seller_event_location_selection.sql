BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.create_event_from_seller_offer(uuid,text,integer,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw uruchom migrację 20260911234500.';
  END IF;
END $$;

-- Reuse the existing two-stage handoff, concurrency guards and notification
-- triggers. Save the location relation in the same transaction, never as a
-- second browser request after an event was already confirmed.
CREATE OR REPLACE FUNCTION public.create_event_from_seller_offer_at_location(
  p_offer_id uuid, p_source_key text, p_revision integer, p_values jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_offer public.offers%ROWTYPE;
  v_location uuid;
  v_location_text text;
  v_result jsonb;
BEGIN
  IF NOT COALESCE(public.seller_offer_can_create_event(p_offer_id),false) THEN
    RAISE EXCEPTION 'Brak uprawnień do utworzenia wydarzenia tej marki';
  END IF;
  SELECT * INTO STRICT v_offer FROM public.offers
    WHERE id=p_offer_id AND sales_channel='seller_portal' FOR UPDATE;

  -- Retrying a successful handoff must never overwrite the event's location.
  -- The original function also checks access to this existing event.
  IF v_offer.event_id IS NOT NULL THEN
    RETURN public.create_event_from_seller_offer(p_offer_id,p_source_key,p_revision,p_values);
  END IF;
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Nieprawidłowe dane wydarzenia';
  END IF;
  v_location:=NULLIF(p_values->>'location_id','')::uuid;
  IF v_location IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.employees e
      WHERE e.id=public.current_employee_id() AND e.is_active
        AND (e.role::text='admin' OR e.access_level::text='admin'
          OR COALESCE(e.permissions,'{}'::text[]) && ARRAY[
            'admin','locations_view','locations_manage','calendar_view','calendar_manage'
          ]::text[])) THEN
      RAISE EXCEPTION 'Brak uprawnień do korzystania z bazy lokalizacji';
    END IF;
    SELECT concat_ws(', ',NULLIF(btrim(l.name),''),NULLIF(btrim(l.address),''),
      NULLIF(btrim(l.city),''),NULLIF(btrim(l.postal_code),''))
      INTO v_location_text FROM public.locations l WHERE l.id=v_location FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Wybrana lokalizacja nie istnieje. Wybierz ją ponownie.'; END IF;
    p_values:=p_values||jsonb_build_object('location',v_location_text);
  END IF;

  v_result:=public.create_event_from_seller_offer(p_offer_id,p_source_key,p_revision,p_values);
  IF v_location IS NOT NULL THEN
    UPDATE public.events SET location_id=v_location
      WHERE id=(v_result->>'event_id')::uuid AND my_company_id=v_offer.my_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Nie udało się powiązać lokalizacji. Wydarzenie nie zostało zapisane.'; END IF;
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_from_seller_offer_at_location(uuid,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_event_from_seller_offer_at_location(uuid,text,integer,jsonb) TO authenticated;

COMMIT;
