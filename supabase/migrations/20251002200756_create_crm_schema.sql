/*
  # CRM Schema for Event Agency
  
  ## Overview
  Complete CRM system for managing events, clients, equipment, employees, offers, and tasks.
  
  ## New Tables
  
  ### 1. clients
  - `id` (uuid, primary key)
  - `company_name` (text)
  - `contact_person` (text)
  - `email` (text)
  - `phone` (text)
  - `address` (text)
  - `nip` (text) - tax identification number
  - `notes` (text)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)
  
  ### 2. events
  - `id` (uuid, primary key)
  - `client_id` (uuid, foreign key to clients)
  - `name` (text)
  - `description` (text)
  - `event_date` (timestamptz)
  - `event_end_date` (timestamptz)
  - `location` (text)
  - `status` (enum: offer_sent, offer_accepted, in_preparation, in_progress, completed, cancelled, invoiced)
  - `budget` (numeric)
  - `final_cost` (numeric)
  - `notes` (text)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)
  
  ### 3. equipment
  - `id` (uuid, primary key)
  - `name` (text)
  - `category` (text) - e.g., "sound", "lighting", "stage", "video"
  - `quantity` (integer)
  - `available_quantity` (integer)
  - `unit_price` (numeric)
  - `status` (enum: available, maintenance, retired)
  - `notes` (text)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)
  
  ### 4. equipment_bookings
  - `id` (uuid, primary key)
  - `event_id` (uuid, foreign key to events)
  - `equipment_id` (uuid, foreign key to equipment)
  - `quantity` (integer)
  - `start_date` (timestamptz)
  - `end_date` (timestamptz)
  - `notes` (text)
  - `created_at` (timestamptz)
  
  ### 5. employees
  - `id` (uuid, primary key)
  - `first_name` (text)
  - `last_name` (text)
  - `email` (text)
  - `phone` (text)
  - `position` (text)
  - `hourly_rate` (numeric)
  - `avatar` (text)
  - `status` (enum: active, inactive)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)
  
  ### 6. employee_assignments
  - `id` (uuid, primary key)
  - `event_id` (uuid, foreign key to events)
  - `employee_id` (uuid, foreign key to employees)
  - `role` (text) - role in this event
  - `hours` (numeric)
  - `notes` (text)
  - `created_at` (timestamptz)
  
  ### 7. offers
  - `id` (uuid, primary key)
  - `event_id` (uuid, foreign key to events)
  - `client_id` (uuid, foreign key to clients)
  - `offer_number` (text)
  - `total_amount` (numeric)
  - `valid_until` (timestamptz)
  - `status` (enum: draft, sent, accepted, rejected, expired)
  - `pdf_url` (text)
  - `notes` (text)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)
  
  ### 8. tasks
  - `id` (uuid, primary key)
  - `event_id` (uuid, foreign key to events, nullable)
  - `assigned_to` (uuid, foreign key to employees, nullable)
  - `title` (text)
  - `description` (text)
  - `priority` (enum: low, medium, high, urgent)
  - `status` (enum: todo, in_progress, completed, cancelled)
  - `due_date` (timestamptz)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)
  
  ### 9. mailing_campaigns
  - `id` (uuid, primary key)
  - `name` (text)
  - `subject` (text)
  - `content` (text)
  - `status` (enum: draft, scheduled, sent)
  - `scheduled_at` (timestamptz)
  - `sent_at` (timestamptz)
  - `created_at` (timestamptz)
  
  ### 10. mailing_recipients
  - `id` (uuid, primary key)
  - `campaign_id` (uuid, foreign key to mailing_campaigns)
  - `client_id` (uuid, foreign key to clients)
  - `status` (enum: pending, sent, opened, clicked, bounced)
  - `sent_at` (timestamptz)
  - `opened_at` (timestamptz)
  
  ## Security
  - Enable RLS on all tables
  - Add policies for authenticated users
*/

-- Create enum types
CREATE TYPE event_status AS ENUM (
  'offer_sent',
  'offer_accepted',
  'in_preparation',
  'in_progress',
  'completed',
  'cancelled',
  'invoiced'
);

CREATE TYPE equipment_status AS ENUM (
  'available',
  'maintenance',
  'retired'
);

CREATE TYPE employee_status AS ENUM (
  'active',
  'inactive'
);

CREATE TYPE offer_status AS ENUM (
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired'
);

