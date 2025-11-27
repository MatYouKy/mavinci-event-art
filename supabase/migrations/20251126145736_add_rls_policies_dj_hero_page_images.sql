/*
  # Add RLS policies for dj_hero_page_images

  1. Security
    - Add INSERT policy for admins and website editors
    - Add UPDATE policy for admins and website editors
    - Add DELETE policy for admins
    - Existing SELECT policy allows public read access
*/

-- INSERT policy for admins and website editors
CREATE POLICY "Admins and website editors can insert dj hero images"
  ON dj_hero_page_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND ('admin' = ANY(employees.permissions) OR 'website_edit' = ANY(employees.permissions))
    )
  );

-- UPDATE policy for admins and website editors
CREATE POLICY "Admins and website editors can update dj hero images"
  ON dj_hero_page_images
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND ('admin' = ANY(employees.permissions) OR 'website_edit' = ANY(employees.permissions))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND ('admin' = ANY(employees.permissions) OR 'website_edit' = ANY(employees.permissions))
    )
  );

-- DELETE policy for admins only
CREATE POLICY "Admins can delete dj hero images"
  ON dj_hero_page_images
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );
