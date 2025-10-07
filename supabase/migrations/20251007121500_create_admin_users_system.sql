/*
  # Create Admin Users System with Supabase Auth

  ## Overview
  Creates a complete authentication system using Supabase Auth for admin panel access.
  Removes dependency on external API by using Supabase's built-in authentication.

  ## Authentication Strategy
  - Uses Supabase's built-in `auth.users` table for user authentication
  - Email/password authentication enabled by default
  - No email confirmation required (disabled for simplicity)
  - Admin users are created directly in Supabase Auth

  ## New Tables

  ### `admin_profiles`
  Extends auth.users with additional admin-specific data.

  **Columns:**
  - `id` (uuid, primary key, references auth.users) - Links to Supabase auth user
  - `email` (text, required) - Admin email (synced from auth.users)
  - `full_name` (text) - Full name of admin
  - `role` (text, default 'admin') - Admin role/permission level
  - `is_active` (boolean, default true) - Whether admin account is active
  - `created_at` (timestamptz) - Account creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security
  - Enable RLS on admin_profiles table
  - Only authenticated users can view their own profile
  - Only authenticated users can update their own profile
  - Insert is handled via trigger when new auth user is created

  ## Triggers
  - Auto-create admin_profiles entry when new user is added to auth.users

  ## Sample Data
  - Creates a default admin user: admin@mavinci.pl / Admin123!
  - This user can be used immediately to log into the admin panel

  ## Notes
  - Email confirmation is disabled for admin users
  - Passwords are securely hashed by Supabase Auth
  - Session management is handled automatically by Supabase
*/

-- Create admin_profiles table
CREATE TABLE IF NOT EXISTS admin_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  full_name text,
  role text DEFAULT 'admin',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index on email for quick lookups
CREATE INDEX IF NOT EXISTS idx_admin_profiles_email ON admin_profiles(email);

-- Create index on is_active for filtering
CREATE INDEX IF NOT EXISTS idx_admin_profiles_active ON admin_profiles(is_active);

-- Enable RLS
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can view their own profile
CREATE POLICY "Users can view own profile"
  ON admin_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Policy: Authenticated users can update their own profile
CREATE POLICY "Users can update own profile"
  ON admin_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Function to automatically create admin_profile when new user is created
CREATE OR REPLACE FUNCTION handle_new_admin_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.admin_profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function when new user is created
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_admin_user();

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_admin_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS trigger_update_admin_profiles_updated_at ON admin_profiles;
CREATE TRIGGER trigger_update_admin_profiles_updated_at
  BEFORE UPDATE ON admin_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_admin_profiles_updated_at();

-- Create default admin user
-- Password: Admin123!
-- This creates a user in auth.users and admin_profiles will be created automatically via trigger
DO $$
DECLARE
  new_user_id uuid;
BEGIN
  -- Check if user already exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@mavinci.pl') THEN
    -- Insert into auth.users (Supabase's authentication table)
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      confirmation_token,
      recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'admin@mavinci.pl',
      crypt('Admin123!', gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Admin Mavinci"}'::jsonb,
      false,
      '',
      ''
    ) RETURNING id INTO new_user_id;

    -- Create identity for email auth
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      new_user_id,
      jsonb_build_object('sub', new_user_id, 'email', 'admin@mavinci.pl'),
      'email',
      now(),
      now(),
      now()
    );

    RAISE NOTICE 'Default admin user created: admin@mavinci.pl / Admin123!';
  ELSE
    RAISE NOTICE 'Admin user already exists';
  END IF;
END $$;
