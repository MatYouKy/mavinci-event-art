/*
  # Rozszerzenie systemu wyciągów bankowych o typ konta i przechowywanie plików

  1. Nowe kolumny w tabeli `bank_statements`
    - `account_type` (text) - typ konta: 'regular' (bieżące) lub 'vat' (konto VAT)
    - `file_storage_path` (text) - ścieżka do pliku PDF w Supabase Storage

  2. Zmiany indeksów
    - Usunięcie starego unique indexu
    - Nowy unique index uwzględniający account_type (jeden wyciąg na miesiąc/rok/firmę/typ konta)

  3. Storage
    - Utworzenie bucketa 'bank-statements' do przechowywania plików PDF
    - Polityki dostępu dla uwierzytelnionych użytkowników z uprawnieniami

  4. Ważne notatki
    - Istniejące wyciągi otrzymają domyślny account_type = 'regular'
    - Pliki mogą być pobierane przez pracowników z uprawnieniami ksef_manage lub invoices_manage
*/

-- Dodaj kolumnę account_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bank_statements' AND column_name = 'account_type'
  ) THEN
    ALTER TABLE bank_statements ADD COLUMN account_type text NOT NULL DEFAULT 'regular'
      CHECK (account_type IN ('regular', 'vat'));
  END IF;
END $$;

-- Dodaj kolumnę file_storage_path
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bank_statements' AND column_name = 'file_storage_path'
  ) THEN
    ALTER TABLE bank_statements ADD COLUMN file_storage_path text;
  END IF;
END $$;

-- Przebuduj unique index na uwzględniający account_type
DROP INDEX IF EXISTS idx_bank_statements_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_statements_unique 
  ON bank_statements(statement_month, statement_year, my_company_id, account_type);

-- Utwórz bucket Storage dla wyciągów bankowych (jeśli nie istnieje)
INSERT INTO storage.buckets (id, name, public)
VALUES ('bank-statements', 'bank-statements', false)
ON CONFLICT (id) DO NOTHING;

-- Polityka SELECT - użytkownicy z uprawnieniami mogą pobierać wyciągi
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Finance users can read bank statements files' 
    AND tablename = 'objects' AND schemaname = 'storage'
  ) THEN
    CREATE POLICY "Finance users can read bank statements files"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'bank-statements'
        AND EXISTS (
          SELECT 1 FROM employees e
          WHERE e.id = auth.uid()
          AND (
            e.permissions::text[] && ARRAY['admin', 'ksef_manage', 'invoices_manage']
          )
        )
      );
  END IF;
END $$;

-- Polityka INSERT - użytkownicy z uprawnieniami mogą uploadować
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Finance users can upload bank statements files' 
    AND tablename = 'objects' AND schemaname = 'storage'
  ) THEN
    CREATE POLICY "Finance users can upload bank statements files"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'bank-statements'
        AND EXISTS (
          SELECT 1 FROM employees e
          WHERE e.id = auth.uid()
          AND (
            e.permissions::text[] && ARRAY['admin', 'ksef_manage', 'invoices_manage']
          )
        )
      );
  END IF;
END $$;

-- Polityka DELETE - użytkownicy z uprawnieniami mogą usuwać
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Finance users can delete bank statements files' 
    AND tablename = 'objects' AND schemaname = 'storage'
  ) THEN
    CREATE POLICY "Finance users can delete bank statements files"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'bank-statements'
        AND EXISTS (
          SELECT 1 FROM employees e
          WHERE e.id = auth.uid()
          AND (
            e.permissions::text[] && ARRAY['admin', 'ksef_manage', 'invoices_manage']
          )
        )
      );
  END IF;
END $$;