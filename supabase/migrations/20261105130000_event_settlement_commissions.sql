-- Podsumowanie wydarzenia (rozliczenie przychodów i kosztów netto) i ewidencja prowizji (2026-11-05).
--
-- Zasady (ustalone z właścicielem):
--  * Pracownik CRM, który sprzedał wydarzenie (autor zaakceptowanej oferty; administrator może zmienić lub podzielić
--    udziały): 5% od zysku netto, 10% gdy w dniu akceptacji oferty był opiekunem klienta. Zysk = przychód netto
--    − koszty wydarzenia (koszty, faktury kosztowe) − podwykonawcy − ekipa (ewidencja czasu) − prowizje zewnętrzne
--    i narzut sprzedawcy. Stawki: ustawienia globalne + przełącznik i wyjątki przy pracowniku.
--  * Sprzedawca zewnętrzny (hotel, agencja — kartoteka sprzedawców z włączoną prowizją): stawka z kartoteki
--    od faktury netto − wykonawcy zewnętrzni (podwykonawcy). Także gdy tylko poleca / pośredniczy / jest kontaktem
--    rozliczeniowym.
--  * Prognoza od akceptacji oferty aktualizuje się sama. Prowizja jest do wypłaty po rozliczeniu: sprzedawca wysyła
--    podsumowanie po wydarzeniu, administrator zatwierdza (zamraża kwoty). Zmiana po wypłacie → dopłata albo
--    potrącenie, nigdy nadpisanie historii.
--  * Każda zmiana prowizji i każda wersja podsumowania jest zapisana (kto, kiedy, z czego).
-- Plik można uruchomić ponownie.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Stawki prowizji pracowników
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE public.compensation_settings
  ADD COLUMN IF NOT EXISTS sales_commission_standard_rate numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS sales_commission_own_client_rate numeric NOT NULL DEFAULT 10;

