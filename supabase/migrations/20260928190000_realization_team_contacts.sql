-- Extend the existing authorized, operational-only payload with event team contacts.
DO $$ DECLARE definition text; marker text := '''equipment'',(SELECT'; BEGIN
 definition:=pg_get_functiondef('public.get_realization_workspace(uuid)'::regprocedure);
 IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'Missing workspace equipment section'; END IF;
 definition:=replace(definition,marker,$team$
 'team',(SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',a.id,'employee_id',employee.id,'name',concat_ws(' ',employee.name,employee.surname),
 'role',a.role,'responsibilities',a.responsibilities,'status',a.status,
 'phone',employee.phone_number,'email',employee.email
 ) ORDER BY employee.surname,employee.name),'[]'::jsonb)
 FROM public.employee_assignments a JOIN public.employees employee ON employee.id=a.employee_id
 WHERE a.event_id=e.id AND employee.is_active AND a.status IN ('accepted','pending')),
 'equipment',(SELECT$team$);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
