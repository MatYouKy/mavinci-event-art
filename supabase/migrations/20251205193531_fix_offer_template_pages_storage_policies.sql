/*
  # Napraw polityki RLS dla storage szablonów ofert

  1. Storage Policies
    - Dodaj politykę SELECT dla bucketu offer-template-pages
    - Pozwól użytkownikom z uprawnieniem 'offers_manage' na dostęp do plików
*/

-- Utwórz bucket jeśli nie istnieje
INSERT INTO storage.buckets (id, name, public)
VALUES ('offer-template-pages', 'offer-template-pages', false)
ON CONFLICT (id) DO NOTHING;

-- Usuń stare polityki jeśli istnieją
DROP POLICY IF EXISTS "Allow authenticated users to read offer template pages" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin to upload offer template pages" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin to update offer template pages" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin to delete offer template pages" ON storage.objects;

-- Polityka SELECT - pozwól użytkownikom z uprawnieniami na odczyt
CREATE POLICY "Allow authenticated users to read offer template pages"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'offer-template-pages' AND (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'offers_manage' = ANY(employees.permissions)
    )
  )
);

-- Polityka INSERT
CREATE POLICY "Allow admin to upload offer template pages"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'offer-template-pages' AND
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.id = auth.uid()
    AND 'offers_manage' = ANY(employees.permissions)
  )
);

-- Polityka UPDATE
CREATE POLICY "Allow admin to update offer template pages"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'offer-template-pages' AND
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.id = auth.uid()
    AND 'offers_manage' = ANY(employees.permissions)
  )
)
WITH CHECK (
  bucket_id = 'offer-template-pages' AND
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.id = auth.uid()
    AND 'offers_manage' = ANY(employees.permissions)
  )
);

-- Polityka DELETE
CREATE POLICY "Allow admin to delete offer template pages"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'offer-template-pages' AND
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.id = auth.uid()
    AND 'offers_manage' = ANY(employees.permissions)
  )
);