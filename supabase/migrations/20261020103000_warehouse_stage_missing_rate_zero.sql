BEGIN;
SET LOCAL lock_timeout='5s';

CREATE OR REPLACE FUNCTION public.warehouse_stage_visit(s jsonb,equipment_id text,q numeric,path text,ancestors text[],state jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE n jsonb:=s->'equipment'->equipment_id;p jsonb:=s->'selection';links jsonb;g record;l jsonb;chosen jsonb;selected_id text;required boolean;k text;rate numeric;amount numeric;h numeric;seen jsonb:=state->'seen';total numeric:=(state->>'total')::numeric;visits integer:=(state->>'visits')::integer;
BEGIN
 visits:=visits+1;
 IF visits>300 OR coalesce(array_length(ancestors,1),0)>=8 OR equipment_id=ANY(ancestors) THEN RAISE EXCEPTION 'Pętla lub zbyt głębokie zależności sprzętu.'; END IF;
 IF n IS NULL THEN RAISE EXCEPTION 'Brakuje sprzętu w kopii konfiguracji. Pobierz dane ponownie.'; END IF;
 IF q<=0 OR q>100000 OR q<>round(q,2) THEN RAISE EXCEPTION 'Podaj poprawną ilość: %.',n->>'name'; END IF;
 -- Missing rental prices contribute zero; malformed or negative prices still fail validation.
 rate:=coalesce(public.modular_numeric(n->'rate',n->>'name',true),0);
 total:=total+round(q*rate,2);h:=(p->>'height')::numeric;
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO links FROM jsonb_array_elements(n->'links') x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s#>'{catalog,roots}') root WHERE root->>'equipment_id'=x->>'equipment_id');
 FOR g IN SELECT CASE WHEN x->>'group' IS NOT NULL THEN 'group:'||(x->>'group') ELSE 'item:'||(x->>'id') END AS key,jsonb_agg(x ORDER BY ord) AS options,bool_or(x->>'type'='required') AS required,bool_or(x->>'group' IS NOT NULL) AS choice FROM jsonb_array_elements(links) WITH ORDINALITY a(x,ord) GROUP BY 1 ORDER BY min(ord) LOOP
  k:=path||'/'||g.key;chosen:='[]'::jsonb;
  IF g.choice THEN
   selected_id:=p->'choices'->>k;
   IF coalesce(selected_id,'')<>'' THEN
    SELECT x INTO l FROM jsonb_array_elements(g.options) x WHERE x->>'id'=selected_id;
    IF l IS NULL THEN RAISE EXCEPTION 'Wybierz aktualny wariant w grupie: %.',substring(g.key from 7); END IF;
    chosen:=jsonb_build_array(l);
   ELSIF g.required THEN RAISE EXCEPTION 'Wybierz jeden wariant: % (%).',substring(g.key from 7),n->>'name'; END IF;
  ELSIF g.required OR p->'enabled'->k='true'::jsonb THEN chosen:=g.options;END IF;
  FOR l IN SELECT value FROM jsonb_array_elements(chosen) LOOP
   IF (l->>'min_height' IS NOT NULL AND h<(l->>'min_height')::numeric) OR (l->>'max_height' IS NOT NULL AND h>(l->>'max_height')::numeric) THEN RAISE EXCEPTION 'Wybrany sprzęt nie pasuje do wysokości % cm: %.',h,s->'equipment'->(l->>'equipment_id')->>'name'; END IF;
   amount:=(l->>'quantity')::numeric;
   IF l->>'mode'='fixed' THEN
    IF seen ? (l->>'id') THEN
     IF (seen->>(l->>'id'))::numeric<>amount THEN RAISE EXCEPTION 'Niespójna stała ilość zależności.'; END IF;
     CONTINUE;
    END IF;
    seen:=seen||jsonb_build_object(l->>'id',amount);
   ELSE amount:=amount*q;END IF;
   state:=public.warehouse_stage_visit(s,l->>'equipment_id',amount,path||'/'||(l->>'id'),array_append(ancestors,equipment_id),jsonb_build_object('seen',seen,'total',total,'visits',visits));
   seen:=state->'seen';total:=(state->>'total')::numeric;visits:=(state->>'visits')::integer;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('seen',seen,'total',total,'visits',visits);
END $$;

COMMIT;