DO $$ BEGIN
  ALTER TABLE public.compensation_settings ADD CONSTRAINT compensation_settings_sales_commission_rates_check
    CHECK (sales_commission_standard_rate >= 0 AND sales_commission_standard_rate <= 100
       AND sales_commission_own_client_rate >= 0 AND sales_commission_own_client_rate <= 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.employee_sales_commission_terms (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  standard_rate numeric,
  own_client_rate numeric,
  payment_method text NOT NULL DEFAULT 'payroll',
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_sales_commission_terms_rates_check CHECK (
    (standard_rate IS NULL OR (standard_rate >= 0 AND standard_rate <= 100))
    AND (own_client_rate IS NULL OR (own_client_rate >= 0 AND own_client_rate <= 100))),
  CONSTRAINT employee_sales_commission_terms_payment_check
    CHECK (payment_method IN ('cash_dividend', 'invoice', 'payroll', 'other'))
);

CREATE TABLE IF NOT EXISTS public.employee_sales_commission_terms_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  before_values jsonb,
  after_values jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_sales_commission_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_sales_commission_terms_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_sales_commission_terms, public.employee_sales_commission_terms_audit FROM anon, authenticated;
GRANT SELECT ON public.employee_sales_commission_terms, public.employee_sales_commission_terms_audit TO authenticated;

DROP POLICY IF EXISTS employee_sales_commission_terms_read ON public.employee_sales_commission_terms;
CREATE POLICY employee_sales_commission_terms_read ON public.employee_sales_commission_terms FOR SELECT TO authenticated
  USING (employee_id = public.current_invoice_employee_id() OR public.current_employee_is_crm_admin()
         OR public.commission_settlement_can_access(NULL, true));
DROP POLICY IF EXISTS employee_sales_commission_terms_audit_read ON public.employee_sales_commission_terms_audit;
CREATE POLICY employee_sales_commission_terms_audit_read ON public.employee_sales_commission_terms_audit FOR SELECT TO authenticated
  USING (employee_id = public.current_invoice_employee_id() OR public.current_employee_is_crm_admin()
         OR public.commission_settlement_can_access(NULL, true));

-- Domyślnie prowizja jest włączona dla aktywnych pracowników sprzedaży (uprawnienia ofert), bez administratora.
INSERT INTO public.employee_sales_commission_terms (employee_id, enabled)
SELECT e.id, true FROM public.employees e
 WHERE e.is_active AND coalesce(e.role::text, '') <> 'admin' AND coalesce(e.access_level::text, '') <> 'admin'
   AND coalesce(e.permissions, '{}'::text[]) && ARRAY['offers_create', 'offers_manage']::text[]
ON CONFLICT (employee_id) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Prowizje: rodzaj wpisu (naliczenie / dopłata / potrącenie), źródło stawki i historia zmian
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE public.event_commissions
  ADD COLUMN IF NOT EXISTS entry_kind text NOT NULL DEFAULT 'accrual',
  ADD COLUMN IF NOT EXISTS corrects_commission_id uuid REFERENCES public.event_commissions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS settlement_revision integer,
  ADD COLUMN IF NOT EXISTS share_percent numeric,
  ADD COLUMN IF NOT EXISTS client_owned boolean,
  ADD COLUMN IF NOT EXISTS rate_reason text,
  ADD COLUMN IF NOT EXISTS auto_cancelled boolean NOT NULL DEFAULT false,
  -- Składki pracodawcy zapisane przy naliczeniu (koszt firmy nie zmienia się, gdy później zmienią się ustawienia).
  ADD COLUMN IF NOT EXISTS employer_social_rate numeric,
  -- Powód ręcznego anulowania prowizji z podsumowania (finanse / administrator).
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- Potrącenie nadpłaty zapisuje się w rejestrze wypłat jako rozliczenie bez przelewu.
ALTER TABLE public.event_commission_payouts ADD COLUMN IF NOT EXISTS is_offset boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.event_commissions ADD CONSTRAINT event_commissions_entry_kind_check
    CHECK (entry_kind IN ('accrual', 'correction', 'deduction'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.event_commissions ADD CONSTRAINT event_commissions_correction_link_check
    CHECK ((entry_kind = 'accrual') = (corrects_commission_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_event_commissions_event ON public.event_commissions(event_id);
CREATE INDEX IF NOT EXISTS idx_event_commissions_employee ON public.event_commissions(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_commissions_corrects ON public.event_commissions(corrects_commission_id) WHERE corrects_commission_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.event_commission_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_id uuid NOT NULL,
  event_id uuid,
  employee_id uuid,
  sales_partner_id uuid,
  action text NOT NULL,
  before_values jsonb,
  after_values jsonb,
  settlement_revision integer,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_commission_history_commission ON public.event_commission_history(commission_id, created_at);
CREATE INDEX IF NOT EXISTS idx_event_commission_history_event ON public.event_commission_history(event_id, created_at);
ALTER TABLE public.event_commission_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_commission_history FROM anon, authenticated;
GRANT SELECT ON public.event_commission_history TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Sprzedawca wydarzenia (udziały pracowników w prowizji)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_sales_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  share_percent numeric NOT NULL DEFAULT 100,
  source text NOT NULL DEFAULT 'manual',
  client_owned boolean NOT NULL DEFAULT false,
  client_label text,
  client_checked_at timestamptz NOT NULL DEFAULT now(),
  client_check_basis text NOT NULL DEFAULT 'offer_acceptance',
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sales_shares_unique UNIQUE (event_id, employee_id),
  CONSTRAINT event_sales_shares_percent_check CHECK (share_percent > 0 AND share_percent <= 100),
  CONSTRAINT event_sales_shares_source_check
    CHECK (source IN ('offer_author', 'seller_portal_owner', 'inquiry_owner', 'event_creator', 'manual')),
  CONSTRAINT event_sales_shares_basis_check CHECK (client_check_basis IN ('offer_acceptance', 'backfill', 'manual'))
);
CREATE INDEX IF NOT EXISTS idx_event_sales_shares_employee ON public.event_sales_shares(employee_id);

CREATE TABLE IF NOT EXISTS public.event_sales_share_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  before_values jsonb,
  after_values jsonb,
  reason text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_sales_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_sales_share_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_sales_shares, public.event_sales_share_audit FROM anon, authenticated;
GRANT SELECT ON public.event_sales_shares, public.event_sales_share_audit TO authenticated;

DROP POLICY IF EXISTS event_sales_shares_read ON public.event_sales_shares;
CREATE POLICY event_sales_shares_read ON public.event_sales_shares FOR SELECT TO authenticated
  USING (employee_id = public.current_invoice_employee_id() OR public.can_view_event_area(event_id, 'values'));
DROP POLICY IF EXISTS event_sales_share_audit_read ON public.event_sales_share_audit;
CREATE POLICY event_sales_share_audit_read ON public.event_sales_share_audit FOR SELECT TO authenticated
  USING (public.can_view_event_area(event_id, 'values'));

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Podsumowanie wydarzenia: stan, pozycje (korekty pozycji automatycznych i pozycje ręczne), wersje
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_settlements (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft',
  revision integer NOT NULL DEFAULT 0,
  submitted_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  submitted_note text,
  submitted_source_key text,
  approved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_source_key text,
  returned_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  returned_at timestamptz,
  returned_note text,
  no_sales_share boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_settlements_status_check CHECK (status IN ('draft', 'submitted', 'approved'))
);

CREATE TABLE IF NOT EXISTS public.event_settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id uuid,
  kind text,
  category text,
  name text,
  net_amount numeric(14,2),
  source_net numeric(14,2),
  included boolean,
  confirmed boolean NOT NULL DEFAULT false,
  note text,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_settlement_lines_source_check CHECK (source_type IN
    ('manual', 'invoice', 'offer', 'cash', 'forecast', 'event_cost', 'subcontractor_task', 'team', 'markup', 'commission')),
  CONSTRAINT event_settlement_lines_manual_check CHECK ((source_type = 'manual') = (source_id IS NULL)),
  CONSTRAINT event_settlement_lines_kind_check CHECK (kind IS NULL OR kind IN ('revenue', 'cost')),
  CONSTRAINT event_settlement_lines_category_check CHECK (category IS NULL OR category IN
    ('revenue', 'subcontractor', 'direct_cost', 'team', 'external_commission')),
  CONSTRAINT event_settlement_lines_amount_check CHECK (net_amount IS NULL OR
    (net_amount::text NOT IN ('NaN', 'Infinity', '-Infinity') AND abs(net_amount) < 1000000000)),
  CONSTRAINT event_settlement_lines_name_check CHECK (name IS NULL OR length(btrim(name)) BETWEEN 1 AND 300),
  CONSTRAINT event_settlement_lines_note_check CHECK (note IS NULL OR length(note) <= 2000)
);
ALTER TABLE public.event_settlements ADD COLUMN IF NOT EXISTS no_sales_share boolean NOT NULL DEFAULT false;
-- Ponowne otwarcie z przeliczeniem stawek: przy następnym zatwierdzeniu stawki i sposób wypłaty bierzemy z aktualnych
-- warunków (np. korekta błędnie ustawionej stawki), zamiast zachowywać je z poprzedniego zatwierdzenia.
ALTER TABLE public.event_settlements ADD COLUMN IF NOT EXISTS refresh_rates boolean NOT NULL DEFAULT false;
-- Kwota źródła w chwili korekty: gdy źródło się zmieni, korekta przestaje obowiązywać i trzeba ją potwierdzić ponownie.
ALTER TABLE public.event_settlement_lines ADD COLUMN IF NOT EXISTS source_net numeric(14,2);

CREATE UNIQUE INDEX IF NOT EXISTS event_settlement_lines_source_unique
  ON public.event_settlement_lines(event_id, source_type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_settlement_lines_event ON public.event_settlement_lines(event_id);

CREATE TABLE IF NOT EXISTS public.event_settlement_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  action text NOT NULL,
  snapshot jsonb NOT NULL,
  source_key text,
  note text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_settlement_versions_action_check
    CHECK (action IN ('submitted', 'returned', 'approved', 'reopened'))
);
CREATE INDEX IF NOT EXISTS idx_event_settlement_versions_event ON public.event_settlement_versions(event_id, created_at);

ALTER TABLE public.event_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_settlement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_settlement_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_settlements, public.event_settlement_lines, public.event_settlement_versions FROM anon, authenticated;
GRANT SELECT ON public.event_settlements, public.event_settlement_lines, public.event_settlement_versions TO authenticated;

DROP POLICY IF EXISTS event_settlements_read ON public.event_settlements;
CREATE POLICY event_settlements_read ON public.event_settlements FOR SELECT TO authenticated
  USING (public.can_view_event_area(event_id, 'values'));
DROP POLICY IF EXISTS event_settlement_lines_read ON public.event_settlement_lines;
CREATE POLICY event_settlement_lines_read ON public.event_settlement_lines FOR SELECT TO authenticated
  USING (public.can_view_event_area(event_id, 'values'));
DROP POLICY IF EXISTS event_settlement_versions_read ON public.event_settlement_versions;
CREATE POLICY event_settlement_versions_read ON public.event_settlement_versions FOR SELECT TO authenticated
  USING (public.can_view_event_area(event_id, 'values'));

-- Wersje i audyty są niezmienne.
CREATE OR REPLACE FUNCTION private.prevent_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'event_settlement_versions' THEN
    RAISE EXCEPTION 'Wydarzenie ma historię podsumowania i prowizji — nie można go usunąć. Anuluj je zamiast usuwać.';
  END IF;
  RAISE EXCEPTION 'Historia rozliczeń jest niezmienna.';
END $$;

DROP TRIGGER IF EXISTS event_settlement_versions_immutable ON public.event_settlement_versions;
CREATE TRIGGER event_settlement_versions_immutable BEFORE UPDATE OR DELETE ON public.event_settlement_versions
  FOR EACH ROW EXECUTE FUNCTION private.prevent_ledger_mutation();
DROP TRIGGER IF EXISTS event_commission_history_immutable ON public.event_commission_history;
CREATE TRIGGER event_commission_history_immutable BEFORE UPDATE ON public.event_commission_history
  FOR EACH ROW EXECUTE FUNCTION private.prevent_ledger_mutation();
DROP TRIGGER IF EXISTS event_sales_share_audit_immutable ON public.event_sales_share_audit;
CREATE TRIGGER event_sales_share_audit_immutable BEFORE UPDATE OR DELETE ON public.event_sales_share_audit
  FOR EACH ROW EXECUTE FUNCTION private.prevent_ledger_mutation();
DROP TRIGGER IF EXISTS employee_sales_commission_terms_audit_immutable ON public.employee_sales_commission_terms_audit;
CREATE TRIGGER employee_sales_commission_terms_audit_immutable BEFORE UPDATE OR DELETE ON public.employee_sales_commission_terms_audit
  FOR EACH ROW EXECUTE FUNCTION private.prevent_ledger_mutation();

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Pomocnicze: silnik prowizji, historia, koszt firmy, ochrona wpisów automatycznych
-- ---------------------------------------------------------------------------------------------------------------
-- Źródła prowizji liczonych z podsumowania (nie edytuje się ich ręcznie — tylko przez podsumowanie).
CREATE OR REPLACE FUNCTION private.commission_auto_sources()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['sales_share', 'billing_contact', 'event_referral', 'partner_arrangement', 'seller_portal', 'manual_partner']::text[];
$$;

CREATE OR REPLACE FUNCTION private.commission_engine_active()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('mavinci.commission_engine', true), '') = 'on';
$$;

-- Wartość netto oferty jak getOfferTotals().net (po rabacie, bez VAT).
CREATE OR REPLACE FUNCTION private.offer_net_amount(o public.offers)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_list numeric; v_discount numeric;
BEGIN
  v_discount := greatest(0, coalesce(o.discount_amount, 0));
  v_list := greatest(0, coalesce(o.subtotal, 0));
  IF v_list = 0 AND coalesce(o.total_amount, 0) > 0 THEN
    v_list := CASE WHEN coalesce(o.tax_amount, 0) > 0 THEN greatest(0, o.total_amount - o.tax_amount)
      ELSE o.total_amount / (1 + greatest(0, coalesce(o.tax_percent, 23)) / 100) END + v_discount;
  END IF;
  RETURN round(greatest(0, v_list - least(v_list, v_discount)), 2);
END $$;

-- Koszt firmy: wypłata gotówką z zysku (brutto-up podatku), wynagrodzenie pracownicze (+ składki pracodawcy).
CREATE OR REPLACE FUNCTION public.calculate_event_commission_cost()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.calculation_type = 'percent' THEN
    NEW.amount := ROUND(COALESCE(NEW.base_amount, 0) * COALESCE(NEW.rate, 0) / 100, 2);
  ELSE
    NEW.amount := ROUND(COALESCE(NEW.amount, 0), 2);
  END IF;

  IF NEW.payment_method = 'cash_dividend' THEN
    NEW.company_cost_amount := ROUND(NEW.amount / (1 - LEAST(99.99, GREATEST(0, COALESCE(NEW.dividend_tax_rate, 19))) / 100), 2);
  ELSIF NEW.payment_method = 'payroll' AND NEW.employer_social_rate IS NOT NULL THEN
    -- Stawka składek zapisana przy naliczeniu (nie z bieżących ustawień): koszt firmy jest stały także przy wypłacie.
    NEW.company_cost_amount := ROUND(NEW.amount * (1 + GREATEST(0, NEW.employer_social_rate) / 100), 2);
  ELSE
    NEW.company_cost_amount := NEW.amount;
  END IF;

  IF NEW.status = 'paid' AND NEW.paid_at IS NULL THEN
    NEW.paid_at := now();
  ELSIF NEW.status <> 'paid' THEN
    NEW.paid_at := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- Wpisy liczone z podsumowania zmienia tylko silnik. Ręcznie: anulowanie, notatka, termin; wypłaty — rejestr wypłat.
CREATE OR REPLACE FUNCTION private.guard_automatic_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_auto boolean; v_event uuid; v_status text; v_paid numeric; v_finance boolean;
BEGIN
  IF private.commission_engine_active() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_event := CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  v_auto := CASE WHEN TG_OP = 'INSERT'
    THEN NEW.entry_kind <> 'accrual' OR NEW.corrects_commission_id IS NOT NULL
         OR coalesce(NEW.automatic_source = ANY (private.commission_auto_sources()), false)
    ELSE OLD.entry_kind <> 'accrual' OR coalesce(OLD.automatic_source = ANY (private.commission_auto_sources()), false) END;

  v_finance := auth.uid() IS NULL OR coalesce(public.commission_settlement_can_access(v_event, true), false);

  IF NOT v_auto THEN
    -- Ręczne wpisy: po wysłaniu podsumowania zmienia je tylko finanse / administrator (podsumowanie byłoby nieaktualne).
    SELECT s.status INTO v_status FROM public.event_settlements s WHERE s.event_id = v_event;
    IF coalesce(v_status, 'draft') <> 'draft' AND NOT v_finance THEN
      RAISE EXCEPTION 'Podsumowanie wydarzenia jest wysłane lub zatwierdzone — prowizje tego wydarzenia zmienia finanse lub administrator.';
    END IF;
    -- Cudzy wpis ręczny (np. dodany przez administratora — ma pierwszeństwo przed prowizją z podsumowania) zmienia
    -- jego autor, finanse albo administrator.
    IF TG_OP <> 'INSERT' AND NOT v_finance AND OLD.created_by IS DISTINCT FROM public.current_invoice_employee_id() THEN
      RAISE EXCEPTION 'Ten wpis prowizji dodała inna osoba — zmienia go autor, finanse lub administrator.';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Prowizje z podsumowania wydarzenia, dopłaty i potrącenia tworzy wyłącznie podsumowanie wydarzenia.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Prowizji z podsumowania wydarzenia nie usuwa się — możesz ją anulować.';
  END IF;
  IF ROW(NEW.event_id, NEW.beneficiary_type, NEW.beneficiary_name, NEW.salesperson_id, NEW.employee_id,
         NEW.organization_id, NEW.contact_id, NEW.sales_partner_id, NEW.calculation_type, NEW.rate,
         NEW.base_amount, NEW.amount, NEW.payment_method, NEW.dividend_tax_rate, NEW.automatic_source,
         NEW.entry_kind, NEW.corrects_commission_id, NEW.settlement_revision, NEW.share_percent,
         NEW.client_owned, NEW.rate_reason, NEW.base_description, NEW.employer_social_rate)
     IS DISTINCT FROM
     ROW(OLD.event_id, OLD.beneficiary_type, OLD.beneficiary_name, OLD.salesperson_id, OLD.employee_id,
         OLD.organization_id, OLD.contact_id, OLD.sales_partner_id, OLD.calculation_type, OLD.rate,
         OLD.base_amount, OLD.amount, OLD.payment_method, OLD.dividend_tax_rate, OLD.automatic_source,
         OLD.entry_kind, OLD.corrects_commission_id, OLD.settlement_revision, OLD.share_percent,
         OLD.client_owned, OLD.rate_reason, OLD.base_description, OLD.employer_social_rate) THEN
    RAISE EXCEPTION 'Kwotę, podstawę i odbiorcę tej prowizji ustala podsumowanie wydarzenia. Zmień dane w zakładce Podsumowanie.';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT coalesce(sum(p.amount), 0) INTO v_paid FROM public.event_commission_payouts p WHERE p.commission_id = OLD.id;
    IF NEW.status = 'cancelled' THEN
      -- Anulowana prowizja nie pomniejsza zysku (podnosi prowizję sprzedawcy) — decyduje finanse / administrator, z powodem.
      IF NOT v_finance THEN
        RAISE EXCEPTION 'Prowizję z podsumowania anuluje finanse lub administrator.';
      END IF;
      IF nullif(btrim(NEW.cancel_reason), '') IS NULL OR length(NEW.cancel_reason) > 1000 THEN
        RAISE EXCEPTION 'Podaj powód anulowania prowizji (do 1000 znaków).';
      END IF;
      IF v_paid > 0 THEN
        RAISE EXCEPTION 'Prowizja ma wypłaty — zmiana wymaga ponownego zatwierdzenia podsumowania (dopłata lub potrącenie).';
      END IF;
      IF OLD.entry_kind <> 'accrual' THEN
        RAISE EXCEPTION 'Dopłatę i potrącenie zmienia ponowne zatwierdzenie podsumowania.';
      END IF;
      NEW.auto_cancelled := false;
      NEW.cancel_reason := btrim(NEW.cancel_reason);
    ELSIF OLD.status = 'cancelled' AND NEW.status = 'planned' AND v_paid = 0 AND OLD.entry_kind = 'accrual' THEN
      -- Przywrócenie ręcznie anulowanej prowizji — kwotę ustali podsumowanie.
      IF NOT v_finance THEN
        RAISE EXCEPTION 'Prowizję z podsumowania przywraca finanse lub administrator.';
      END IF;
      NEW.auto_cancelled := false;
      NEW.cancel_reason := NULL;
    ELSIF NEW.status = 'paid' AND OLD.status = 'approved' AND v_paid = NEW.amount THEN
      NULL; -- pełna wypłata zapisana w rejestrze wypłat
    ELSIF NEW.status = 'approved' AND OLD.status = 'paid' AND v_paid < NEW.amount THEN
      NULL; -- rejestr wypłat (pilnuje protect_commission_settlement_history)
    ELSE
      RAISE EXCEPTION 'Status tej prowizji wynika z podsumowania wydarzenia i rejestru wypłat.';
    END IF;
  ELSE
    NEW.cancel_reason := OLD.cancel_reason;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS aa_guard_automatic_commission ON public.event_commissions;
CREATE TRIGGER aa_guard_automatic_commission BEFORE INSERT OR UPDATE OR DELETE ON public.event_commissions
  FOR EACH ROW EXECUTE FUNCTION private.guard_automatic_commission();

-- Autor wpisu zawsze z sesji (od niego zależy pierwszeństwo wpisu ręcznego), nie z danych wysłanych przez aplikację.
-- Wynagrodzenie pracownika: stawka składek pracodawcy z ustawień w chwili naliczenia (koszt firmy = brutto + składki);
-- potem stała. Inni odbiorcy (sprzedawca, firma) — bez składek. Wpisy silnika ustawia silnik.
CREATE OR REPLACE FUNCTION private.stamp_event_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF private.commission_engine_active() THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := public.current_invoice_employee_id();
    ELSE
      NEW.created_by := OLD.created_by;
    END IF;
  END IF;
  IF NEW.payment_method = 'payroll' AND NEW.beneficiary_type = 'employee'
     AND (TG_OP = 'INSERT' OR OLD.payment_method IS DISTINCT FROM 'payroll') THEN
    NEW.employer_social_rate := (SELECT s.employer_social_rate FROM public.compensation_settings s WHERE s.id = 1);
  ELSIF TG_OP = 'INSERT' THEN
    NEW.employer_social_rate := NULL;
  ELSIF NEW.payment_method IS DISTINCT FROM 'payroll' OR NEW.beneficiary_type IS DISTINCT FROM 'employee' THEN
    NEW.employer_social_rate := NULL;
  ELSE
    NEW.employer_social_rate := OLD.employer_social_rate;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS a0_stamp_event_commission ON public.event_commissions;
CREATE TRIGGER a0_stamp_event_commission BEFORE INSERT OR UPDATE ON public.event_commissions
  FOR EACH ROW EXECUTE FUNCTION private.stamp_event_commission();

-- Historia każdej zmiany prowizji (także ręcznych).
CREATE OR REPLACE FUNCTION private.log_event_commission_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_before jsonb; v_after jsonb; v_action text;
  v_row public.event_commissions%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  IF TG_OP <> 'INSERT' THEN
    v_before := jsonb_build_object('status', OLD.status, 'amount', OLD.amount, 'base_amount', OLD.base_amount,
      'rate', OLD.rate, 'company_cost_amount', OLD.company_cost_amount, 'payment_method', OLD.payment_method,
      'beneficiary_name', OLD.beneficiary_name, 'base_description', OLD.base_description,
      'settlement_revision', OLD.settlement_revision, 'share_percent', OLD.share_percent,
      'client_owned', OLD.client_owned, 'rate_reason', OLD.rate_reason, 'cancel_reason', OLD.cancel_reason);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_after := jsonb_build_object('status', NEW.status, 'amount', NEW.amount, 'base_amount', NEW.base_amount,
      'rate', NEW.rate, 'company_cost_amount', NEW.company_cost_amount, 'payment_method', NEW.payment_method,
      'beneficiary_name', NEW.beneficiary_name, 'base_description', NEW.base_description,
      'settlement_revision', NEW.settlement_revision, 'share_percent', NEW.share_percent,
      'client_owned', NEW.client_owned, 'rate_reason', NEW.rate_reason, 'cancel_reason', NEW.cancel_reason);
  END IF;
  IF TG_OP = 'UPDATE' AND v_before = v_after THEN RETURN NULL; END IF;
  -- Prognoza zmienia się z każdą fakturą i kosztem — w historii zapisujemy powstanie wpisu, zmiany statusu
  -- i każdą zmianę wpisu zatwierdzonego, nie każde przeliczenie prognozy.
  IF TG_OP = 'UPDATE' AND OLD.status = 'planned' AND NEW.status = 'planned' THEN RETURN NULL; END IF;
  v_action := CASE
    WHEN TG_OP = 'INSERT' THEN CASE NEW.entry_kind WHEN 'correction' THEN 'correction' WHEN 'deduction' THEN 'deduction' ELSE 'created' END
    WHEN TG_OP = 'DELETE' THEN 'deleted'
    WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'status:' || NEW.status
    ELSE 'recalculated' END;
  INSERT INTO public.event_commission_history (commission_id, event_id, employee_id, sales_partner_id, action,
    before_values, after_values, settlement_revision, actor_id)
  VALUES (v_row.id, v_row.event_id, v_row.employee_id, v_row.sales_partner_id, v_action, v_before, v_after,
    v_row.settlement_revision, public.current_invoice_employee_id());
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS zz_log_event_commission_change ON public.event_commissions;
CREATE TRIGGER zz_log_event_commission_change AFTER INSERT OR UPDATE OR DELETE ON public.event_commissions
  FOR EACH ROW EXECUTE FUNCTION private.log_event_commission_change();

DROP POLICY IF EXISTS event_commission_history_read ON public.event_commission_history;
CREATE POLICY event_commission_history_read ON public.event_commission_history FOR SELECT TO authenticated
  USING (
    (employee_id IS NOT NULL AND employee_id = public.current_invoice_employee_id())
    OR (event_id IS NOT NULL AND public.commission_settlement_can_access(event_id, false))
    OR public.sales_commission_visible(commission_id)
  );

-- Prowizję opiekuna sprzedawcy portalu nalicza teraz podsumowanie wydarzenia (udział sprzedawcy wydarzenia).
CREATE OR REPLACE FUNCTION public.protect_seller_owner_profit_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE r public.seller_owner_profit_reviews; ctx jsonb; needs_current boolean:=false; latest uuid;
BEGIN
  IF TG_OP='UPDATE' AND OLD.owner_profit_review_id IS NOT NULL AND NEW.owner_profit_review_id IS NULL THEN
    RAISE EXCEPTION 'Nie można usunąć podstawy prowizji opiekuna.';
  END IF;
  IF NEW.owner_profit_review_id IS NULL THEN
    IF NEW.automatic_source = 'sales_share' OR NEW.entry_kind <> 'accrual' THEN RETURN NEW; END IF;
    IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.offers o
      LEFT JOIN public.sales_partner_profiles p ON p.id=NEW.sales_partner_id
      WHERE o.event_id=NEW.event_id AND o.sales_channel='seller_portal'
        AND public.seller_partner_manager_id(o.sales_partner_id,o.my_company_id)
          IN (NEW.employee_id,NEW.salesperson_id,p.employee_id)) THEN
      RAISE EXCEPTION 'Prowizję opiekuna nalicza podsumowanie wydarzenia (udział sprzedawcy). Nie dodawaj jej ręcznie.';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT r FROM public.seller_owner_profit_reviews WHERE id=NEW.owner_profit_review_id;
  IF TG_OP='UPDATE' AND OLD.owner_profit_review_id IS DISTINCT FROM NEW.owner_profit_review_id
    AND (OLD.status<>'planned' OR EXISTS(SELECT 1 FROM public.event_commission_payouts p WHERE p.commission_id=OLD.id)) THEN
    RAISE EXCEPTION 'Zatwierdzona prowizja lub historia wypłat nie mogą otrzymać innej podstawy.';
  END IF;
  IF ROW(NEW.event_id,NEW.employee_id,NEW.sales_partner_id,NEW.calculation_type,NEW.rate,NEW.base_amount,NEW.amount,NEW.payment_method,NEW.dividend_tax_rate,NEW.automatic_source)
    IS DISTINCT FROM ROW(r.event_id,r.manager_id,r.owner_partner_id,'percent'::text,(r.snapshot->>'rate')::numeric,
      (r.snapshot->>'base_amount')::numeric,(r.snapshot->>'amount')::numeric,r.snapshot->>'payment_method',
      (r.snapshot->>'dividend_tax_rate')::numeric,'seller_owner_profit'::text)
    OR NEW.contact_id IS NOT NULL OR NEW.organization_id IS NOT NULL OR NEW.salesperson_id IS NOT NULL
    OR NEW.beneficiary_type<>'employee' THEN
    RAISE EXCEPTION 'Dane prowizji opiekuna muszą odpowiadać zapisanej kalkulacji zysku.';
  END IF;
  NEW.company_cost_amount:=(r.snapshot->>'company_cost')::numeric;
  IF TG_OP='INSERT' THEN needs_current:=true;
  ELSE needs_current:=OLD.owner_profit_review_id IS DISTINCT FROM NEW.owner_profit_review_id
    OR (NEW.status IN ('approved','paid') AND NEW.status IS DISTINCT FROM OLD.status); END IF;
  IF needs_current THEN
    ctx:=public.seller_owner_profit_context(r.offer_id);
    SELECT id INTO latest FROM public.seller_owner_profit_reviews WHERE offer_id=r.offer_id ORDER BY recorded_at DESC,id LIMIT 1;
    IF r.id IS DISTINCT FROM latest OR r.source_key IS DISTINCT FROM ctx->>'source_key'
      OR jsonb_array_length(ctx->'issues')>0 OR ctx->>'offer_status'<>'accepted' OR ctx->>'external_cost_source'='estimated' THEN
      RAISE EXCEPTION 'Najpierw sprawdź i zapisz aktualną kalkulację zysku opiekuna. Nie zatwierdzamy nieaktualnej podstawy.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Stary panel „Rentowność i prowizja opiekuna” — zastąpiony podsumowaniem wydarzenia (nieużywany, 0 naliczeń).
CREATE OR REPLACE FUNCTION public.book_seller_owner_profit_commission(p_review uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
BEGIN
  RAISE EXCEPTION 'Prowizję opiekuna nalicza teraz zakładka Podsumowanie w wydarzeniu (udział sprzedawcy, 5%% / 10%% od zysku).';
END;
$function$;

-- Identyfikator wpisu prowizji (deterministyczny — jeden wpis na osobę i wydarzenie, także przy równoczesnych zapisach).
CREATE OR REPLACE FUNCTION private.commission_uuid(p_seed text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-5' || substr(h, 14, 3) || '-a' || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
  FROM (SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') AS h) x;
$$;

-- Czy pracownik był opiekunem klienta wydarzenia (organizacja, a bez niej osoba kontaktowa).
CREATE OR REPLACE FUNCTION private.event_client_owner(p_event_id uuid)
RETURNS TABLE(owner_id uuid, client_label text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN o.id IS NOT NULL THEN o.owner_id ELSE c.owner_id END,
         CASE WHEN o.id IS NOT NULL THEN coalesce(nullif(btrim(o.alias), ''), o.name)
              ELSE coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) END
  FROM public.events e
  LEFT JOIN public.organizations o ON o.id = e.organization_id
  LEFT JOIN public.contacts c ON c.id = e.contact_person_id
  WHERE e.id = p_event_id;
$$;

-- Sprzedawca wydarzenia: autor zaakceptowanej oferty (portal sprzedawcy → opiekun sprzedawcy), dalej prowadzący
-- zapytanie i twórca wydarzenia. Tworzony raz — potem zmienia go tylko administrator.
CREATE OR REPLACE FUNCTION private.ensure_event_sales_shares(p_event_id uuid, p_basis text DEFAULT 'backfill')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  o public.offers%ROWTYPE; e public.events%ROWTYPE;
  v_employee uuid; v_source text; v_owner uuid; v_label text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.event_sales_shares s WHERE s.event_id = p_event_id) THEN RETURN; END IF;
  -- Administrator świadomie zostawił wydarzenie bez sprzedawcy.
  IF EXISTS (SELECT 1 FROM public.event_settlements s WHERE s.event_id = p_event_id AND s.no_sales_share) THEN RETURN; END IF;
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR e.status::text IN ('cancelled', 'settled') THEN RETURN; END IF;
  SELECT * INTO o FROM public.offers x WHERE x.event_id = p_event_id AND x.status::text = 'accepted'
   ORDER BY x.accepted_at NULLS LAST, x.created_at, x.id LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF o.sales_channel = 'seller_portal' AND o.sales_partner_id IS NOT NULL THEN
    v_employee := public.seller_partner_manager_id(o.sales_partner_id, o.my_company_id); v_source := 'seller_portal_owner';
  ELSE
    SELECT emp.id INTO v_employee FROM public.employees emp
     WHERE emp.id = o.created_by OR emp.auth_user_id = o.created_by
     ORDER BY (emp.id = o.created_by) DESC LIMIT 1;
    v_source := 'offer_author';
  END IF;
  IF v_employee IS NULL THEN
    SELECT t.inquiry_owner_id INTO v_employee FROM public.tasks t
     WHERE t.is_inquiry AND t.event_id = p_event_id AND t.inquiry_owner_id IS NOT NULL
     ORDER BY t.created_at LIMIT 1;
    v_source := 'inquiry_owner';
  END IF;
  IF v_employee IS NULL THEN
    SELECT emp.id INTO v_employee FROM public.employees emp
     WHERE emp.id = e.created_by OR emp.auth_user_id = e.created_by
     ORDER BY (emp.id = e.created_by) DESC LIMIT 1;
    v_source := 'event_creator';
  END IF;
  IF v_employee IS NULL OR NOT EXISTS (SELECT 1 FROM public.employees emp WHERE emp.id = v_employee) THEN RETURN; END IF;
  SELECT x.owner_id, x.client_label INTO v_owner, v_label FROM private.event_client_owner(p_event_id) x;
  INSERT INTO public.event_sales_shares (event_id, employee_id, share_percent, source, client_owned, client_label,
    client_checked_at, client_check_basis, created_by)
  VALUES (p_event_id, v_employee, 100, v_source, coalesce(v_owner = v_employee, false), v_label, now(),
    CASE WHEN p_basis = 'offer_acceptance' THEN 'offer_acceptance' ELSE 'backfill' END, public.current_invoice_employee_id())
  ON CONFLICT (event_id, employee_id) DO NOTHING;
  INSERT INTO public.event_sales_share_audit (event_id, before_values, after_values, reason, actor_id)
  SELECT p_event_id, NULL, jsonb_agg(to_jsonb(s)), 'Automatycznie: ' || v_source, public.current_invoice_employee_id()
    FROM public.event_sales_shares s WHERE s.event_id = p_event_id;
END $$;

-- Ręczny wpis prowizji ma pierwszeństwo przed wyliczeniem z podsumowania tylko wtedy, gdy zatwierdziły go finanse
-- (status zatwierdzona / wypłacona) albo wpisał go administrator. Inaczej czeka — liczy się prowizja z podsumowania.
CREATE OR REPLACE FUNCTION private.commission_manual_precedes(c public.event_commissions)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.status IN ('approved', 'paid')
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = c.created_by
                   AND (e.role::text = 'admin' OR e.access_level::text = 'admin' OR 'admin' = ANY (coalesce(e.permissions, '{}'::text[]))));
$$;

-- Warunki sprzedawcy dla marki sprawdzamy przy nowym naliczeniu; dopłata i potrącenie dotyczą już zatwierdzonej prowizji.
CREATE OR REPLACE FUNCTION public.enforce_sales_partner_event_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_company_id uuid;
BEGIN
  IF NEW.sales_partner_id IS NULL OR NEW.entry_kind <> 'accrual' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.sales_partner_id IS NOT DISTINCT FROM OLD.sales_partner_id AND NEW.event_id IS NOT DISTINCT FROM OLD.event_id THEN
    RETURN NEW;
  END IF;
  SELECT event.my_company_id INTO v_company_id
  FROM public.events event
  WHERE event.id = NEW.event_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sales_partner_brand_terms term
    WHERE term.sales_partner_id = NEW.sales_partner_id
      AND term.my_company_id = v_company_id
      AND term.is_active = true
      AND term.commission_enabled = true
  ) THEN
    RAISE EXCEPTION 'Ten sprzedawca nie ma włączonego rozliczenia prowizyjnego dla marki wydarzenia';
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Pozycje automatyczne podsumowania (bez zapisu — liczone z danych źródłowych przy każdym odczycie)
-- ---------------------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS private.event_settlement_auto_lines(uuid);
CREATE FUNCTION private.event_settlement_auto_lines(p_event_id uuid)
RETURNS TABLE(source_type text, source_id uuid, kind text, category text, name text, detail text, line_date date,
              suggested_net numeric, gross_amount numeric, auto_included boolean, needs_confirmation boolean,
              auto_note text, sort_order integer, group_id uuid, ref_partner uuid, ref_contact uuid, ref_employee uuid,
              precedes boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH ev AS (SELECT * FROM public.events WHERE id = p_event_id),
  inv AS (
    SELECT i.*, CASE WHEN a.total_weight > 0 THEN coalesce(a.my_weight, 0) / a.total_weight ELSE 1 END AS share
      FROM public.invoices i
      LEFT JOIN LATERAL (
        SELECT sum(x.allocation_weight) AS total_weight,
               sum(x.allocation_weight) FILTER (WHERE x.event_id = p_event_id) AS my_weight
          FROM public.invoice_event_allocations x WHERE x.invoice_id = i.id) a ON true
     WHERE (i.event_id = p_event_id OR EXISTS (SELECT 1 FROM public.invoice_event_allocations x
                                                WHERE x.invoice_id = i.id AND x.event_id = p_event_id))
       AND NOT coalesce(i.is_proforma, false) AND coalesce(i.invoice_type, 'vat') <> 'proforma'
       AND coalesce(i.status, '') NOT IN ('draft', 'cancelled', 'proforma')
  ),
  full_invoice AS (SELECT EXISTS (SELECT 1 FROM inv WHERE inv.invoice_type IN ('vat', 'final') AND inv.share > 0)
                       OR EXISTS (SELECT 1 FROM public.event_financials f WHERE f.event_id = p_event_id AND coalesce(f.actual_cash_revenue, 0) > 0)
                       AS present),
  off AS (
    SELECT o.*, private.offer_net_amount(o) AS net FROM public.offers o
     WHERE o.event_id = p_event_id AND o.status::text = 'accepted'
  ),
  lines AS (
    -- Faktury sprzedaży. Zaliczka rozliczona w fakturze końcowej nie liczy się drugi raz (jak w raporcie finansowym).
    SELECT 'invoice'::text AS source_type, i.id AS source_id, 'revenue'::text AS kind, 'revenue'::text AS category,
           coalesce(nullif(btrim(i.invoice_number), ''), 'Faktura bez numeru') AS name,
           concat_ws(' · ',
             CASE i.invoice_type WHEN 'advance' THEN 'Faktura zaliczkowa' WHEN 'final' THEN 'Faktura końcowa (pełna wartość)'
               WHEN 'corrective' THEN 'Faktura korygująca' ELSE 'Faktura VAT' END,
             nullif(btrim(i.buyer_name), ''),
             CASE WHEN i.share < 1 THEN 'udział ' || replace(round(i.share * 100, 1)::text, '.', ',') || '%' END) AS detail,
           i.issue_date AS line_date,
           round(coalesce(i.total_net, 0) * i.share, 2) AS suggested_net,
           round(coalesce(i.total_gross, 0) * i.share, 2) AS gross_amount,
           CASE WHEN fin.number IS NOT NULL THEN false
                WHEN i.invoice_type = 'advance' AND NOT (SELECT present FROM full_invoice) AND EXISTS (SELECT 1 FROM off) THEN false
                ELSE true END AS auto_included,
           false AS needs_confirmation,
           CASE WHEN fin.number IS NOT NULL THEN 'Rozliczona w fakturze końcowej ' || fin.number || ' — nie liczymy jej drugi raz.'
                WHEN i.invoice_type = 'advance' AND NOT (SELECT present FROM full_invoice) AND EXISTS (SELECT 1 FROM off)
                  THEN 'Zaliczka — do czasu faktury końcowej przychód prognozujemy z oferty.' END AS auto_note,
           10 AS sort_order, NULL::uuid AS group_id, NULL::uuid AS ref_partner, NULL::uuid AS ref_contact,
           NULL::uuid AS ref_employee, NULL::boolean AS precedes
      FROM inv i
      LEFT JOIN LATERAL (
        SELECT coalesce(nullif(btrim(f.invoice_number), ''), 'bez numeru') AS number
          FROM public.invoices f
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.settled_invoices) = 'array' THEN f.settled_invoices ELSE '[]'::jsonb END) s
         WHERE i.invoice_type = 'advance' AND f.invoice_type = 'final' AND coalesce(f.status, '') NOT IN ('draft', 'cancelled', 'proforma')
           AND s->>'id' = i.id::text
         LIMIT 1) fin ON true
     WHERE i.share > 0
    UNION ALL
    -- Prognoza z zaakceptowanej oferty (do czasu faktury VAT / końcowej albo gotówki).
    SELECT 'offer', o.id, 'revenue', 'revenue',
           'Oferta ' || coalesce(nullif(btrim(o.offer_number), ''), 'bez numeru'),
           CASE WHEN o.commercial_model = 'markup' THEN 'Prognoza z zaakceptowanej oferty (z narzutem sprzedawcy)'
                ELSE 'Prognoza z zaakceptowanej oferty' END,
           o.accepted_at::date, o.net, NULL::numeric,
           NOT (SELECT present FROM full_invoice), false,
           CASE WHEN (SELECT present FROM full_invoice) THEN 'Zastąpiona fakturami sprzedaży lub przychodem gotówkowym.'
                ELSE 'Prognoza — do rozliczenia potrzebna jest faktura sprzedaży.' END,
           20, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::boolean
      FROM off o
    UNION ALL
    -- Przychód gotówkowy z rozliczenia wydarzenia.
    SELECT 'cash', f.event_id, 'revenue', 'revenue', 'Przychód gotówkowy', 'Z rozliczenia gotówki wydarzenia',
           NULL::date, f.actual_cash_revenue, f.actual_cash_revenue,
           true, true, 'Potwierdź kwotę netto przychodu gotówkowego.', 30,
           NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::boolean
      FROM public.event_financials f
     WHERE f.event_id = p_event_id AND coalesce(f.actual_cash_revenue, 0) > 0
    UNION ALL
    -- Prognoza z kalkulacji / budżetu, gdy nie ma zaakceptowanej oferty.
    SELECT 'forecast', f.event_id, 'revenue', 'revenue', 'Przychód planowany', 'Prognoza z kalkulacji lub budżetu wydarzenia',
           NULL::date, f.expected_revenue, NULL::numeric,
           NOT (SELECT present FROM full_invoice), false,
           'Prognoza — do rozliczenia potrzebna jest faktura sprzedaży.', 40,
           NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::boolean
      FROM public.event_financials f
     WHERE f.event_id = p_event_id AND coalesce(f.expected_revenue, 0) > 0 AND NOT EXISTS (SELECT 1 FROM off)
    UNION ALL
    -- Koszty wydarzenia (także faktury kosztowe KSeF i spoza KSeF przypisane do wydarzenia).
    SELECT 'event_cost', ec.id, 'cost',
           CASE WHEN ec.subcontractor_id IS NOT NULL THEN 'subcontractor' ELSE 'direct_cost' END,
           coalesce(nullif(btrim(ec.name), ''), 'Koszt'),
           concat_ws(' · ', cat.name, coalesce(k.seller_name, x.seller_name, s.company_name),
             CASE WHEN k.id IS NOT NULL THEN 'KSeF ' || coalesce(k.invoice_number, '') WHEN x.id IS NOT NULL THEN 'faktura ' || x.invoice_number END),
           ec.cost_date,
           CASE WHEN k.id IS NOT NULL AND coalesce(k.gross_amount, 0) <> 0 AND k.net_amount IS NOT NULL
                  THEN round(ec.amount * k.net_amount / k.gross_amount, 2)
                WHEN x.id IS NOT NULL AND coalesce(x.amount_gross, 0) <> 0 AND x.amount_net IS NOT NULL
                  THEN round(ec.amount * x.amount_net / x.amount_gross, 2)
                ELSE ec.amount END,
           ec.amount,
           true,
           NOT ((k.id IS NOT NULL AND coalesce(k.gross_amount, 0) <> 0 AND k.net_amount IS NOT NULL)
             OR (x.id IS NOT NULL AND coalesce(x.amount_gross, 0) <> 0 AND x.amount_net IS NOT NULL)),
           CASE WHEN k.id IS NULL AND x.id IS NULL THEN 'Koszt wpisany ręcznie — potwierdź, ile wynosi netto.'
                ELSE 'Netto z faktury kosztowej.' END,
           50, ec.subcontractor_id, NULL::uuid, NULL::uuid, NULL::uuid, NULL::boolean
      FROM public.event_costs ec
      LEFT JOIN public.event_cost_categories cat ON cat.id = ec.category_id
      LEFT JOIN public.ksef_invoices k ON k.id = ec.ksef_invoice_id
      LEFT JOIN public.external_invoices x ON x.id = ec.external_invoice_id
      LEFT JOIN public.subcontractors s ON s.id = ec.subcontractor_id
     WHERE ec.event_id = p_event_id AND coalesce(ec.status, '') <> 'rejected'
    UNION ALL
    -- Zlecenia podwykonawców. Kwota uzgodniona pomniejszona o koszty tego podwykonawcy już wpisane (np. jego faktura)
    -- — różnicę liczy event_settlement_compute po korektach pozycji.
    SELECT 'subcontractor_task', t.id, 'cost', 'subcontractor',
           coalesce(nullif(btrim(t.task_name), ''), 'Zlecenie podwykonawcy'),
           concat_ws(' · ', s.company_name, 'kwota uzgodniona'),
           coalesce(t.start_date, t.scheduled_start::date),
           round(coalesce(nullif(t.agreed_cost, 0), nullif(t.total_cost, 0), nullif(t.fixed_price, 0),
                          t.hourly_rate * coalesce(t.actual_hours, t.estimated_hours)), 2),
           NULL::numeric,
           true, false, 'Kwota uzgodniona z podwykonawcą (netto).', 60,
           t.subcontractor_id, NULL::uuid, NULL::uuid, NULL::uuid, NULL::boolean
      FROM public.subcontractor_tasks t
      LEFT JOIN public.subcontractors s ON s.id = t.subcontractor_id
     WHERE t.event_id = p_event_id AND coalesce(t.status::text, '') NOT IN ('cancelled', 'declined', 'rejected')
       AND coalesce(nullif(t.agreed_cost, 0), nullif(t.total_cost, 0), nullif(t.fixed_price, 0),
                    t.hourly_rate * coalesce(t.actual_hours, t.estimated_hours), 0) > 0
    UNION ALL
    -- Ekipa za to wydarzenie: ewidencja czasu ze stawką.
    SELECT 'team', te.employee_id, 'cost', 'team',
           'Ekipa: ' || coalesce(nullif(btrim(concat_ws(' ', emp.name, emp.surname)), ''), 'pracownik'),
           replace(round(sum(te.duration_minutes) / 60.0, 2)::text, '.', ',') || ' h z ewidencji czasu',
           max(te.start_time)::date,
           round(sum(te.duration_minutes / 60.0 * te.hourly_rate), 2), NULL::numeric,
           true, false, NULL::text, 70,
           NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::boolean
      FROM public.time_entries te
      LEFT JOIN public.employees emp ON emp.id = te.employee_id
     WHERE te.event_id = p_event_id AND te.employee_id IS NOT NULL
       AND coalesce(te.hourly_rate, 0) > 0 AND coalesce(te.duration_minutes, 0) > 0
     GROUP BY te.employee_id, emp.name, emp.surname
    UNION ALL
    -- Narzut sprzedawcy zewnętrznego (oferta z narzutem): narzut nie jest naszym przychodem.
    SELECT 'markup', o.id, 'cost', 'external_commission', 'Narzut sprzedawcy zewnętrznego',
           'Oferta ' || coalesce(nullif(btrim(o.offer_number), ''), 'bez numeru') || ' rozliczana narzutem',
           o.accepted_at::date, round(o.net - o.partner_base_net, 2), NULL::numeric,
           coalesce(ev.billing_arrangement, 'direct') = 'direct', false,
           CASE WHEN coalesce(ev.billing_arrangement, 'direct') <> 'direct'
                THEN 'Rozliczenie przez hotel / agencję — narzut jest poza naszą fakturą.'
                ELSE 'Narzut jest w naszej fakturze, ale należy się sprzedawcy.' END,
           80, NULL::uuid, o.sales_partner_id, NULL::uuid, NULL::uuid, NULL::boolean
      FROM off o CROSS JOIN ev
     WHERE o.commercial_model = 'markup' AND o.partner_base_net IS NOT NULL AND o.net > o.partner_base_net
    UNION ALL
    -- Prowizje wpisane ręcznie (koszt firmy). Prowizje liczone przez podsumowanie dochodzą osobno.
    SELECT 'commission', c.id, 'cost', 'external_commission',
           'Prowizja: ' || coalesce(nullif(btrim(c.beneficiary_name), ''), 'odbiorca'),
           'Wpis ręczny' || CASE WHEN c.status = 'paid' THEN ' · wypłacona' WHEN c.status = 'approved' THEN ' · zatwierdzona' ELSE ' · czeka na zatwierdzenie' END,
           c.created_at::date, coalesce(c.company_cost_amount, c.amount), c.amount,
           NOT own.present, false,
           CASE WHEN own.present THEN 'Ręczna prowizja sprzedawcy wydarzenia — prowizje pracowników nie pomniejszają zysku.' END,
           90, NULL::uuid, c.sales_partner_id, c.contact_id, c.employee_id, private.commission_manual_precedes(c)
      FROM public.event_commissions c
      CROSS JOIN LATERAL (SELECT c.employee_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.event_sales_shares sh
         WHERE sh.event_id = p_event_id AND sh.employee_id = c.employee_id) AS present) own
     WHERE c.event_id = p_event_id AND c.status <> 'cancelled' AND c.entry_kind = 'accrual'
       AND c.owner_profit_review_id IS NULL
       AND (c.automatic_source IS NULL OR NOT (c.automatic_source = ANY (private.commission_auto_sources())))
  )
  SELECT * FROM lines;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Obliczenie podsumowania: pozycje + korekty, sumy, prowizje zewnętrzne i pracowników, braki
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.event_settlement_compute(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  e public.events%ROWTYPE;
  settings public.compensation_settings%ROWTYPE;
  v_raw jsonb; v_lines jsonb;
  v_revenue numeric := 0; v_sub numeric := 0; v_direct numeric := 0; v_team numeric := 0; v_ext_lines numeric := 0;
  v_partner_base numeric := 0; v_external jsonb := '[]'; v_ext_auto numeric := 0; v_profit numeric := 0;
  v_internal jsonb := '[]'; v_internal_total numeric := 0; v_internal_cost numeric := 0;
  v_issues jsonb := '[]'; v_warnings jsonb := '[]';
  v_unconfirmed integer := 0; v_forecast_lines integer := 0; v_share_sum numeric; v_share_count integer;
  v_finished boolean; v_cancelled boolean; v_key_input jsonb; v_revision integer; v_clawback boolean;
  v_refresh_rates boolean;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO settings FROM public.compensation_settings WHERE id = 1;
  SELECT s.revision, s.refresh_rates INTO v_revision, v_refresh_rates FROM public.event_settlements s WHERE s.event_id = p_event_id;
  v_revision := coalesce(v_revision, 0);
  -- Administrator otworzył podsumowanie z przeliczeniem stawek: nie zachowujemy stawek z poprzedniego zatwierdzenia.
  v_refresh_rates := coalesce(v_refresh_rates, false);
  v_cancelled := e.status::text = 'cancelled';
  -- Anulowanie po zatwierdzeniu: ponowne zatwierdzenie zeruje prowizje (dopłaty / potrącenia).
  v_clawback := v_cancelled AND v_revision > 0;
  v_finished := e.status::text IN ('completed', 'invoiced', 'settled')
    OR coalesce(e.event_end_date, e.event_date) < now();

  -- 1. Pozycje: automatyczne + korekty + ręczne. Korekta kwoty / potwierdzenie obowiązuje, dopóki kwota źródła
  --    się nie zmieni (source_net); po zmianie źródła pozycja wymaga ponownego potwierdzenia.
  WITH auto AS (SELECT * FROM private.event_settlement_auto_lines(p_event_id)),
  ov AS (SELECT * FROM public.event_settlement_lines l WHERE l.event_id = p_event_id AND l.source_type <> 'manual'),
  joined AS (
    SELECT a.*, ov.id AS ov_id, ov.category AS ov_category, ov.net_amount AS ov_net, ov.source_net AS ov_source_net,
           ov.included AS ov_included, ov.confirmed AS ov_confirmed, ov.note AS ov_note, ov.updated_at AS ov_updated_at,
           ov.updated_by AS ov_updated_by,
           (ov.id IS NOT NULL AND (ov.net_amount IS NOT NULL OR ov.confirmed)) AS ov_has_value,
           (ov.source_net IS NOT DISTINCT FROM a.suggested_net) AS ov_valid
      FROM auto a LEFT JOIN ov ON ov.source_type = a.source_type AND ov.source_id = a.source_id
  ),
  merged AS (
    SELECT jsonb_build_object(
             'key', j.source_type || ':' || j.source_id, 'line_id', j.ov_id, 'source_type', j.source_type,
             'source_id', j.source_id, 'kind', j.kind,
             'category', CASE WHEN j.source_type IN ('event_cost', 'subcontractor_task') AND j.ov_category IN ('subcontractor', 'direct_cost')
                              THEN j.ov_category ELSE j.category END,
             'name', j.name, 'detail', nullif(j.detail, ''), 'date', j.line_date, 'suggested_net', j.suggested_net,
             'net_amount', coalesce(CASE WHEN j.source_type IN ('event_cost', 'subcontractor_task', 'team', 'cash', 'forecast')
                                              AND j.ov_net IS NOT NULL AND j.ov_valid
                                         THEN j.ov_net ELSE j.suggested_net END, 0),
             'gross_amount', j.gross_amount, 'auto_included', j.auto_included,
             'included', coalesce(j.ov_included, j.auto_included),
             'needs_confirmation', (j.needs_confirmation AND NOT (coalesce(j.ov_confirmed, false) AND j.ov_valid))
                                   OR (j.ov_has_value AND NOT j.ov_valid),
             'confirmed', CASE WHEN j.needs_confirmation THEN coalesce(j.ov_confirmed, false) AND j.ov_valid ELSE true END,
             'source_changed', j.ov_has_value AND NOT j.ov_valid,
             'previous_source_net', CASE WHEN j.ov_has_value AND NOT j.ov_valid THEN j.ov_source_net END,
             'auto', true, 'auto_note', j.auto_note, 'note', j.ov_note, 'updated_at', j.ov_updated_at,
             'updated_by', j.ov_updated_by,
             'editable', CASE j.source_type
                WHEN 'event_cost' THEN '["included","category","net","confirm","note"]'::jsonb
                WHEN 'subcontractor_task' THEN '["included","category","net","note"]'::jsonb
                WHEN 'team' THEN '["included","net","note"]'::jsonb
                WHEN 'cash' THEN '["included","net","confirm","note"]'::jsonb
                WHEN 'forecast' THEN '["included","net","note"]'::jsonb
                ELSE '["included","note"]'::jsonb END,
             'sort_order', j.sort_order, 'group_id', j.group_id, 'ref_partner', j.ref_partner, 'ref_contact', j.ref_contact,
             'ref_employee', j.ref_employee, 'precedes', j.precedes) AS l
      FROM joined j
    UNION ALL
    SELECT jsonb_build_object(
             'key', 'manual:' || l.id, 'line_id', l.id, 'source_type', 'manual', 'source_id', NULL, 'kind', l.kind,
             'category', l.category, 'name', l.name, 'detail', NULL, 'date', l.created_at::date, 'suggested_net', l.net_amount,
             'net_amount', coalesce(l.net_amount, 0), 'gross_amount', NULL, 'auto_included', true,
             'included', coalesce(l.included, true), 'needs_confirmation', false, 'confirmed', true, 'source_changed', false,
             'previous_source_net', NULL, 'auto', false, 'auto_note', NULL, 'note', l.note, 'updated_at', l.updated_at,
             'updated_by', l.updated_by, 'editable', '["included","category","net","name","note","delete"]'::jsonb,
             'sort_order', CASE WHEN l.kind = 'revenue' THEN 15 ELSE 95 END)
      FROM public.event_settlement_lines l
     WHERE l.event_id = p_event_id AND l.source_type = 'manual'
  )
  SELECT coalesce(jsonb_agg(m.l ORDER BY (m.l->>'sort_order')::int, m.l->>'date' NULLS LAST, m.l->>'name'), '[]'::jsonb)
    INTO v_raw FROM merged m;

  -- 2. Zlecenia podwykonawcy: liczy się tylko część niepokryta kosztami tego podwykonawcy już wpisanymi (np. jego
  --    fakturą). Pokrycie liczymy raz na podwykonawcę: Σ zleceń − Σ jego kosztów, rozdzielone po kolei na zlecenia
  --    (faktura za jedno zlecenie nie zeruje pozostałych).
  WITH el AS (
    SELECT t.l, t.ord FROM jsonb_array_elements(v_raw) WITH ORDINALITY AS t(l, ord)
  ),
  cov AS (
    SELECT el.l->>'group_id' AS g, sum((el.l->>'net_amount')::numeric) AS covered
      FROM el
     WHERE el.l->>'source_type' = 'event_cost' AND (el.l->>'included')::boolean AND el.l->>'group_id' IS NOT NULL
     GROUP BY 1
  ),
  tasks AS (
    SELECT el.ord, cov.covered,
           greatest(0, cov.covered - coalesce(sum((el.l->>'net_amount')::numeric) OVER (
             PARTITION BY el.l->>'group_id' ORDER BY el.ord ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)) AS available
      FROM el JOIN cov ON cov.g = el.l->>'group_id'
     WHERE el.l->>'source_type' = 'subcontractor_task' AND (el.l->>'included')::boolean AND cov.covered > 0
  )
  SELECT coalesce(jsonb_agg(
           CASE WHEN tk.ord IS NOT NULL AND tk.available > 0
                THEN el.l || jsonb_build_object(
                       'net_amount', greatest(0, round((el.l->>'net_amount')::numeric - least((el.l->>'net_amount')::numeric, tk.available), 2)),
                       'auto_note', format('Kwota uzgodniona %s zł − pokryte kosztami tego podwykonawcy już wpisanymi %s zł (razem jego koszty: %s zł).',
                                           private.pl_money((el.l->>'net_amount')::numeric),
                                           private.pl_money(least((el.l->>'net_amount')::numeric, tk.available)),
                                           private.pl_money(tk.covered)))
                ELSE el.l END ORDER BY el.ord), '[]'::jsonb)
    INTO v_raw
    FROM el LEFT JOIN tasks tk ON tk.ord = el.ord;

  SELECT coalesce(sum((l->>'net_amount')::numeric) FILTER (WHERE (l->>'included')::boolean AND l->>'kind' = 'revenue'), 0),
         coalesce(sum((l->>'net_amount')::numeric) FILTER (WHERE (l->>'included')::boolean AND l->>'kind' = 'cost' AND l->>'category' = 'subcontractor'), 0),
         coalesce(sum((l->>'net_amount')::numeric) FILTER (WHERE (l->>'included')::boolean AND l->>'kind' = 'cost' AND l->>'category' = 'direct_cost'), 0),
         coalesce(sum((l->>'net_amount')::numeric) FILTER (WHERE (l->>'included')::boolean AND l->>'kind' = 'cost' AND l->>'category' = 'team'), 0),
         count(*) FILTER (WHERE (l->>'included')::boolean AND (l->>'needs_confirmation')::boolean),
         count(*) FILTER (WHERE (l->>'included')::boolean AND l->>'source_type' IN ('offer', 'forecast'))
    INTO v_revenue, v_sub, v_direct, v_team, v_unconfirmed, v_forecast_lines
    FROM jsonb_array_elements(v_raw) l;

  v_partner_base := greatest(0, round(v_revenue - v_sub, 2));

  -- 3. Sprzedawcy zewnętrzni: portal (prowizja), polecenie, kontakt rozliczeniowy, pośrednik (Ustalenia), dodany ręcznie.
  IF NOT v_cancelled THEN
    WITH src AS (
      SELECT o.sales_partner_id AS pid, 'seller_portal'::text AS src, 1 AS prio, o.partner_commission_rate AS offer_rate,
             NULL::uuid AS org_id, o.commercial_model
        FROM public.offers o
       WHERE o.event_id = p_event_id AND o.status::text = 'accepted' AND o.sales_channel = 'seller_portal' AND o.sales_partner_id IS NOT NULL
      UNION ALL
      SELECT e.referring_sales_partner_id, 'event_referral', 2, NULL, NULL, NULL WHERE e.referring_sales_partner_id IS NOT NULL
      UNION ALL
      SELECT p.id, 'billing_contact', 3, NULL, b.organization_id, NULL
        FROM public.event_billing_contacts b
        JOIN public.sales_partner_profiles p ON p.contact_id = b.contact_id
       WHERE b.event_id = p_event_id AND coalesce(e.billing_arrangement, 'direct') <> 'direct'
         AND b.organization_id = e.billing_organization_id
         AND EXISTS (SELECT 1 FROM public.contact_organizations r
                      WHERE r.contact_id = b.contact_id AND r.organization_id = b.organization_id AND r.is_current)
      UNION ALL
      SELECT p.id, 'partner_arrangement', 4, NULL, a.organization_id, NULL
        FROM public.event_partner_arrangements a
        JOIN public.sales_partner_profiles p ON p.contact_id = a.contact_id
       WHERE a.event_id = p_event_id AND a.enabled AND a.contact_id IS NOT NULL
      UNION ALL
      SELECT c.sales_partner_id, 'manual_partner', 5, NULL, c.organization_id, NULL
        FROM public.event_commissions c
       WHERE c.event_id = p_event_id AND c.automatic_source = 'manual_partner' AND c.entry_kind = 'accrual'
         AND c.sales_partner_id IS NOT NULL AND (c.status <> 'cancelled' OR c.auto_cancelled)
    ),
    picked AS (
      SELECT DISTINCT ON (s.pid) s.* FROM src s ORDER BY s.pid, s.prio
    ),
    rows AS (
      SELECT pk.pid, pk.src, pk.prio, pk.offer_rate, pk.commercial_model, p.contact_id, p.employee_id, p.partner_type,
             p.status AS profile_status,
             coalesce(pk.org_id, p.organization_id, e.billing_organization_id) AS org_id,
             coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
                      nullif(btrim(concat_ws(' ', emp.name, emp.surname)), '')) AS person,
             t.is_active, t.commission_enabled, t.default_payment_method, t.dividend_tax_rate, t.default_commission_rate,
             cur.id AS cur_id, cur.status AS cur_status, cur.auto_cancelled AS cur_auto_cancelled, cur.cancel_reason AS cur_cancel_reason,
             -- Prowizja już zatwierdzona: przy ponownym rozliczeniu zostaje jej stawka i sposób wypłaty
             -- (późniejsza zmiana warunków w kartotece nie działa wstecz).
             (cur.id IS NOT NULL AND cur.settlement_revision IS NOT NULL AND cur.status IN ('approved', 'paid')) AS retained,
             coalesce(lc.rate, cur.rate) AS cur_rate, cur.payment_method AS cur_payment, cur.dividend_tax_rate AS cur_dividend
        FROM picked pk
        JOIN public.sales_partner_profiles p ON p.id = pk.pid
        LEFT JOIN public.contacts c ON c.id = p.contact_id
        LEFT JOIN public.employees emp ON emp.id = p.employee_id
        LEFT JOIN public.sales_partner_brand_terms t ON t.sales_partner_id = p.id AND t.my_company_id = e.my_company_id
        LEFT JOIN public.event_commissions cur
          ON cur.id = private.commission_uuid('mavinci:event-commission:' || p_event_id::text || ':' || pk.pid::text)
        -- Stawka z ostatniego zatwierdzenia (dopłata / potrącenie zapisują stawkę swojej wersji).
        LEFT JOIN LATERAL (
          SELECT x.rate FROM public.event_commissions x
           WHERE (x.id = cur.id OR x.corrects_commission_id = cur.id) AND x.status <> 'cancelled'
           ORDER BY x.settlement_revision DESC NULLS LAST, x.created_at DESC LIMIT 1) lc ON true
    ),
    judged AS (
      SELECT r.*,
             CASE WHEN r.retained AND NOT v_refresh_rates THEN r.cur_rate
                  WHEN r.src = 'seller_portal' AND r.commercial_model = 'commission' THEN coalesce(r.offer_rate, r.default_commission_rate)
                  ELSE r.default_commission_rate END AS rate,
             CASE WHEN r.retained AND NOT v_refresh_rates THEN 'Stawka z zatwierdzonego rozliczenia'
                  WHEN r.src = 'seller_portal' AND r.commercial_model = 'commission' AND r.offer_rate IS NOT NULL
                    THEN 'Stawka uzgodniona w ofercie sprzedawcy'
                  ELSE 'Stawka z kartoteki sprzedawców (marka wydarzenia)' END AS rate_reason,
             CASE WHEN r.retained THEN r.cur_payment ELSE coalesce(r.default_payment_method, 'cash_dividend') END AS payment_method,
             CASE WHEN r.retained THEN r.cur_dividend ELSE coalesce(r.dividend_tax_rate, 19) END AS dividend,
             CASE WHEN r.cur_id IS NOT NULL AND r.cur_status = 'cancelled' AND NOT r.cur_auto_cancelled
                    THEN 'Prowizja anulowana ręcznie' || coalesce(': ' || r.cur_cancel_reason, ' w ewidencji prowizji') || '.'
                  WHEN EXISTS (SELECT 1 FROM public.event_commissions mc
                                WHERE mc.event_id = p_event_id AND mc.status <> 'cancelled' AND mc.entry_kind = 'accrual'
                                  AND (mc.automatic_source IS NULL OR NOT (mc.automatic_source = ANY (private.commission_auto_sources())))
                                  AND (mc.sales_partner_id = r.pid OR (r.contact_id IS NOT NULL AND mc.contact_id = r.contact_id))
                                  AND private.commission_manual_precedes(mc))
                    THEN 'Ma zatwierdzony ręczny wpis prowizji w tym wydarzeniu — liczymy wpis ręczny.'
                  WHEN r.src = 'seller_portal' AND r.commercial_model = 'markup' THEN 'Rozliczany narzutem w swojej ofercie — bez dodatkowej prowizji.'
                  WHEN r.partner_type = 'internal_employee' THEN 'Pracownik — jego prowizję liczy udział sprzedawcy wydarzenia.'
                  WHEN r.retained THEN NULL
                  WHEN r.profile_status <> 'active' THEN 'Profil sprzedawcy jest nieaktywny.'
                  WHEN e.my_company_id IS NULL THEN 'Wydarzenie nie ma marki — brak warunków prowizji.'
                  WHEN NOT coalesce(r.is_active AND r.commission_enabled, false) THEN 'Brak aktywnej prowizji dla marki wydarzenia w kartotece sprzedawców.'
                  WHEN r.person IS NULL THEN 'Uzupełnij dane osoby w kartotece sprzedawców.'
             END AS skip_reason
        FROM rows r
    ),
    calc AS (
      SELECT j.*,
             coalesce(j.skip_reason, CASE WHEN coalesce(j.rate, 0) <= 0 THEN 'Stawka prowizji wynosi 0%.' END) AS reason,
             round(v_partner_base * coalesce(j.rate, 0) / 100, 2) AS amount
        FROM judged j
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'partner_id', c.pid, 'contact_id', c.contact_id, 'employee_id', c.employee_id, 'organization_id', c.org_id,
             'name', coalesce(c.person, 'Sprzedawca'), 'source', c.src, 'eligible', c.reason IS NULL,
             'skip_reason', c.reason, 'rate', c.rate, 'rate_reason', c.rate_reason, 'retained', c.retained, 'base', v_partner_base,
             'previous_rate', CASE WHEN c.retained AND v_refresh_rates AND c.cur_rate IS DISTINCT FROM c.rate THEN c.cur_rate END,
             'amount', CASE WHEN c.reason IS NULL THEN c.amount ELSE 0 END,
             'payment_method', c.payment_method,
             'dividend_tax_rate', c.dividend,
             'company_cost', CASE WHEN c.reason IS NOT NULL THEN 0
                                  WHEN c.payment_method = 'cash_dividend'
                                    THEN round(c.amount / (1 - least(99.99, greatest(0, coalesce(c.dividend, 19))) / 100), 2)
                                  ELSE c.amount END,
             'commission_id', private.commission_uuid('mavinci:event-commission:' || p_event_id::text || ':' || c.pid::text))
             ORDER BY c.prio, c.person), '[]'::jsonb)
      INTO v_external
      FROM calc c;
  END IF;

  SELECT coalesce(sum((x->>'company_cost')::numeric) FILTER (WHERE (x->>'eligible')::boolean), 0)
    INTO v_ext_auto FROM jsonb_array_elements(v_external) x;

  -- 4. Ręczny wpis prowizji osoby, którą liczy podsumowanie, a który nie ma pierwszeństwa (czeka na zatwierdzenie
  --    przez finanse): nie odejmujemy go podwójnie.
  SELECT coalesce(jsonb_agg(
           CASE WHEN l->>'source_type' = 'commission' AND NOT coalesce((l->>'precedes')::boolean, false)
                     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_external) x
                                  WHERE (x->>'eligible')::boolean
                                    AND (x->>'partner_id' = l->>'ref_partner' OR (l->>'ref_contact' IS NOT NULL AND x->>'contact_id' = l->>'ref_contact')))
                THEN l || jsonb_build_object('included', false,
                       'auto_note', 'Ręczny wpis czeka na zatwierdzenie przez finanse — do tego czasu liczy się prowizja z podsumowania.')
                ELSE l END ORDER BY ord), '[]'::jsonb)
    INTO v_raw
    FROM jsonb_array_elements(v_raw) WITH ORDINALITY AS t(l, ord);

  SELECT coalesce(sum((l->>'net_amount')::numeric) FILTER (WHERE (l->>'included')::boolean AND l->>'kind' = 'cost' AND l->>'category' = 'external_commission'), 0)
    INTO v_ext_lines FROM jsonb_array_elements(v_raw) l;

  v_profit := round(v_revenue - v_sub - v_direct - v_team - v_ext_lines - v_ext_auto, 2);

  -- 5. Pracownicy: udział sprzedawcy × stawka (5% / 10% przy kliencie własnym) × zysk netto.
  SELECT count(*), coalesce(sum(sh.share_percent), 0) INTO v_share_count, v_share_sum
    FROM public.event_sales_shares sh WHERE sh.event_id = p_event_id;

  IF NOT v_cancelled THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'employee_id', z.employee_id, 'name', z.person, 'share_percent', z.share_percent, 'source', z.source,
             'client_owned', z.client_owned, 'client_label', z.client_label, 'client_checked_at', z.client_checked_at,
             'client_check_basis', z.client_check_basis,
             'enabled', z.enabled, 'rate', z.rate, 'retained', z.retained,
             'previous_rate', CASE WHEN z.retained AND v_refresh_rates AND z.retained_rate IS DISTINCT FROM z.rate THEN z.retained_rate END,
             'blocked_reason', z.blocked_reason,
             'rate_reason', CASE WHEN z.retained AND z.keep_rate THEN 'Stawka z zatwierdzonego rozliczenia'
                                 WHEN z.client_owned THEN 'Klient własny' || coalesce(' (' || z.client_label || ')', '')
                                   || CASE WHEN z.client_check_basis = 'offer_acceptance' THEN ' — opiekun w dniu akceptacji oferty'
                                           WHEN z.client_check_basis = 'manual' THEN ' — potwierdzone przez administratora'
                                           ELSE ' — opiekun w dniu przypisania sprzedawcy' END
                                 ELSE 'Stawka podstawowa' END,
             'base', z.base, 'amount', CASE WHEN z.enabled AND z.blocked_reason IS NULL THEN z.amount ELSE 0 END,
             'payment_method', z.payment_method, 'dividend_tax_rate', z.dividend_rate,
             'employer_social_rate', z.employer_rate,
             'company_cost', CASE WHEN NOT z.enabled OR z.blocked_reason IS NOT NULL THEN 0
                                  WHEN z.payment_method = 'payroll' THEN round(z.amount * (1 + coalesce(z.employer_rate, 0) / 100), 2)
                                  WHEN z.payment_method = 'cash_dividend' THEN round(z.amount / (1 - least(99.99, z.dividend_rate) / 100), 2)
                                  ELSE z.amount END,
             'commission_id', z.commission_id)
             ORDER BY z.share_percent DESC, z.person), '[]'::jsonb)
      INTO v_internal
      FROM (
        SELECT y.*,
               round(greatest(0, v_profit) * y.share_percent / 100, 2) AS base,
               round(round(greatest(0, v_profit) * y.share_percent / 100, 2) * y.rate / 100, 2) AS amount
          FROM (
            SELECT sh.*, n.person, n.commission_id, x.retained, x.keep_rate, x.blocked_reason, x.cur_rate AS retained_rate,
                   n.enabled_now OR x.retained AS enabled,
                   CASE WHEN x.retained AND x.keep_rate THEN x.cur_rate ELSE n.rate_now END AS rate,
                   CASE WHEN x.retained THEN x.cur_payment ELSE n.payment_now END AS payment_method,
                   CASE WHEN x.retained THEN coalesce(x.cur_employer, settings.employer_social_rate) ELSE settings.employer_social_rate END AS employer_rate,
                   coalesce(settings.dividend_rate, 19) AS dividend_rate
              FROM public.event_sales_shares sh
              JOIN public.employees emp ON emp.id = sh.employee_id
              LEFT JOIN public.employee_sales_commission_terms t ON t.employee_id = sh.employee_id
              CROSS JOIN LATERAL (
                SELECT coalesce(nullif(btrim(concat_ws(' ', emp.name, emp.surname)), ''), 'Pracownik') AS person,
                       private.commission_uuid('mavinci:sales-share:' || p_event_id::text || ':' || sh.employee_id::text) AS commission_id,
                       coalesce(t.enabled, false) AS enabled_now,
                       CASE WHEN sh.client_owned THEN coalesce(t.own_client_rate, settings.sales_commission_own_client_rate, 10)
                            ELSE coalesce(t.standard_rate, settings.sales_commission_standard_rate, 5) END AS rate_now,
                       coalesce(t.payment_method, 'payroll') AS payment_now
              ) n
              LEFT JOIN public.event_commissions cur ON cur.id = n.commission_id
              LEFT JOIN LATERAL (
                SELECT x.rate, x.client_owned FROM public.event_commissions x
                 WHERE (x.id = cur.id OR x.corrects_commission_id = cur.id) AND x.status <> 'cancelled'
                 ORDER BY x.settlement_revision DESC NULLS LAST, x.created_at DESC LIMIT 1) lc ON true
              CROSS JOIN LATERAL (
                SELECT (cur.id IS NOT NULL AND cur.settlement_revision IS NOT NULL AND cur.status IN ('approved', 'paid')) AS retained,
                       -- Stawkę z zatwierdzenia zachowujemy, chyba że administrator zmienił „klient własny” albo otworzył
                       -- podsumowanie z przeliczeniem stawek.
                       (coalesce(lc.client_owned, cur.client_owned) IS NOT DISTINCT FROM sh.client_owned AND NOT v_refresh_rates) AS keep_rate,
                       coalesce(lc.rate, cur.rate) AS cur_rate, cur.payment_method AS cur_payment, cur.employer_social_rate AS cur_employer,
                       CASE WHEN cur.id IS NOT NULL AND cur.status = 'cancelled' AND NOT cur.auto_cancelled
                              THEN 'Prowizja anulowana ręcznie' || coalesce(': ' || cur.cancel_reason, ' w ewidencji prowizji') || '.'
                            WHEN EXISTS (SELECT 1 FROM public.event_commissions mc
                                          WHERE mc.event_id = p_event_id AND mc.employee_id = sh.employee_id AND mc.status <> 'cancelled'
                                            AND mc.entry_kind = 'accrual'
                                            AND (mc.automatic_source IS NULL OR NOT (mc.automatic_source = ANY (private.commission_auto_sources())))
                                            AND private.commission_manual_precedes(mc))
                              THEN 'Ma zatwierdzony ręczny wpis prowizji w tym wydarzeniu — liczymy wpis ręczny.' END AS blocked_reason
              ) x
             WHERE sh.event_id = p_event_id
          ) y
      ) z;
  END IF;

  SELECT coalesce(sum((x->>'amount')::numeric), 0), coalesce(sum((x->>'company_cost')::numeric), 0)
    INTO v_internal_total, v_internal_cost FROM jsonb_array_elements(v_internal) x;

  -- Pozycje do wyświetlenia: bez pól technicznych, z nazwiskiem ostatniej osoby, która zmieniła pozycję.
  SELECT coalesce(jsonb_agg(
           (l - 'sort_order' - 'group_id' - 'ref_partner' - 'ref_contact' - 'ref_employee' - 'precedes' - 'updated_by')
           || jsonb_build_object('updated_by_name', nullif(btrim(concat_ws(' ', u.name, u.surname)), ''),
                                 'needs_confirmation', (l->>'needs_confirmation')::boolean AND (l->>'included')::boolean)
           ORDER BY ord), '[]'::jsonb)
    INTO v_lines
    FROM jsonb_array_elements(v_raw) WITH ORDINALITY AS t(l, ord)
    LEFT JOIN public.employees u ON u.id::text = l->>'updated_by';

  -- 6. Braki blokujące wysłanie i zatwierdzenie.
  IF v_cancelled AND NOT v_clawback THEN v_issues := v_issues || jsonb_build_array('Wydarzenie jest anulowane — nie ma czego rozliczać.'); END IF;
  IF NOT v_clawback THEN
    IF NOT v_finished THEN v_issues := v_issues || jsonb_build_array('Podsumowanie wyślesz po zakończeniu wydarzenia.'); END IF;
    IF v_revenue <= 0 THEN v_issues := v_issues || jsonb_build_array('Brak przychodu netto — potrzebna jest faktura sprzedaży, potwierdzony przychód gotówkowy albo pozycja ręczna.'); END IF;
    IF v_forecast_lines > 0 THEN
      v_issues := v_issues || jsonb_build_array('Przychód pochodzi z prognozy (oferta lub kalkulacja). Do rozliczenia potrzebna jest faktura sprzedaży, potwierdzony przychód gotówkowy albo pozycja ręczna.');
    END IF;
    IF v_unconfirmed > 0 THEN
      v_issues := v_issues || jsonb_build_array(format('Potwierdź kwotę netto w pozycjach: %s.', v_unconfirmed));
    END IF;
    IF v_share_count > 0 AND round(v_share_sum, 2) <> 100 THEN
      v_issues := v_issues || jsonb_build_array('Udziały sprzedawców muszą dawać razem 100%.');
    END IF;
  END IF;

  -- Ostrzeżenia (nie blokują).
  IF v_clawback THEN
    v_warnings := v_warnings || jsonb_build_array('Wydarzenie anulowane po zatwierdzeniu — ponowne zatwierdzenie wyzeruje prowizje (niewypłacone anuluje, wypłacone zamieni w potrącenia).');
  END IF;
  IF v_refresh_rates THEN
    v_warnings := v_warnings || jsonb_build_array('Podsumowanie otwarto z przeliczeniem stawek — przy zatwierdzeniu stawki będą według aktualnych warunków (różnica: dopłata albo potrącenie).');
  END IF;
  IF v_share_count = 0 AND NOT v_cancelled THEN
    v_warnings := v_warnings || jsonb_build_array('Wydarzenie nie ma przypisanego sprzedawcy — prowizja pracownika nie zostanie naliczona.');
  END IF;
  -- Przeliczenie stawek: kto i jak się zmieni (różnica — dopłata albo potrącenie przy zatwierdzeniu).
  SELECT v_warnings || coalesce(jsonb_agg(format('%s: stawka %s%% → %s%% (przeliczenie stawek).', x->>'name',
           private.pl_number((x->>'previous_rate')::numeric), private.pl_number((x->>'rate')::numeric))), '[]'::jsonb)
    INTO v_warnings
    FROM (SELECT * FROM jsonb_array_elements(v_internal) UNION ALL SELECT * FROM jsonb_array_elements(v_external)) AS t(x)
   WHERE x->>'previous_rate' IS NOT NULL;
  SELECT v_warnings || coalesce(jsonb_agg(format('%s nie ma włączonej prowizji od sprzedaży.', x->>'name')), '[]'::jsonb)
    INTO v_warnings FROM jsonb_array_elements(v_internal) x WHERE NOT (x->>'enabled')::boolean;
  SELECT v_warnings || coalesce(jsonb_agg(format('%s: %s', x->>'name', x->>'blocked_reason')), '[]'::jsonb)
    INTO v_warnings FROM jsonb_array_elements(v_internal) x WHERE x->>'blocked_reason' IS NOT NULL;
  SELECT v_warnings || coalesce(jsonb_agg(format('%s: %s', x->>'name', x->>'skip_reason')), '[]'::jsonb)
    INTO v_warnings FROM jsonb_array_elements(v_external) x WHERE NOT (x->>'eligible')::boolean;
  IF v_profit < 0 THEN
    v_warnings := v_warnings || jsonb_build_array('Wydarzenie jest na minusie — prowizja od zysku wynosi 0 zł.');
  END IF;
  IF (SELECT count(*) FROM public.offers o WHERE o.event_id = p_event_id AND o.status::text = 'accepted') > 1 THEN
    v_warnings := v_warnings || jsonb_build_array('Wydarzenie ma kilka zaakceptowanych ofert — sprawdź, czy przychód nie jest liczony podwójnie.');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_raw) l WHERE (l->>'source_changed')::boolean) THEN
    v_warnings := v_warnings || jsonb_build_array('Kwota źródłowa części pozycji zmieniła się po korekcie — potwierdź je ponownie.');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_raw) l
              WHERE l->>'source_type' = 'commission' AND NOT coalesce((l->>'precedes')::boolean, false)) THEN
    v_warnings := v_warnings || jsonb_build_array('Ręczne wpisy prowizji czekają na zatwierdzenie przez finanse.');
  END IF;

  -- Liczby w kluczu w jednej skali (stawka z ustawień „15” i zapisana w ewidencji „15.000” to ta sama wartość).
  v_key_input := jsonb_build_object(
    'lines', (SELECT coalesce(jsonb_agg(jsonb_build_array(l->>'key', l->'included', l->>'category',
                round((l->>'net_amount')::numeric, 2), l->'confirmed', l->>'kind', round((l->>'suggested_net')::numeric, 2))
                ORDER BY l->>'key'), '[]'::jsonb) FROM jsonb_array_elements(v_lines) l),
    'external', (SELECT coalesce(jsonb_agg(jsonb_build_array(x->>'partner_id', x->'eligible', round((x->>'rate')::numeric, 3),
                x->>'payment_method', round((x->>'dividend_tax_rate')::numeric, 2))
                ORDER BY x->>'partner_id'), '[]'::jsonb) FROM jsonb_array_elements(v_external) x),
    'internal', (SELECT coalesce(jsonb_agg(jsonb_build_array(x->>'employee_id', round((x->>'share_percent')::numeric, 2), x->'client_owned',
                x->'enabled', round((x->>'rate')::numeric, 3), x->>'payment_method', x->>'blocked_reason')
                ORDER BY x->>'employee_id'), '[]'::jsonb) FROM jsonb_array_elements(v_internal) x),
    'cancelled', v_cancelled);

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'lines', v_lines,
    'totals', jsonb_build_object(
      'revenue_net', round(v_revenue, 2), 'subcontractor_net', round(v_sub, 2), 'direct_cost_net', round(v_direct, 2),
      'team_net', round(v_team, 2), 'external_commission_lines', round(v_ext_lines, 2),
      'external_commission_auto', round(v_ext_auto, 2),
      'costs_net', round(v_sub + v_direct + v_team + v_ext_lines + v_ext_auto, 2),
      'partner_base', v_partner_base, 'profit_net', v_profit,
      'internal_commissions', round(v_internal_total, 2), 'internal_commissions_cost', round(v_internal_cost, 2),
      'profit_after_commissions', round(v_profit - v_internal_cost, 2)),
    'external', v_external,
    'internal', v_internal,
    'shares_sum', v_share_sum,
    'issues', v_issues,
    'warnings', v_warnings,
    'finished', v_finished,
    'clawback', v_clawback,
    'refresh_rates', v_refresh_rates,
    'forecast', v_forecast_lines > 0 OR v_revenue <= 0,
    'source_key', md5(v_key_input::text));
