/*
  # System zarządzania umowami
  
  1. Nowe tabele:
    - `contract_templates` - szablony umów
      - `id` (uuid, primary key)
      - `name` (text) - nazwa szablonu
      - `description` (text) - opis
      - `content` (text) - treść szablonu z placeholderami
      - `category` (text) - kategoria (event, service, rental, other)
      - `placeholders` (jsonb) - lista placeholderów z opisami
      - `is_active` (boolean) - czy szablon jest aktywny
      - `created_by` (uuid) - kto utworzył
      - `created_at`, `updated_at`
    
    - `contracts` - umowy
      - `id` (uuid, primary key)
      - `contract_number` (text, unique) - numer umowy (automatyczny)
      - `template_id` (uuid) - szablon użyty do wygenerowania
      - `client_id` (uuid) - klient
      - `event_id` (uuid) - powiązany event (opcjonalny)
      - `offer_id` (uuid) - powiązana oferta (opcjonalny)
      - `title` (text) - tytuł umowy
      - `content` (text) - wygenerowana treść umowy
      - `status` (enum) - draft, sent, signed, cancelled
      - `generated_data` (jsonb) - dane użyte do wygenerowania
      - `signed_at` (timestamptz) - data podpisania
      - `valid_from` (date) - ważna od
      - `valid_until` (date) - ważna do
      - `pdf_url` (text) - URL do PDF
      - `notes` (text) - notatki
      - `created_by` (uuid)
      - `created_at`, `updated_at`
  
  2. Security:
    - Enable RLS na obu tabelach
    - Policies dla authenticated users
*/

-- Typ statusu umowy
DO $$ BEGIN
  CREATE TYPE contract_status AS ENUM (
    'draft',
    'sent',
    'signed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tabela szablonów umów
CREATE TABLE IF NOT EXISTS contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  content text NOT NULL,
  category text DEFAULT 'other' CHECK (category IN ('event', 'service', 'rental', 'other')),
  placeholders jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tabela umów
CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number text UNIQUE NOT NULL,
  template_id uuid REFERENCES contract_templates(id) ON DELETE SET NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  offer_id uuid REFERENCES offers(id) ON DELETE SET NULL,
  title text NOT NULL,
  content text NOT NULL,
  status contract_status DEFAULT 'draft',
  generated_data jsonb DEFAULT '{}'::jsonb,
  signed_at timestamptz,
  valid_from date,
  valid_until date,
  pdf_url text,
  notes text,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Funkcja do automatycznego generowania numeru umowy
CREATE OR REPLACE FUNCTION generate_contract_number()
RETURNS text AS $$
DECLARE
  v_year text;
  v_month text;
  v_count integer;
  v_contract_number text;
  v_exists boolean;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YYYY');
  v_month := TO_CHAR(CURRENT_DATE, 'MM');
  
  v_count := 1;
  LOOP
    v_contract_number := 'UM/' || v_year || '/' || v_month || '/' || LPAD(v_count::text, 3, '0');
    
    SELECT EXISTS(
      SELECT 1 FROM contracts WHERE contract_number = v_contract_number
    ) INTO v_exists;
    
    IF NOT v_exists THEN
      RETURN v_contract_number;
    END IF;
    
    v_count := v_count + 1;
    
    IF v_count > 9999 THEN
      RAISE EXCEPTION 'Przekroczono limit umów dla miesiąca %/%', v_year, v_month;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger do automatycznego generowania numeru umowy
CREATE OR REPLACE FUNCTION auto_generate_contract_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.contract_number IS NULL OR NEW.contract_number = '' THEN
    NEW.contract_number := generate_contract_number();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_generate_contract_number ON contracts;
CREATE TRIGGER trigger_auto_generate_contract_number
  BEFORE INSERT ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_contract_number();

-- Funkcja do walidacji unikalności numeru umowy
CREATE OR REPLACE FUNCTION validate_contract_number_unique()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM contracts 
    WHERE contract_number = NEW.contract_number 
    AND id != NEW.id
  ) THEN
    RAISE EXCEPTION 'Numer umowy % już istnieje. Proszę wybrać inny numer.', NEW.contract_number;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_contract_number_unique ON contracts;
CREATE TRIGGER trigger_validate_contract_number_unique
  BEFORE INSERT OR UPDATE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION validate_contract_number_unique();

-- Trigger do aktualizacji updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_contract_templates_updated_at ON contract_templates;
CREATE TRIGGER update_contract_templates_updated_at
  BEFORE UPDATE ON contract_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contracts_updated_at ON contracts;
CREATE TRIGGER update_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

-- Policies dla contract_templates
CREATE POLICY "Authenticated users can view active templates"
  ON contract_templates FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Authenticated users can view all templates"
  ON contract_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create templates"
  ON contract_templates FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update templates"
  ON contract_templates FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete templates"
  ON contract_templates FOR DELETE
  TO authenticated
  USING (true);

