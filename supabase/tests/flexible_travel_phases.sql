BEGIN;
SET LOCAL statement_timeout='15s';
DO $$
DECLARE target uuid; phases_before bigint; stages jsonb;
BEGIN
 SELECT id INTO target FROM public.events LIMIT 1;
 IF target IS NULL THEN RAISE EXCEPTION 'Missing event fixture'; END IF;
 SELECT count(*) INTO phases_before FROM public.event_phases WHERE event_id=target;
 PERFORM public.save_flexible_travel_phase(target,'outbound','Dojazd','Bez godzin');
 PERFORM public.save_flexible_travel_phase(target,'inbound','Powrót','');
 PERFORM public.save_flexible_travel_phase(target,'outbound','Dojazd poprawiony','');
 SELECT flexible_travel_phases INTO stages FROM public.events WHERE id=target;
 IF jsonb_array_length(stages)<>2 THEN RAISE EXCEPTION 'Duplicate phase or lost direction'; END IF;
 IF (SELECT count(*) FROM public.event_phases WHERE event_id=target)<>phases_before THEN
   RAISE EXCEPTION 'Created a dated phase for an undated declaration';
 END IF;
 PERFORM public.save_flexible_travel_phase(target,'outbound',NULL,'');
 SELECT flexible_travel_phases INTO stages FROM public.events WHERE id=target;
 IF jsonb_array_length(stages)<>1 OR stages->0->>'key'<>'inbound' THEN RAISE EXCEPTION 'Wrong removal'; END IF;
END $$;
SELECT 'PASS: save without times; both directions retained; duplicate save updates; removal preserves other direction; no fabricated event phase' AS result;
ROLLBACK;
