/*
  # Dodanie RLS do katalogów podwykonawców - v2

  1. Tabele
    - subcontractor_services
    - subcontractor_service_catalog
    - subcontractor_equipment_catalog
    - subcontractor_transport_catalog

  2. Polityki RLS
    - Administratorzy (access_level='admin' lub role='admin') mogą wszystko
    - Użytkownicy z uprawnieniami 'contacts:view' mogą przeglądać
    - Użytkownicy z uprawnieniami 'contacts:manage' mogą edytować

  3. Bezpieczeństwo
    - RLS jest włączony dla wszystkich tabel
*/

-- Włącz RLS
ALTER TABLE subcontractor_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_service_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_equipment_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_transport_catalog ENABLE ROW LEVEL SECURITY;

-- Polityki dla subcontractor_services
CREATE POLICY "Admin and contacts:view can read subcontractor_services"
  ON subcontractor_services FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:view' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and contacts:manage can insert subcontractor_services"
  ON subcontractor_services FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and contacts:manage can update subcontractor_services"
  ON subcontractor_services FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and contacts:manage can delete subcontractor_services"
  ON subcontractor_services FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

-- Polityki dla subcontractor_service_catalog
CREATE POLICY "Admin and contacts:view can read service_catalog"
  ON subcontractor_service_catalog FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:view' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and contacts:manage can insert service_catalog"
  ON subcontractor_service_catalog FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and contacts:manage can update service_catalog"
  ON subcontractor_service_catalog FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and contacts:manage can delete service_catalog"
  ON subcontractor_service_catalog FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

-- Polityki dla subcontractor_equipment_catalog
CREATE POLICY "Admin and contacts:view can read equipment_catalog"
  ON subcontractor_equipment_catalog FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:view' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and contacts:manage can insert equipment_catalog"
  ON subcontractor_equipment_catalog FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and contacts:manage can update equipment_catalog"
  ON subcontractor_equipment_catalog FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and contacts:manage can delete equipment_catalog"
  ON subcontractor_equipment_catalog FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

-- Polityki dla subcontractor_transport_catalog
CREATE POLICY "Admin and contacts:view can read transport_catalog"
  ON subcontractor_transport_catalog FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:view' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and contacts:manage can insert transport_catalog"
  ON subcontractor_transport_catalog FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and contacts:manage can update transport_catalog"
  ON subcontractor_transport_catalog FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and contacts:manage can delete transport_catalog"
  ON subcontractor_transport_catalog FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );