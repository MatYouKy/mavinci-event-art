-- Keep existing immutable documents; enforce 30 MB for new uploads.
BEGIN;
UPDATE storage.buckets SET file_size_limit = least(coalesce(file_size_limit,30000000),30000000)
WHERE id = 'generated-brochures';
COMMIT;
