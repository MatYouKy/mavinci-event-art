BEGIN;
CREATE TABLE public.employee_time_settlements (
 id uuid PRIMARY KEY,
 employee_id uuid NOT NULL REFERENCES public.employees(id),
 previous_id uuid REFERENCES public.employee_time_settlements(id),
 settled_until timestamptz NOT NULL,
 hours numeric(12,2) NOT NULL CHECK(hours>0 AND hours<=1000000),
 hourly_rate numeric(12,2) NOT NULL CHECK(hourly_rate>0 AND hourly_rate<=1000000),
 amount numeric(16,2) GENERATED ALWAYS AS (round(hours*hourly_rate,2)) STORED,
 report_minutes numeric NOT NULL,
 report_signature text NOT NULL,
 notes text,
 created_by uuid NOT NULL REFERENCES public.employees(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 voided_at timestamptz, voided_by uuid REFERENCES public.employees(id), void_reason text
);
CREATE INDEX employee_time_settlements_employee ON public.employee_time_settlements(employee_id,settled_until DESC) WHERE voided_at IS NULL;
ALTER TABLE public.employee_time_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_time_settlements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.employee_time_settlements TO authenticated;
CREATE POLICY employee_time_settlements_read ON public.employee_time_settlements FOR SELECT TO authenticated
 USING (NOT public.current_session_is_seller_portal() AND (public.personnel_can_access() OR employee_id=public.current_workflow_employee_id()));

-- Fingerprint includes all earlier work, so late additions and edits cannot silently look paid.
CREATE FUNCTION public.employee_time_report_signature(p_employee uuid,p_until timestamptz)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(id,start_time,end_time,duration_minutes) ORDER BY id)::text,'[]'))
 FROM public.time_entries WHERE employee_id=p_employee AND start_time<=p_until;
