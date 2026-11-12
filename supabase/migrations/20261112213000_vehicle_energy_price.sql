-- Logistyka, pojazdy elektryczne: zużycie energii w kWh/100 km i cena prądu w koszcie trasy.
-- Dla pojazdu elektrycznego `vehicles.average_fuel_consumption` oznacza średnie zużycie energii (kWh/100 km,
-- np. Melex ok. 27), a nowa kolumna `energy_price_per_kwh` — cenę prądu (zł/kWh brutto, np. z rachunku za
-- ładowanie w bazie). Kalkulator trasy liczy wtedy: dystans × kWh/100 km / 100 × cena kWh (można skorygować
-- dla przejazdu). Pojazdy spalinowe bez zmian (l/100 km i cena paliwa z AutoCentrum).
-- Migracja jest idempotentna — można ją uruchomić ponownie.

begin;

alter table public.vehicles add column if not exists energy_price_per_kwh numeric(8,4);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_energy_price_per_kwh_positive') then
    alter table public.vehicles add constraint vehicles_energy_price_per_kwh_positive
      check (energy_price_per_kwh is null or (energy_price_per_kwh > 0 and energy_price_per_kwh < 100));
  end if;
end $$;

comment on column public.vehicles.average_fuel_consumption is
  'Średnie spalanie do kosztów logistyki: l/100 km; dla pojazdu elektrycznego (fuel_type = elektryczny) — zużycie energii w kWh/100 km.';
comment on column public.vehicles.energy_price_per_kwh is
  'Pojazd elektryczny: cena prądu do kosztów logistyki (zł/kWh brutto).';

commit;
