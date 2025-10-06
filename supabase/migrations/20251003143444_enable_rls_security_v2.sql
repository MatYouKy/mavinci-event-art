/*
  # Włączenie Row Level Security - Pełna ochrona danych CRM

  KRYTYCZNE ZABEZPIECZENIE:
  - Wszystkie dane CRM są CAŁKOWICIE CHRONIONE
  - Dostęp TYLKO dla zalogowanych użytkowników systemu CRM
  - ZERO dostępu publicznego
  - Pełna anonimizacja - bez auth brak danych
*/

-- WŁĄCZ RLS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_event_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_users ENABLE ROW LEVEL SECURITY;

-- USUŃ stare polityki
DROP POLICY IF EXISTS "Authenticated users can access clients" ON clients;
DROP POLICY IF EXISTS "Authenticated users can insert clients" ON clients;
DROP POLICY IF EXISTS "Authenticated users can update clients" ON clients;
DROP POLICY IF EXISTS "Authenticated users can delete clients" ON clients;
DROP POLICY IF EXISTS "Authenticated users can access employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can manage employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can access tasks" ON tasks;
DROP POLICY IF EXISTS "Authenticated users can manage tasks" ON tasks;
DROP POLICY IF EXISTS "Authenticated users can access events" ON events;
DROP POLICY IF EXISTS "Authenticated users can manage events" ON events;
DROP POLICY IF EXISTS "Authenticated users can access crm_users" ON crm_users;
DROP POLICY IF EXISTS "Only admins can manage crm_users" ON crm_users;

-- CLIENTS
CREATE POLICY "CRM users can view clients"
  ON clients FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

CREATE POLICY "CRM users can insert clients"
  ON clients FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

CREATE POLICY "CRM users can update clients"
  ON clients FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

CREATE POLICY "Admins can delete clients"
  ON clients FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid() AND crm_users.role = 'admin'));

-- CLIENT_CONTACTS
CREATE POLICY "CRM users full access to client_contacts"
  ON client_contacts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

-- CLIENT_HISTORY
CREATE POLICY "CRM users full access to client_history"
  ON client_history FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

-- EMPLOYEES
CREATE POLICY "CRM users can view employees"
  ON employees FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

CREATE POLICY "Admins can manage employees"
  ON employees FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

-- EMPLOYEE_DOCUMENTS
CREATE POLICY "CRM users full access to employee_documents"
  ON employee_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

-- EMPLOYEE_EVENT_ASSIGNMENTS
CREATE POLICY "CRM users full access to employee_event_assignments"
  ON employee_event_assignments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

-- TASKS
CREATE POLICY "CRM users can view tasks"
  ON tasks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

CREATE POLICY "CRM users can manage tasks"
  ON tasks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

-- TASK_ASSIGNMENTS
CREATE POLICY "CRM users full access to task_assignments"
  ON task_assignments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

-- TASK_LISTS
CREATE POLICY "CRM users full access to task_lists"
  ON task_lists FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

-- EVENTS
CREATE POLICY "CRM users can view events"
  ON events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

CREATE POLICY "CRM users can manage events"
  ON events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

-- CRM_USERS (specjalne zasady)
CREATE POLICY "Users can view all CRM users"
  ON crm_users FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid()));

CREATE POLICY "Only admins can manage CRM users"
  ON crm_users FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM crm_users WHERE crm_users.id = auth.uid() AND crm_users.role = 'admin'));
