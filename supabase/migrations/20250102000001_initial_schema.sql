/*
  # Initial Schema for Event Management System

  ## Overview
  This migration creates the foundational database schema for managing team members and portfolio projects
  in an event management website with admin capabilities.

  ## New Tables

  ### `team_members`
  Stores information about team members displayed on the website.
  - `id` (uuid, primary key) - Unique identifier for each team member
  - `name` (text, required) - Full name of the team member
  - `role` (text, required) - Job title/role (e.g., "Event Manager", "Creative Director")
  - `image` (text, required) - URL to the team member's photo
  - `bio` (text, optional) - Short biography or description
  - `linkedin` (text, optional) - LinkedIn profile URL
  - `instagram` (text, optional) - Instagram profile URL
  - `facebook` (text, optional) - Facebook profile URL
  - `order_index` (integer, default 0) - Display order on the page
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### `portfolio_projects`
  Stores portfolio projects/events showcased on the website.
  - `id` (uuid, primary key) - Unique identifier for each project
  - `title` (text, required) - Project/event title
  - `category` (text, required) - Project category (e.g., "Konferencja", "Gala")
  - `image` (text, required) - URL to the project's main image
  - `description` (text, required) - Brief description of the project
  - `order_index` (integer, default 0) - Display order on the page
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security

  ### Row Level Security (RLS)
  - RLS is enabled on both tables
  - Public users can read all records (SELECT)
  - Only authenticated admin users can create, update, or delete records

  ### Policies
  Each table has 4 policies:
  1. Public read access for displaying content
  2. Authenticated users only for INSERT operations
  3. Authenticated users only for UPDATE operations
  4. Authenticated users only for DELETE operations

  ## Notes
  - All URLs are stored as text fields for flexibility
  - Timestamps are automatically managed with triggers
  - The `order_index` allows custom sorting of items on the frontend
  - Social media links are optional to accommodate varying team member preferences
*/

-- Create team_members table
CREATE TABLE IF NOT EXISTS team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL,
  image text NOT NULL,
  bio text DEFAULT '',
  linkedin text,
  instagram text,
  facebook text,
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create portfolio_projects table
CREATE TABLE IF NOT EXISTS portfolio_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL,
  image text NOT NULL,
  description text NOT NULL,
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on team_members
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Enable RLS on portfolio_projects
ALTER TABLE portfolio_projects ENABLE ROW LEVEL SECURITY;

-- RLS Policies for team_members

-- Allow public read access
CREATE POLICY "Public users can view team members"
  ON team_members
  FOR SELECT
  USING (true);

-- Allow authenticated users to insert
CREATE POLICY "Authenticated users can add team members"
  ON team_members
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update
CREATE POLICY "Authenticated users can update team members"
  ON team_members
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to delete
CREATE POLICY "Authenticated users can delete team members"
  ON team_members
  FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies for portfolio_projects

-- Allow public read access
CREATE POLICY "Public users can view portfolio projects"
  ON portfolio_projects
  FOR SELECT
  USING (true);

-- Allow authenticated users to insert
CREATE POLICY "Authenticated users can add portfolio projects"
  ON portfolio_projects
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update
CREATE POLICY "Authenticated users can update portfolio projects"
  ON portfolio_projects
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to delete
CREATE POLICY "Authenticated users can delete portfolio projects"
  ON portfolio_projects
  FOR DELETE
  TO authenticated
  USING (true);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to team_members
DROP TRIGGER IF EXISTS update_team_members_updated_at ON team_members;
CREATE TRIGGER update_team_members_updated_at
  BEFORE UPDATE ON team_members
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add trigger to portfolio_projects
DROP TRIGGER IF EXISTS update_portfolio_projects_updated_at ON portfolio_projects;
CREATE TRIGGER update_portfolio_projects_updated_at
  BEFORE UPDATE ON portfolio_projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