-- Policies dla contracts
CREATE POLICY "Authenticated users can view contracts"
  ON contracts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create contracts"
  ON contracts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update contracts"
  ON contracts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete contracts"
  ON contracts FOR DELETE
  TO authenticated
  USING (true);

-- Przykładowe szablony
INSERT INTO contract_templates (name, description, content, category, placeholders, is_active) VALUES
(
  'Umowa na organizację eventu',
  'Standardowa umowa na organizację wydarzenia',
  'UMOWA NR {{contract_number}}

zawarta w dniu {{signing_date}} w {{signing_place}}

pomiędzy:

{{company_name}}
z siedzibą w {{company_address}}
NIP: {{company_nip}}
reprezentowaną przez {{company_representative}}

zwaną dalej "Wykonawcą"

a

{{client_name}}
{{client_address}}
{{client_nip}}
reprezentowaną przez {{client_representative}}

zwaną dalej "Zamawiającym"

§1 Przedmiot umowy

1. Wykonawca zobowiązuje się do organizacji wydarzenia:
   Nazwa: {{event_name}}
   Data: {{event_date}}
   Miejsce: {{event_location}}

2. Zakres usług:
{{services_description}}

§2 Wynagrodzenie

1. Całkowite wynagrodzenie wynosi: {{total_amount}} PLN (brutto)
2. Termin płatności: {{payment_deadline}}
3. Numer konta: {{bank_account}}

§3 Terminy

1. Umowa obowiązuje od {{valid_from}} do {{valid_until}}
2. Realizacja wydarzenia: {{event_date}}

§4 Postanowienia końcowe

1. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.
2. W sprawach nieuregulowanych niniejszą umową mają zastosowanie przepisy Kodeksu cywilnego.

Zamawiający                           Wykonawca

........................          ........................',
  'event',
  '[
    {"key": "contract_number", "label": "Numer umowy", "type": "text"},
    {"key": "signing_date", "label": "Data podpisania", "type": "date"},
    {"key": "signing_place", "label": "Miejsce podpisania", "type": "text"},
    {"key": "company_name", "label": "Nazwa firmy", "type": "text"},
    {"key": "company_address", "label": "Adres firmy", "type": "text"},
    {"key": "company_nip", "label": "NIP firmy", "type": "text"},
    {"key": "company_representative", "label": "Reprezentant firmy", "type": "text"},
    {"key": "client_name", "label": "Nazwa klienta", "type": "text"},
    {"key": "client_address", "label": "Adres klienta", "type": "text"},
    {"key": "client_nip", "label": "NIP klienta", "type": "text"},
    {"key": "client_representative", "label": "Reprezentant klienta", "type": "text"},
    {"key": "event_name", "label": "Nazwa wydarzenia", "type": "text"},
    {"key": "event_date", "label": "Data wydarzenia", "type": "date"},
    {"key": "event_location", "label": "Miejsce wydarzenia", "type": "text"},
    {"key": "services_description", "label": "Opis usług", "type": "textarea"},
    {"key": "total_amount", "label": "Całkowita kwota", "type": "number"},
    {"key": "payment_deadline", "label": "Termin płatności", "type": "date"},
    {"key": "bank_account", "label": "Numer konta", "type": "text"},
    {"key": "valid_from", "label": "Ważna od", "type": "date"},
    {"key": "valid_until", "label": "Ważna do", "type": "date"}
  ]'::jsonb,
  true
),
(
  'Umowa na wynajem sprzętu',
  'Umowa na wynajem sprzętu eventowego',
  'UMOWA NAJMU SPRZĘTU NR {{contract_number}}

zawarta w dniu {{signing_date}}

pomiędzy:

{{company_name}}
NIP: {{company_nip}}
zwaną dalej "Wynajmującym"

a

{{client_name}}
{{client_nip}}
zwaną dalej "Najemcą"

§1 Przedmiot umowy

Wynajmujący zobowiązuje się oddać w najem Najemcy następujący sprzęt:
{{equipment_list}}

§2 Okres najmu

Od: {{rental_start}}
Do: {{rental_end}}

§3 Wynagrodzenie

Czynsz najmu: {{rental_amount}} PLN

§4 Postanowienia końcowe

Zamawiający                           Wykonawca

........................          ........................',
  'rental',
  '[
    {"key": "contract_number", "label": "Numer umowy", "type": "text"},
    {"key": "signing_date", "label": "Data podpisania", "type": "date"},
    {"key": "company_name", "label": "Nazwa firmy", "type": "text"},
    {"key": "company_nip", "label": "NIP firmy", "type": "text"},
    {"key": "client_name", "label": "Nazwa klienta", "type": "text"},
    {"key": "client_nip", "label": "NIP klienta", "type": "text"},
    {"key": "equipment_list", "label": "Lista sprzętu", "type": "textarea"},
    {"key": "rental_start", "label": "Początek najmu", "type": "date"},
    {"key": "rental_end", "label": "Koniec najmu", "type": "date"},
    {"key": "rental_amount", "label": "Kwota najmu", "type": "number"}
  ]'::jsonb,
  true
);