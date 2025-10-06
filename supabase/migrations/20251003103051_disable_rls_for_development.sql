/*
  # Tymczasowe wyłączenie RLS dla środowiska deweloperskiego

  1. Zmiany
    - Wyłączenie RLS dla głównych tabel CRM
    - UWAGA: To jest tylko dla developmentu!
    - W produkcji należy przywrócić RLS i dodać właściwą autentykację
  
  2. Tabele
    - clients, events, employees, equipment
    - event_equipment, event_employees, event_checklists
    - tasks, offers, mailing_campaigns, email_messages
*/

-- Wyłączenie RLS dla tabel CRM (tymczasowo dla developmentu)
ALTER TABLE clients DISABLE ROW LEVEL SECURITY;
ALTER TABLE events DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE equipment DISABLE ROW LEVEL SECURITY;
ALTER TABLE event_equipment DISABLE ROW LEVEL SECURITY;
ALTER TABLE event_employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE event_checklists DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE offers DISABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_bookings DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE mailing_campaigns DISABLE ROW LEVEL SECURITY;
ALTER TABLE mailing_recipients DISABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages DISABLE ROW LEVEL SECURITY;
