BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';

-- Acquire the referenced tables before locking storage.objects. NOWAIT makes
-- contention abort this transaction immediately, releasing every acquired lock.
-- Do not wait on a referenced table while holding an exclusive storage lock.
LOCK TABLE public.locations, public.employees IN ACCESS SHARE MODE NOWAIT;
LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE NOWAIT;

-- Inside the locations subquery, bare `name` resolves to locations.name.
-- Explicitly reference the outer storage object path. Preserve role and permission checks.
ALTER POLICY "Location materials view" ON storage.objects
USING (bucket_id = 'location-materials' AND EXISTS (
  SELECT 1 FROM public.locations l
  WHERE l.id::text = (storage.foldername(storage.objects.name))[1]
));

ALTER POLICY "Location materials insert" ON storage.objects
WITH CHECK (bucket_id = 'location-materials' AND EXISTS (
  SELECT 1 FROM public.locations l
  WHERE l.id::text = (storage.foldername(storage.objects.name))[1]
) AND EXISTS (
  SELECT 1 FROM public.employees e WHERE e.id = auth.uid()
    AND ('admin' = ANY(e.permissions) OR 'locations_manage' = ANY(e.permissions))
));

ALTER POLICY "Location materials delete" ON storage.objects
USING (bucket_id = 'location-materials' AND EXISTS (
  SELECT 1 FROM public.locations l
  WHERE l.id::text = (storage.foldername(storage.objects.name))[1]
) AND EXISTS (
  SELECT 1 FROM public.employees e WHERE e.id = auth.uid()
    AND ('admin' = ANY(e.permissions) OR 'locations_manage' = ANY(e.permissions))
));
COMMIT;