END $$;

-- Kwoty po polsku w opisach (niezależnie od ustawień regionalnych bazy): 12 345,60
CREATE OR REPLACE FUNCTION private.pl_money(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL THEN '—' ELSE
    (CASE WHEN round(p, 2) < 0 THEN '−' ELSE '' END)
    || regexp_replace(trunc(abs(round(p, 2)))::numeric(20,0)::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g')
    || ',' || lpad(((abs(round(p, 2)) * 100)::numeric(22,0) % 100)::text, 2, '0') END;
$$;

CREATE OR REPLACE FUNCTION private.pl_number(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL THEN '—' ELSE
    replace(CASE WHEN round(p, 2) = trunc(p) THEN trunc(p)::text ELSE rtrim(round(p, 2)::text, '0') END, '.', ',') END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Silnik: prognoza (planowane wpisy) i zatwierdzenie (zamrożenie, dopłaty, potrącenia)
-- ---------------------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS private.commission_target_rows(uuid, jsonb);
CREATE FUNCTION private.commission_target_rows(p_event_id uuid, ctx jsonb)
RETURNS TABLE(commission_id uuid, beneficiary_type text, beneficiary_name text, sales_partner_id uuid, employee_id uuid,
              contact_id uuid, organization_id uuid, rate numeric, base_amount numeric, payment_method text,
              dividend_tax_rate numeric, automatic_source text, base_description text, rate_reason text,
              share_percent numeric, client_owned boolean, amount numeric, employer_social_rate numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT (x->>'commission_id')::uuid, 'salesperson', x->>'name', (x->>'partner_id')::uuid, (x->>'employee_id')::uuid,
         (x->>'contact_id')::uuid, (x->>'organization_id')::uuid, (x->>'rate')::numeric, (x->>'base')::numeric,
         x->>'payment_method', (x->>'dividend_tax_rate')::numeric, x->>'source',
         format('Przychód netto %s zł − wykonawcy zewnętrzni %s zł = %s zł',
           private.pl_money((ctx#>>'{totals,revenue_net}')::numeric),
           private.pl_money((ctx#>>'{totals,subcontractor_net}')::numeric),
           private.pl_money((x->>'base')::numeric)),
         x->>'rate_reason', NULL::numeric, NULL::boolean, (x->>'amount')::numeric, NULL::numeric
    FROM jsonb_array_elements(ctx->'external') x WHERE (x->>'eligible')::boolean
  UNION ALL
  SELECT (x->>'commission_id')::uuid, 'employee', x->>'name', NULL::uuid, (x->>'employee_id')::uuid,
         NULL::uuid, NULL::uuid, (x->>'rate')::numeric, (x->>'base')::numeric,
         x->>'payment_method', (x->>'dividend_tax_rate')::numeric, 'sales_share',
         format('Zysk netto %s zł (przychód %s zł − koszty %s zł) × udział %s%%',
           private.pl_money((ctx#>>'{totals,profit_net}')::numeric),
           private.pl_money((ctx#>>'{totals,revenue_net}')::numeric),
           private.pl_money((ctx#>>'{totals,costs_net}')::numeric),
           private.pl_number((x->>'share_percent')::numeric)),
         x->>'rate_reason', (x->>'share_percent')::numeric, (x->>'client_owned')::boolean, (x->>'amount')::numeric,
         CASE WHEN x->>'payment_method' = 'payroll' THEN (x->>'employer_social_rate')::numeric END
    FROM jsonb_array_elements(ctx->'internal') x
   WHERE (x->>'enabled')::boolean AND x->>'blocked_reason' IS NULL;
$$;

-- Czy wydarzenie jest objęte nowym rozliczeniem. Wydarzenia rozliczone przed wdrożeniem (bez podsumowania i bez
-- wpisów automatycznych) zostają bez zmian, nawet gdy później dojdzie do nich koszt lub faktura.
CREATE OR REPLACE FUNCTION private.event_settlement_tracked(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT e.status::text <> 'settled' FROM public.events e WHERE e.id = p_event_id), false)
      OR EXISTS (SELECT 1 FROM public.event_settlements s WHERE s.event_id = p_event_id)
      OR EXISTS (SELECT 1 FROM public.event_commissions c WHERE c.event_id = p_event_id
                   AND (c.entry_kind <> 'accrual' OR c.automatic_source = ANY (private.commission_auto_sources())));
$$;

DROP FUNCTION IF EXISTS private.refresh_event_commissions(uuid);
CREATE OR REPLACE FUNCTION private.refresh_event_commissions(p_event_id uuid, p_basis text DEFAULT 'backfill')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_prev text := coalesce(current_setting('mavinci.commission_engine', true), '');
  ctx jsonb; e public.events%ROWTYPE; t record; cur public.event_commissions%ROWTYPE;
  v_keep uuid[] := '{}'; v_created integer := 0; v_updated integer := 0; v_cancelled integer := 0; v_actor uuid;
BEGIN
  IF p_event_id IS NULL OR NOT private.event_settlement_tracked(p_event_id) THEN
    RETURN jsonb_build_object('matched', 0, 'eligible', 0, 'created', 0, 'completed', 0, 'waiting', 0);
  END IF;
  PERFORM set_config('mavinci.commission_engine', 'on', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-commission:' || p_event_id::text, 0));
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    PERFORM set_config('mavinci.commission_engine', v_prev, true);
    RETURN jsonb_build_object('matched', 0, 'eligible', 0, 'created', 0, 'completed', 0, 'waiting', 0);
  END IF;
  PERFORM private.ensure_event_sales_shares(p_event_id, p_basis);
  ctx := private.event_settlement_compute(p_event_id);
  v_actor := public.current_invoice_employee_id();

  FOR t IN SELECT * FROM private.commission_target_rows(p_event_id, ctx) LOOP
    SELECT * INTO cur FROM public.event_commissions c WHERE c.id = t.commission_id FOR UPDATE;
    IF NOT FOUND AND coalesce(t.amount, 0) <= 0 THEN
      -- Bez kwoty (np. przed akceptacją oferty) nie tworzymy pustych wpisów w ewidencji.
      CONTINUE;
    ELSIF NOT FOUND THEN
      INSERT INTO public.event_commissions (id, event_id, beneficiary_type, beneficiary_name, sales_partner_id, employee_id,
        contact_id, organization_id, calculation_type, rate, base_amount, amount, base_description, payment_method,
        dividend_tax_rate, status, created_by, automatic_source, automatic_company_id, automatic_waiting_for_offer,
        share_percent, client_owned, rate_reason, entry_kind, employer_social_rate)
      VALUES (t.commission_id, p_event_id, t.beneficiary_type, t.beneficiary_name, t.sales_partner_id, t.employee_id,
        t.contact_id, t.organization_id, 'percent', t.rate, t.base_amount, 0, t.base_description, t.payment_method,
        t.dividend_tax_rate, 'planned', v_actor, t.automatic_source, e.my_company_id, false,
        t.share_percent, t.client_owned, t.rate_reason, 'accrual', t.employer_social_rate);
      v_created := v_created + 1;
      v_keep := v_keep || t.commission_id;
    ELSIF cur.automatic_source IS NULL OR NOT (cur.automatic_source = ANY (private.commission_auto_sources())) THEN
      -- Wpis z tym samym identyfikatorem utworzony dawniej ręcznie / starym automatem — zostaje bez zmian.
      CONTINUE;
    ELSIF cur.status = 'cancelled' AND NOT cur.auto_cancelled THEN
      -- Anulowana ręcznie — decyzja osoby, nie przywracamy jej automatycznie.
      v_keep := v_keep || cur.id;
    ELSIF coalesce(t.amount, 0) <= 0 THEN
      -- Prognoza spadła do zera: planowany wpis zostanie anulowany automatycznie (wróci, gdy kwota się pojawi).
      CONTINUE;
    ELSE
      v_keep := v_keep || cur.id;
      IF (cur.status = 'planned' OR (cur.status = 'cancelled' AND cur.auto_cancelled))
         AND NOT EXISTS (SELECT 1 FROM public.event_commission_payouts p WHERE p.commission_id = cur.id)
         AND (cur.status <> 'planned' OR ROW(cur.rate, cur.base_amount, cur.payment_method, cur.dividend_tax_rate, cur.base_description,
                  cur.beneficiary_name, cur.share_percent, cur.client_owned, cur.rate_reason, cur.automatic_source,
                  cur.automatic_waiting_for_offer, cur.organization_id, cur.employer_social_rate)
              IS DISTINCT FROM ROW(t.rate, t.base_amount, t.payment_method, t.dividend_tax_rate, t.base_description,
                  t.beneficiary_name, t.share_percent, t.client_owned, t.rate_reason, t.automatic_source, false,
                  coalesce(t.organization_id, cur.organization_id), t.employer_social_rate)) THEN
        UPDATE public.event_commissions SET
          rate = t.rate, base_amount = t.base_amount, calculation_type = 'percent', payment_method = t.payment_method,
          dividend_tax_rate = t.dividend_tax_rate, base_description = t.base_description, beneficiary_name = t.beneficiary_name,
          share_percent = t.share_percent, client_owned = t.client_owned, rate_reason = t.rate_reason,
          automatic_source = t.automatic_source, automatic_waiting_for_offer = false, automatic_company_id = e.my_company_id,
          organization_id = coalesce(t.organization_id, organization_id), employer_social_rate = t.employer_social_rate,
          status = 'planned', auto_cancelled = false
        WHERE id = cur.id;
        v_updated := v_updated + 1;
      END IF;
    END IF;
  END LOOP;

  -- Osoby, których już nie ma w podsumowaniu (albo z kwotą 0): planowany wpis → anulowany automatycznie.
  WITH gone AS (
    UPDATE public.event_commissions c SET status = 'cancelled', auto_cancelled = true
     WHERE c.event_id = p_event_id AND c.entry_kind = 'accrual' AND c.status = 'planned'
       AND c.automatic_source = ANY (private.commission_auto_sources())
       AND NOT (c.id = ANY (v_keep))
       AND NOT EXISTS (SELECT 1 FROM public.event_commission_payouts p WHERE p.commission_id = c.id)
    RETURNING 1)
  SELECT count(*) INTO v_cancelled FROM gone;

  PERFORM set_config('mavinci.commission_engine', v_prev, true);
  RETURN jsonb_build_object('matched', jsonb_array_length(ctx->'external'),
    'eligible', (SELECT count(*) FROM jsonb_array_elements(ctx->'external') x WHERE (x->>'eligible')::boolean),
    'created', v_created, 'completed', v_updated, 'cancelled', v_cancelled, 'waiting', 0);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('mavinci.commission_engine', v_prev, true);
  RAISE;
END $$;

-- Wywołanie z wyzwalaczy: błąd prognozy nigdy nie blokuje zapisu faktury, kosztu czy oferty.
DROP FUNCTION IF EXISTS private.refresh_event_commissions_safe(uuid);
CREATE OR REPLACE FUNCTION private.refresh_event_commissions_safe(p_event_id uuid, p_basis text DEFAULT 'backfill')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_event_id IS NULL OR private.commission_engine_active() THEN RETURN; END IF;
  BEGIN
    PERFORM private.refresh_event_commissions(p_event_id, p_basis);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Prognoza prowizji wydarzenia % nie została odświeżona: %', p_event_id, SQLERRM;
  END;
END $$;

-- Kwota prowizji z podsumowania po wszystkich wersjach: naliczenie + dopłaty − potrącenia (bez anulowanych).
CREATE OR REPLACE FUNCTION private.commission_chain_net(p_commission_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT c.amount FROM public.event_commissions c WHERE c.id = p_commission_id AND c.status <> 'cancelled'), 0)
       + coalesce((SELECT sum(x.amount) FROM public.event_commissions x
                    WHERE x.corrects_commission_id = p_commission_id AND x.entry_kind = 'correction' AND x.status <> 'cancelled'), 0)
       - coalesce((SELECT sum(x.amount) FROM public.event_commissions x
                    WHERE x.corrects_commission_id = p_commission_id AND x.entry_kind = 'deduction' AND x.status <> 'cancelled'), 0);
$$;

-- Ta sama osoba: wpis z podsumowania (a) i inny wpis (b) — sprzedawca z kartoteki, osoba kontaktowa albo pracownik
-- (udział sprzedawcy wydarzenia).
CREATE OR REPLACE FUNCTION private.commission_same_person(a public.event_commissions, b public.event_commissions)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce((a.sales_partner_id IS NOT NULL AND a.sales_partner_id = b.sales_partner_id)
      OR (a.contact_id IS NOT NULL AND a.contact_id = b.contact_id)
      OR (a.automatic_source = 'sales_share' AND a.employee_id IS NOT NULL AND a.employee_id = b.employee_id), false);
$$;

-- Rozliczenie potrącenia z inną prowizją do wypłaty tej samej osoby (bez przelewu): zapis w rejestrze wypłat obu wpisów.
CREATE OR REPLACE FUNCTION private.offset_commission_deduction(p_deduction_id uuid, p_target_id uuid, p_amount numeric, p_key uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  d public.event_commissions%ROWTYPE; t public.event_commissions%ROWTYPE;
  v_prev text := coalesce(current_setting('mavinci.commission_engine', true), '');
  v_d_paid numeric; v_t_paid numeric; v_amount numeric; v_today date := (current_timestamp AT TIME ZONE 'Europe/Warsaw')::date;
  v_t_company uuid; v_d_company uuid;
BEGIN
  SELECT * INTO d FROM public.event_commissions WHERE id = p_deduction_id FOR UPDATE;
  SELECT * INTO t FROM public.event_commissions WHERE id = p_target_id FOR UPDATE;
  SELECT coalesce(sum(p.amount), 0) INTO v_d_paid FROM public.event_commission_payouts p WHERE p.commission_id = d.id;
  SELECT coalesce(sum(p.amount), 0) INTO v_t_paid FROM public.event_commission_payouts p WHERE p.commission_id = t.id;
  v_amount := round(least(coalesce(p_amount, d.amount - v_d_paid), d.amount - v_d_paid, t.amount - v_t_paid), 2);
  IF v_amount <= 0 THEN RETURN 0; END IF;
  SELECT my_company_id INTO v_t_company FROM public.events WHERE id = t.event_id;
  SELECT my_company_id INTO v_d_company FROM public.events WHERE id = d.event_id;
  PERFORM set_config('mavinci.commission_engine', 'on', true);
  INSERT INTO public.event_commission_payouts (id, commission_id, event_id, my_company_id, amount, payment_date, payment_method,
    reference, note, recorded_by, is_offset)
  VALUES (p_key, t.id, t.event_id, v_t_company, v_amount, v_today, t.payment_method, 'Potrącenie',
          format('Potrącenie nadpłaty (wpis %s, wydarzenie %s) — bez przelewu', d.id, d.event_id), auth.uid(), true);
  INSERT INTO public.event_commission_payouts (id, commission_id, event_id, my_company_id, amount, payment_date, payment_method,
    reference, note, recorded_by, is_offset)
  VALUES (private.commission_uuid('mavinci:deduction:' || p_key::text), d.id, d.event_id, v_d_company, v_amount, v_today,
          d.payment_method, 'Potrącono', format('Potrącono z prowizji %s (wydarzenie %s)', t.id, t.event_id), auth.uid(), true);
  UPDATE public.event_commissions SET
    status = CASE WHEN v_t_paid + v_amount = t.amount THEN 'paid' ELSE 'approved' END,
    paid_at = CASE WHEN v_t_paid + v_amount = t.amount
                   THEN (SELECT max(p.payment_date) FROM public.event_commission_payouts p WHERE p.commission_id = t.id)::timestamp AT TIME ZONE 'Europe/Warsaw' END
   WHERE id = t.id;
  UPDATE public.event_commissions SET
    status = CASE WHEN v_d_paid + v_amount = d.amount THEN 'paid' ELSE 'approved' END,
    paid_at = CASE WHEN v_d_paid + v_amount = d.amount
                   THEN (SELECT max(p.payment_date) FROM public.event_commission_payouts p WHERE p.commission_id = d.id)::timestamp AT TIME ZONE 'Europe/Warsaw' END
   WHERE id = d.id;
  PERFORM set_config('mavinci.commission_engine', v_prev, true);
  RETURN v_amount;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('mavinci.commission_engine', v_prev, true);
  RAISE;
END $$;

-- Zatwierdzenie podsumowania: wpisy do wypłaty z zamrożoną podstawą; po wypłatach — dopłata albo potrącenie.
CREATE OR REPLACE FUNCTION private.apply_settlement_commissions(p_event_id uuid, ctx jsonb, p_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_prev text := coalesce(current_setting('mavinci.commission_engine', true), '');
  e public.events%ROWTYPE; t record; cur public.event_commissions%ROWTYPE; r record; rd record; v_ded uuid; v_cor uuid;
  v_actor uuid := public.current_invoice_employee_id();
  v_has_history boolean; v_current numeric; v_delta numeric; v_result jsonb := '[]'; v_left numeric; v_done numeric;
  v_netted numeric; dd public.event_commissions%ROWTYPE;
BEGIN
  PERFORM set_config('mavinci.commission_engine', 'on', true);
  SELECT * INTO e FROM public.events WHERE id = p_event_id;

  FOR t IN
    SELECT tr.*, false AS stale FROM private.commission_target_rows(p_event_id, ctx) tr
    UNION ALL
    -- Wpisy automatyczne do wypłaty, których osoby nie ma już w podsumowaniu (cel: 0 zł).
    SELECT c.id, c.beneficiary_type, c.beneficiary_name, c.sales_partner_id, c.employee_id, c.contact_id, c.organization_id,
           c.rate, 0::numeric, c.payment_method, c.dividend_tax_rate, c.automatic_source,
           'Osoba nie występuje już w zatwierdzonym podsumowaniu', c.rate_reason, c.share_percent, c.client_owned, 0::numeric,
           c.employer_social_rate, true
      FROM public.event_commissions c
     WHERE c.event_id = p_event_id AND c.entry_kind = 'accrual' AND c.status IN ('approved', 'paid')
       AND c.automatic_source = ANY (private.commission_auto_sources())
       AND NOT (c.id IN (SELECT tr2.commission_id FROM private.commission_target_rows(p_event_id, ctx) tr2))
  LOOP
    SELECT * INTO cur FROM public.event_commissions c WHERE c.id = t.commission_id FOR UPDATE;
    IF NOT FOUND THEN
      IF t.stale OR coalesce(t.amount, 0) <= 0 THEN CONTINUE; END IF;
      INSERT INTO public.event_commissions (id, event_id, beneficiary_type, beneficiary_name, sales_partner_id, employee_id,
        contact_id, organization_id, calculation_type, rate, base_amount, amount, base_description, payment_method,
        dividend_tax_rate, status, created_by, automatic_source, automatic_company_id, automatic_waiting_for_offer,
        share_percent, client_owned, rate_reason, entry_kind, settlement_revision, employer_social_rate)
      VALUES (t.commission_id, p_event_id, t.beneficiary_type, t.beneficiary_name, t.sales_partner_id, t.employee_id,
        t.contact_id, t.organization_id, 'percent', t.rate, t.base_amount, 0, t.base_description, t.payment_method,
        t.dividend_tax_rate, 'approved', v_actor, t.automatic_source,
        e.my_company_id, false, t.share_percent, t.client_owned, t.rate_reason, 'accrual', p_revision, t.employer_social_rate);
      v_result := v_result || jsonb_build_object('commission_id', t.commission_id, 'action', 'approved', 'amount', t.amount);
      CONTINUE;
    END IF;
    IF cur.automatic_source IS NULL OR NOT (cur.automatic_source = ANY (private.commission_auto_sources())) THEN CONTINUE; END IF;
    -- Anulowana ręcznie — decyzja osoby; zatwierdzenie jej nie przywraca.
    IF cur.status = 'cancelled' AND NOT cur.auto_cancelled THEN CONTINUE; END IF;

    v_has_history := cur.status = 'paid' OR EXISTS (SELECT 1 FROM public.event_commission_payouts p WHERE p.commission_id = cur.id)
      OR EXISTS (SELECT 1 FROM public.event_commissions x WHERE x.corrects_commission_id = cur.id AND x.status <> 'cancelled'
                   AND (x.status = 'paid' OR EXISTS (SELECT 1 FROM public.event_commission_payouts p WHERE p.commission_id = x.id)));

    IF NOT v_has_history THEN
      -- Bez wypłat: wpis przyjmuje zatwierdzoną podstawę (historia zmian zostaje w event_commission_history).
      UPDATE public.event_commissions SET status = 'cancelled', auto_cancelled = true
       WHERE corrects_commission_id = cur.id AND status IN ('planned', 'approved');
      UPDATE public.event_commissions SET
        rate = t.rate, base_amount = t.base_amount, calculation_type = 'percent', payment_method = t.payment_method,
        dividend_tax_rate = t.dividend_tax_rate, base_description = t.base_description, beneficiary_name = t.beneficiary_name,
        share_percent = t.share_percent, client_owned = t.client_owned, rate_reason = t.rate_reason,
        automatic_source = t.automatic_source, automatic_waiting_for_offer = false, employer_social_rate = t.employer_social_rate,
        status = CASE WHEN round(t.base_amount * t.rate / 100, 2) > 0 THEN 'approved' ELSE 'cancelled' END,
        auto_cancelled = round(t.base_amount * t.rate / 100, 2) <= 0,
        settlement_revision = p_revision
      WHERE id = cur.id;
      v_result := v_result || jsonb_build_object('commission_id', cur.id, 'action', 'approved', 'amount', round(t.base_amount * t.rate / 100, 2));
    ELSE
      -- Są wypłaty: nie zmieniamy wypłaconego wpisu. Otwarte dopłaty/potrącenia bez wypłat zastępuje jedna nowa różnica.
      UPDATE public.event_commissions x SET status = 'cancelled', auto_cancelled = true
       WHERE x.corrects_commission_id = cur.id AND x.status IN ('planned', 'approved')
         AND NOT EXISTS (SELECT 1 FROM public.event_commission_payouts p WHERE p.commission_id = x.id);
      SELECT cur.amount
             + coalesce(sum(x.amount) FILTER (WHERE x.entry_kind = 'correction'), 0)
             - coalesce(sum(x.amount) FILTER (WHERE x.entry_kind = 'deduction'), 0)
        INTO v_current
        FROM public.event_commissions x WHERE x.corrects_commission_id = cur.id AND x.status <> 'cancelled';
      v_current := coalesce(v_current, cur.amount);
      v_delta := round(t.amount - v_current, 2);
      v_ded := NULL; v_cor := NULL;
      IF v_delta > 0 THEN
        v_cor := gen_random_uuid();
        INSERT INTO public.event_commissions (id, event_id, beneficiary_type, beneficiary_name, sales_partner_id, employee_id,
          contact_id, organization_id, calculation_type, rate, base_amount, amount, base_description, payment_method,
          dividend_tax_rate, status, created_by, automatic_source, automatic_company_id, automatic_waiting_for_offer,
          share_percent, client_owned, rate_reason, entry_kind, corrects_commission_id, settlement_revision, employer_social_rate)
        VALUES (v_cor, p_event_id, cur.beneficiary_type, cur.beneficiary_name, cur.sales_partner_id, cur.employee_id, cur.contact_id,
          cur.organization_id, 'fixed', t.rate, t.base_amount, v_delta,
          format('Dopłata po ponownym rozliczeniu (wersja %s): było %s zł, jest %s zł', p_revision,
            private.pl_money(v_current), private.pl_money(t.amount)),
          cur.payment_method, cur.dividend_tax_rate, 'approved', v_actor, cur.automatic_source, e.my_company_id, false,
          t.share_percent, t.client_owned, t.rate_reason, 'correction', cur.id, p_revision, cur.employer_social_rate);
      ELSIF v_delta < 0 THEN
        v_ded := gen_random_uuid();
        INSERT INTO public.event_commissions (id, event_id, beneficiary_type, beneficiary_name, sales_partner_id, employee_id,
          contact_id, organization_id, calculation_type, rate, base_amount, amount, base_description, payment_method,
          dividend_tax_rate, status, created_by, automatic_source, automatic_company_id, automatic_waiting_for_offer,
          share_percent, client_owned, rate_reason, entry_kind, corrects_commission_id, settlement_revision, employer_social_rate)
        VALUES (v_ded, p_event_id, cur.beneficiary_type, cur.beneficiary_name, cur.sales_partner_id, cur.employee_id, cur.contact_id,
          cur.organization_id, 'fixed', t.rate, t.base_amount, -v_delta,
          format('Potrącenie po ponownym rozliczeniu (wersja %s): było %s zł, jest %s zł', p_revision,
            private.pl_money(v_current), private.pl_money(t.amount)),
          cur.payment_method, cur.dividend_tax_rate, 'approved', v_actor, cur.automatic_source, e.my_company_id, false,
          t.share_percent, t.client_owned, t.rate_reason, 'deduction', cur.id, p_revision, cur.employer_social_rate);
      END IF;
      -- Otwarte potrącenia tej prowizji rozliczamy od razu z jej niewypłaconą resztą (naliczenie i dopłaty), bez przelewu:
      -- nowe potrącenie zmniejsza resztę do wypłaty, a nowa dopłata najpierw spłaca wcześniejszą nadpłatę. „Do potrącenia”
      -- z innych prowizji zostaje tylko faktyczna nadpłata, a gotówką wypłaca się tylko to, co faktycznie się należy.
      v_netted := 0;
      FOR rd IN
        SELECT x.id FROM public.event_commissions x
         WHERE x.corrects_commission_id = cur.id AND x.entry_kind = 'deduction' AND x.status = 'approved'
         ORDER BY x.created_at, x.id
      LOOP
        FOR r IN
          SELECT x.id FROM public.event_commissions x
           WHERE (x.id = cur.id OR (x.corrects_commission_id = cur.id AND x.entry_kind = 'correction'))
             AND x.status = 'approved'
             AND x.amount > coalesce((SELECT sum(p.amount) FROM public.event_commission_payouts p WHERE p.commission_id = x.id), 0)
           ORDER BY x.created_at, x.id
        LOOP
          v_done := private.offset_commission_deduction(rd.id, r.id, NULL, gen_random_uuid());
          v_netted := round(v_netted + v_done, 2);
        END LOOP;
      END LOOP;
      IF v_cor IS NOT NULL THEN
        v_result := v_result || jsonb_build_object('commission_id', cur.id, 'action', 'correction', 'amount', v_delta,
                                                   'offset_now', v_netted,
                                                   'to_pay', round(v_delta - coalesce((SELECT sum(p.amount) FROM public.event_commission_payouts p WHERE p.commission_id = v_cor), 0), 2));
      ELSIF v_ded IS NOT NULL THEN
        v_left := round(-v_delta - coalesce((SELECT sum(p.amount) FROM public.event_commission_payouts p WHERE p.commission_id = v_ded), 0), 2);
        v_result := v_result || jsonb_build_object('commission_id', cur.id, 'action', 'deduction', 'amount', -v_delta,
                                                   'offset_now', round(-v_delta - v_left, 2), 'to_offset', v_left);
      END IF;
    END IF;
  END LOOP;

  -- Nadpłata z prowizji z podsumowania (np. po zatwierdzeniu ręcznego wpisu, który ma pierwszeństwo) zmniejsza
  -- niewypłacone ręczne wpisy tej samej osoby w tym wydarzeniu — bez przelewu, żeby nie wypłacić obu.
  FOR dd IN
    SELECT d.* FROM public.event_commissions d
     WHERE d.event_id = p_event_id AND d.entry_kind = 'deduction' AND d.status = 'approved'
     ORDER BY d.created_at, d.id
  LOOP
    FOR r IN
      SELECT m.id FROM public.event_commissions m
       WHERE m.event_id = p_event_id AND m.entry_kind = 'accrual' AND m.status = 'approved' AND m.owner_profit_review_id IS NULL
         AND (m.automatic_source IS NULL OR NOT (m.automatic_source = ANY (private.commission_auto_sources())))
         AND private.commission_same_person(dd, m)
         AND m.amount > coalesce((SELECT sum(p.amount) FROM public.event_commission_payouts p WHERE p.commission_id = m.id), 0)
       ORDER BY m.created_at, m.id
    LOOP
      v_done := private.offset_commission_deduction(dd.id, r.id, NULL, gen_random_uuid());
      IF v_done > 0 THEN
        v_result := v_result || jsonb_build_object('commission_id', dd.corrects_commission_id, 'action', 'offset_manual',
                                                   'manual_commission_id', r.id, 'amount', v_done);
      END IF;
    END LOOP;
  END LOOP;

  -- Planowane wpisy osób spoza zatwierdzonego podsumowania.
  UPDATE public.event_commissions c SET status = 'cancelled', auto_cancelled = true
   WHERE c.event_id = p_event_id AND c.entry_kind = 'accrual' AND c.status = 'planned'
     AND c.automatic_source = ANY (private.commission_auto_sources())
     AND NOT (c.id IN (SELECT tr.commission_id FROM private.commission_target_rows(p_event_id, ctx) tr))
     AND NOT EXISTS (SELECT 1 FROM public.event_commission_payouts p WHERE p.commission_id = c.id);

  PERFORM set_config('mavinci.commission_engine', v_prev, true);
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('mavinci.commission_engine', v_prev, true);
  RAISE;
END $$;

-- Dotychczasowa funkcja automatu (wyzwalacze kontaktu rozliczeniowego i wydarzenia) — teraz bezpieczna prognoza.
CREATE OR REPLACE FUNCTION public.sync_event_billing_seller_commissions(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
BEGIN
  IF private.commission_engine_active() THEN
    RETURN jsonb_build_object('matched', 0, 'eligible', 0, 'created', 0, 'completed', 0, 'waiting', 0);
  END IF;
  BEGIN
    RETURN private.refresh_event_commissions(p_event_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Prognoza prowizji wydarzenia % nie została odświeżona: %', p_event_id, SQLERRM;
    RETURN jsonb_build_object('matched', 0, 'eligible', 0, 'created', 0, 'completed', 0, 'waiting', 0, 'error', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_billing_commissions_after_offer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.event_id IS DISTINCT FROM NEW.event_id AND OLD.status = 'accepted' THEN
    PERFORM private.refresh_event_commissions_safe(OLD.event_id);
  END IF;
  IF NEW.event_id IS NOT NULL AND (NEW.status = 'accepted' OR (TG_OP = 'UPDATE' AND OLD.status = 'accepted')) THEN
    -- Sprzedawcę wydarzenia zapisujemy w chwili akceptacji oferty (z oceną „klient własny” na ten dzień).
    PERFORM private.refresh_event_commissions_safe(NEW.event_id,
      CASE WHEN NEW.status = 'accepted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted')
           THEN 'offer_acceptance' ELSE 'backfill' END);
  END IF;
  RETURN NEW;
END;
$function$;

-- Rejestr wypłat: wpisy z podsumowania zatwierdza podsumowanie; potrącenie rozlicza się potrąceniem, nie przelewem.
CREATE OR REPLACE FUNCTION public.record_commission_settlement(p_commission_id uuid, p_action text DEFAULT 'payout'::text, p_amount numeric DEFAULT NULL::numeric, p_payment_date date DEFAULT NULL::date, p_reference text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_expected_amount numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  commission public.event_commissions%ROWTYPE;
  previous public.event_commission_payouts%ROWTYPE;
  event_id_to_lock uuid;
  company_id uuid;
  paid numeric;
  final_amount numeric;
  last_payment date;
  normalized_reference text := nullif(btrim(p_reference), '');
  normalized_note text := nullif(btrim(p_note), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.commission_settlement_can_access(NULL, true) THEN
    RAISE EXCEPTION 'Brak uprawnień do rozliczania prowizji.' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve', 'payout') THEN RAISE EXCEPTION 'Nieprawidłowa operacja.'; END IF;
  IF p_action = 'payout' THEN
    IF p_idempotency_key IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_amount <= 0 OR p_amount >= 1000000000000 OR p_amount <> round(p_amount, 2)
       OR p_payment_date IS NULL OR p_payment_date < DATE '1900-01-01'
       OR p_payment_date > (current_timestamp AT TIME ZONE 'Europe/Warsaw')::date
       OR length(p_reference) > 200 OR length(p_note) > 2000 THEN
      RAISE EXCEPTION 'Podaj dodatnią kwotę do dwóch miejsc po przecinku, rzeczywistą datę dokonanej wypłaty oraz poprawny identyfikator.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('commission-payout:' || p_idempotency_key::text, 0));
  END IF;
  SELECT c.event_id INTO event_id_to_lock FROM public.event_commissions c WHERE c.id = p_commission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono prowizji.'; END IF;
  SELECT e.my_company_id INTO company_id FROM public.events e WHERE e.id = event_id_to_lock FOR SHARE;
  SELECT * INTO commission FROM public.event_commissions c WHERE c.id = p_commission_id FOR UPDATE;
  IF NOT FOUND OR commission.event_id IS DISTINCT FROM event_id_to_lock THEN
    RAISE EXCEPTION 'Prowizja zmieniła wydarzenie. Odśwież rozliczenia.';
  END IF;
  IF NOT public.commission_settlement_can_access(commission.event_id, true) THEN
    RAISE EXCEPTION 'Brak dostępu do rozliczenia tego wydarzenia.' USING ERRCODE = '42501';
  END IF;
  IF commission.entry_kind = 'deduction' THEN
    RAISE EXCEPTION 'To potrącenie — rozlicz je przyciskiem „Potrąć z prowizji”, nie wypłatą.';
  END IF;
  IF p_action = 'approve' THEN
    IF coalesce(commission.automatic_source = ANY (private.commission_auto_sources()), false) OR commission.entry_kind <> 'accrual' THEN
      IF commission.status = 'approved' THEN
        RETURN jsonb_build_object('ok', true, 'commissionId', commission.id, 'duplicate', true);
      END IF;
      RAISE EXCEPTION 'Ta prowizja staje się do wypłaty po zatwierdzeniu podsumowania wydarzenia (zakładka Podsumowanie).';
    END IF;
    IF p_expected_amount IS NULL OR p_expected_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_expected_amount <= 0 OR p_expected_amount IS DISTINCT FROM commission.amount
       OR commission.automatic_waiting_for_offer OR commission.status NOT IN ('planned', 'approved') THEN
      RAISE EXCEPTION 'Zatwierdzenie wymaga aktualnej dodatniej kwoty i ustalonej podstawy prowizji. Odśwież dane.';
    END IF;
    IF commission.status = 'approved' THEN
      RETURN jsonb_build_object('ok', true, 'commissionId', commission.id, 'duplicate', true);
    END IF;
    -- Ta sama osoba ma już zatwierdzoną prowizję z zatwierdzonego podsumowania: zatwierdzenie wpisu ręcznego dałoby
    -- podwójną wypłatę. Najpierw otwórz podsumowanie — po zatwierdzeniu wpisu ponowne zatwierdzenie rozliczy różnicę.
    IF private.event_settlement_status(commission.event_id) = 'approved' AND EXISTS (
         SELECT 1 FROM public.event_commissions a
          WHERE a.event_id = commission.event_id AND a.id <> commission.id AND a.entry_kind = 'accrual'
            AND a.automatic_source = ANY (private.commission_auto_sources()) AND a.status IN ('approved', 'paid')
            AND private.commission_same_person(a, commission) AND private.commission_chain_net(a.id) > 0) THEN
      RAISE EXCEPTION 'Ta osoba ma już zatwierdzoną prowizję z podsumowania wydarzenia. Otwórz ponownie podsumowanie (zakładka Podsumowanie), zatwierdź ten wpis, a potem zatwierdź podsumowanie — rozliczy różnicę bez podwójnej wypłaty.';
    END IF;
    UPDATE public.event_commissions SET status = 'approved' WHERE id = commission.id RETURNING amount INTO final_amount;
    IF final_amount IS DISTINCT FROM p_expected_amount THEN
      RAISE EXCEPTION 'Kwota prowizji wymaga ponownego przeliczenia. Zapisz naliczenie przed zatwierdzeniem.';
    END IF;
    RETURN jsonb_build_object('ok', true, 'commissionId', commission.id, 'duplicate', false);
  END IF;
  SELECT * INTO previous FROM public.event_commission_payouts WHERE id = p_idempotency_key;
  IF FOUND THEN
    IF previous.commission_id IS DISTINCT FROM commission.id OR previous.amount IS DISTINCT FROM p_amount
       OR previous.payment_date IS DISTINCT FROM p_payment_date OR previous.reference IS DISTINCT FROM normalized_reference
       OR previous.note IS DISTINCT FROM normalized_note OR previous.recorded_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Identyfikator operacji został już wykorzystany z innymi danymi. Nie zapisano drugiej wypłaty.';
    END IF;
    RETURN jsonb_build_object('ok', true, 'commissionId', commission.id, 'paymentId', previous.id, 'duplicate', true);
  END IF;
  IF commission.status <> 'approved' OR commission.automatic_waiting_for_offer OR commission.amount <= 0 THEN
    RAISE EXCEPTION 'Wypłatę można zapisać tylko dla zatwierdzonej prowizji z ustaloną dodatnią kwotą.';
  END IF;
  -- Prowizja z podsumowania, a ta sama osoba ma zatwierdzony ręczny wpis (ma pierwszeństwo): bez ponownego zatwierdzenia
  -- podsumowania wypłacilibyśmy obie.
  IF coalesce(commission.automatic_source = ANY (private.commission_auto_sources()), false) AND EXISTS (
       SELECT 1 FROM public.event_commissions m
        WHERE m.event_id = commission.event_id AND m.entry_kind = 'accrual' AND m.status IN ('approved', 'paid')
          AND m.owner_profit_review_id IS NULL
          AND (m.automatic_source IS NULL OR NOT (m.automatic_source = ANY (private.commission_auto_sources())))
          AND ((commission.sales_partner_id IS NOT NULL AND m.sales_partner_id = commission.sales_partner_id)
            OR (commission.contact_id IS NOT NULL AND m.contact_id = commission.contact_id)
            OR (commission.automatic_source = 'sales_share' AND m.employee_id = commission.employee_id))) THEN
    RAISE EXCEPTION 'Ta osoba ma zatwierdzony ręczny wpis prowizji w tym wydarzeniu. Najpierw zatwierdź ponownie podsumowanie wydarzenia — rozliczy różnicę.';
  END IF;
  -- Wpis ręczny, a ta sama osoba ma w tym wydarzeniu prowizję z podsumowania: najpierw ponowne zatwierdzenie podsumowania
  -- (prowizja z podsumowania spadnie do zera), a nadpłatę z niej potrąca się z wpisu ręcznego, nie wypłaca obu.
  IF NOT coalesce(commission.automatic_source = ANY (private.commission_auto_sources()), false)
     AND commission.entry_kind = 'accrual' AND commission.owner_profit_review_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.event_commissions a
                WHERE a.event_id = commission.event_id AND a.entry_kind = 'accrual'
                  AND a.automatic_source = ANY (private.commission_auto_sources()) AND a.status IN ('approved', 'paid')
                  AND private.commission_same_person(a, commission) AND private.commission_chain_net(a.id) > 0) THEN
      RAISE EXCEPTION 'Ta osoba ma w tym wydarzeniu prowizję z podsumowania. Najpierw zatwierdź ponownie podsumowanie wydarzenia — rozliczy różnicę.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.event_commissions d
                WHERE d.event_id = commission.event_id AND d.entry_kind = 'deduction' AND d.status = 'approved'
                  AND private.commission_same_person(d, commission)) THEN
      RAISE EXCEPTION 'Ta osoba ma otwarte potrącenie z tego wydarzenia — najpierw potrąć je z tej prowizji („Potrąć z prowizji”).';
    END IF;
  END IF;
  SELECT coalesce(sum(p.amount), 0) INTO paid FROM public.event_commission_payouts p WHERE p.commission_id = commission.id;
  IF p_amount > commission.amount - paid THEN
    RAISE EXCEPTION 'Kwota przekracza pozostałą prowizję. Odśwież dane — inna wypłata mogła już zostać zapisana.';
  END IF;
  INSERT INTO public.event_commission_payouts (
    id, commission_id, event_id, my_company_id, amount, payment_date, payment_method, reference, note, recorded_by
  ) VALUES (
    p_idempotency_key, commission.id, commission.event_id, company_id, p_amount, p_payment_date,
    commission.payment_method, normalized_reference, normalized_note, auth.uid()
  );
  SELECT max(p.payment_date) INTO last_payment FROM public.event_commission_payouts p WHERE p.commission_id = commission.id;
  UPDATE public.event_commissions SET
    status = CASE WHEN paid + p_amount = commission.amount THEN 'paid' ELSE 'approved' END,
    paid_at = CASE WHEN paid + p_amount = commission.amount THEN last_payment::timestamp AT TIME ZONE 'Europe/Warsaw' ELSE NULL END
  WHERE id = commission.id;
  RETURN jsonb_build_object('ok', true, 'commissionId', commission.id, 'paymentId', p_idempotency_key, 'duplicate', false);
END;
$function$;

-- Potrącenie: nadpłata zmniejsza inną zatwierdzoną prowizję tej samej osoby — w tej samej marce i tym samym sposobie
-- wypłaty. Może być częściowe (reszta zostaje „do potrącenia”). Zapis w rejestrze wypłat obu wpisów, bez przelewu.
CREATE OR REPLACE FUNCTION public.settle_commission_deduction(p_deduction_id uuid, p_target_id uuid, p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  d public.event_commissions%ROWTYPE; t public.event_commissions%ROWTYPE; prev public.event_commission_payouts%ROWTYPE;
  v_d_company uuid; v_t_company uuid; v_done numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.commission_settlement_can_access(NULL, true) THEN
    RAISE EXCEPTION 'Brak uprawnień do rozliczania prowizji.' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Brak identyfikatora operacji.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('commission-payout:' || p_idempotency_key::text, 0));
  SELECT * INTO prev FROM public.event_commission_payouts p WHERE p.id = p_idempotency_key;
  IF FOUND THEN
    IF prev.commission_id IS DISTINCT FROM p_target_id OR NOT prev.is_offset OR position(p_deduction_id::text IN coalesce(prev.note, '')) = 0 THEN
      RAISE EXCEPTION 'Identyfikator operacji został już wykorzystany z innymi danymi.';
    END IF;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'amount', prev.amount);
  END IF;
  SELECT * INTO d FROM public.event_commissions WHERE id = p_deduction_id FOR UPDATE;
  SELECT * INTO t FROM public.event_commissions WHERE id = p_target_id FOR UPDATE;
  IF d.id IS NULL OR d.entry_kind <> 'deduction' OR d.status <> 'approved' THEN
    RAISE EXCEPTION 'Wybierz otwarte potrącenie.';
  END IF;
  IF t.id IS NULL OR t.entry_kind = 'deduction' OR t.status <> 'approved' THEN
    RAISE EXCEPTION 'Potrącić można tylko z zatwierdzonej prowizji do wypłaty.';
  END IF;
  IF NOT public.commission_settlement_can_access(d.event_id, true) OR NOT public.commission_settlement_can_access(t.event_id, true) THEN
    RAISE EXCEPTION 'Brak dostępu do rozliczenia tych wydarzeń.' USING ERRCODE = '42501';
  END IF;
  IF NOT ((d.sales_partner_id IS NOT NULL AND d.sales_partner_id = t.sales_partner_id)
       OR (d.contact_id IS NOT NULL AND d.contact_id = t.contact_id)
       OR (d.sales_partner_id IS NULL AND t.sales_partner_id IS NULL AND d.employee_id IS NOT NULL AND d.employee_id = t.employee_id)) THEN
    RAISE EXCEPTION 'Potrącenie i prowizja muszą dotyczyć tej samej osoby.';
  END IF;
  SELECT my_company_id INTO v_t_company FROM public.events WHERE id = t.event_id;
  SELECT my_company_id INTO v_d_company FROM public.events WHERE id = d.event_id;
  -- W tym samym wydarzeniu nadpłatę można potrącić także z wpisu z innym sposobem wypłaty.
  IF v_t_company IS DISTINCT FROM v_d_company
     OR (t.payment_method IS DISTINCT FROM d.payment_method AND t.event_id IS DISTINCT FROM d.event_id) THEN
    RAISE EXCEPTION 'Potrącić można tylko z prowizji tej samej marki i tego samego sposobu wypłaty.';
  END IF;
  v_done := private.offset_commission_deduction(d.id, t.id, NULL, p_idempotency_key);
  IF v_done <= 0 THEN RAISE EXCEPTION 'Ta prowizja nie ma już kwoty do wypłaty.'; END IF;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'targetId', t.id, 'deductionId', d.id, 'amount', v_done);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 18. Kroki realizacji: „Wyślij podsumowanie” (sprzedaż) i „Zatwierdź podsumowanie” (administrator) w etapie Rozliczenie
--     (funkcje z 20261105090000_event_access_areas.sql + dwa kroki; zamykają się same ze stanu podsumowania).
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.event_step_auto_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['manager_appointed','settlement_invoice','settlement_paid','formal_details','formal_contract','formal_deposit',
               'wedding_card','team_ready','agenda_ready','transport_planned',
               'settlement_summary','settlement_summary_approval'];
$$;

CREATE OR REPLACE FUNCTION private.event_step_plan(p_event uuid)
RETURNS TABLE(step_key text, stage text, kind text, source text, source_id uuid, title text, details text,
  quantity numeric, unit text, supplier text, owner_role text, due_at timestamptz, blocks_ready boolean,
  sort_order integer, depends_on text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  ev record;
  t_accept timestamptz; t_start timestamptz; t_end timestamptz; t_loading timestamptz; t_paid timestamptz;
  has_equipment boolean; has_driver boolean; requirements text; manual_blocking text[];
  is_wedding boolean; has_deposit boolean; t_deposit timestamptz;
BEGIN
  SELECT e.id, e.status::text AS status, e.event_date, e.event_end_date INTO ev FROM public.events e WHERE e.id = p_event;
  IF ev.id IS NULL OR ev.event_date IS NULL
     OR ev.status NOT IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled') THEN
    RETURN;
  END IF;

  t_start := ev.event_date;
  t_end := greatest(coalesce(ev.event_end_date, ev.event_date), ev.event_date);
  t_accept := coalesce(
    (SELECT h.requested_at FROM public.event_warehouse_handoffs h WHERE h.event_id = p_event),
    (SELECT max(o.updated_at) FROM public.offers o WHERE o.event_id = p_event AND o.status::text = 'accepted'),
    least(now(), t_start));
  SELECT min(p.start_time) INTO t_loading FROM public.event_phases p
    LEFT JOIN public.event_phase_types t ON t.id = p.phase_type_id
   WHERE p.event_id = p_event AND p.start_time IS NOT NULL AND coalesce(t.name, p.name) ILIKE 'za_adunek%';
  t_loading := least(coalesce(t_loading, t_start - interval '6 hours'), t_start);
  t_paid := (SELECT max(i.payment_due_date)::timestamptz + interval '12 hours' FROM public.invoices i
              WHERE i.event_id = p_event AND i.invoice_type IN ('vat','final','advance')
                AND i.status NOT IN ('draft','cancelled','proforma'));

  has_equipment := EXISTS (SELECT 1 FROM public.event_equipment x WHERE x.event_id = p_event
    AND NOT coalesce(x.removed_from_offer, false));
  has_driver := EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event
    AND v.driver_id IS NOT NULL AND coalesce(v.status,'planned') <> 'cancelled');
  is_wedding := EXISTS (SELECT 1 FROM public.wedding_cards w WHERE w.event_id = p_event);
  SELECT min(m.due_date)::timestamptz + interval '12 hours', count(*) > 0 INTO t_deposit, has_deposit
    FROM public.event_payment_milestones m
   WHERE m.event_id = p_event AND m.milestone_type = 'deposit' AND m.status <> 'waived';
  SELECT coalesce(array_agg(s.step_key ORDER BY s.created_at), '{}') INTO manual_blocking FROM public.event_steps s
   WHERE s.event_id = p_event AND s.source = 'manual' AND s.blocks_ready AND s.status <> 'archived';

  -- Wymagania usług wobec klienta i obiektu (zgody, czujki, zasilanie).
  SELECT string_agg(DISTINCT '• ' || coalesce(nullif(btrim(oi.name),''), op.name) || ': ' || btrim(r->>'title')
           || CASE WHEN nullif(btrim(r->>'description'),'') IS NOT NULL THEN ' — ' || btrim(r->>'description') ELSE '' END, E'\n')
    INTO requirements
    FROM public.offers o
    JOIN public.offer_items oi ON oi.offer_id = o.id
    JOIN public.offer_products op ON op.id = oi.product_id
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(op.offer_additional_requirements) = 'array'
      THEN op.offer_additional_requirements ELSE '[]'::jsonb END) r
   WHERE o.event_id = p_event AND o.status::text = 'accepted' AND jsonb_typeof(r) = 'object'
     AND nullif(btrim(r->>'title'),'') IS NOT NULL;

  RETURN QUERY
  WITH prep AS (
    -- Zamówienia / sprawdzenia / potwierdzenia z konfiguracji usług zaakceptowanej oferty.
    SELECT 'product:' || tpl.id || ':' || oi.id AS step_key, 'preparation'::text AS stage, tpl.kind, 'product'::text AS source,
           tpl.id AS source_id, tpl.title,
           nullif(concat_ws(E'\n', nullif(btrim(tpl.details),''), 'Usługa: ' || coalesce(nullif(btrim(oi.name),''), op.name)), '') AS details,
           CASE WHEN tpl.quantity_per_unit IS NOT NULL THEN round(tpl.quantity_per_unit * greatest(coalesce(oi.quantity,1),1), 2) END AS quantity,
           tpl.unit, tpl.supplier, tpl.owner_role,
           (CASE WHEN tpl.anchor = 'loading' THEN t_loading ELSE t_start END) - make_interval(days => tpl.lead_days) AS due_at,
           tpl.blocks_ready, 100 + tpl.order_index AS sort_order,
           CASE WHEN tpl.owner_role = 'warehouse' THEN ARRAY['warehouse_accept'] ELSE '{}'::text[] END AS depends_on
      FROM public.offers o
      JOIN public.offer_items oi ON oi.offer_id = o.id
      JOIN public.offer_products op ON op.id = oi.product_id
      JOIN public.offer_product_preparation_items tpl ON tpl.product_id = oi.product_id AND tpl.is_active
     WHERE o.event_id = p_event AND o.status::text = 'accepted'
    UNION ALL
    -- Zaakceptowane braki w magazynie.
    SELECT 'shortage:' || x.id, 'preparation', 'order', 'shortage', x.id,
           'Zapewnij brakujący sprzęt: ' || coalesce(i.name, k.name, c.name, 'sprzęt') || ' × ' || coalesce(x.quantity, 1),
           'Brak w magazynie zaakceptowany przy rezerwacji — wynajem, zakup albo zamiana.',
           x.quantity::numeric, 'szt.', NULL, 'warehouse', t_loading - interval '2 days', true, 200, ARRAY['warehouse_accept']
      FROM public.event_equipment x
      LEFT JOIN public.equipment_items i ON i.id = x.equipment_id
      LEFT JOIN public.equipment_kits k ON k.id = x.kit_id
      LEFT JOIN public.cables c ON c.id = x.cable_id
     WHERE x.event_id = p_event AND coalesce(x.is_optional, false) AND x.reservation_status::text = 'planned'
       AND NOT coalesce(x.removed_from_offer, false)
    UNION ALL
    -- Wynajem zewnętrzny.
    SELECT 'rental:' || x.id, 'preparation', 'order', 'rental', x.id,
           'Potwierdź wynajem zewnętrzny: ' || coalesce(i.name, k.name, c.name, 'sprzęt') || ' × ' || coalesce(x.quantity, 1),
           'Ustal odbiór i zwrot u wynajmującego.', x.quantity::numeric, 'szt.', NULL, 'warehouse', t_loading - interval '2 days', true, 210,
           ARRAY['warehouse_accept']
      FROM public.event_equipment x
      LEFT JOIN public.equipment_items i ON i.id = x.equipment_id
      LEFT JOIN public.equipment_kits k ON k.id = x.kit_id
      LEFT JOIN public.cables c ON c.id = x.cable_id
     WHERE x.event_id = p_event AND coalesce(x.use_external_rental, false)
       AND NOT coalesce(x.is_optional, false) AND NOT coalesce(x.removed_from_offer, false)
    UNION ALL
    -- Sprzęt ze sprawdzeniem stanu przed wydaniem (pozycje i składniki zestawów).
    SELECT 'check:' || i.id, 'preparation', 'stock_check', 'equipment', i.id,
           'Sprawdź stan: ' || i.name, nullif(btrim(i.pre_check_instructions), ''), NULL::numeric, NULL, NULL, 'warehouse',
           t_loading - interval '2 days', true, 220, ARRAY['warehouse_accept']
      FROM public.equipment_items i
     WHERE i.requires_pre_check AND i.deleted_at IS NULL
       AND i.id IN (
         SELECT x.equipment_id FROM public.event_equipment x
          WHERE x.event_id = p_event AND x.equipment_id IS NOT NULL
            AND NOT coalesce(x.is_optional, false) AND NOT coalesce(x.removed_from_offer, false)
         UNION
         SELECT ki.equipment_id FROM public.event_equipment x JOIN public.equipment_kit_items ki ON ki.kit_id = x.kit_id
          WHERE x.event_id = p_event AND ki.equipment_id IS NOT NULL
            AND NOT coalesce(x.is_optional, false) AND NOT coalesce(x.removed_from_offer, false))
  ), flags AS (
    SELECT coalesce(array_agg(p.step_key ORDER BY p.sort_order, p.step_key) FILTER (WHERE p.blocks_ready), '{}') AS blocking_keys,
           coalesce(bool_or(p.owner_role = 'warehouse'), false) AS warehouse_prep
      FROM prep p
  ), sys AS (
    SELECT v.* FROM flags f CROSS JOIN LATERAL (VALUES
      ('formal_details','formalities','approval','Uzupełnij kluczowe dane wydarzenia',
       'Data, miejsce i klient (organizacja albo osoba kontaktowa). Krok zamyka się sam po uzupełnieniu danych.',
       'sales', t_accept + interval '1 day', false, 1, '{}'::text[], true),
      ('formal_contract','formalities','approval','Podpisana umowa z klientem',
       'Wyślij umowę i zapisz ją jako podpisaną w zakładce Umowa. Krok zamyka się sam (także gdy ustalenia z partnerem nie wymagają umowy).',
       'sales', greatest(t_accept, least(t_start - interval '1 day', greatest(t_start - interval '14 days', t_accept + interval '3 days'))),
       false, 2, '{}'::text[], true),
      ('formal_deposit','formalities','approval','Zaliczka lub zadatek wpłacone',
       'Krok zamyka się sam po zaksięgowaniu wpłaty z harmonogramu płatności (zakładka Finanse).',
       'sales', greatest(t_accept, coalesce(t_deposit, t_start - interval '7 days')), false, 3, '{}'::text[], has_deposit),
      ('sales_handoff','handoff','handoff','Przekaż realizację do magazynu',
       'Sprawdź, że sprzęt jest zarezerwowany (braki oznaczone), miejsce, kontakt i godziny są uzupełnione, a klient zna wymagania usług. Krok zamyka się też sam, gdy magazyn przyjmie realizację.',
       'sales', t_accept + interval '1 day', false, 10, '{}'::text[], true),
      ('warehouse_accept','handoff','handoff','Przyjmij realizację do przygotowania',
       'Przyjęcie oznacza, że magazyn odpowiada za przygotowanie sprzętu, zamówienia i sprawdzenia stanu tego wydarzenia. Przyjmująca osoba zostaje opiekunem wydarzenia w magazynie.',
       'warehouse', greatest(t_accept, least(t_accept + interval '2 days', t_start - interval '1 day')), false, 20, '{}'::text[],
       has_equipment OR f.warehouse_prep),
      ('manager_appointed','handoff','approval','Wyznacz kierownika realizacji',
       'Kierownik realizacji prowadzi wydarzenie na miejscu: odbiera sprzęt, startuje i kończy realizację, oddaje sprzęt do magazynu. Wyznaczasz go w zakładce Zespół — krok zamknie się sam.',
       'author', greatest(t_accept, least(t_start - interval '1 day', greatest(t_start - interval '14 days', t_accept + interval '1 day'))),
       false, 30, '{}'::text[], true),
      ('client_requirements','preparation','venue_confirmation','Potwierdź z klientem i obiektem wymagania usług',
       coalesce(requirements, ''), 'sales',
       greatest(t_accept, least(t_start - interval '1 day', greatest(t_start - interval '7 days', t_accept + interval '2 days'))),
       false, 40, '{}'::text[], requirements IS NOT NULL),
      ('wedding_card','preparation','venue_confirmation','Karta weselna wysłana do akceptacji',
       'Uzupełnij kartę weselną z parą młodą i wyślij ją do akceptacji. Krok zamyka się sam.',
       'sales', greatest(t_accept, t_start - interval '21 days'), false, 45, '{}'::text[], is_wedding),
      ('team_ready','preparation','approval','Zespół przypisany i potwierdzony',
       'Przypisz osoby w zakładce Zespół. Krok zamyka się sam, gdy wszyscy zaproszeni potwierdzą udział.',
       'author', greatest(t_accept, t_start - interval '7 days'), false, 50, '{}'::text[], true),
      ('agenda_ready','preparation','approval','Agenda realizacji gotowa',
       'Przygotuj agendę (harmonogram dnia) w zakładce Agenda. Krok zamyka się sam.',
       'author', greatest(t_accept, t_start - interval '5 days'), false, 52, '{}'::text[], true),
      ('transport_planned','preparation','approval','Transport zaplanowany',
       'Dodaj auta i kierowców w zakładce Logistyka. Krok zamyka się sam, gdy każde auto ma kierowcę.',
       'author', greatest(t_accept, t_loading - interval '2 days'), false, 54, '{}'::text[], has_equipment),
      ('warehouse_ready','preparation','approval','Oznacz przygotowanie jako gotowe',
       'Możliwe dopiero, gdy zamówienia, sprawdzenia stanu, braki i wynajmy są zamknięte, a kierownik realizacji wyznaczony.',
       'warehouse', greatest(t_accept, t_loading - interval '1 day'), false, 300,
       ARRAY['warehouse_accept','manager_appointed'] || f.blocking_keys || manual_blocking,
       has_equipment OR f.warehouse_prep),
      ('dispatch_out','dispatch','handoff','Wydaj sprzęt — załadunek zgodny z listą',
       'Odhacz załadowane pozycje i potwierdź wydanie. Rozbieżności opisz w notatce. Potwierdzenie blokuje listę załadunku.',
       'warehouse', t_loading, false, 400, ARRAY['warehouse_ready'], has_equipment),
      ('dispatch_receive','dispatch','handoff','Odbierz sprzęt i auto',
       'Odbierający potwierdza zgodność załadunku z listą (albo zgłasza problem). Od tej chwili odpowiada za sprzęt w drodze i na miejscu. Krok zamyka się też sam po odbiorze auta z licznikiem.',
       CASE WHEN has_driver THEN 'driver' ELSE 'manager' END, t_loading, false, 410, ARRAY['dispatch_out'], has_equipment),
      ('realization_start','realization','approval','Przejmij realizację na miejscu',
       'Kierownik realizacji potwierdza start na miejscu.', 'manager', t_start, false, 500,
       CASE WHEN has_equipment OR f.warehouse_prep THEN ARRAY['warehouse_ready']
            ELSE ARRAY['manager_appointed'] || f.blocking_keys || manual_blocking END, true),
      ('realization_complete','realization','approval','Zakończ realizację z raportem',
       'Raport: przebieg, dodatkowe godziny, uwagi klienta, szkody.', 'manager', t_end + interval '12 hours', false, 510,
       ARRAY['realization_start'], true),
      ('return_handover','return','handoff','Oddaj sprzęt do magazynu',
       'Kierownik (albo kierowca) przekazuje sprzęt magazynowi. Braki i uszkodzenia opisz w notatce albo zgłoś jako problem.', 'manager',
       t_end + interval '1 day', false, 600, ARRAY['realization_complete'], has_equipment),
      ('return_check','return','handoff','Przyjmij zwrot i sprawdź sprzęt',
       'Magazyn sprawdza zwrot z listą. Braki i uszkodzenia zgłoś jako problem z opisem.', 'warehouse',
       t_end + interval '2 days', false, 610, ARRAY['return_handover'], has_equipment),
      ('settlement_invoice','settlement','approval','Wystaw fakturę za wydarzenie',
       'Krok zamyka się sam po wystawieniu faktury powiązanej z wydarzeniem.', 'admin',
       t_end + interval '7 days', false, 700, '{}'::text[], true),
      ('settlement_paid','settlement','approval','Potwierdź wpłatę za wydarzenie',
       'Krok zamyka się sam, gdy faktury wydarzenia są opłacone.', 'admin',
       coalesce(t_paid, t_end + interval '21 days'), false, 710, ARRAY['settlement_invoice'], true),
      ('settlement_summary','settlement','task','Wyślij podsumowanie wydarzenia',
       'W zakładce Podsumowanie potwierdź koszty netto i wyślij do zatwierdzenia — z podsumowania liczą się prowizje. Krok zamyka się sam po wysłaniu.',
       'sales', t_end + interval '5 days', false, 720, '{}'::text[], true),
      ('settlement_summary_approval','settlement','approval','Zatwierdź podsumowanie wydarzenia',
       'Sprawdź przychody, koszty i prowizje. Zatwierdzenie zamraża prowizje do wypłaty. Krok zamyka się sam po zatwierdzeniu.',
       'admin', t_end + interval '10 days', false, 730, ARRAY['settlement_summary'], true)
    ) AS v(step_key, stage, kind, title, details, owner_role, due_at, blocks_ready, sort_order, depends_on, include)
  )
  SELECT s.step_key, s.stage, s.kind, 'system'::text, NULL::uuid, s.title, nullif(s.details,''), NULL::numeric, NULL::text, NULL::text,
         s.owner_role, s.due_at, s.blocks_ready, s.sort_order, s.depends_on
    FROM sys s WHERE s.include
  UNION ALL
  SELECT p.step_key, p.stage, p.kind, p.source, p.source_id, p.title, p.details, p.quantity, p.unit, p.supplier,
         p.owner_role, p.due_at, p.blocks_ready, p.sort_order, p.depends_on
    FROM prep p;
END $$;

CREATE OR REPLACE FUNCTION public.sync_event_steps(p_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ev record; planned text[]; h record; r record; invoiced boolean; paid boolean; picked_up boolean;
  details_ok boolean; contract_ok boolean; deposit_ok boolean; wedding_ok boolean; team_ok boolean; agenda_ok boolean; transport_ok boolean;
BEGIN
  IF p_event IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('event_steps:' || p_event::text));
  SELECT e.id, e.status::text AS status, coalesce(e.loading_confirmed, false) AS loading_ok, e.loading_confirmed_at, e.loading_confirmed_by
    INTO ev FROM public.events e WHERE e.id = p_event;
  IF ev.id IS NULL THEN RETURN; END IF;

  IF ev.status = 'cancelled' THEN
    UPDATE public.event_steps s SET status = 'archived', updated_at = now(),
           status_note = CASE WHEN s.status = 'problem' THEN 'Problem: ' || s.status_note || ' · wydarzenie anulowane.' ELSE 'Wydarzenie anulowane.' END
     WHERE s.event_id = p_event AND s.status IN ('open','in_progress','problem');
    RETURN;
  END IF;

  IF ev.status <> 'settled' THEN
    SELECT coalesce(array_agg(p.step_key), '{}') INTO planned FROM private.event_step_plan(p_event) p;

    INSERT INTO public.event_steps AS s (event_id, step_key, stage, kind, source, source_id, title, details, quantity, unit,
        supplier, owner_role, assignee_id, due_at, blocks_ready, sort_order, depends_on)
    SELECT p_event, p.step_key, p.stage, p.kind, p.source, p.source_id, p.title, p.details, p.quantity, p.unit,
           p.supplier, p.owner_role, public.event_step_assignee(p_event, p.owner_role), p.due_at, p.blocks_ready,
           p.sort_order, p.depends_on
      FROM private.event_step_plan(p_event) p
    ON CONFLICT (event_id, step_key) DO UPDATE SET
      stage = excluded.stage, kind = excluded.kind, source = excluded.source, source_id = excluded.source_id,
      title = excluded.title, details = excluded.details, quantity = excluded.quantity, unit = excluded.unit,
      supplier = coalesce(s.supplier, excluded.supplier), owner_role = excluded.owner_role,
      assignee_id = CASE WHEN s.assigned_manually AND s.owner_role = excluded.owner_role THEN s.assignee_id
                         ELSE coalesce(excluded.assignee_id, CASE WHEN s.owner_role = excluded.owner_role THEN s.assignee_id END) END,
      assigned_manually = s.assigned_manually AND s.owner_role = excluded.owner_role,
      due_at = CASE WHEN s.status IN ('done','skipped') THEN s.due_at ELSE excluded.due_at END,
      blocks_ready = excluded.blocks_ready, sort_order = excluded.sort_order, depends_on = excluded.depends_on,
      status = CASE WHEN s.status = 'archived' THEN 'open' ELSE s.status END,
      status_note = CASE WHEN s.status = 'archived' THEN NULL ELSE s.status_note END,
      updated_at = now()
    WHERE (s.stage, s.kind, s.source, s.source_id, s.title, s.details, s.quantity, s.unit, s.owner_role,
           s.due_at, s.blocks_ready, s.sort_order, s.depends_on, s.status)
          IS DISTINCT FROM
          (excluded.stage, excluded.kind, excluded.source, excluded.source_id, excluded.title, excluded.details,
           excluded.quantity, excluded.unit, excluded.owner_role,
           CASE WHEN s.status IN ('done','skipped') THEN s.due_at ELSE excluded.due_at END,
           excluded.blocks_ready, excluded.sort_order, excluded.depends_on,
           CASE WHEN s.status = 'archived' THEN 'open' ELSE s.status END)
       OR (NOT s.assigned_manually AND excluded.assignee_id IS NOT NULL AND s.assignee_id IS DISTINCT FROM excluded.assignee_id);

    -- Braki rozwiązane w rezerwacji zamykamy; pozostałe kroki spoza planu archiwizujemy.
    UPDATE public.event_steps s SET status = 'done', completed_at = now(), completed_by = NULL,
           completed_by_name = 'Rezerwacja sprzętu', status_note = 'Brak rozwiązany w rezerwacji sprzętu.', updated_at = now()
     WHERE s.event_id = p_event AND s.status IN ('open','in_progress','problem') AND s.source = 'shortage'
       AND NOT (s.step_key = ANY(planned))
       AND EXISTS (SELECT 1 FROM public.event_equipment x WHERE x.id = s.source_id AND NOT coalesce(x.removed_from_offer, false));
    UPDATE public.event_steps s SET status = 'archived', updated_at = now(),
           status_note = CASE WHEN s.status = 'problem' THEN 'Problem: ' || s.status_note || ' · poza zakresem wydarzenia.' ELSE 'Poza zakresem wydarzenia.' END
     WHERE s.event_id = p_event AND s.status IN ('open','in_progress','problem') AND s.source <> 'manual'
       AND NOT (s.step_key = ANY(planned));
  END IF;

  -- Prawda procesu → kroki systemowe. Dwukierunkowo (zamknij / otwórz ponownie) tam, gdzie proces jest źródłem prawdy.
  SELECT hh.accepted_at, hh.accepted_by, hh.accepted_by_name, hh.ready_at, hh.ready_by, hh.ready_by_name INTO h
    FROM public.event_warehouse_handoffs hh WHERE hh.event_id = p_event;
  SELECT rr.manager_id, rr.started_at, rr.started_by, rr.completed_at, rr.completed_by INTO r
    FROM public.event_realizations rr JOIN public.employees e ON e.id = rr.manager_id AND e.is_active WHERE rr.event_id = p_event;
  invoiced := EXISTS (SELECT 1 FROM public.invoices i WHERE i.event_id = p_event AND i.invoice_type IN ('vat','final','advance')
                AND i.status NOT IN ('draft','cancelled','proforma'));
  paid := ev.status = 'settled' OR (invoiced AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.event_id = p_event
                AND i.invoice_type IN ('vat','final','advance') AND i.status NOT IN ('draft','cancelled','proforma')
                AND coalesce(i.payment_status, 'unpaid') IN ('unpaid','partially_paid','overdue')));
  picked_up := EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event AND v.pickup_timestamp IS NOT NULL
                AND coalesce(v.status,'planned') <> 'cancelled');

  details_ok := EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event AND e.event_date IS NOT NULL
                  AND nullif(btrim(coalesce(e.location, '')), '') IS NOT NULL
                  AND (e.contact_person_id IS NOT NULL OR e.organization_id IS NOT NULL));
  contract_ok := EXISTS (SELECT 1 FROM public.event_partner_arrangements a WHERE a.event_id = p_event AND a.enabled AND NOT a.include_contract)
              OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.event_id = p_event
                          AND c.status::text IN ('signed_by_client','signed_returned','completed'));
  deposit_ok := NOT EXISTS (SELECT 1 FROM public.event_payment_milestones m WHERE m.event_id = p_event
                  AND m.milestone_type = 'deposit' AND m.status NOT IN ('paid','waived'));
  wedding_ok := EXISTS (SELECT 1 FROM public.wedding_cards w WHERE w.event_id = p_event AND w.status IN ('submitted','approved'));
  team_ok := EXISTS (SELECT 1 FROM public.employee_assignments a WHERE a.event_id = p_event AND a.status = 'accepted')
         AND NOT EXISTS (SELECT 1 FROM public.employee_assignments a WHERE a.event_id = p_event AND coalesce(a.status, 'pending') = 'pending');
  agenda_ok := EXISTS (SELECT 1 FROM public.event_agendas g WHERE g.event_id = p_event);
  transport_ok := EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event AND coalesce(v.status, 'planned') <> 'cancelled')
              AND NOT EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event AND coalesce(v.status, 'planned') <> 'cancelled'
                               AND v.driver_id IS NULL AND NOT coalesce(v.is_external, false));

  WITH truth(step_key, met, at, who, who_name, two_way) AS (VALUES
      ('formal_details', details_ok, NULL::timestamptz, NULL::uuid, 'Dane wydarzenia'::text, true),
      ('formal_contract', contract_ok, NULL::timestamptz, NULL::uuid, 'Umowa'::text, true),
      ('formal_deposit', deposit_ok, NULL::timestamptz, NULL::uuid, 'Płatność'::text, true),
      ('wedding_card', wedding_ok, NULL::timestamptz, NULL::uuid, 'Karta weselna'::text, true),
      ('team_ready', team_ok, NULL::timestamptz, NULL::uuid, 'Zespół'::text, true),
      ('agenda_ready', agenda_ok, NULL::timestamptz, NULL::uuid, 'Agenda'::text, true),
      ('transport_planned', transport_ok, NULL::timestamptz, NULL::uuid, 'Logistyka'::text, true),
      ('warehouse_accept', h.accepted_at IS NOT NULL, h.accepted_at, h.accepted_by, h.accepted_by_name, true),
      ('sales_handoff', h.accepted_at IS NOT NULL, h.accepted_at, NULL::uuid, 'Przyjęte przez magazyn'::text, false),
      ('warehouse_ready', h.ready_at IS NOT NULL, h.ready_at, h.ready_by, h.ready_by_name, true),
      ('manager_appointed', r.manager_id IS NOT NULL, NULL::timestamptz, NULL::uuid,
        (SELECT coalesce(nullif(concat_ws(' ', e.name, e.surname), ''), e.nickname) FROM public.employees e WHERE e.id = r.manager_id), true),
      ('dispatch_out', ev.loading_ok, ev.loading_confirmed_at, ev.loading_confirmed_by, NULL::text, true),
      ('dispatch_receive', picked_up, NULL::timestamptz, NULL::uuid, 'Odbiór auta'::text, false),
      ('realization_start', r.started_at IS NOT NULL, r.started_at, r.started_by, NULL::text, true),
      ('realization_complete', r.completed_at IS NOT NULL, r.completed_at, r.completed_by, NULL::text, true),
      ('settlement_invoice', invoiced OR ev.status = 'settled', NULL::timestamptz, NULL::uuid, 'Faktura'::text, true),
      ('settlement_paid', paid, NULL::timestamptz, NULL::uuid, 'Rozliczenie'::text, true)
  ), changes AS (
    SELECT s.id, s.status AS old_status, t.met, t.at, t.who, t.who_name
      FROM public.event_steps s JOIN truth t ON t.step_key = s.step_key
     WHERE s.event_id = p_event AND s.status <> 'archived'
       AND ((t.met AND s.status NOT IN ('done','skipped')) OR (t.two_way AND NOT t.met AND s.status = 'done'))
  ), applied AS (
    UPDATE public.event_steps s SET
      status = CASE WHEN c.met THEN 'done' ELSE 'open' END,
      completed_at = CASE WHEN c.met THEN coalesce(c.at, now()) END,
      completed_by = CASE WHEN c.met THEN c.who END,
      completed_by_name = CASE WHEN c.met THEN coalesce(c.who_name,
        (SELECT coalesce(nullif(concat_ws(' ', e.name, e.surname), ''), e.nickname) FROM public.employees e WHERE e.id = c.who)) END,
      status_note = CASE WHEN c.met THEN s.status_note ELSE 'Cofnięto w procesie wydarzenia.' END,
      updated_at = now()
    FROM changes c WHERE s.id = c.id
    RETURNING s.id, s.event_id, c.old_status, s.status
  )
  INSERT INTO public.event_step_activity(step_id, event_id, action, from_status, to_status, performed_by_name)
  SELECT a.id, a.event_id, CASE WHEN a.status = 'done' THEN 'auto_done' ELSE 'auto_reopen' END, a.old_status, a.status, 'System'
    FROM applied a
   -- Krok zamykany właśnie przez update_event_step ma własny wpis w historii.
   WHERE a.id::text IS DISTINCT FROM nullif(current_setting('mavinci.event_step_in_action', true), '');

  -- Wydarzenie rozliczone = zamknięte: pozostałe otwarte kroki archiwizujemy.
  IF ev.status = 'settled' THEN
    UPDATE public.event_steps s SET status = 'archived', updated_at = now(),
           status_note = CASE WHEN s.status = 'problem' THEN 'Problem: ' || s.status_note || ' · wydarzenie rozliczone.' ELSE 'Wydarzenie rozliczone.' END
     WHERE s.event_id = p_event AND s.status IN ('open','in_progress','problem');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.event_step_json(s public.event_steps, p_can_act boolean, p_can_override boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'id', s.id, 'event_id', s.event_id, 'key', s.step_key, 'stage', s.stage, 'kind', s.kind, 'source', s.source,
    'title', s.title, 'details', s.details, 'quantity', s.quantity, 'unit', s.unit, 'supplier', s.supplier,
    'owner_role', s.owner_role, 'due_at', s.due_at, 'status', s.status, 'status_note', s.status_note,
    'ordered_at', s.ordered_at, 'expected_at', s.expected_at, 'completed_at', s.completed_at,
    'completed_by_name', s.completed_by_name, 'blocks_ready', s.blocks_ready, 'sort_order', s.sort_order,
    'is_mine', s.assignee_id IS NOT NULL AND s.assignee_id = public.sales_employee_id(),
    'completed_by_me', s.completed_by IS NOT NULL AND s.completed_by = public.sales_employee_id(),
    'assignee', (SELECT jsonb_build_object('id', e.id, 'name', coalesce(nullif(concat_ws(' ', e.name, e.surname), ''), e.nickname),
                   'phone', e.phone_number) FROM public.employees e WHERE e.id = s.assignee_id),
    'blocked_by', coalesce((SELECT jsonb_agg(jsonb_build_object('key', d.step_key, 'title', d.title, 'owner_role', d.owner_role)
                   ORDER BY d.sort_order) FROM public.event_steps d WHERE d.event_id = s.event_id AND d.step_key = ANY(s.depends_on)
                    AND d.status NOT IN ('done','skipped','archived')), '[]'::jsonb),
    'overdue', s.status IN ('open','in_progress','problem') AND s.due_at IS NOT NULL AND s.due_at < now(),
    'can_act', p_can_act AND s.status IN ('open','in_progress','problem'),
    'can_override', p_can_override,
    'system_managed', s.step_key = ANY(private.event_step_auto_keys()),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('action', a.action, 'to_status', a.to_status, 'note', a.note,
                   'by', a.performed_by_name, 'at', a.created_at) ORDER BY a.created_at DESC)
                   FROM (SELECT x.* FROM public.event_step_activity x WHERE x.step_id = s.id ORDER BY x.created_at DESC LIMIT 5) a), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.sync_event_steps(p_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ev record; planned text[]; h record; r record; invoiced boolean; paid boolean; picked_up boolean;
  details_ok boolean; contract_ok boolean; deposit_ok boolean; wedding_ok boolean; team_ok boolean; agenda_ok boolean; transport_ok boolean;
  st record;
BEGIN
  IF p_event IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('event_steps:' || p_event::text));
  SELECT e.id, e.status::text AS status, coalesce(e.loading_confirmed, false) AS loading_ok, e.loading_confirmed_at, e.loading_confirmed_by
    INTO ev FROM public.events e WHERE e.id = p_event;
  IF ev.id IS NULL THEN RETURN; END IF;

  IF ev.status = 'cancelled' THEN
    UPDATE public.event_steps s SET status = 'archived', updated_at = now(),
           status_note = CASE WHEN s.status = 'problem' THEN 'Problem: ' || s.status_note || ' · wydarzenie anulowane.' ELSE 'Wydarzenie anulowane.' END
     WHERE s.event_id = p_event AND s.status IN ('open','in_progress','problem');
    RETURN;
  END IF;

  IF ev.status <> 'settled' THEN
    SELECT coalesce(array_agg(p.step_key), '{}') INTO planned FROM private.event_step_plan(p_event) p;

    INSERT INTO public.event_steps AS s (event_id, step_key, stage, kind, source, source_id, title, details, quantity, unit,
        supplier, owner_role, assignee_id, due_at, blocks_ready, sort_order, depends_on)
    SELECT p_event, p.step_key, p.stage, p.kind, p.source, p.source_id, p.title, p.details, p.quantity, p.unit,
           p.supplier, p.owner_role, public.event_step_assignee(p_event, p.owner_role), p.due_at, p.blocks_ready,
           p.sort_order, p.depends_on
      FROM private.event_step_plan(p_event) p
    ON CONFLICT (event_id, step_key) DO UPDATE SET
      stage = excluded.stage, kind = excluded.kind, source = excluded.source, source_id = excluded.source_id,
      title = excluded.title, details = excluded.details, quantity = excluded.quantity, unit = excluded.unit,
      supplier = coalesce(s.supplier, excluded.supplier), owner_role = excluded.owner_role,
      assignee_id = CASE WHEN s.assigned_manually AND s.owner_role = excluded.owner_role THEN s.assignee_id
                         ELSE coalesce(excluded.assignee_id, CASE WHEN s.owner_role = excluded.owner_role THEN s.assignee_id END) END,
      assigned_manually = s.assigned_manually AND s.owner_role = excluded.owner_role,
      due_at = CASE WHEN s.status IN ('done','skipped') THEN s.due_at ELSE excluded.due_at END,
      blocks_ready = excluded.blocks_ready, sort_order = excluded.sort_order, depends_on = excluded.depends_on,
      status = CASE WHEN s.status = 'archived' THEN 'open' ELSE s.status END,
      status_note = CASE WHEN s.status = 'archived' THEN NULL ELSE s.status_note END,
      updated_at = now()
    WHERE (s.stage, s.kind, s.source, s.source_id, s.title, s.details, s.quantity, s.unit, s.owner_role,
           s.due_at, s.blocks_ready, s.sort_order, s.depends_on, s.status)
          IS DISTINCT FROM
          (excluded.stage, excluded.kind, excluded.source, excluded.source_id, excluded.title, excluded.details,
           excluded.quantity, excluded.unit, excluded.owner_role,
           CASE WHEN s.status IN ('done','skipped') THEN s.due_at ELSE excluded.due_at END,
           excluded.blocks_ready, excluded.sort_order, excluded.depends_on,
           CASE WHEN s.status = 'archived' THEN 'open' ELSE s.status END)
       OR (NOT s.assigned_manually AND excluded.assignee_id IS NOT NULL AND s.assignee_id IS DISTINCT FROM excluded.assignee_id);

    -- Braki rozwiązane w rezerwacji zamykamy; pozostałe kroki spoza planu archiwizujemy.
    UPDATE public.event_steps s SET status = 'done', completed_at = now(), completed_by = NULL,
           completed_by_name = 'Rezerwacja sprzętu', status_note = 'Brak rozwiązany w rezerwacji sprzętu.', updated_at = now()
     WHERE s.event_id = p_event AND s.status IN ('open','in_progress','problem') AND s.source = 'shortage'
       AND NOT (s.step_key = ANY(planned))
       AND EXISTS (SELECT 1 FROM public.event_equipment x WHERE x.id = s.source_id AND NOT coalesce(x.removed_from_offer, false));
    UPDATE public.event_steps s SET status = 'archived', updated_at = now(),
           status_note = CASE WHEN s.status = 'problem' THEN 'Problem: ' || s.status_note || ' · poza zakresem wydarzenia.' ELSE 'Poza zakresem wydarzenia.' END
     WHERE s.event_id = p_event AND s.status IN ('open','in_progress','problem') AND s.source <> 'manual'
       AND NOT (s.step_key = ANY(planned));
  END IF;

  -- Prawda procesu → kroki systemowe. Dwukierunkowo (zamknij / otwórz ponownie) tam, gdzie proces jest źródłem prawdy.
  SELECT hh.accepted_at, hh.accepted_by, hh.accepted_by_name, hh.ready_at, hh.ready_by, hh.ready_by_name INTO h
    FROM public.event_warehouse_handoffs hh WHERE hh.event_id = p_event;
  SELECT rr.manager_id, rr.started_at, rr.started_by, rr.completed_at, rr.completed_by INTO r
    FROM public.event_realizations rr JOIN public.employees e ON e.id = rr.manager_id AND e.is_active WHERE rr.event_id = p_event;
  invoiced := EXISTS (SELECT 1 FROM public.invoices i WHERE i.event_id = p_event AND i.invoice_type IN ('vat','final','advance')
                AND i.status NOT IN ('draft','cancelled','proforma'));
  paid := ev.status = 'settled' OR (invoiced AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.event_id = p_event
                AND i.invoice_type IN ('vat','final','advance') AND i.status NOT IN ('draft','cancelled','proforma')
                AND coalesce(i.payment_status, 'unpaid') IN ('unpaid','partially_paid','overdue')));
  picked_up := EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event AND v.pickup_timestamp IS NOT NULL
                AND coalesce(v.status,'planned') <> 'cancelled');

  details_ok := EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event AND e.event_date IS NOT NULL
                  AND nullif(btrim(coalesce(e.location, '')), '') IS NOT NULL
                  AND (e.contact_person_id IS NOT NULL OR e.organization_id IS NOT NULL));
  contract_ok := EXISTS (SELECT 1 FROM public.event_partner_arrangements a WHERE a.event_id = p_event AND a.enabled AND NOT a.include_contract)
              OR EXISTS (SELECT 1 FROM public.contracts c WHERE c.event_id = p_event
                          AND c.status::text IN ('signed_by_client','signed_returned','completed'));
  deposit_ok := NOT EXISTS (SELECT 1 FROM public.event_payment_milestones m WHERE m.event_id = p_event
                  AND m.milestone_type = 'deposit' AND m.status NOT IN ('paid','waived'));
  wedding_ok := EXISTS (SELECT 1 FROM public.wedding_cards w WHERE w.event_id = p_event AND w.status IN ('submitted','approved'));
  team_ok := EXISTS (SELECT 1 FROM public.employee_assignments a WHERE a.event_id = p_event AND a.status = 'accepted')
         AND NOT EXISTS (SELECT 1 FROM public.employee_assignments a WHERE a.event_id = p_event AND coalesce(a.status, 'pending') = 'pending');
  agenda_ok := EXISTS (SELECT 1 FROM public.event_agendas g WHERE g.event_id = p_event);
  transport_ok := EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event AND coalesce(v.status, 'planned') <> 'cancelled')
              AND NOT EXISTS (SELECT 1 FROM public.event_vehicles v WHERE v.event_id = p_event AND coalesce(v.status, 'planned') <> 'cancelled'
                               AND v.driver_id IS NULL AND NOT coalesce(v.is_external, false));

  SELECT s.status, s.submitted_at, s.submitted_by, s.approved_at, s.approved_by INTO st
    FROM public.event_settlements s WHERE s.event_id = p_event;

  WITH truth(step_key, met, at, who, who_name, two_way) AS (VALUES
      ('formal_details', details_ok, NULL::timestamptz, NULL::uuid, 'Dane wydarzenia'::text, true),
      ('formal_contract', contract_ok, NULL::timestamptz, NULL::uuid, 'Umowa'::text, true),
      ('formal_deposit', deposit_ok, NULL::timestamptz, NULL::uuid, 'Płatność'::text, true),
      ('wedding_card', wedding_ok, NULL::timestamptz, NULL::uuid, 'Karta weselna'::text, true),
      ('team_ready', team_ok, NULL::timestamptz, NULL::uuid, 'Zespół'::text, true),
      ('agenda_ready', agenda_ok, NULL::timestamptz, NULL::uuid, 'Agenda'::text, true),
      ('transport_planned', transport_ok, NULL::timestamptz, NULL::uuid, 'Logistyka'::text, true),
      ('warehouse_accept', h.accepted_at IS NOT NULL, h.accepted_at, h.accepted_by, h.accepted_by_name, true),
      ('sales_handoff', h.accepted_at IS NOT NULL, h.accepted_at, NULL::uuid, 'Przyjęte przez magazyn'::text, false),
      ('warehouse_ready', h.ready_at IS NOT NULL, h.ready_at, h.ready_by, h.ready_by_name, true),
      ('manager_appointed', r.manager_id IS NOT NULL, NULL::timestamptz, NULL::uuid,
        (SELECT coalesce(nullif(concat_ws(' ', e.name, e.surname), ''), e.nickname) FROM public.employees e WHERE e.id = r.manager_id), true),
      ('dispatch_out', ev.loading_ok, ev.loading_confirmed_at, ev.loading_confirmed_by, NULL::text, true),
      ('dispatch_receive', picked_up, NULL::timestamptz, NULL::uuid, 'Odbiór auta'::text, false),
      ('realization_start', r.started_at IS NOT NULL, r.started_at, r.started_by, NULL::text, true),
      ('realization_complete', r.completed_at IS NOT NULL, r.completed_at, r.completed_by, NULL::text, true),
      ('settlement_invoice', invoiced OR ev.status = 'settled', NULL::timestamptz, NULL::uuid, 'Faktura'::text, true),
      ('settlement_paid', paid, NULL::timestamptz, NULL::uuid, 'Rozliczenie'::text, true),
      ('settlement_summary', coalesce(st.status IN ('submitted','approved'), false), st.submitted_at, st.submitted_by, NULL::text, true),
      ('settlement_summary_approval', coalesce(st.status = 'approved', false), st.approved_at, st.approved_by, NULL::text, true)
  ), changes AS (
    SELECT s.id, s.status AS old_status, t.met, t.at, t.who, t.who_name
      FROM public.event_steps s JOIN truth t ON t.step_key = s.step_key
     WHERE s.event_id = p_event AND s.status <> 'archived'
       AND ((t.met AND s.status NOT IN ('done','skipped')) OR (t.two_way AND NOT t.met AND s.status = 'done'))
  ), applied AS (
    UPDATE public.event_steps s SET
      status = CASE WHEN c.met THEN 'done' ELSE 'open' END,
      completed_at = CASE WHEN c.met THEN coalesce(c.at, now()) END,
      completed_by = CASE WHEN c.met THEN c.who END,
      completed_by_name = CASE WHEN c.met THEN coalesce(c.who_name,
        (SELECT coalesce(nullif(concat_ws(' ', e.name, e.surname), ''), e.nickname) FROM public.employees e WHERE e.id = c.who)) END,
      status_note = CASE WHEN c.met THEN s.status_note ELSE 'Cofnięto w procesie wydarzenia.' END,
      updated_at = now()
    FROM changes c WHERE s.id = c.id
    RETURNING s.id, s.event_id, c.old_status, s.status
  )
  INSERT INTO public.event_step_activity(step_id, event_id, action, from_status, to_status, performed_by_name)
  SELECT a.id, a.event_id, CASE WHEN a.status = 'done' THEN 'auto_done' ELSE 'auto_reopen' END, a.old_status, a.status, 'System'
    FROM applied a
   -- Krok zamykany właśnie przez update_event_step ma własny wpis w historii.
   WHERE a.id::text IS DISTINCT FROM nullif(current_setting('mavinci.event_step_in_action', true), '');

  -- Wydarzenie rozliczone = zamknięte: pozostałe otwarte kroki archiwizujemy.
  IF ev.status = 'settled' THEN
    UPDATE public.event_steps s SET status = 'archived', updated_at = now(),
           status_note = CASE WHEN s.status = 'problem' THEN 'Problem: ' || s.status_note || ' · wydarzenie rozliczone.' ELSE 'Wydarzenie rozliczone.' END
     WHERE s.event_id = p_event AND s.status IN ('open','in_progress','problem');
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Uprawnienia podsumowania
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.event_settlement_status(p_event_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT s.status FROM public.event_settlements s WHERE s.event_id = p_event_id), 'draft');
$$;

-- Wypełnia: sprzedawca wydarzenia (udział / prowadzący), finanse wydarzenia, administrator — w wersji roboczej.
CREATE OR REPLACE FUNCTION private.event_settlement_can_fill(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT auth.uid() IS NOT NULL AND NOT coalesce(public.current_session_is_seller_portal(), true)
    AND public.can_view_event_area(p_event_id, 'values')
    AND (public.current_employee_is_crm_admin()
      OR public.commission_settlement_can_access(p_event_id, true)
      OR EXISTS (SELECT 1 FROM public.event_sales_shares s
                  WHERE s.event_id = p_event_id AND s.employee_id = public.current_invoice_employee_id())
      OR public.current_employee_sells_event(p_event_id));
$$;

CREATE OR REPLACE FUNCTION private.event_settlement_can_edit(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT private.event_settlement_status(p_event_id) = 'draft' AND private.event_settlement_can_fill(p_event_id);
$$;

-- Zatwierdza, zwraca i otwiera ponownie: administrator.
-- Blokada stanu podsumowania przed sprawdzeniem uprawnień do zmiany (zapis pozycji nie wyprzedzi wysłania).
CREATE OR REPLACE FUNCTION private.lock_event_settlement(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN RAISE EXCEPTION 'Nie znaleziono wydarzenia.'; END IF;
  INSERT INTO public.event_settlements (event_id) VALUES (p_event_id) ON CONFLICT (event_id) DO NOTHING;
  PERFORM 1 FROM public.event_settlements WHERE event_id = p_event_id FOR UPDATE;
END $$;

CREATE OR REPLACE FUNCTION private.event_settlement_can_approve(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT auth.uid() IS NOT NULL AND public.current_employee_is_crm_admin() AND public.can_view_event_area(p_event_id, 'values');
$$;

CREATE OR REPLACE FUNCTION private.notify_settlement(p_event_id uuid, p_title text, p_message text, p_recipients uuid[], p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ev public.events%ROWTYPE; nid uuid; v_actor uuid := public.current_invoice_employee_id();
BEGIN
  SELECT * INTO ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR coalesce(array_length(p_recipients, 1), 0) = 0 THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.notifications(category, title, message, type, related_entity_type, related_entity_id, action_url, metadata)
    VALUES ('event', p_title, format('Wydarzenie „%s”: %s', ev.name, p_message), 'info', 'event', ev.id::text,
            '/crm/events/' || ev.id || '?tab=summary',
            jsonb_build_object('event_id', ev.id, 'initial_tab', 'summary', 'settlement_action', p_kind))
    RETURNING id INTO nid;
    INSERT INTO public.notification_recipients(notification_id, user_id)
    SELECT DISTINCT nid, r FROM unnest(p_recipients) r WHERE r IS NOT NULL AND r IS DISTINCT FROM v_actor;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Powiadomienie o podsumowaniu nie zostało wysłane: %', SQLERRM;
  END;
END $$;


CREATE OR REPLACE FUNCTION private.settlement_sync_steps(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  BEGIN
    PERFORM public.sync_event_steps(p_event_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Kroki wydarzenia % nie zostały odświeżone: %', p_event_id, SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 10. Odczyt podsumowania
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_event_settlement(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ctx jsonb; st public.event_settlements%ROWTYPE; v_versions jsonb; v_commissions jsonb; v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_event_area(p_event_id, 'values') THEN
    RAISE EXCEPTION 'Podsumowanie wydarzenia widzi osoba z dostępem do kwot tego wydarzenia.' USING ERRCODE = '42501';
  END IF;
  ctx := private.event_settlement_compute(p_event_id);
  IF ctx IS NULL THEN RAISE EXCEPTION 'Nie znaleziono wydarzenia.'; END IF;
  SELECT * INTO st FROM public.event_settlements WHERE event_id = p_event_id;
  v_status := coalesce(st.status, 'draft');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'revision', v.revision, 'action', v.action, 'note', v.note, 'created_at', v.created_at,
           'actor_name', nullif(btrim(concat_ws(' ', a.name, a.surname)), ''),
           'totals', v.snapshot->'totals',
           'internal', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', i->>'name', 'amount', i->'amount', 'rate', i->'rate',
                          'share_percent', i->'share_percent')), '[]'::jsonb) FROM jsonb_array_elements(v.snapshot->'internal') i),
           'external', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', x->>'name', 'amount', x->'amount', 'rate', x->'rate')), '[]'::jsonb)
                          FROM jsonb_array_elements(v.snapshot->'external') x WHERE (x->>'eligible')::boolean))
           ORDER BY v.created_at DESC), '[]'::jsonb)
    INTO v_versions
    FROM public.event_settlement_versions v LEFT JOIN public.employees a ON a.id = v.actor_id
   WHERE v.event_id = p_event_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'beneficiary_name', c.beneficiary_name, 'beneficiary_type', c.beneficiary_type,
           'employee_id', c.employee_id, 'sales_partner_id', c.sales_partner_id, 'entry_kind', c.entry_kind,
           'corrects_commission_id', c.corrects_commission_id, 'automatic_source', c.automatic_source,
           'status', c.status, 'amount', c.amount, 'base_amount', c.base_amount, 'rate', c.rate,
           'company_cost_amount', c.company_cost_amount, 'payment_method', c.payment_method,
           'base_description', c.base_description, 'rate_reason', c.rate_reason, 'settlement_revision', c.settlement_revision,
           'cancel_reason', c.cancel_reason,
           'paid_amount', coalesce((SELECT sum(p.amount) FROM public.event_commission_payouts p WHERE p.commission_id = c.id AND NOT p.is_offset), 0),
           'offset_amount', coalesce((SELECT sum(p.amount) FROM public.event_commission_payouts p WHERE p.commission_id = c.id AND p.is_offset), 0),
           'manual', c.automatic_source IS NULL OR NOT (c.automatic_source = ANY (private.commission_auto_sources())))
           ORDER BY c.entry_kind, c.created_at), '[]'::jsonb)
    INTO v_commissions
    FROM public.event_commissions c
   WHERE c.event_id = p_event_id AND (c.status <> 'cancelled' OR NOT c.auto_cancelled);

  RETURN ctx || jsonb_build_object(
    'status', v_status,
    'revision', coalesce(st.revision, 0),
    'stale', v_status = 'approved' AND st.approved_source_key IS DISTINCT FROM ctx->>'source_key',
    'submitted_stale', v_status = 'submitted' AND st.submitted_source_key IS DISTINCT FROM ctx->>'source_key',
    'submitted', CASE WHEN st.submitted_at IS NOT NULL THEN jsonb_build_object('at', st.submitted_at, 'note', st.submitted_note,
                   'by_name', (SELECT nullif(btrim(concat_ws(' ', x.name, x.surname)), '') FROM public.employees x WHERE x.id = st.submitted_by)) END,
    'approved', CASE WHEN st.approved_at IS NOT NULL THEN jsonb_build_object('at', st.approved_at,
                   'by_name', (SELECT nullif(btrim(concat_ws(' ', x.name, x.surname)), '') FROM public.employees x WHERE x.id = st.approved_by)) END,
    'returned', CASE WHEN st.returned_at IS NOT NULL AND v_status = 'draft' THEN jsonb_build_object('at', st.returned_at, 'note', st.returned_note,
                   'by_name', (SELECT nullif(btrim(concat_ws(' ', x.name, x.surname)), '') FROM public.employees x WHERE x.id = st.returned_by)) END,
    'can_edit', private.event_settlement_can_edit(p_event_id),
    'can_submit', private.event_settlement_can_edit(p_event_id) AND jsonb_array_length(ctx->'issues') = 0,
    'can_approve', v_status = 'submitted' AND private.event_settlement_can_approve(p_event_id)
                   AND jsonb_array_length(ctx->'issues') = 0 AND st.submitted_source_key IS NOT DISTINCT FROM ctx->>'source_key',
    'can_return', v_status = 'submitted' AND private.event_settlement_can_approve(p_event_id),
    'can_reopen', v_status = 'approved' AND private.event_settlement_can_approve(p_event_id),
    'can_edit_shares', v_status <> 'approved' AND private.event_settlement_can_approve(p_event_id),
    'versions', v_versions,
    'commissions', v_commissions);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 11. Edycja pozycji
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_event_settlement_line(p_event_id uuid, p_line jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_type text := p_line->>'source_type'; v_source uuid; v_line uuid; a record; ov public.event_settlement_lines%ROWTYPE;
  v_kind text; v_category text; v_name text; v_net numeric; v_note text; v_included boolean; v_confirmed boolean;
  v_actor uuid := public.current_invoice_employee_id();
BEGIN
  IF NOT private.event_settlement_can_fill(p_event_id) THEN
    RAISE EXCEPTION 'Podsumowanie zmienia osoba sprzedająca wydarzenie, finanse lub administrator.' USING ERRCODE = '42501';
  END IF;
  PERFORM private.lock_event_settlement(p_event_id);
  IF NOT private.event_settlement_can_edit(p_event_id) THEN
    RAISE EXCEPTION 'Podsumowanie można zmieniać w wersji roboczej — zostało już wysłane albo zatwierdzone.' USING ERRCODE = '42501';
  END IF;
  v_note := nullif(btrim(p_line->>'note'), '');
  IF length(v_note) > 2000 THEN RAISE EXCEPTION 'Notatka może mieć najwyżej 2000 znaków.'; END IF;
  IF p_line ? 'net_amount' AND p_line->>'net_amount' IS NOT NULL THEN
    BEGIN v_net := (p_line->>'net_amount')::numeric; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Nieprawidłowa kwota netto.'; END;
    IF v_net::text IN ('NaN', 'Infinity', '-Infinity') OR abs(v_net) >= 1000000000 OR v_net <> round(v_net, 2) THEN
      RAISE EXCEPTION 'Podaj kwotę netto z dokładnością do grosza.';
    END IF;
    IF v_net < 0 THEN
      RAISE EXCEPTION 'Kwota netto nie może być ujemna. Korektę przychodu wystawia się fakturą korygującą.';
    END IF;
  END IF;

  IF v_type = 'manual' THEN
    v_kind := p_line->>'kind';
    v_category := CASE WHEN v_kind = 'revenue' THEN 'revenue' ELSE p_line->>'category' END;
    v_name := nullif(btrim(p_line->>'name'), '');
    v_included := coalesce((p_line->>'included')::boolean, true);
    IF v_kind NOT IN ('revenue', 'cost') OR v_kind IS NULL THEN RAISE EXCEPTION 'Wybierz przychód albo koszt.'; END IF;
    IF v_kind = 'cost' AND (v_category IS NULL OR v_category NOT IN ('subcontractor', 'direct_cost', 'team', 'external_commission')) THEN
      RAISE EXCEPTION 'Wybierz rodzaj kosztu.';
    END IF;
    IF v_name IS NULL OR length(v_name) > 300 THEN RAISE EXCEPTION 'Podaj nazwę pozycji (do 300 znaków).'; END IF;
    IF v_net IS NULL THEN RAISE EXCEPTION 'Podaj kwotę netto.'; END IF;
    IF nullif(p_line->>'line_id', '') IS NOT NULL THEN
      UPDATE public.event_settlement_lines SET kind = v_kind, category = v_category, name = v_name, net_amount = v_net,
             included = v_included, confirmed = true, note = v_note, updated_by = v_actor, updated_at = now()
       WHERE id = (p_line->>'line_id')::uuid AND event_id = p_event_id AND source_type = 'manual';
      IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pozycji.'; END IF;
    ELSE
      INSERT INTO public.event_settlement_lines (event_id, source_type, source_id, kind, category, name, net_amount, included,
        confirmed, note, created_by, updated_by)
      VALUES (p_event_id, 'manual', NULL, v_kind, v_category, v_name, v_net, v_included, true, v_note, v_actor, v_actor);
    END IF;
  ELSE
    BEGIN v_source := (p_line->>'source_id')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Nieprawidłowa pozycja.'; END;
    SELECT * INTO a FROM private.event_settlement_auto_lines(p_event_id) x WHERE x.source_type = v_type AND x.source_id = v_source;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ta pozycja nie należy już do wydarzenia. Odśwież podsumowanie.'; END IF;
    SELECT * INTO ov FROM public.event_settlement_lines l
     WHERE l.event_id = p_event_id AND l.source_type = v_type AND l.source_id = v_source FOR UPDATE;

    v_included := CASE WHEN p_line ? 'included' THEN (p_line->>'included')::boolean ELSE ov.included END;
    v_category := ov.category; v_confirmed := coalesce(ov.confirmed, false);
    IF p_line ? 'category' THEN
      IF v_type NOT IN ('event_cost', 'subcontractor_task') OR p_line->>'category' NOT IN ('subcontractor', 'direct_cost') THEN
        RAISE EXCEPTION 'Rodzaj można zmienić tylko dla kosztu: wykonawca zewnętrzny albo koszt bezpośredni.';
      END IF;
      v_category := CASE WHEN p_line->>'category' = a.category THEN NULL ELSE p_line->>'category' END;
    END IF;
    IF p_line ? 'net_amount' THEN
      IF v_type NOT IN ('event_cost', 'subcontractor_task', 'team', 'cash', 'forecast') THEN
        RAISE EXCEPTION 'Kwoty tej pozycji nie zmienia się w podsumowaniu (pochodzi z dokumentu). Możesz ją wyłączyć z uzasadnieniem.';
      END IF;
      v_net := CASE WHEN v_net IS NULL OR v_net = a.suggested_net THEN NULL ELSE v_net END;
      IF p_line->>'net_amount' IS NOT NULL THEN v_confirmed := true; END IF;
    ELSE
      -- Korekta kwoty z innym stanem źródła już nie obowiązuje (trzeba ją wpisać ponownie).
      v_net := CASE WHEN ov.source_net IS NOT DISTINCT FROM a.suggested_net THEN ov.net_amount END;
      IF ov.source_net IS DISTINCT FROM a.suggested_net AND NOT (p_line ? 'confirmed') THEN v_confirmed := false; END IF;
    END IF;
    IF p_line ? 'confirmed' THEN
      IF NOT a.needs_confirmation THEN v_confirmed := false;
      ELSE v_confirmed := coalesce((p_line->>'confirmed')::boolean, false); END IF;
    END IF;
    IF NOT (p_line ? 'note') THEN v_note := ov.note; END IF;
    IF v_included IS NOT NULL AND v_included = a.auto_included THEN v_included := NULL; END IF;
    -- Zaliczka rozliczona w fakturze końcowej jest już w jej pełnej wartości — liczenie jej drugi raz zawyżyłoby przychód.
    IF v_included AND v_type = 'invoice' AND NOT a.auto_included AND a.auto_note LIKE 'Rozliczona w fakturze końcowej%' THEN
      RAISE EXCEPTION 'Ta zaliczka jest rozliczona w fakturze końcowej (pełna wartość) — nie można jej liczyć drugi raz.';
    END IF;
    -- Wyłączenie pozycji wliczanej automatycznie, włączenie pozycji wyłączonej automatycznie i zmiana rodzaju kosztu
    -- zmieniają prowizje — zawsze z powodem.
    IF v_included IS NOT NULL AND v_included = false AND a.auto_included AND v_note IS NULL THEN
      RAISE EXCEPTION 'Podaj powód wyłączenia tej pozycji z podsumowania.';
    END IF;
    IF v_included AND NOT a.auto_included AND v_note IS NULL THEN
      RAISE EXCEPTION 'Podaj powód włączenia tej pozycji (system ją pominął: %).', coalesce(rtrim(a.auto_note, '.'), 'pozycja wyłączona automatycznie');
    END IF;
    -- Kwota niższa niż w źródle przy koszcie (albo wyższa przy przychodzie) podnosi zysk i prowizję — z powodem.
    -- Przy pozycji do potwierdzenia netto (kwota wpisana brutto) dopuszczamy przeliczenie do netto (VAT do 23%).
    IF v_net IS NOT NULL AND v_note IS NULL AND a.suggested_net IS NOT NULL AND (
         (a.kind = 'cost' AND v_net < CASE WHEN a.needs_confirmation THEN trunc(a.suggested_net / 1.23, 2) - 0.05 ELSE a.suggested_net END)
      OR (a.kind = 'revenue' AND v_net > a.suggested_net)) THEN
      RAISE EXCEPTION 'Podaj powód zmiany kwoty: % zł zamiast % zł z danych źródłowych (zmienia podstawę prowizji).',
        private.pl_money(v_net), private.pl_money(a.suggested_net);
    END IF;
    IF v_category IS DISTINCT FROM ov.category AND v_category IS NOT NULL AND v_note IS NULL THEN
      RAISE EXCEPTION 'Podaj powód zmiany rodzaju kosztu (zmienia podstawę prowizji).';
    END IF;
    IF NOT a.needs_confirmation THEN v_confirmed := false; END IF;

    IF v_included IS NULL AND v_category IS NULL AND v_net IS NULL AND NOT v_confirmed AND v_note IS NULL THEN
      DELETE FROM public.event_settlement_lines WHERE id = ov.id;
    ELSIF ov.id IS NOT NULL THEN
      UPDATE public.event_settlement_lines SET included = v_included, category = v_category, net_amount = v_net,
             confirmed = v_confirmed, note = v_note, kind = a.kind, source_net = a.suggested_net,
             updated_by = v_actor, updated_at = now()
       WHERE id = ov.id;
    ELSE
      INSERT INTO public.event_settlement_lines (event_id, source_type, source_id, kind, category, net_amount, source_net,
        included, confirmed, note, created_by, updated_by)
      VALUES (p_event_id, v_type, v_source, a.kind, v_category, v_net, a.suggested_net, v_included, v_confirmed, v_note,
        v_actor, v_actor);
    END IF;
  END IF;

  PERFORM private.refresh_event_commissions(p_event_id);
  RETURN public.get_event_settlement(p_event_id);
END $$;

CREATE OR REPLACE FUNCTION public.delete_event_settlement_line(p_line_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE l public.event_settlement_lines%ROWTYPE;
BEGIN
  SELECT * INTO l FROM public.event_settlement_lines WHERE id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pozycji.'; END IF;
  IF NOT private.event_settlement_can_fill(l.event_id) THEN
    RAISE EXCEPTION 'Brak dostępu do podsumowania tego wydarzenia.' USING ERRCODE = '42501';
  END IF;
  PERFORM private.lock_event_settlement(l.event_id);
  IF NOT private.event_settlement_can_edit(l.event_id) THEN
    RAISE EXCEPTION 'Podsumowanie można zmieniać w wersji roboczej.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.event_settlement_lines WHERE id = p_line_id;
  PERFORM private.refresh_event_commissions(l.event_id);
  RETURN public.get_event_settlement(l.event_id);
END $$;

-- Faktury kosztowe (KSeF i spoza KSeF) do przypisania: najbliżej daty wydarzenia, jeszcze nie w pełni przypisane.
CREATE OR REPLACE FUNCTION public.list_event_cost_invoice_candidates(p_event_id uuid, p_search text DEFAULT NULL, p_limit integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE e public.events%ROWTYPE; v_q text := nullif(btrim(p_search), ''); v_rows jsonb;
BEGIN
  -- Rejestr faktur kosztowych marki widzi tylko osoba z dostępem do finansów (sprzedawca nie przegląda zakupów firmy).
  IF NOT private.event_settlement_can_fill(p_event_id) OR NOT public.event_finance_can_access(p_event_id, false) THEN
    RAISE EXCEPTION 'Faktury kosztowe przypisuje osoba z dostępem do finansów tego wydarzenia.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  WITH cand AS (
    SELECT 'ksef'::text AS source, k.id, k.invoice_number AS number, k.seller_name, k.seller_nip,
           coalesce(k.issue_date, k.ksef_issued_at::date) AS issue_date, k.net_amount AS net, k.gross_amount AS gross,
           coalesce(k.invoice_items->0->>'name', '') AS first_item,
           coalesce((SELECT sum(ec.amount) FROM public.event_costs ec WHERE ec.ksef_invoice_id = k.id), 0) AS allocated
      FROM public.ksef_invoices k
     WHERE k.invoice_type::text = 'received' AND (e.my_company_id IS NULL OR k.my_company_id = e.my_company_id)
       AND coalesce(k.gross_amount, 0) > 0
    UNION ALL
    SELECT 'external', x.id, x.invoice_number, x.seller_name, x.seller_nip, x.invoice_date, x.amount_net,
           coalesce(x.amount_gross, x.amount_net), coalesce(x.label, ''),
           coalesce((SELECT sum(ec.amount) FROM public.event_costs ec WHERE ec.external_invoice_id = x.id), 0)
      FROM public.external_invoices x
     WHERE x.payment_status <> 'cancelled' AND (e.my_company_id IS NULL OR x.my_company_id IS NULL OR x.my_company_id = e.my_company_id)
       AND coalesce(x.amount_gross, x.amount_net, 0) > 0
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('source', c.source, 'id', c.id, 'number', c.number, 'seller_name', c.seller_name,
           'seller_nip', c.seller_nip, 'issue_date', c.issue_date, 'net', c.net, 'gross', c.gross, 'first_item', nullif(c.first_item, ''),
           'allocated', c.allocated, 'remaining_gross', round(c.gross - c.allocated, 2),
           'linked_to_event', EXISTS (SELECT 1 FROM public.event_costs ec WHERE ec.event_id = p_event_id
                                        AND (ec.ksef_invoice_id = c.id OR ec.external_invoice_id = c.id)))
           ORDER BY abs(coalesce(c.issue_date, CURRENT_DATE) - coalesce(e.event_date::date, CURRENT_DATE)), c.issue_date DESC), '[]'::jsonb)
    INTO v_rows
    FROM (SELECT * FROM cand c
           WHERE c.gross - c.allocated > 0.009
             AND (v_q IS NULL OR c.number ILIKE '%' || v_q || '%' OR c.seller_name ILIKE '%' || v_q || '%'
                  OR c.seller_nip ILIKE '%' || v_q || '%' OR c.first_item ILIKE '%' || v_q || '%')
           ORDER BY abs(coalesce(c.issue_date, CURRENT_DATE) - coalesce(e.event_date::date, CURRENT_DATE)), c.issue_date DESC
           LIMIT least(greatest(coalesce(p_limit, 30), 1), 100)) c;
  RETURN v_rows;
END $$;

-- Przypisanie faktury kosztowej do wydarzenia: powstaje koszt wydarzenia powiązany z fakturą (netto z faktury).
CREATE OR REPLACE FUNCTION public.link_event_cost_invoice(p_event_id uuid, p_source text, p_invoice_id uuid,
  p_gross_amount numeric DEFAULT NULL, p_category text DEFAULT 'direct_cost', p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  e public.events%ROWTYPE; v_gross numeric; v_allocated numeric; v_amount numeric; v_name text; v_date date;
  v_cost uuid; v_actor uuid := public.current_invoice_employee_id(); k public.ksef_invoices%ROWTYPE; x public.external_invoices%ROWTYPE;
BEGIN
  IF NOT private.event_settlement_can_fill(p_event_id) OR NOT public.event_finance_can_access(p_event_id, false) THEN
    RAISE EXCEPTION 'Faktury kosztowe przypisuje osoba z dostępem do finansów tego wydarzenia.' USING ERRCODE = '42501';
  END IF;
  PERFORM private.lock_event_settlement(p_event_id);
  IF NOT private.event_settlement_can_edit(p_event_id) THEN
    RAISE EXCEPTION 'Podsumowanie można zmieniać w wersji roboczej.' USING ERRCODE = '42501';
  END IF;
  IF p_category NOT IN ('subcontractor', 'direct_cost') THEN RAISE EXCEPTION 'Wybierz: wykonawca zewnętrzny albo koszt bezpośredni.'; END IF;
  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('cost-invoice:' || p_invoice_id::text, 0));
  IF p_source = 'ksef' THEN
    SELECT * INTO k FROM public.ksef_invoices WHERE id = p_invoice_id AND invoice_type::text = 'received';
    IF NOT FOUND OR (e.my_company_id IS NOT NULL AND k.my_company_id IS DISTINCT FROM e.my_company_id) THEN
      RAISE EXCEPTION 'Nie znaleziono faktury kosztowej tej marki.';
    END IF;
    v_gross := k.gross_amount; v_date := coalesce(k.issue_date, k.ksef_issued_at::date);
    v_name := coalesce(nullif(btrim(p_name), ''), concat_ws(' — ', nullif(btrim(k.seller_name), ''), nullif(btrim(k.invoice_items->0->>'name'), ''), k.invoice_number));
    SELECT coalesce(sum(ec.amount), 0) INTO v_allocated FROM public.event_costs ec WHERE ec.ksef_invoice_id = k.id;
  ELSIF p_source = 'external' THEN
    SELECT * INTO x FROM public.external_invoices WHERE id = p_invoice_id AND payment_status <> 'cancelled';
    IF NOT FOUND OR (e.my_company_id IS NOT NULL AND x.my_company_id IS NOT NULL AND x.my_company_id <> e.my_company_id) THEN
      RAISE EXCEPTION 'Nie znaleziono faktury kosztowej tej marki.';
    END IF;
    v_gross := coalesce(x.amount_gross, x.amount_net); v_date := x.invoice_date;
    v_name := coalesce(nullif(btrim(p_name), ''), concat_ws(' — ', nullif(btrim(x.seller_name), ''), nullif(btrim(x.label), ''), x.invoice_number));
    SELECT coalesce(sum(ec.amount), 0) INTO v_allocated FROM public.event_costs ec WHERE ec.external_invoice_id = x.id;
  ELSE
    RAISE EXCEPTION 'Nieznane źródło faktury.';
  END IF;
  IF coalesce(v_gross, 0) <= 0 THEN RAISE EXCEPTION 'Faktura nie ma kwoty brutto.'; END IF;
  v_amount := round(coalesce(p_gross_amount, v_gross - v_allocated), 2);
  IF v_amount <= 0 OR v_allocated + v_amount > v_gross + 0.009 THEN
    RAISE EXCEPTION 'Faktura jest już przypisana do wydarzeń na % zł z % zł brutto. Podaj mniejszą część.',
      private.pl_money(v_allocated), private.pl_money(v_gross);
  END IF;
  INSERT INTO public.event_costs (event_id, name, description, amount, currency, cost_date, status, ksef_invoice_id,
    external_invoice_id, my_company_id, created_by, notes)
  VALUES (p_event_id, left(coalesce(v_name, 'Faktura kosztowa'), 300),
    CASE WHEN v_amount < v_gross THEN format('Część faktury: %s zł z %s zł brutto', private.pl_money(v_amount), private.pl_money(v_gross)) END,
    v_amount, 'PLN', coalesce(v_date, CURRENT_DATE), 'approved',
    CASE WHEN p_source = 'ksef' THEN p_invoice_id END, CASE WHEN p_source = 'external' THEN p_invoice_id END,
    e.my_company_id, v_actor, 'Przypisano w podsumowaniu wydarzenia')
  RETURNING id INTO v_cost;
  IF p_category = 'subcontractor' THEN
    INSERT INTO public.event_settlement_lines (event_id, source_type, source_id, kind, category, created_by, updated_by)
    VALUES (p_event_id, 'event_cost', v_cost, 'cost', 'subcontractor', v_actor, v_actor)
    ON CONFLICT (event_id, source_type, source_id) WHERE source_id IS NOT NULL DO UPDATE SET category = 'subcontractor';
  END IF;
  PERFORM private.refresh_event_commissions(p_event_id);
  RETURN public.get_event_settlement(p_event_id);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 12. Obieg: wysłanie → zatwierdzenie / zwrot → ponowne otwarcie
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_event_settlement(p_event_id uuid, p_note text DEFAULT NULL, p_expected_source_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ctx jsonb; st public.event_settlements%ROWTYPE; v_actor uuid := public.current_invoice_employee_id(); v_admins uuid[];
BEGIN
  IF NOT private.event_settlement_can_fill(p_event_id) THEN
    RAISE EXCEPTION 'Podsumowanie wysyła osoba sprzedająca wydarzenie, finanse lub administrator.' USING ERRCODE = '42501';
  END IF;
  IF length(p_note) > 2000 THEN RAISE EXCEPTION 'Notatka może mieć najwyżej 2000 znaków.'; END IF;
  PERFORM private.lock_event_settlement(p_event_id);
  SELECT * INTO st FROM public.event_settlements WHERE event_id = p_event_id FOR UPDATE;
  IF st.status <> 'draft' THEN RAISE EXCEPTION 'Podsumowanie zostało już wysłane.'; END IF;
  PERFORM private.refresh_event_commissions(p_event_id);
  ctx := private.event_settlement_compute(p_event_id);
  IF p_expected_source_key IS NOT NULL AND p_expected_source_key IS DISTINCT FROM ctx->>'source_key' THEN
    RAISE EXCEPTION 'Dane wydarzenia zmieniły się w międzyczasie. Odśwież podsumowanie i sprawdź kwoty.';
  END IF;
  IF jsonb_array_length(ctx->'issues') > 0 THEN RAISE EXCEPTION '%', ctx->'issues'->>0; END IF;
  INSERT INTO public.event_settlement_versions (event_id, revision, action, snapshot, source_key, note, actor_id)
  VALUES (p_event_id, st.revision, 'submitted', ctx, ctx->>'source_key', nullif(btrim(p_note), ''), v_actor);
  UPDATE public.event_settlements SET status = 'submitted', submitted_by = v_actor, submitted_at = now(),
         submitted_note = nullif(btrim(p_note), ''), submitted_source_key = ctx->>'source_key',
         returned_by = NULL, returned_at = NULL, returned_note = NULL, updated_at = now()
   WHERE event_id = p_event_id;
  SELECT array_agg(e.id) INTO v_admins FROM public.employees e
   WHERE e.is_active AND (e.role::text = 'admin' OR e.access_level::text = 'admin');
  PERFORM private.notify_settlement(p_event_id, 'Podsumowanie do zatwierdzenia',
    format('podsumowanie czeka na zatwierdzenie (zysk netto %s zł).', private.pl_money((ctx#>>'{totals,profit_net}')::numeric)),
    v_admins, 'submitted');
  PERFORM private.settlement_sync_steps(p_event_id);
  RETURN public.get_event_settlement(p_event_id);
END $$;

CREATE OR REPLACE FUNCTION public.return_event_settlement(p_event_id uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st public.event_settlements%ROWTYPE; v_actor uuid := public.current_invoice_employee_id();
BEGIN
  IF NOT private.event_settlement_can_approve(p_event_id) THEN
    RAISE EXCEPTION 'Podsumowanie zwraca administrator.' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_note), '') IS NULL OR length(p_note) > 2000 THEN RAISE EXCEPTION 'Napisz, co trzeba poprawić.'; END IF;
  -- Kolejność blokad jak przy zapisie pozycji: najpierw stan podsumowania, potem blokady silnika.
  PERFORM private.lock_event_settlement(p_event_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('event-settlement:' || p_event_id::text, 0));
  SELECT * INTO st FROM public.event_settlements WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND OR st.status <> 'submitted' THEN RAISE EXCEPTION 'Podsumowanie nie czeka na zatwierdzenie.'; END IF;
  INSERT INTO public.event_settlement_versions (event_id, revision, action, snapshot, source_key, note, actor_id)
  VALUES (p_event_id, st.revision, 'returned', private.event_settlement_compute(p_event_id), st.submitted_source_key, btrim(p_note), v_actor);
  UPDATE public.event_settlements SET status = 'draft', returned_by = v_actor, returned_at = now(), returned_note = btrim(p_note), updated_at = now()
   WHERE event_id = p_event_id;
  PERFORM private.notify_settlement(p_event_id, 'Podsumowanie do poprawy', format('podsumowanie wróciło do poprawy: %s', btrim(p_note)),
    ARRAY[st.submitted_by], 'returned');
  PERFORM private.settlement_sync_steps(p_event_id);
  RETURN public.get_event_settlement(p_event_id);
END $$;

CREATE OR REPLACE FUNCTION public.approve_event_settlement(p_event_id uuid, p_expected_source_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ctx jsonb; st public.event_settlements%ROWTYPE; v_actor uuid := public.current_invoice_employee_id();
  v_rev integer; v_applied jsonb; v_recipients uuid[];
BEGIN
  IF NOT private.event_settlement_can_approve(p_event_id) THEN
    RAISE EXCEPTION 'Podsumowanie zatwierdza administrator.' USING ERRCODE = '42501';
  END IF;
  PERFORM private.lock_event_settlement(p_event_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('event-settlement:' || p_event_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-commission:' || p_event_id::text, 0));
  SELECT * INTO st FROM public.event_settlements WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND OR st.status <> 'submitted' THEN RAISE EXCEPTION 'Podsumowanie nie czeka na zatwierdzenie.'; END IF;
  ctx := private.event_settlement_compute(p_event_id);
  IF ctx->>'source_key' IS DISTINCT FROM st.submitted_source_key THEN
    RAISE EXCEPTION 'Dane wydarzenia zmieniły się po wysłaniu podsumowania. Zwróć je do poprawy, aby sprzedawca sprawdził nowe kwoty.';
  END IF;
  IF p_expected_source_key IS DISTINCT FROM ctx->>'source_key' THEN
    RAISE EXCEPTION 'Podsumowanie zmieniło się od chwili otwarcia. Odśwież je przed zatwierdzeniem.';
  END IF;
  IF jsonb_array_length(ctx->'issues') > 0 THEN RAISE EXCEPTION '%', ctx->'issues'->>0; END IF;
  v_rev := st.revision + 1;
  v_applied := private.apply_settlement_commissions(p_event_id, ctx, v_rev);
  INSERT INTO public.event_settlement_versions (event_id, revision, action, snapshot, source_key, note, actor_id)
  VALUES (p_event_id, v_rev, 'approved', ctx || jsonb_build_object('applied', v_applied), ctx->>'source_key', NULL, v_actor);
  UPDATE public.event_settlements SET status = 'approved', revision = v_rev, approved_by = v_actor, approved_at = now(),
         approved_source_key = ctx->>'source_key', refresh_rates = false, updated_at = now()
   WHERE event_id = p_event_id;
  SELECT array_agg(DISTINCT r) INTO v_recipients FROM (
    SELECT st.submitted_by AS r UNION ALL SELECT sh.employee_id FROM public.event_sales_shares sh WHERE sh.event_id = p_event_id) x;
  PERFORM private.notify_settlement(p_event_id, 'Podsumowanie zatwierdzone',
    'podsumowanie jest zatwierdzone — prowizje są do wypłaty.', v_recipients, 'approved');
  PERFORM private.settlement_sync_steps(p_event_id);
  RETURN public.get_event_settlement(p_event_id);
END $$;

DROP FUNCTION IF EXISTS public.reopen_event_settlement(uuid, text);
-- p_refresh_rates: przy ponownym zatwierdzeniu stawki i sposób wypłaty z aktualnych warunków (np. korekta błędnej stawki),
-- zamiast zachowania ich z poprzedniego zatwierdzenia.
CREATE OR REPLACE FUNCTION public.reopen_event_settlement(p_event_id uuid, p_reason text, p_refresh_rates boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st public.event_settlements%ROWTYPE; v_actor uuid := public.current_invoice_employee_id();
BEGIN
  IF NOT private.event_settlement_can_approve(p_event_id) THEN
    RAISE EXCEPTION 'Zatwierdzone podsumowanie otwiera ponownie administrator.' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL OR length(p_reason) > 2000 THEN RAISE EXCEPTION 'Podaj powód ponownego otwarcia.'; END IF;
  PERFORM private.lock_event_settlement(p_event_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('event-settlement:' || p_event_id::text, 0));
  SELECT * INTO st FROM public.event_settlements WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND OR st.status <> 'approved' THEN RAISE EXCEPTION 'Podsumowanie nie jest zatwierdzone.'; END IF;
  INSERT INTO public.event_settlement_versions (event_id, revision, action, snapshot, source_key, note, actor_id)
  VALUES (p_event_id, st.revision, 'reopened', private.event_settlement_compute(p_event_id), st.approved_source_key,
          btrim(p_reason) || CASE WHEN coalesce(p_refresh_rates, false) THEN ' (przeliczenie stawek według aktualnych warunków)' ELSE '' END,
          v_actor);
  UPDATE public.event_settlements SET status = 'draft', submitted_source_key = NULL,
         refresh_rates = coalesce(p_refresh_rates, false), updated_at = now()
   WHERE event_id = p_event_id;
  PERFORM private.refresh_event_commissions(p_event_id);
  PERFORM private.settlement_sync_steps(p_event_id);
  RETURN public.get_event_settlement(p_event_id);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 13. Sprzedawca wydarzenia i stawki (administrator)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_event_sales_shares(p_event_id uuid, p_shares jsonb, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_before jsonb; v_after jsonb; v_sum numeric; v_count integer; v_actor uuid := public.current_invoice_employee_id();
  v_owner uuid; v_label text; r jsonb;
BEGIN
  IF NOT private.event_settlement_can_approve(p_event_id) THEN
    RAISE EXCEPTION 'Sprzedawcę wydarzenia zmienia administrator.' USING ERRCODE = '42501';
  END IF;
  IF private.event_settlement_status(p_event_id) = 'approved' THEN
    RAISE EXCEPTION 'Podsumowanie jest zatwierdzone. Otwórz je ponownie, aby zmienić sprzedawcę.';
  END IF;
  IF jsonb_typeof(p_shares) <> 'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista sprzedawców.'; END IF;
  PERFORM private.lock_event_settlement(p_event_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('event-settlement:' || p_event_id::text, 0));
  SELECT count(*), coalesce(sum(round((x->>'share_percent')::numeric, 2)), 0) INTO v_count, v_sum FROM jsonb_array_elements(p_shares) x;
  IF v_count > 0 AND round(v_sum, 2) <> 100 THEN RAISE EXCEPTION 'Udziały muszą dawać razem 100%%.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_shares) x
              WHERE NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = (x->>'employee_id')::uuid)
                 OR coalesce((x->>'share_percent')::numeric, 0) <= 0 OR (x->>'share_percent')::numeric > 100) THEN
    RAISE EXCEPTION 'Wybierz pracowników i udziały większe od zera.';
  END IF;
  IF (SELECT count(DISTINCT x->>'employee_id') FROM jsonb_array_elements(p_shares) x) <> v_count THEN
    RAISE EXCEPTION 'Każdy pracownik może wystąpić raz.';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.employee_id), '[]'::jsonb) INTO v_before FROM public.event_sales_shares s WHERE s.event_id = p_event_id;
  SELECT x.owner_id, x.client_label INTO v_owner, v_label FROM private.event_client_owner(p_event_id) x;
  DELETE FROM public.event_sales_shares WHERE event_id = p_event_id
     AND employee_id NOT IN (SELECT (x->>'employee_id')::uuid FROM jsonb_array_elements(p_shares) x);
  FOR r IN SELECT * FROM jsonb_array_elements(p_shares) LOOP
    INSERT INTO public.event_sales_shares (event_id, employee_id, share_percent, source, client_owned, client_label,
      client_checked_at, client_check_basis, created_by)
    VALUES (p_event_id, (r->>'employee_id')::uuid, round((r->>'share_percent')::numeric, 2), 'manual',
      coalesce((r->>'client_owned')::boolean, v_owner = (r->>'employee_id')::uuid, false), v_label, now(),
      CASE WHEN r ? 'client_owned' THEN 'manual' ELSE 'offer_acceptance' END, v_actor)
    ON CONFLICT (event_id, employee_id) DO UPDATE SET share_percent = excluded.share_percent,
      client_owned = CASE WHEN r ? 'client_owned' THEN excluded.client_owned ELSE event_sales_shares.client_owned END,
      client_check_basis = CASE WHEN r ? 'client_owned' THEN 'manual' ELSE event_sales_shares.client_check_basis END,
      updated_at = now();
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.employee_id), '[]'::jsonb) INTO v_after FROM public.event_sales_shares s WHERE s.event_id = p_event_id;
  INSERT INTO public.event_sales_share_audit (event_id, before_values, after_values, reason, actor_id)
  VALUES (p_event_id, v_before, v_after, nullif(btrim(p_reason), ''), v_actor);
  -- Pusta lista = świadomie bez sprzedawcy (nie przywracamy go automatycznie).
  UPDATE public.event_settlements SET no_sales_share = (v_count = 0), updated_at = now() WHERE event_id = p_event_id;
  PERFORM private.refresh_event_commissions(p_event_id);
  RETURN public.get_event_settlement(p_event_id);
END $$;

CREATE OR REPLACE FUNCTION public.get_sales_commission_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE s public.compensation_settings%ROWTYPE; v_rows jsonb;
BEGIN
  IF NOT (public.current_employee_is_crm_admin() OR public.commission_settlement_can_access(NULL, true)) THEN
    RAISE EXCEPTION 'Ustawienia prowizji widzi administrator.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.compensation_settings WHERE id = 1;
  SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id', e.id,
           'name', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''), 'is_active', e.is_active, 'role', e.role,
           'enabled', coalesce(t.enabled, false), 'standard_rate', t.standard_rate, 'own_client_rate', t.own_client_rate,
           'payment_method', coalesce(t.payment_method, 'payroll'), 'updated_at', t.updated_at)
           ORDER BY coalesce(t.enabled, false) DESC, e.is_active DESC, e.surname, e.name), '[]'::jsonb)
    INTO v_rows
    FROM public.employees e LEFT JOIN public.employee_sales_commission_terms t ON t.employee_id = e.id
   WHERE e.is_active OR t.employee_id IS NOT NULL;
  RETURN jsonb_build_object('standard_rate', coalesce(s.sales_commission_standard_rate, 5),
    'own_client_rate', coalesce(s.sales_commission_own_client_rate, 10),
    'employer_social_rate', s.employer_social_rate, 'dividend_rate', s.dividend_rate, 'employees', v_rows);
