/*
  # Create company brandbook system

  1. New Tables
    - `company_brandbook_logos` - logos array per company (multiple logos with labels)
    - `company_brandbook_colors` - color palette per company (name, hex, role)
    - `company_brandbook_fonts` - typography (font family, weight, role)
    - `company_brandbook_styles` - free-form key/value style tokens (e.g. button radius)

  2. Notes
    - Existing `my_companies.logo_url` stays for invoices (default logo)
    - New tables let companies maintain a richer brand kit reusable across signatures, offers, contracts
    - All tables linked to `my_companies(id)` with cascade delete
    - Each table has order_index for sorting

  3. Security
    - RLS enabled
    - Authenticated users with `invoices_manage` can manage; others can read
*/

CREATE TABLE IF NOT EXISTS company_brandbook_logos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES my_companies(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  url text NOT NULL,
  variant text DEFAULT 'default',
  background text DEFAULT 'light',
  order_index integer DEFAULT 0,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_brandbook_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES my_companies(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  hex text NOT NULL,
  role text DEFAULT 'primary',
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_brandbook_fonts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES my_companies(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  family text NOT NULL,
  weight text DEFAULT '400',
  role text DEFAULT 'body',
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_brandbook_styles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES my_companies(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  description text DEFAULT '',
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE company_brandbook_logos ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_brandbook_colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_brandbook_fonts ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_brandbook_styles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_logos' AND policyname='brandbook_logos_select') THEN
    CREATE POLICY brandbook_logos_select ON company_brandbook_logos FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_logos' AND policyname='brandbook_logos_insert') THEN
    CREATE POLICY brandbook_logos_insert ON company_brandbook_logos FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_logos' AND policyname='brandbook_logos_update') THEN
    CREATE POLICY brandbook_logos_update ON company_brandbook_logos FOR UPDATE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_logos' AND policyname='brandbook_logos_delete') THEN
    CREATE POLICY brandbook_logos_delete ON company_brandbook_logos FOR DELETE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_colors' AND policyname='brandbook_colors_select') THEN
    CREATE POLICY brandbook_colors_select ON company_brandbook_colors FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_colors' AND policyname='brandbook_colors_insert') THEN
    CREATE POLICY brandbook_colors_insert ON company_brandbook_colors FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_colors' AND policyname='brandbook_colors_update') THEN
    CREATE POLICY brandbook_colors_update ON company_brandbook_colors FOR UPDATE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_colors' AND policyname='brandbook_colors_delete') THEN
    CREATE POLICY brandbook_colors_delete ON company_brandbook_colors FOR DELETE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_fonts' AND policyname='brandbook_fonts_select') THEN
    CREATE POLICY brandbook_fonts_select ON company_brandbook_fonts FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_fonts' AND policyname='brandbook_fonts_insert') THEN
    CREATE POLICY brandbook_fonts_insert ON company_brandbook_fonts FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_fonts' AND policyname='brandbook_fonts_update') THEN
    CREATE POLICY brandbook_fonts_update ON company_brandbook_fonts FOR UPDATE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_fonts' AND policyname='brandbook_fonts_delete') THEN
    CREATE POLICY brandbook_fonts_delete ON company_brandbook_fonts FOR DELETE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_styles' AND policyname='brandbook_styles_select') THEN
    CREATE POLICY brandbook_styles_select ON company_brandbook_styles FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_styles' AND policyname='brandbook_styles_insert') THEN
    CREATE POLICY brandbook_styles_insert ON company_brandbook_styles FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_styles' AND policyname='brandbook_styles_update') THEN
    CREATE POLICY brandbook_styles_update ON company_brandbook_styles FOR UPDATE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='company_brandbook_styles' AND policyname='brandbook_styles_delete') THEN
    CREATE POLICY brandbook_styles_delete ON company_brandbook_styles FOR DELETE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid() AND ('invoices_manage' = ANY(e.permissions) OR 'admin' = ANY(e.permissions)))
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_brandbook_logos_company ON company_brandbook_logos(company_id);
CREATE INDEX IF NOT EXISTS idx_brandbook_colors_company ON company_brandbook_colors(company_id);
CREATE INDEX IF NOT EXISTS idx_brandbook_fonts_company ON company_brandbook_fonts(company_id);
CREATE INDEX IF NOT EXISTS idx_brandbook_styles_company ON company_brandbook_styles(company_id);