$$;
REVOKE ALL ON FUNCTION public.employee_time_report_signature(uuid,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_employee_time_settlement_preview(p_employee uuid,p_until timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE last_row public.employee_time_settlements; minutes numeric; entry_count integer; crossing integer; recent jsonb; changed boolean:=false;
BEGIN
 IF public.current_session_is_seller_portal() OR NOT (public.personnel_can_access() OR p_employee=public.current_workflow_employee_id()) THEN RAISE EXCEPTION 'Brak uprawnień do rozliczeń pracownika'; END IF;
 IF p_until IS NULL OR NOT isfinite(p_until) THEN RAISE EXCEPTION 'Podaj datę i godzinę rozliczenia'; END IF;
 SELECT * INTO last_row FROM public.employee_time_settlements WHERE employee_id=p_employee AND voided_at IS NULL ORDER BY settled_until DESC LIMIT 1;
 IF last_row.id IS NOT NULL THEN changed:=last_row.report_signature IS DISTINCT FROM public.employee_time_report_signature(p_employee,last_row.settled_until); END IF;
 SELECT coalesce(sum(coalesce(duration_minutes,extract(epoch FROM end_time-start_time)/60)),0),count(*) INTO minutes,entry_count
 FROM public.time_entries WHERE employee_id=p_employee AND end_time IS NOT NULL AND end_time<=p_until AND (last_row.id IS NULL OR end_time>last_row.settled_until);
 SELECT count(*) INTO crossing FROM public.time_entries WHERE employee_id=p_employee AND start_time<p_until AND (end_time IS NULL OR end_time>p_until);
 SELECT coalesce(jsonb_agg(to_jsonb(s)-'report_signature' ORDER BY s.created_at DESC),'[]') INTO recent FROM (SELECT * FROM public.employee_time_settlements WHERE employee_id=p_employee ORDER BY created_at DESC LIMIT 20) s;
 RETURN jsonb_build_object('can_manage',public.personnel_can_access(true),'latest',CASE WHEN last_row.id IS NULL THEN NULL ELSE to_jsonb(last_row)-'report_signature' END,
 'latest_changed',changed,'history',recent,'minutes',minutes,'entry_count',entry_count,'crossing_count',crossing,'signature',public.employee_time_report_signature(p_employee,p_until));
END $$;

CREATE FUNCTION public.save_employee_time_settlement(p_id uuid,p_employee uuid,p_until timestamptz,p_hours numeric,p_rate numeric,p_previous uuid,p_signature text,p_notes text DEFAULT NULL,p_accept_adjustment boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_preview jsonb; saved public.employee_time_settlements; actor uuid;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do zapisywania rozliczeń'; END IF;
 actor:=public.current_workflow_employee_id();
 PERFORM 1 FROM public.employees WHERE id=p_employee FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pracownika'; END IF;
 IF p_id IS NULL OR p_until IS NULL OR NOT isfinite(p_until) OR p_until>now() THEN RAISE EXCEPTION 'Wskaż moment rozliczenia nie późniejszy niż teraz'; END IF;
 IF p_hours IS NULL OR p_rate IS NULL OR p_hours NOT BETWEEN 0.01 AND 1000000 OR p_rate NOT BETWEEN 0.01 AND 1000000 OR p_hours<>round(p_hours,2) OR p_rate<>round(p_rate,2) THEN RAISE EXCEPTION 'Podaj dodatnią liczbę godzin i stawkę, maksymalnie dwa miejsca po przecinku'; END IF;
 IF length(coalesce(p_notes,''))>2000 THEN RAISE EXCEPTION 'Notatka może mieć maksymalnie 2000 znaków'; END IF;
 SELECT * INTO saved FROM public.employee_time_settlements WHERE id=p_id;
 IF FOUND THEN
   IF saved.employee_id=p_employee AND saved.created_by=actor AND saved.settled_until=p_until AND saved.hours=p_hours AND saved.hourly_rate=p_rate AND saved.voided_at IS NULL THEN RETURN to_jsonb(saved)-'report_signature'; END IF;
   RAISE EXCEPTION 'To rozliczenie zostało już zapisane. Odśwież dane';
 END IF;
 current_preview:=public.get_employee_time_settlement_preview(p_employee,p_until);
 IF nullif(current_preview->'latest'->>'id','')::uuid IS DISTINCT FROM p_previous THEN RAISE EXCEPTION 'Rozliczenia zmieniły się. Odśwież podgląd przed zapisem'; END IF;
 IF p_previous IS NOT NULL AND p_until <= (current_preview->'latest'->>'settled_until')::timestamptz THEN RAISE EXCEPTION 'Nowe rozliczenie musi być późniejsze od poprzedniego'; END IF;
 IF (current_preview->>'signature') IS DISTINCT FROM p_signature THEN RAISE EXCEPTION 'Raport czasu zmienił się. Odśwież podgląd i sprawdź godziny'; END IF;
 IF (current_preview->>'crossing_count')::integer>0 THEN RAISE EXCEPTION 'Wpis czasu trwa przez wybrany moment. Zakończ go lub wybierz granicę pomiędzy wpisami'; END IF;
 IF NOT coalesce(p_accept_adjustment,false) AND (p_hours<>round((current_preview->>'minutes')::numeric/60,2) OR (current_preview->>'latest_changed')::boolean) THEN RAISE EXCEPTION 'Potwierdź ręczne uzgodnienie liczby godzin i rozliczanego okresu'; END IF;
 INSERT INTO public.employee_time_settlements(id,employee_id,previous_id,settled_until,hours,hourly_rate,report_minutes,report_signature,notes,created_by)
 VALUES(p_id,p_employee,p_previous,p_until,p_hours,p_rate,(current_preview->>'minutes')::numeric,p_signature,nullif(btrim(p_notes),''),actor) RETURNING * INTO saved;
 RETURN to_jsonb(saved)-'report_signature';
END $$;

CREATE FUNCTION public.void_employee_time_settlement(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target uuid; latest uuid;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do rozliczeń'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Podaj powód cofnięcia (do 2000 znaków)'; END IF;
 SELECT employee_id INTO target FROM public.employee_time_settlements WHERE id=p_id;
 IF target IS NULL THEN RAISE EXCEPTION 'Nie znaleziono rozliczenia'; END IF;
 PERFORM 1 FROM public.employees WHERE id=target FOR UPDATE;
 SELECT id INTO latest FROM public.employee_time_settlements WHERE employee_id=target AND voided_at IS NULL ORDER BY settled_until DESC LIMIT 1;
 IF latest IS DISTINCT FROM p_id THEN RAISE EXCEPTION 'Można cofnąć tylko ostatnie aktywne rozliczenie'; END IF;
 UPDATE public.employee_time_settlements SET voided_at=now(),voided_by=public.current_workflow_employee_id(),void_reason=btrim(p_reason) WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.get_employee_time_settlement_preview(uuid,timestamptz),public.save_employee_time_settlement(uuid,uuid,timestamptz,numeric,numeric,uuid,text,text,boolean),public.void_employee_time_settlement(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_time_settlement_preview(uuid,timestamptz),public.save_employee_time_settlement(uuid,uuid,timestamptz,numeric,numeric,uuid,text,text,boolean),public.void_employee_time_settlement(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