END $$;

CREATE OR REPLACE FUNCTION private.refresh_open_events_for_employee(p_employee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT sh.event_id FROM public.event_sales_shares sh
             JOIN public.events e ON e.id = sh.event_id
            WHERE (p_employee_id IS NULL OR sh.employee_id = p_employee_id)
              AND private.event_settlement_status(sh.event_id) <> 'approved' AND e.status::text <> 'cancelled' LOOP
    PERFORM private.refresh_event_commissions_safe(r.event_id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.set_sales_commission_defaults(p_standard_rate numeric, p_own_client_rate numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.current_employee_is_crm_admin() THEN RAISE EXCEPTION 'Stawki prowizji zmienia administrator.' USING ERRCODE = '42501'; END IF;
  IF p_standard_rate IS NULL OR p_own_client_rate IS NULL OR p_standard_rate < 0 OR p_standard_rate > 100
     OR p_own_client_rate < 0 OR p_own_client_rate > 100 THEN
    RAISE EXCEPTION 'Stawki muszą mieścić się w zakresie 0–100%%.';
  END IF;
  INSERT INTO public.employee_sales_commission_terms_audit (employee_id, before_values, after_values, actor_id)
  SELECT '00000000-0000-0000-0000-000000000000'::uuid,
         jsonb_build_object('standard_rate', s.sales_commission_standard_rate, 'own_client_rate', s.sales_commission_own_client_rate),
         jsonb_build_object('standard_rate', p_standard_rate, 'own_client_rate', p_own_client_rate), public.current_invoice_employee_id()
    FROM public.compensation_settings s WHERE s.id = 1;
  UPDATE public.compensation_settings SET sales_commission_standard_rate = p_standard_rate,
         sales_commission_own_client_rate = p_own_client_rate, updated_at = now() WHERE id = 1;
  PERFORM private.refresh_open_events_for_employee(NULL);
  RETURN public.get_sales_commission_settings();
END $$;

CREATE OR REPLACE FUNCTION public.set_employee_sales_commission_terms(p_employee_id uuid, p_enabled boolean,
  p_standard_rate numeric DEFAULT NULL, p_own_client_rate numeric DEFAULT NULL, p_payment_method text DEFAULT 'payroll')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_before jsonb; v_actor uuid := public.current_invoice_employee_id();
BEGIN
  IF NOT public.current_employee_is_crm_admin() THEN RAISE EXCEPTION 'Prowizję pracownika ustawia administrator.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id) THEN RAISE EXCEPTION 'Nie znaleziono pracownika.'; END IF;
  IF (p_standard_rate IS NOT NULL AND (p_standard_rate < 0 OR p_standard_rate > 100))
     OR (p_own_client_rate IS NOT NULL AND (p_own_client_rate < 0 OR p_own_client_rate > 100)) THEN
    RAISE EXCEPTION 'Stawki muszą mieścić się w zakresie 0–100%%.';
  END IF;
  IF coalesce(p_payment_method, 'payroll') NOT IN ('cash_dividend', 'invoice', 'payroll', 'other') THEN
    RAISE EXCEPTION 'Nieznany sposób wypłaty.';
  END IF;
  SELECT to_jsonb(t) INTO v_before FROM public.employee_sales_commission_terms t WHERE t.employee_id = p_employee_id;
  INSERT INTO public.employee_sales_commission_terms (employee_id, enabled, standard_rate, own_client_rate, payment_method, updated_by, updated_at)
  VALUES (p_employee_id, coalesce(p_enabled, false), p_standard_rate, p_own_client_rate, coalesce(p_payment_method, 'payroll'), v_actor, now())
  ON CONFLICT (employee_id) DO UPDATE SET enabled = excluded.enabled, standard_rate = excluded.standard_rate,
    own_client_rate = excluded.own_client_rate, payment_method = excluded.payment_method, updated_by = v_actor, updated_at = now();
  INSERT INTO public.employee_sales_commission_terms_audit (employee_id, before_values, after_values, actor_id)
  SELECT p_employee_id, v_before, to_jsonb(t), v_actor FROM public.employee_sales_commission_terms t WHERE t.employee_id = p_employee_id;
  PERFORM private.refresh_open_events_for_employee(p_employee_id);
  RETURN public.get_sales_commission_settings();
END $$;

-- Dodanie sprzedawcy z kartoteki do wydarzenia (np. polecił klienta) — kwota według zasad podsumowania.
CREATE OR REPLACE FUNCTION public.add_event_partner_commission(p_event_id uuid, p_sales_partner_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_prev text := coalesce(current_setting('mavinci.commission_engine', true), ''); e public.events%ROWTYPE;
  p public.sales_partner_profiles%ROWTYPE; v_id uuid; v_name text;
BEGIN
  IF NOT (private.event_settlement_can_edit(p_event_id) OR public.commission_settlement_can_access(p_event_id, true)) THEN
    RAISE EXCEPTION 'Brak uprawnień do prowizji tego wydarzenia.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  SELECT * INTO p FROM public.sales_partner_profiles WHERE id = p_sales_partner_id;
  IF NOT FOUND OR p.status <> 'active' OR p.partner_type = 'internal_employee' THEN RAISE EXCEPTION 'Wybierz aktywnego sprzedawcę zewnętrznego z kartoteki.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id = p.id AND t.my_company_id = e.my_company_id
                  AND t.is_active AND t.commission_enabled AND coalesce(t.default_commission_rate, 0) > 0) THEN
    RAISE EXCEPTION 'Sprzedawca nie ma aktywnej prowizji dla marki wydarzenia. Uzupełnij kartotekę sprzedawców.';
  END IF;
  v_id := private.commission_uuid('mavinci:event-commission:' || p_event_id::text || ':' || p.id::text);
  IF EXISTS (SELECT 1 FROM public.event_commissions c WHERE c.event_id = p_event_id AND c.status <> 'cancelled'
              AND (c.id = v_id OR c.sales_partner_id = p.id OR (p.contact_id IS NOT NULL AND c.contact_id = p.contact_id))) THEN
    RETURN jsonb_build_object('created', false, 'commission_id', v_id, 'reason', 'existing');
  END IF;
  SELECT coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Sprzedawca')
    INTO v_name FROM public.contacts c WHERE c.id = p.contact_id;
  PERFORM set_config('mavinci.commission_engine', 'on', true);
  INSERT INTO public.event_commissions (id, event_id, beneficiary_type, beneficiary_name, sales_partner_id, employee_id, contact_id,
    organization_id, calculation_type, rate, base_amount, amount, status, created_by, automatic_source, automatic_company_id,
    automatic_waiting_for_offer, entry_kind, base_description)
  VALUES (v_id, p_event_id, 'salesperson', coalesce(v_name, 'Sprzedawca'), p.id, p.employee_id, p.contact_id, p.organization_id,
    'percent', 0, 0, 0, 'planned', public.current_invoice_employee_id(), 'manual_partner', e.my_company_id, false, 'accrual',
    'Dodany ręcznie do wydarzenia — kwota według podsumowania')
  ON CONFLICT (id) DO UPDATE SET status = 'planned', auto_cancelled = false, automatic_source = 'manual_partner'
    WHERE event_commissions.status = 'cancelled' AND event_commissions.automatic_source = ANY (private.commission_auto_sources());
  PERFORM set_config('mavinci.commission_engine', v_prev, true);
  PERFORM private.refresh_event_commissions(p_event_id);
  RETURN jsonb_build_object('created', true, 'commission_id', v_id, 'reason', 'ready');
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('mavinci.commission_engine', v_prev, true);
  RAISE;
END $$;

-- Ręczne anulowanie (z powodem) i przywrócenie prowizji z podsumowania: finanse lub administrator. Anulowana prowizja nie
-- pomniejsza zysku i nie wraca przy zatwierdzeniu; przywróconej kwotę ustala podsumowanie.
CREATE OR REPLACE FUNCTION public.set_event_commission_cancelled(p_commission_id uuid, p_cancel boolean, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.event_commissions%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.event_commissions WHERE id = p_commission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono prowizji.'; END IF;
  IF auth.uid() IS NULL OR NOT public.commission_settlement_can_access(c.event_id, true) THEN
    RAISE EXCEPTION 'Prowizję z podsumowania anuluje i przywraca finanse lub administrator.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_cancel, false) THEN
    IF c.status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'status', 'cancelled', 'duplicate', true); END IF;
    UPDATE public.event_commissions SET status = 'cancelled', cancel_reason = p_reason WHERE id = c.id;
  ELSE
    IF c.status <> 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'status', c.status, 'duplicate', true); END IF;
    IF c.auto_cancelled THEN RAISE EXCEPTION 'Tę prowizję anulowało podsumowanie — wróci sama, gdy pojawi się kwota.'; END IF;
    UPDATE public.event_commissions SET status = 'planned' WHERE id = c.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN coalesce(p_cancel, false) THEN 'cancelled' ELSE 'planned' END, 'duplicate', false);
END $$;

CREATE OR REPLACE FUNCTION public.refresh_event_commissions(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT (private.event_settlement_can_fill(p_event_id) OR public.commission_settlement_can_access(p_event_id, true)) THEN
    RAISE EXCEPTION 'Brak uprawnień do prowizji tego wydarzenia.' USING ERRCODE = '42501';
  END IF;
  RETURN private.refresh_event_commissions(p_event_id);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 14. Moje prowizje (pracownik — CRM i aplikacja)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_commissions()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_emp uuid := public.current_invoice_employee_id(); v_rows jsonb; s public.compensation_settings%ROWTYPE;
  t public.employee_sales_commission_terms%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_emp IS NULL OR coalesce(public.current_session_is_seller_portal(), false) THEN
    RAISE EXCEPTION 'Wymagane konto pracownika.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.compensation_settings WHERE id = 1;
  SELECT * INTO t FROM public.employee_sales_commission_terms WHERE employee_id = v_emp;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'event_id', c.event_id, 'event_name', e.name, 'event_date', e.event_date, 'event_status', e.status,
           'entry_kind', c.entry_kind, 'corrects_commission_id', c.corrects_commission_id, 'status', c.status,
           'amount', c.amount, 'base_amount', c.base_amount, 'rate', c.rate, 'rate_reason', c.rate_reason,
           'share_percent', c.share_percent, 'client_owned', c.client_owned, 'base_description', c.base_description,
           'payment_method', c.payment_method, 'automatic', c.automatic_source = 'sales_share',
           -- Wypłacono = przelewy / wypłaty; potrącenia (bez przelewu) osobno.
           'paid_amount', CASE WHEN c.entry_kind = 'deduction' THEN 0 ELSE coalesce(pay.cash, 0) END,
           'offset_amount', coalesce(pay.offset_total, 0),
           'remaining_amount', CASE WHEN c.status IN ('cancelled', 'paid', 'planned') THEN 0
                                    ELSE greatest(0, c.amount - coalesce(pay.total, 0)) END,
           'settlement_status', coalesce(st.status, 'draft'), 'settlement_revision', c.settlement_revision,
           'created_at', c.created_at, 'updated_at', c.updated_at,
           'payments', coalesce(pay.entries, '[]'::jsonb))
           ORDER BY e.event_date DESC NULLS LAST, c.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM public.event_commissions c
    JOIN public.events e ON e.id = c.event_id
    LEFT JOIN public.event_settlements st ON st.event_id = c.event_id
    LEFT JOIN LATERAL (SELECT sum(p.amount) AS total,
                              sum(p.amount) FILTER (WHERE NOT p.is_offset) AS cash,
                              sum(p.amount) FILTER (WHERE p.is_offset) AS offset_total,
                              jsonb_agg(jsonb_build_object('amount', p.amount, 'payment_date', p.payment_date, 'reference', p.reference,
                                                           'is_offset', p.is_offset) ORDER BY p.payment_date) AS entries
                         FROM public.event_commission_payouts p WHERE p.commission_id = c.id) pay ON true
   WHERE c.employee_id = v_emp AND c.beneficiary_type = 'employee' AND c.status <> 'cancelled';
  RETURN jsonb_build_object(
    'employee_id', v_emp,
    'enabled', coalesce(t.enabled, false),
    'standard_rate', coalesce(t.standard_rate, s.sales_commission_standard_rate, 5),
    'own_client_rate', coalesce(t.own_client_rate, s.sales_commission_own_client_rate, 10),
    'payment_method', coalesce(t.payment_method, 'payroll'),
    'totals', jsonb_build_object(
      'forecast', (SELECT coalesce(sum((r->>'amount')::numeric), 0) FROM jsonb_array_elements(v_rows) r
                    WHERE r->>'status' = 'planned' AND r->>'entry_kind' <> 'deduction'),
      'to_pay', (SELECT coalesce(sum((r->>'remaining_amount')::numeric), 0) FROM jsonb_array_elements(v_rows) r
                  WHERE r->>'status' = 'approved' AND r->>'entry_kind' <> 'deduction'),
      'paid', (SELECT coalesce(sum((r->>'paid_amount')::numeric), 0) FROM jsonb_array_elements(v_rows) r WHERE r->>'entry_kind' <> 'deduction'),
      'to_offset', (SELECT coalesce(sum((r->>'remaining_amount')::numeric), 0) FROM jsonb_array_elements(v_rows) r
                     WHERE r->>'status' = 'approved' AND r->>'entry_kind' = 'deduction')),
    'commissions', v_rows);
END $$;

-- Rejestr rozliczeń prowizji: podstawa, stawka, rodzaj wpisu; pracownik widzi własne konto prowizji.
CREATE OR REPLACE FUNCTION public.get_commission_settlements(p_mode text DEFAULT 'crm'::text, p_account_type text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE seller_id uuid; account_type text := p_account_type; account_id uuid := p_account_id; own_account boolean := false;
  rows jsonb; sales_scope boolean := public.invoice_finance_scope() = 'sales';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Wymagane logowanie.' USING ERRCODE = '42501'; END IF;
  IF p_mode = 'seller' THEN
    IF p_account_id IS NOT NULL OR p_account_type IS NOT NULL THEN
      RAISE EXCEPTION 'Portal udostępnia tylko własne konto.' USING ERRCODE = '42501';
    END IF;
    seller_id := public.current_sales_partner_id();
    IF seller_id IS NULL THEN RAISE EXCEPTION 'Brak dostępu do portalu sprzedawcy.' USING ERRCODE = '42501'; END IF;
    account_type := 'partner'; account_id := seller_id;
  ELSIF p_mode = 'crm' THEN
    IF account_type IS NULL OR account_type NOT IN ('contact','partner','employee','organization') OR account_id IS NULL THEN
      RAISE EXCEPTION 'Wybierz prawidłowe konto prowizji.';
    END IF;
    own_account := account_type = 'employee' AND account_id = public.current_invoice_employee_id();
    IF own_account THEN
      NULL; -- własne prowizje pracownika (np. udział w sprzedaży) widzi każdy pracownik
    ELSIF sales_scope THEN
      IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.owner_id = public.current_invoice_employee_id()
        AND ((account_type = 'contact' AND c.id = account_id)
          OR (account_type = 'partner' AND EXISTS (SELECT 1 FROM public.sales_partner_profiles p
            WHERE p.id = account_id AND p.contact_id = c.id)))) THEN
        RAISE EXCEPTION 'Możesz zobaczyć wyłącznie sprzedawców, których jesteś opiekunem.' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT public.commission_settlement_can_access(NULL, false) THEN
      RAISE EXCEPTION 'Brak dostępu do finansów.' USING ERRCODE = '42501';
    END IF;
  ELSE RAISE EXCEPTION 'Nieprawidłowy widok rozliczeń.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'event_id', c.event_id, 'event_name', e.name, 'event_date', e.event_date,
    'my_company_id', e.my_company_id, 'company_name', company.name,
    'can_manage', p_mode = 'crm' AND public.commission_settlement_can_access(c.event_id, true),
    'beneficiary_name', c.beneficiary_name, 'amount', c.amount,
    'base_amount', c.base_amount, 'rate', c.rate, 'base_description', c.base_description, 'rate_reason', c.rate_reason,
    'entry_kind', c.entry_kind, 'corrects_commission_id', c.corrects_commission_id, 'automatic_source', c.automatic_source,
    'share_percent', c.share_percent, 'client_owned', c.client_owned, 'settlement_revision', c.settlement_revision,
    'company_cost_amount', CASE WHEN p_mode = 'crm' AND NOT sales_scope THEN coalesce(c.company_cost_amount,c.amount) ELSE NULL END,
    'status', c.status, 'automatic_waiting_for_offer', c.automatic_waiting_for_offer,
    'created_at', c.created_at, 'due_date', c.due_date, 'payment_method', c.payment_method,
    'paid_amount', CASE WHEN payments.count = 0 AND c.status = 'paid' THEN c.amount ELSE payments.total END,
    'remaining_amount', CASE WHEN c.status IN ('cancelled','paid') OR c.entry_kind = 'deduction' THEN 0 ELSE greatest(0,c.amount-payments.total) END,
    -- Potrącenie: kwota do potrącenia z kolejnych prowizji (nie do wypłaty); kwota ze znakiem do sum salda.
    'to_offset', CASE WHEN c.entry_kind = 'deduction' AND c.status = 'approved' THEN greatest(0, c.amount - payments.total) ELSE 0 END,
    'signed_amount', CASE WHEN c.entry_kind = 'deduction' THEN -c.amount ELSE c.amount END,
    'offset_amount', payments.offset_total,
    'payments', CASE WHEN payments.count = 0 AND c.status = 'paid' THEN jsonb_build_array(jsonb_build_object(
      'id', 'legacy:' || c.id::text, 'commission_id', c.id, 'amount', c.amount,
      'payment_date', (c.paid_at AT TIME ZONE 'Europe/Warsaw')::date,
      'recorded_at', NULL, 'reference', NULL, 'note', NULL, 'source', 'legacy'
    )) ELSE payments.entries END
  ) ORDER BY e.event_date DESC NULLS LAST,c.created_at DESC,c.id), '[]'::jsonb) INTO rows
  FROM public.event_commissions c JOIN public.events e ON e.id = c.event_id
  LEFT JOIN public.my_companies company ON company.id = e.my_company_id
  LEFT JOIN public.sales_partner_profiles profile ON profile.id = c.sales_partner_id
  CROSS JOIN LATERAL (
    SELECT count(*) AS count, coalesce(sum(p.amount),0) AS total,
      coalesce(sum(p.amount) FILTER (WHERE p.is_offset),0) AS offset_total,
      coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'commission_id', p.commission_id, 'amount', p.amount,
        'payment_date', p.payment_date, 'recorded_at', p.recorded_at, 'reference', p.reference,
        'note', CASE WHEN p_mode = 'crm' AND NOT sales_scope THEN p.note ELSE NULL END, 'source', CASE WHEN p.is_offset THEN 'offset' ELSE 'ledger' END, 'is_offset', p.is_offset
      ) ORDER BY p.payment_date DESC,p.recorded_at DESC,p.id), '[]'::jsonb) AS entries
    FROM public.event_commission_payouts p WHERE p.commission_id = c.id
  ) payments
  WHERE (p_mode = 'seller' OR (own_account AND c.employee_id = account_id AND c.beneficiary_type = 'employee') OR CASE WHEN sales_scope THEN public.sales_commission_visible(c.id)
    ELSE public.commission_settlement_can_access(c.event_id,false) END)
    AND CASE account_type
      WHEN 'contact' THEN c.contact_id = account_id OR profile.contact_id = account_id
      WHEN 'employee' THEN c.employee_id = account_id OR c.salesperson_id = account_id OR profile.employee_id = account_id
      WHEN 'organization' THEN c.organization_id = account_id
      WHEN 'partner' THEN c.sales_partner_id = account_id OR (c.sales_partner_id IS NULL AND EXISTS (
        SELECT 1 FROM public.sales_partner_profiles own_profile WHERE own_profile.id = account_id
          AND ((own_profile.contact_id IS NOT NULL AND c.contact_id = own_profile.contact_id)
            OR (own_profile.employee_id IS NOT NULL AND (c.employee_id = own_profile.employee_id OR c.salesperson_id = own_profile.employee_id)))))
      ELSE false END;
  RETURN jsonb_build_object('mode', p_mode, 'accountType', account_type, 'accountId', account_id,
    'canManage', p_mode = 'crm' AND public.commission_settlement_can_access(NULL,true),
    'currency','PLN','commissions',rows);
