BEGIN;
ALTER TABLE public.vehicles
 ADD COLUMN IF NOT EXISTS average_fuel_consumption numeric(5,2)
 CONSTRAINT vehicles_average_fuel_consumption_check
 CHECK (average_fuel_consumption IS NULL OR (average_fuel_consumption > 0 AND average_fuel_consumption <= 999.99));
COMMENT ON COLUMN public.vehicles.average_fuel_consumption IS
 'Średnie spalanie l/100 km wpisane na karcie auta. Domyślne do kalkulacji trasy; NULL oznacza korzystanie z historii tankowań.';
NOTIFY pgrst, 'reload schema';
COMMIT;
