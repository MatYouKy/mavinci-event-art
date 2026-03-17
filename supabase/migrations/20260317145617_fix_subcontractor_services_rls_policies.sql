/*
  # Naprawa polityk RLS dla usług podwykonawców

  1. Problem
    - Polityki wymagają uprawnienia 'subcontractors_manage'
    - Ale podwykonawcy są częścią systemu kontaktów
    - Użytkownicy z 'contacts_manage' lub admini powinni mieć dostęp

  2. Zmiany
    - Aktualizacja polityk dla subcontractor_services
    - Aktualizacja polityk dla subcontractor_service_catalog
    - Aktualizacja polityk dla subcontractor_equipment_catalog
    - Aktualizacja polityk dla subcontractor_transport_catalog
    - Dodanie wsparcia dla adminów i contacts_manage

  3. Bezpieczeństwo
    - Tylko admini lub użytkownicy z contacts_manage mogą zarządzać
    - Wszyscy zalogowani mogą czytać
*/

-- Drop existing policies for subcontractor_services
DROP POLICY IF EXISTS "Allow read subcontractor_services for authenticated users" ON subcontractor_services;
DROP POLICY IF EXISTS "Allow insert subcontractor_services for users with subcontractors_manage" ON subcontractor_services;
DROP POLICY IF EXISTS "Allow update subcontractor_services for users with subcontractors_manage" ON subcontractor_services;
DROP POLICY IF EXISTS "Allow delete subcontractor_services for users with subcontractors_manage" ON subcontractor_services;

-- Create new policies for subcontractor_services
CREATE POLICY "Allow read subcontractor_services for authenticated users"
  ON subcontractor_services FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow insert subcontractor_services for admins and contacts_manage"
  ON subcontractor_services FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR 'contacts_manage' = ANY(permissions)
        OR 'subcontractors_manage' = ANY(permissions)
      )
    )
  );

CREATE POLICY "Allow update subcontractor_services for admins and contacts_manage"
  ON subcontractor_services FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR 'contacts_manage' = ANY(permissions)
        OR 'subcontractors_manage' = ANY(permissions)
      )
    )
  );

CREATE POLICY "Allow delete subcontractor_services for admins and contacts_manage"
  ON subcontractor_services FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR 'contacts_manage' = ANY(permissions)
        OR 'subcontractors_manage' = ANY(permissions)
      )
    )
  );

-- Drop existing policies for subcontractor_service_catalog
DROP POLICY IF EXISTS "Allow read subcontractor_service_catalog for authenticated users" ON subcontractor_service_catalog;
DROP POLICY IF EXISTS "Allow manage subcontractor_service_catalog for users with subcontractors_manage" ON subcontractor_service_catalog;

-- Create new policies for subcontractor_service_catalog
CREATE POLICY "Allow read subcontractor_service_catalog for authenticated users"
  ON subcontractor_service_catalog FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow manage subcontractor_service_catalog for admins and contacts_manage"
  ON subcontractor_service_catalog FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR 'contacts_manage' = ANY(permissions)
        OR 'subcontractors_manage' = ANY(permissions)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR 'contacts_manage' = ANY(permissions)
        OR 'subcontractors_manage' = ANY(permissions)
      )
    )
  );

-- Drop existing policies for subcontractor_equipment_catalog
DROP POLICY IF EXISTS "Allow read subcontractor_equipment_catalog for authenticated users" ON subcontractor_equipment_catalog;
DROP POLICY IF EXISTS "Allow manage subcontractor_equipment_catalog for users with subcontractors_manage" ON subcontractor_equipment_catalog;

-- Create new policies for subcontractor_equipment_catalog
CREATE POLICY "Allow read subcontractor_equipment_catalog for authenticated users"
  ON subcontractor_equipment_catalog FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow manage subcontractor_equipment_catalog for admins and contacts_manage"
  ON subcontractor_equipment_catalog FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR 'contacts_manage' = ANY(permissions)
        OR 'subcontractors_manage' = ANY(permissions)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR 'contacts_manage' = ANY(permissions)
        OR 'subcontractors_manage' = ANY(permissions)
      )
    )
  );

-- Drop existing policies for subcontractor_transport_catalog
DROP POLICY IF EXISTS "Allow read subcontractor_transport_catalog for authenticated users" ON subcontractor_transport_catalog;
DROP POLICY IF EXISTS "Allow manage subcontractor_transport_catalog for users with subcontractors_manage" ON subcontractor_transport_catalog;

-- Create new policies for subcontractor_transport_catalog
CREATE POLICY "Allow read subcontractor_transport_catalog for authenticated users"
  ON subcontractor_transport_catalog FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow manage subcontractor_transport_catalog for admins and contacts_manage"
  ON subcontractor_transport_catalog FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR 'contacts_manage' = ANY(permissions)
        OR 'subcontractors_manage' = ANY(permissions)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR 'contacts_manage' = ANY(permissions)
        OR 'subcontractors_manage' = ANY(permissions)
      )
    )
  );

COMMENT ON POLICY "Allow insert subcontractor_services for admins and contacts_manage" ON subcontractor_services 
  IS 'Pozwala adminom i użytkownikom z contacts_manage lub subcontractors_manage dodawać typy usług';

COMMENT ON POLICY "Allow manage subcontractor_service_catalog for admins and contacts_manage" ON subcontractor_service_catalog 
  IS 'Pozwala adminom i użytkownikom z contacts_manage lub subcontractors_manage zarządzać katalogiem usług';

COMMENT ON POLICY "Allow manage subcontractor_equipment_catalog for admins and contacts_manage" ON subcontractor_equipment_catalog 
  IS 'Pozwala adminom i użytkownikom z contacts_manage lub subcontractors_manage zarządzać katalogiem sprzętu';

COMMENT ON POLICY "Allow manage subcontractor_transport_catalog for admins and contacts_manage" ON subcontractor_transport_catalog 
  IS 'Pozwala adminom i użytkownikom z contacts_manage lub subcontractors_manage zarządzać katalogiem transportu';