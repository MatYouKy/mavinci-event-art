-- Raise only the generated brochure PDF limit to 50 MiB.
-- Keep bucket privacy, allowed MIME types and all access policies unchanged.
UPDATE storage.buckets
SET file_size_limit = 52428800
WHERE id = 'generated-brochures';
