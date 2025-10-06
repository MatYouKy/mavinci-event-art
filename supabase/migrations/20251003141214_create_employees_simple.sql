/*
  # System pracowników i zadań - uproszczona wersja

  1. Tabele
    - employees - pracownicy
    - employee_documents - dokumenty
    - task_lists - listy zadań
    - tasks - zadania
    - task_assignments - przypisania

  2. Bez konfliktów z istniejącymi typami
*/

-- Najpierw usuń konfliktujące tabele jeśli istnieją
DROP TABLE IF EXISTS employee_event_assignments CASCADE;
DROP TABLE IF EXISTS task_assignments CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS task_lists CASCADE;
DROP TABLE IF EXISTS employee_documents CASCADE;
DROP TABLE IF EXISTS employees CASCADE;

-- TYPY ENUM

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'admin', 'manager', 'event_manager', 'sales', 'logistics', 
    'technician', 'support', 'freelancer', 'dj', 'mc', 'assistant', 'unassigned'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE access_tier AS ENUM (
    'admin', 'manager', 'lead', 'operator', 'external', 'guest', 'unassigned', 'instructor'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE document_type AS ENUM ('contract', 'certificate', 'id_document', 'other');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- EMPLOYEES
CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  surname text NOT NULL,
  nickname text,
  email text UNIQUE NOT NULL,
  phone_number text,
  phone_private text,
  avatar_url text,
  avatar_metadata jsonb,
  role user_role DEFAULT 'unassigned',
  access_level access_tier DEFAULT 'unassigned',
  occupation text,
  region text,
  address_street text,
  address_city text,
  address_postal_code text,
  address_country text DEFAULT 'Polska',
  nip text,
  company_name text,
  skills text[],
  qualifications text[],
  permissions jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  last_login timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES crm_users(id),
  history jsonb DEFAULT '[]'::jsonb
);

-- EMPLOYEE DOCUMENTS
CREATE TABLE employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  document_type document_type DEFAULT 'other',
  file_url text NOT NULL,
  file_size integer,
  mime_type text,
  description text,
  expiry_date timestamptz,
  is_active boolean DEFAULT true,
  uploaded_at timestamptz DEFAULT now(),
  uploaded_by uuid REFERENCES crm_users(id)
);

-- TASK LISTS
CREATE TABLE task_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  color text DEFAULT '#d3bb73',
  icon text,
  team_members uuid[],
  is_archived boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES crm_users(id)
);

-- TASKS
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status task_status DEFAULT 'todo',
  priority task_priority DEFAULT 'medium',
  task_list_id uuid REFERENCES task_lists(id) ON DELETE SET NULL,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  due_date timestamptz,
  start_date timestamptz,
  completed_at timestamptz,
  attachments jsonb DEFAULT '[]'::jsonb,
  tags text[],
  depends_on uuid[],
  blocks uuid[],
  estimated_hours decimal(5,2),
  actual_hours decimal(5,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES crm_users(id)
);

-- TASK ASSIGNMENTS
CREATE TABLE task_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  assigned_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  hours_spent decimal(5,2) DEFAULT 0,
  UNIQUE(task_id, employee_id)
);

-- EMPLOYEE EVENT ASSIGNMENTS
CREATE TABLE employee_event_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  role_in_event text NOT NULL,
  hourly_rate decimal(10,2),
  hours_worked decimal(5,2),
  notes text,
  assigned_at timestamptz DEFAULT now(),
  assigned_by uuid REFERENCES crm_users(id),
  UNIQUE(employee_id, event_id)
);

-- INDEKSY
CREATE INDEX idx_employees_email ON employees(email);
CREATE INDEX idx_employees_role ON employees(role);
CREATE INDEX idx_employees_is_active ON employees(is_active);
CREATE INDEX idx_employee_documents_employee_id ON employee_documents(employee_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_task_list_id ON tasks(task_list_id);
CREATE INDEX idx_task_assignments_employee_id ON task_assignments(employee_id);

-- TRIGGERY
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE task_lists DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_event_assignments DISABLE ROW LEVEL SECURITY;

-- DANE PRZYKŁADOWE
INSERT INTO employees (name, surname, email, role, access_level, phone_number, is_active)
VALUES ('Jan', 'Kowalski', 'jan.kowalski@mavinci.pl', 'event_manager'::user_role, 'manager'::access_tier, '+48 123 456 789', true);

INSERT INTO task_lists (name, description, color)
VALUES ('Wydarzenia 2025', 'Zadania związane z organizacją wydarzeń w 2025 roku', '#d3bb73');
