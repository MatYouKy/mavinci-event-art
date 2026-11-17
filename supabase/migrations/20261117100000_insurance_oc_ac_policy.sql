-- Flota: polisa łączona OC + AC (typ 'oc_ac') — jedna polisa obejmująca oba zakresy.
-- Dotąd przy dodawaniu ubezpieczenia można było wybrać tylko OC albo AC, więc wspólną polisę trzeba było wpisywać dwa razy.
-- Polisa OC + AC liczy się jako ważne OC w kontroli floty (`refresh_vehicle_compliance`: alerty „Brak ważnego OC” /
-- „OC wygasa”, przypomnienia, status pojazdu). W powiadomieniu o wygasającej polisie (`check_fleet_notifications`)
-- typ wyświetla się jako „OC + AC”. Funkcje zmieniane są tylko w tych miejscach (reszta treści bez zmian).

alter table public.insurance_policies drop constraint if exists valid_insurance_type;
alter table public.insurance_policies add constraint valid_insurance_type
  check (type = any (array['oc'::text, 'oc_ac'::text, 'ac'::text, 'nnw'::text, 'assistance'::text, 'gap'::text, 'other'::text]));

do $$
declare
  def text;
begin
  -- Ciągłość OC: polisy 'oc' i 'oc_ac' (dwa miejsca w zapytaniu rekurencyjnym).
  def := pg_get_functiondef('public.refresh_vehicle_compliance()'::regprocedure);
  if position('''oc_ac''' in def) = 0 then
    if position('ip.type = ''oc''' in def) = 0 then
      raise exception 'refresh_vehicle_compliance: nieoczekiwana treść funkcji — migracja nie została zastosowana';
    end if;
    execute replace(def, 'ip.type = ''oc''', 'ip.type in (''oc'', ''oc_ac'')');
  end if;

  -- Powiadomienie o wygasającej polisie: „OC + AC” zamiast „OC_AC”.
  def := pg_get_functiondef('public.check_fleet_notifications()'::regprocedure);
  if position('''oc_ac''' in def) = 0 then
    if position('upper(v_insurance.type)' in def) = 0 then
      raise exception 'check_fleet_notifications: nieoczekiwana treść funkcji — migracja nie została zastosowana';
    end if;
    execute replace(def, 'upper(v_insurance.type)', 'case v_insurance.type when ''oc_ac'' then ''OC + AC'' else upper(v_insurance.type) end');
  end if;
end $$;

-- Odśwież alerty i statusy pojazdów od razu (polisy OC + AC dodane po migracji i tak odświeżają je wyzwalaczem).
select public.refresh_vehicle_compliance();
