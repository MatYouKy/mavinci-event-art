/*
  # Integracja z KSeF (Krajowy System e-Faktur)

  1. Nowe tabele
    - `ksef_credentials` - dane autoryzacyjne do KSeF
    - `ksef_invoices` - faktury zsynchronizowane z KSeF
    - `ksef_sync_log` - log synchronizacji

  2. Bezpieczeństwo
    - Enable RLS on all tables
    - Policies for admin and invoices_manage permission
*/

-- Create enum types
DO $$ BEGIN
  CREATE TYPE ksef_invoice_type AS ENUM ('issued', 'received');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ksef_sync_status AS ENUM ('pending', 'synced', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ksef_sync_type AS ENUM ('issued', 'received', 'manual');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ksef_log_status AS ENUM ('success', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- KSeF Credentials table
CREATE TABLE IF NOT EXISTS ksef_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  nip text NOT NULL,
  token text NOT NULL,
  is_test_environment boolean DEFAULT true,
  session_token text,
  session_expires_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_org_ksef UNIQUE(organization_id)
);

-- KSeF Invoices table
CREATE TABLE IF NOT EXISTS ksef_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  ksef_reference_number text NOT NULL UNIQUE,
  invoice_type ksef_invoice_type NOT NULL,
  xml_content text NOT NULL,
  sync_status ksef_sync_status DEFAULT 'pending',
  sync_error text,
  ksef_issued_at timestamptz NOT NULL,
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- KSeF Sync Log table
CREATE TABLE IF NOT EXISTS ksef_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type ksef_sync_type NOT NULL,
  status ksef_log_status NOT NULL,
  invoices_count integer DEFAULT 0,
  error_message text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ksef_credentials_org ON ksef_credentials(organization_id);
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_invoice_id ON ksef_invoices(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_type ON ksef_invoices(invoice_type);
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_status ON ksef_invoices(sync_status);
CREATE INDEX IF NOT EXISTS idx_ksef_sync_log_type ON ksef_sync_log(sync_type);
CREATE INDEX IF NOT EXISTS idx_ksef_sync_log_status ON ksef_sync_log(status);

-- Enable RLS
ALTER TABLE ksef_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE ksef_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ksef_sync_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ksef_credentials
CREATE POLICY "Admin and invoices_manage can view KSeF credentials"
  ON ksef_credentials FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'invoices_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and invoices_manage can insert KSeF credentials"
  ON ksef_credentials FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'invoices_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and invoices_manage can update KSeF credentials"
  ON ksef_credentials FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'invoices_manage' = ANY(employees.permissions)
      )
    )
  );

-- RLS Policies for ksef_invoices
CREATE POLICY "Admin and invoices_view can view KSeF invoices"
  ON ksef_invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'invoices_view' = ANY(employees.permissions)
        OR 'invoices_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and invoices_manage can insert KSeF invoices"
  ON ksef_invoices FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'invoices_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and invoices_manage can update KSeF invoices"
  ON ksef_invoices FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'invoices_manage' = ANY(employees.permissions)
      )
    )
  );

-- RLS Policies for ksef_sync_log
CREATE POLICY "Admin and invoices_view can view sync log"
  ON ksef_sync_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'invoices_view' = ANY(employees.permissions)
        OR 'invoices_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "System can insert sync log"
  ON ksef_sync_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ksef_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ 
BEGIN
  DROP TRIGGER IF EXISTS ksef_credentials_updated_at ON ksef_credentials;
  CREATE TRIGGER ksef_credentials_updated_at
    BEFORE UPDATE ON ksef_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_ksef_credentials_updated_at();
END $$;