CREATE TYPE task_priority AS ENUM (
  'low',
  'medium',
  'high',
  'urgent'
);

CREATE TYPE task_status AS ENUM (
  'todo',
  'in_progress',
  'completed',
  'cancelled'
);

CREATE TYPE mailing_campaign_status AS ENUM (
  'draft',
  'scheduled',
  'sent'
);

CREATE TYPE mailing_recipient_status AS ENUM (
  'pending',
  'sent',
  'opened',
  'clicked',
  'bounced'
);

-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  address text,
  nip text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create events table
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  event_date timestamptz NOT NULL,
  event_end_date timestamptz,
  location text,
  status event_status DEFAULT 'offer_sent',
  budget numeric(10, 2) DEFAULT 0,
  final_cost numeric(10, 2) DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create equipment table
CREATE TABLE IF NOT EXISTS equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text DEFAULT 'other',
  quantity integer DEFAULT 0,
  available_quantity integer DEFAULT 0,
  unit_price numeric(10, 2) DEFAULT 0,
  status equipment_status DEFAULT 'available',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create equipment_bookings table
CREATE TABLE IF NOT EXISTS equipment_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  equipment_id uuid REFERENCES equipment(id) ON DELETE CASCADE,
  quantity integer DEFAULT 1,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Create employees table
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  position text,
  hourly_rate numeric(10, 2) DEFAULT 0,
  avatar text,
  status employee_status DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create employee_assignments table
CREATE TABLE IF NOT EXISTS employee_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  role text,
  hours numeric(5, 2) DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Create offers table
CREATE TABLE IF NOT EXISTS offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  offer_number text UNIQUE,
  total_amount numeric(10, 2) DEFAULT 0,
  valid_until timestamptz,
  status offer_status DEFAULT 'draft',
  pdf_url text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES employees(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  priority task_priority DEFAULT 'medium',
  status task_status DEFAULT 'todo',
  due_date timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create mailing_campaigns table
CREATE TABLE IF NOT EXISTS mailing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL,
  content text,
  status mailing_campaign_status DEFAULT 'draft',
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create mailing_recipients table
CREATE TABLE IF NOT EXISTS mailing_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES mailing_campaigns(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  status mailing_recipient_status DEFAULT 'pending',
  sent_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailing_recipients ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Authenticated users can view clients"
  ON clients FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert clients"
  ON clients FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update clients"
  ON clients FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete clients"
  ON clients FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view events"
  ON events FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert events"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update events"
  ON events FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete events"
  ON events FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view equipment"
  ON equipment FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert equipment"
  ON equipment FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update equipment"
  ON equipment FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete equipment"
  ON equipment FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view equipment_bookings"
  ON equipment_bookings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert equipment_bookings"
  ON equipment_bookings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update equipment_bookings"
  ON equipment_bookings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete equipment_bookings"
  ON equipment_bookings FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view employees"
  ON employees FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert employees"
  ON employees FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update employees"
  ON employees FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete employees"
  ON employees FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view employee_assignments"
  ON employee_assignments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert employee_assignments"
  ON employee_assignments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update employee_assignments"
  ON employee_assignments FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete employee_assignments"
  ON employee_assignments FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view offers"
  ON offers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert offers"
  ON offers FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update offers"
  ON offers FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete offers"
  ON offers FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view tasks"
  ON tasks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update tasks"
  ON tasks FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete tasks"
  ON tasks FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view mailing_campaigns"
  ON mailing_campaigns FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert mailing_campaigns"
  ON mailing_campaigns FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update mailing_campaigns"
  ON mailing_campaigns FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete mailing_campaigns"
  ON mailing_campaigns FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view mailing_recipients"
  ON mailing_recipients FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert mailing_recipients"
  ON mailing_recipients FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update mailing_recipients"
  ON mailing_recipients FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete mailing_recipients"
  ON mailing_recipients FOR DELETE
  TO authenticated
  USING (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_events_client_id ON events(client_id);
CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_equipment_bookings_event_id ON equipment_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_equipment_bookings_equipment_id ON equipment_bookings(equipment_id);
CREATE INDEX IF NOT EXISTS idx_employee_assignments_event_id ON employee_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_employee_assignments_employee_id ON employee_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_event_id ON tasks(event_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_offers_event_id ON offers(event_id);
CREATE INDEX IF NOT EXISTS idx_offers_client_id ON offers(client_id);
