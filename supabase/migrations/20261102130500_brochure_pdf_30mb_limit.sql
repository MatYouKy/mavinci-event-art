-- New brochure uploads are capped at 30 decimal MB. Existing immutable
-- PDFs and generation history are untouched; regenerate to get a smaller copy.
-- Keep a stricter limit if this environment already has one.
UPDATE storage.buckets
SET file_size_limit = 30000000
WHERE id = 'generated-brochures'
  AND (file_size_limit IS NULL OR file_size_limit > 30000000);
