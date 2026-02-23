/*
  # Add Legal Form, KRS and REGON to Organizations
  
  1. Changes to organizations table
    - `legal_form` (text) - Forma prawna działalności
      Możliwe wartości:
      - 'jdg' - Jednoosobowa działalność gospodarcza
      - 'sp_zoo' - Spółka z ograniczoną odpowiedzialnością
      - 'sp_jawna' - Spółka jawna
      - 'sp_komandytowa' - Spółka komandytowa
      - 'sp_komandytowo_akcyjna' - Spółka komandytowo-akcyjna
      - 'sp_akcyjna' - Spółka akcyjna
      - 'spoldzielnia' - Spółdzielnia
      - 'fundacja' - Fundacja
      - 'stowarzyszenie' - Stowarzyszenie
      - 'other' - Inna
    
    - `krs` (text) - Numer KRS (tylko dla form innych niż JDG)
    - `regon` (text) - Numer REGON (dla wszystkich form)
  
  2. Notes
    - KRS jest opcjonalny dla JDG (nie wymagany)
    - REGON jest dla wszystkich form działalności
    - Placeholdery w umowach będą automatycznie pomijane gdy null
*/

-- Add legal form, KRS and REGON columns
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS legal_form text,
ADD COLUMN IF NOT EXISTS krs text,
ADD COLUMN IF NOT EXISTS regon text;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_organizations_legal_form ON organizations(legal_form);
CREATE INDEX IF NOT EXISTS idx_organizations_krs ON organizations(krs) WHERE krs IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_regon ON organizations(regon) WHERE regon IS NOT NULL;

-- Add comments
COMMENT ON COLUMN organizations.legal_form IS 'Forma prawna działalności (jdg, sp_zoo, sp_jawna, sp_komandytowa, sp_komandytowo_akcyjna, sp_akcyjna, spoldzielnia, fundacja, stowarzyszenie, other)';
COMMENT ON COLUMN organizations.krs IS 'Numer KRS (nie wymagany dla JDG)';
COMMENT ON COLUMN organizations.regon IS 'Numer REGON (dla wszystkich form działalności)';