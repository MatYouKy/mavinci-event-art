/*
  # Naprawa polityk RLS - dostęp dla zalogowanych użytkowników Supabase Auth

  ZMIANA: Polityki teraz sprawdzają auth.uid() zamiast crm_users
  - Każdy zalogowany użytkownik Supabase Auth ma dostęp do CRM
  - Prostsze zarządzanie bez wymogu dodawania do crm_users
  - Nadal pełne zabezpieczenie - tylko autentyfikowani
*/

-- USUŃ stare polityki
DROP POLICY IF EXISTS "CRM users can view clients" ON clients;
DROP POLICY IF EXISTS "CRM users can insert clients" ON clients;
DROP POLICY IF EXISTS "CRM users can update clients" ON clients;
DROP POLICY IF EXISTS "Admins can delete clients" ON clients;

DROP POLICY IF EXISTS "CRM users full access to client_contacts" ON client_contacts;
DROP POLICY IF EXISTS "CRM users full access to client_history" ON client_history;
DROP POLICY IF EXISTS "CRM users can view employees" ON employees;
DROP POLICY IF EXISTS "Admins can manage employees" ON employees;
DROP POLICY IF EXISTS "CRM users full access to employee_documents" ON employee_documents;
DROP POLICY IF EXISTS "CRM users full access to employee_event_assignments" ON employee_event_assignments;
DROP POLICY IF EXISTS "CRM users can view tasks" ON tasks;
DROP POLICY IF EXISTS "CRM users can manage tasks" ON tasks;
DROP POLICY IF EXISTS "CRM users full access to task_assignments" ON task_assignments;
DROP POLICY IF EXISTS "CRM users full access to task_lists" ON task_lists;
DROP POLICY IF EXISTS "CRM users can view events" ON events;
DROP POLICY IF EXISTS "CRM users can manage events" ON events;
DROP POLICY IF EXISTS "Users can view all CRM users" ON crm_users;
DROP POLICY IF EXISTS "Only admins can manage CRM users" ON crm_users;

-- NOWE POLITYKI - dostęp dla wszystkich zalogowanych w Supabase Auth

-- CLIENTS
CREATE POLICY "Authenticated users can view clients"
  ON clients FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert clients"
  ON clients FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update clients"
  ON clients FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete clients"
  ON clients FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- CLIENT_CONTACTS
CREATE POLICY "Authenticated access to client_contacts"
  ON client_contacts FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL);

-- CLIENT_HISTORY
CREATE POLICY "Authenticated access to client_history"
  ON client_history FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL);

-- EMPLOYEES
CREATE POLICY "Authenticated access to employees"
  ON employees FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL);

-- EMPLOYEE_DOCUMENTS
CREATE POLICY "Authenticated access to employee_documents"
  ON employee_documents FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL);

-- EMPLOYEE_EVENT_ASSIGNMENTS
CREATE POLICY "Authenticated access to employee_event_assignments"
  ON employee_event_assignments FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL);

-- TASKS
CREATE POLICY "Authenticated access to tasks"
  ON tasks FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL);

-- TASK_ASSIGNMENTS
CREATE POLICY "Authenticated access to task_assignments"
  ON task_assignments FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL);

-- TASK_LISTS
CREATE POLICY "Authenticated access to task_lists"
  ON task_lists FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL);

-- EVENTS
CREATE POLICY "Authenticated access to events"
  ON events FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL);

-- CRM_USERS (tylko do odczytu dla zalogowanych)
CREATE POLICY "Authenticated can view crm_users"
  ON crm_users FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can manage crm_users"
  ON crm_users FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL);
