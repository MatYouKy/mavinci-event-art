/*
  # Create Portfolio Page Images System

  1. New Tables
    - `portfolio_page_images`
      - `id` (uuid, primary key)
      - `section` (text) - sekcja strony (np. 'hero')
      - `name` (text) - nazwa obrazu
      - `description` (text, nullable) - opis obrazu
      - `image_url` (text) - URL obrazu
      - `alt_text` (text, nullable) - tekst alternatywny
      - `order_index` (integer) - kolejność wyświetlania
      - `is_active` (boolean) - czy obraz jest aktywny
      - `opacity` (numeric) - przezroczystość obrazu (0-1)
      - `image_metadata` (jsonb) - metadane obrazu (pozycja, skalowanie, object-fit)
      - `created_at` (timestamptz) - data utworzenia
      - `updated_at` (timestamptz) - data ostatniej aktualizacji

  2. Security
    - Enable RLS on `portfolio_page_images` table
    - Add policies for public read access
    - Add policies for authenticated users to manage images
*/

CREATE TABLE IF NOT EXISTS portfolio_page_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL DEFAULT 'hero',
  name text NOT NULL,
  description text,
  image_url text NOT NULL,
  alt_text text,
  order_index integer DEFAULT 1,
  is_active boolean DEFAULT true,
  opacity numeric DEFAULT 0.2,
  image_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE portfolio_page_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to portfolio page images"
  ON portfolio_page_images
  FOR SELECT
  TO public
  USING (is_active = true);

CREATE POLICY "Allow authenticated users to insert portfolio page images"
  ON portfolio_page_images
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update portfolio page images"
  ON portfolio_page_images
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete portfolio page images"
  ON portfolio_page_images
  FOR DELETE
  TO authenticated
  USING (true);
