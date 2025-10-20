/*
  # System przechowywania paragonów za paliwo
  
  1. Nowe buckety
    - `fuel-receipts` - bucket dla paragonów/faktur za paliwo
  
  2. Security (RLS)
    - Wszyscy zalogowani użytkownicy mogą:
      - Dodawać paragony
      - Przeglądać paragony
      - Usuwać paragony (tylko admini floty)
*/

-- Utwórz bucket dla paragonów
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fuel-receipts',
  'fuel-receipts',
  false,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Policy dla wstawiania paragonów (wszyscy zalogowani)
CREATE POLICY "Authenticated users can upload fuel receipts"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'fuel-receipts');

-- Policy dla odczytu paragonów (wszyscy zalogowani)
CREATE POLICY "Authenticated users can view fuel receipts"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'fuel-receipts');

-- Policy dla usuwania paragonów (tylko admini floty)
CREATE POLICY "Fleet managers can delete fuel receipts"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'fuel-receipts' AND
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.id = auth.uid()
    AND 'fleet_manage' = ANY(employees.permissions)
  )
);