END; $function$;

-- Portal sprzedawcy: potrącenie widać jako kwotę ujemną (nie jako należność).
CREATE OR REPLACE FUNCTION public.get_seller_portal_commissions()
 RETURNS TABLE(id uuid, event_id uuid, event_name text, event_date timestamp with time zone, amount numeric, status text, due_date date, paid_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT commission.id, commission.event_id, event.name, event.event_date::timestamptz,
         CASE WHEN commission.entry_kind = 'deduction' THEN -commission.amount ELSE commission.amount END,
         commission.status, commission.due_date, commission.paid_at
  FROM public.event_commissions commission
  JOIN public.events event ON event.id = commission.event_id
  WHERE commission.sales_partner_id = public.current_sales_partner_id()
    AND commission.status <> 'cancelled'
    AND EXISTS (
      SELECT 1
      FROM public.sales_partner_brand_terms term
      WHERE term.sales_partner_id = commission.sales_partner_id
        AND term.my_company_id = event.my_company_id
        AND term.is_active = true
        AND term.commission_enabled = true
    )
  ORDER BY event.event_date DESC NULLS LAST, commission.created_at DESC;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 15. Prognoza odświeża się sama po zmianie danych źródłowych — raz na polecenie (nie na każdy wiersz) i nigdy
--     nie blokuje zapisu źródła.
-- ---------------------------------------------------------------------------------------------------------------
-- Usunięcie wyzwalaczy wierszowych z wcześniejszej wersji tej migracji (gdyby była uruchomiona).
DROP TRIGGER IF EXISTS zz_settlement_refresh_invoices ON public.invoices;
DROP TRIGGER IF EXISTS zz_settlement_refresh_allocations ON public.invoice_event_allocations;
DROP TRIGGER IF EXISTS zz_settlement_refresh_costs ON public.event_costs;
DROP TRIGGER IF EXISTS zz_settlement_refresh_subcontractor_tasks ON public.subcontractor_tasks;
DROP TRIGGER IF EXISTS zz_settlement_refresh_time_entries ON public.time_entries;
DROP TRIGGER IF EXISTS zz_settlement_refresh_partner_arrangements ON public.event_partner_arrangements;
DROP TRIGGER IF EXISTS zz_settlement_refresh_financials ON public.event_financials;
DROP TRIGGER IF EXISTS zzz_settlement_refresh_manual_commissions ON public.event_commissions;
DROP TRIGGER IF EXISTS zz_settlement_refresh_events ON public.events;
DROP FUNCTION IF EXISTS private.settlement_source_changed();

CREATE OR REPLACE FUNCTION private.refresh_events_safe(p_events uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT DISTINCT x FROM unnest(coalesce(p_events, '{}'::uuid[])) x WHERE x IS NOT NULL LOOP
    PERFORM private.refresh_event_commissions_safe(v_id);
  END LOOP;
END $$;

-- Wspólna funkcja wyzwalaczy poleceniowych (tabele przejściowe new_rows / old_rows).
CREATE OR REPLACE FUNCTION private.settlement_rows_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_ids uuid[] := '{}'; v_more uuid[];
BEGIN
  IF private.commission_engine_active() THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'events' THEN
    SELECT array_agg(n.id) INTO v_ids FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE ROW(o.status, o.referring_sales_partner_id, o.my_company_id, o.organization_id, o.contact_person_id,
               o.event_date, o.event_end_date, o.billing_arrangement, o.billing_organization_id)
           IS DISTINCT FROM
           ROW(n.status, n.referring_sales_partner_id, n.my_company_id, n.organization_id, n.contact_person_id,
               n.event_date, n.event_end_date, n.billing_arrangement, n.billing_organization_id);
  ELSIF TG_TABLE_NAME = 'event_commissions' THEN
    -- Tylko ręczne wpisy wpływają na koszty podsumowania (wpisy automatyczne zmienia sam silnik).
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      SELECT v_ids || coalesce(array_agg(n.event_id), '{}') INTO v_ids FROM new_rows n
       WHERE n.entry_kind = 'accrual' AND NOT coalesce(n.automatic_source = ANY (private.commission_auto_sources()), false);
    END IF;
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
      SELECT v_ids || coalesce(array_agg(o.event_id), '{}') INTO v_ids FROM old_rows o
       WHERE o.entry_kind = 'accrual' AND NOT coalesce(o.automatic_source = ANY (private.commission_auto_sources()), false);
    END IF;
  ELSIF TG_TABLE_NAME = 'offers' THEN
    SELECT array_agg(o.event_id) INTO v_ids FROM old_rows o WHERE o.status::text = 'accepted';
  ELSE
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      SELECT v_ids || coalesce(array_agg(n.event_id), '{}') INTO v_ids FROM new_rows n;
    END IF;
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
      SELECT v_ids || coalesce(array_agg(o.event_id), '{}') INTO v_ids FROM old_rows o;
    END IF;
    -- Faktura na kilka wydarzeń (udziały): odśwież też pozostałe wydarzenia tej faktury.
    IF TG_TABLE_NAME = 'invoices' THEN
      IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT coalesce(array_agg(a.event_id), '{}') INTO v_more FROM public.invoice_event_allocations a
         WHERE a.invoice_id IN (SELECT n.id FROM new_rows n);
        v_ids := v_ids || v_more;
      END IF;
    ELSIF TG_TABLE_NAME = 'invoice_event_allocations' THEN
      IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT coalesce(array_agg(a.event_id), '{}') INTO v_more FROM public.invoice_event_allocations a
         WHERE a.invoice_id IN (SELECT n.invoice_id FROM new_rows n);
        v_ids := v_ids || v_more;
        SELECT coalesce(array_agg(i.event_id), '{}') INTO v_more FROM public.invoices i WHERE i.id IN (SELECT n.invoice_id FROM new_rows n);
        v_ids := v_ids || v_more;
      END IF;
      IF TG_OP IN ('DELETE', 'UPDATE') THEN
        SELECT coalesce(array_agg(a.event_id), '{}') INTO v_more FROM public.invoice_event_allocations a
         WHERE a.invoice_id IN (SELECT o.invoice_id FROM old_rows o);
        v_ids := v_ids || v_more;
      END IF;
    END IF;
  END IF;
  PERFORM private.refresh_events_safe(v_ids);
  RETURN NULL;
END $$;

-- Tabele przejściowe wymagają osobnego wyzwalacza dla każdej operacji.
DO $$
DECLARE t text; op text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices', 'invoice_event_allocations', 'event_costs', 'subcontractor_tasks', 'time_entries',
                           'event_partner_arrangements', 'event_financials', 'event_commissions', 'events'] LOOP
    FOREACH op IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS zz_settlement_%s_%s ON public.%I', t, op, t);
      IF t = 'events' AND op <> 'update' THEN CONTINUE; END IF;
      EXECUTE format('CREATE TRIGGER zz_settlement_%s_%s AFTER %s ON public.%I REFERENCING %s FOR EACH STATEMENT EXECUTE FUNCTION private.settlement_rows_changed()',
        t, op, upper(op), t,
        CASE op WHEN 'insert' THEN 'NEW TABLE AS new_rows' WHEN 'delete' THEN 'OLD TABLE AS old_rows'
                ELSE 'OLD TABLE AS old_rows NEW TABLE AS new_rows' END);
    END LOOP;
  END LOOP;
END $$;
-- Usunięcie zaakceptowanej oferty zmienia prognozę.
DROP TRIGGER IF EXISTS zz_settlement_offers_delete ON public.offers;
CREATE TRIGGER zz_settlement_offers_delete AFTER DELETE ON public.offers
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.settlement_rows_changed();

-- Warunki sprzedawcy dla marki albo status jego profilu: odśwież otwarte wydarzenia, w których występuje.
CREATE OR REPLACE FUNCTION private.settlement_partner_terms_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record;
  v_partner uuid := CASE WHEN TG_TABLE_NAME = 'sales_partner_profiles' THEN (CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)
                         ELSE (CASE WHEN TG_OP = 'DELETE' THEN OLD.sales_partner_id ELSE NEW.sales_partner_id END) END;
BEGIN
  IF private.commission_engine_active() THEN RETURN NULL; END IF;
  FOR r IN
    SELECT DISTINCT x.event_id FROM (
      SELECT c.event_id FROM public.event_commissions c WHERE c.sales_partner_id = v_partner AND c.status IN ('planned', 'cancelled')
      UNION SELECT e.id FROM public.events e WHERE e.referring_sales_partner_id = v_partner
      UNION SELECT a.event_id FROM public.event_partner_arrangements a JOIN public.sales_partner_profiles p ON p.contact_id = a.contact_id WHERE p.id = v_partner
      UNION SELECT b.event_id FROM public.event_billing_contacts b JOIN public.sales_partner_profiles p ON p.contact_id = b.contact_id WHERE p.id = v_partner
      UNION SELECT o.event_id FROM public.offers o WHERE o.sales_partner_id = v_partner AND o.status::text = 'accepted'
    ) x JOIN public.events e ON e.id = x.event_id
    WHERE e.status::text NOT IN ('cancelled', 'settled') AND private.event_settlement_status(x.event_id) <> 'approved'
  LOOP
    PERFORM private.refresh_event_commissions_safe(r.event_id);
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS zz_settlement_refresh_partner_terms ON public.sales_partner_brand_terms;
CREATE TRIGGER zz_settlement_refresh_partner_terms
  AFTER INSERT OR DELETE OR UPDATE OF is_active, commission_enabled, default_commission_rate, default_payment_method, dividend_tax_rate
  ON public.sales_partner_brand_terms FOR EACH ROW EXECUTE FUNCTION private.settlement_partner_terms_changed();
DROP TRIGGER IF EXISTS zz_settlement_refresh_partner_profile ON public.sales_partner_profiles;
CREATE TRIGGER zz_settlement_refresh_partner_profile
  AFTER UPDATE OF status, partner_type, contact_id ON public.sales_partner_profiles
  FOR EACH ROW EXECUTE FUNCTION private.settlement_partner_terms_changed();

-- ---------------------------------------------------------------------------------------------------------------
-- 16. Uprawnienia do funkcji
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_event_settlement(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_event_settlement_line(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_event_settlement_line(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_event_cost_invoice_candidates(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_event_cost_invoice(uuid, text, uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_event_settlement(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_event_settlement(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_event_settlement(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_event_settlement(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_event_sales_shares(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_sales_commission_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_sales_commission_defaults(numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_employee_sales_commission_terms(uuid, boolean, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_event_partner_commission(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refresh_event_commissions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_commissions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_commission_deduction(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_event_commission_cancelled(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_event_billing_seller_commissions(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_event_settlement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_event_settlement_line(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_event_settlement_line(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_event_cost_invoice_candidates(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_event_cost_invoice(uuid, text, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_event_settlement(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_event_settlement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_event_settlement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_event_settlement(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_sales_shares(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_commission_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_sales_commission_defaults(numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_employee_sales_commission_terms(uuid, boolean, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_event_partner_commission(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_event_commissions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_commissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_commission_deduction(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_commission_cancelled(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_billing_seller_commissions(uuid) TO service_role;

-- Funkcje wewnętrzne (schemat private) nie są dostępne bezpośrednio dla ról aplikacji.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname IN (
              'commission_auto_sources', 'commission_engine_active', 'offer_net_amount', 'guard_automatic_commission', 'stamp_event_commission',
              'log_event_commission_change', 'commission_uuid', 'event_client_owner', 'ensure_event_sales_shares',
              'commission_manual_precedes', 'event_settlement_auto_lines', 'event_settlement_compute', 'pl_money', 'pl_number',
              'commission_target_rows', 'event_settlement_tracked', 'refresh_event_commissions', 'refresh_event_commissions_safe',
              'offset_commission_deduction', 'apply_settlement_commissions', 'commission_chain_net', 'commission_same_person', 'event_settlement_status', 'event_settlement_can_fill',
              'event_settlement_can_edit', 'event_settlement_can_approve', 'lock_event_settlement', 'notify_settlement',
              'settlement_sync_steps', 'refresh_open_events_for_employee', 'refresh_events_safe', 'settlement_rows_changed',
              'settlement_partner_terms_changed', 'prevent_ledger_mutation')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 17. Start: sprzedawca i prognoza dla trwających wydarzeń (rozliczone wydarzenia zostają bez zmian)
-- ---------------------------------------------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT e.id FROM public.events e
     WHERE e.status::text IN ('offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress', 'completed', 'invoiced')
       AND EXISTS (SELECT 1 FROM public.offers o WHERE o.event_id = e.id AND o.status::text = 'accepted')
  LOOP
    PERFORM private.ensure_event_sales_shares(r.id, 'backfill');
    PERFORM private.refresh_event_commissions_safe(r.id);
  END LOOP;
END $$;
