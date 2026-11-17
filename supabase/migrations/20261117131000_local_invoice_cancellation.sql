-- Finanse, krok 2: anulowanie zamiast usuwania wystawionych faktur (CRM, poza KSeF) — 2026-11-17.
--
-- CO I DLACZEGO
-- Dotąd każdą fakturę niewysłaną do KSeF (np. dla osoby prywatnej) można było usunąć — także wystawioną i wysłaną
-- klientowi — razem z historią zmian, a numeracja cofała się do najwyższego pozostałego numeru. Dla spółki to
-- niedopuszczalne: wystawiona faktura zostaje w ewidencji (przechowywanie dokumentów), a numeracja jest ciągła.
--  1. Usunąć można tylko szkic i proformę (nie są dokumentami księgowymi) — w CRM i w bazie (także bezpośredni DELETE z API).
--  2. Fakturę wystawioną, która NIE trafiła do nabywcy, anuluje się (cancel_local_invoice): numer zostaje, faktura
--     ma status „anulowana”, powód, datę i osobę, wpis w historii; znika z raportów, uzgodnienia wyciągów i rozliczeń
--     (status cancelled jest już wykluczany przez te funkcje). Wymagane potwierdzenie, że nie trafiła do nabywcy.
--  3. Faktury, która trafiła do nabywcy (status „wysłana”), zapłaconej, przypiętej do wyciągu, z korektą albo w KSeF
--     nie anuluje się — poprawia się ją korektą.
--  4. Status „anulowana” ustawia wyłącznie cancel_local_invoice (bezpośrednia zmiana z API jest blokowana), a anulowanej
--     faktury nie przywraca się.
-- Uprawnienia: anulowanie — „Wystawianie faktur” lub wyżej w działalności faktury; usuwanie szkicu — jak dotąd
-- „Zarządzanie finansami”. Plik można uruchomić ponownie.
BEGIN;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cancelled_by uuid;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cancellation_reason text;
COMMENT ON COLUMN public.invoices.cancellation_reason IS
  'Powód anulowania faktury, która nie trafiła do nabywcy (cancel_local_invoice).';

-- 1. Strażnik: anulowanie tylko przez cancel_local_invoice, bez przywracania, usuwanie tylko szkiców i proform -------------
-- Funkcje SECURITY DEFINER działają jako właściciel (postgres), zapytania z API — jako anon / authenticated.
CREATE OR REPLACE FUNCTION private.guard_invoice_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('draft', 'proforma') AND NOT coalesce(OLD.is_proforma, false) AND OLD.invoice_type <> 'proforma' THEN
      RAISE EXCEPTION 'Wystawionej faktury % nie usuwa się — anuluj ją (jeśli nie trafiła do nabywcy) albo wystaw korektę.',
        OLD.invoice_number USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'Fakturę anuluje się przyciskiem „Anuluj fakturę” — z powodem i potwierdzeniem, że nie trafiła do nabywcy.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'Anulowanej faktury % nie przywraca się — wystaw nową fakturę.', OLD.invoice_number USING ERRCODE = '42501';
  END IF;
  IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
     OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason THEN
    RAISE EXCEPTION 'Dane anulowania faktury zmienia tylko „Anuluj fakturę”.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_invoice_cancellation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_invoice_cancellation ON public.invoices;
CREATE TRIGGER guard_invoice_cancellation
  BEFORE UPDATE OF status, cancelled_at, cancelled_by, cancellation_reason OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION private.guard_invoice_cancellation();

-- 2. Anulowanie -----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_local_invoice(p_invoice_id uuid, p_reason text, p_not_delivered boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_is_proforma boolean;
  v_employee uuid := public.current_invoice_employee_id();
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Faktura nie istnieje.'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.finance_company_level_at_least(v_invoice.my_company_id, 'invoices_issue') THEN
    RAISE EXCEPTION 'Brak uprawnień do anulowania faktur tej działalności.' USING ERRCODE = '42501';
  END IF;
  v_is_proforma := coalesce(v_invoice.is_proforma, false) OR v_invoice.invoice_type = 'proforma';

  IF v_invoice.status = 'cancelled' THEN RAISE EXCEPTION 'Faktura jest już anulowana.'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'Podaj powód anulowania (co najmniej 5 znaków).'; END IF;
  IF v_invoice.ksef_reference_number IS NOT NULL OR lower(coalesce(v_invoice.ksef_status, '')) IN ('pending', 'sent', 'accepted')
     OR EXISTS (SELECT 1 FROM public.ksef_invoices k WHERE k.invoice_id = p_invoice_id
                  AND (k.sync_status = 'synced' OR k.ksef_reference_number IS NOT NULL)) THEN
    RAISE EXCEPTION 'Faktury wysłanej do KSeF nie anuluje się — wystaw korektę.';
  END IF;
  IF NOT v_is_proforma AND v_invoice.status NOT IN ('draft', 'issued', 'overdue') THEN
    RAISE EXCEPTION 'Faktura ma status „%” — trafiła do nabywcy lub jest rozliczona. Wystaw korektę.',
      CASE v_invoice.status WHEN 'sent' THEN 'wysłana' WHEN 'paid' THEN 'opłacona' ELSE v_invoice.status END;
  END IF;
  IF NOT v_is_proforma AND v_invoice.status <> 'draft' AND NOT coalesce(p_not_delivered, false) THEN
    RAISE EXCEPTION 'Anulować można tylko fakturę, która nie trafiła do nabywcy. Jeśli ją otrzymał — wystaw korektę.';
  END IF;
  IF coalesce(v_invoice.paid_amount, 0) > 0 OR coalesce(v_invoice.manual_paid_amount, 0) > 0
     OR coalesce(v_invoice.payment_status, 'unpaid') IN ('paid', 'partially_paid', 'refund_due', 'partially_refunded', 'refunded') THEN
    RAISE EXCEPTION 'Faktura ma zapłatę — nie anuluje się jej. Wystaw korektę.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bank_transaction_invoice_matches m WHERE m.invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'Faktura jest przypięta do operacji bankowej — najpierw odepnij ją w uzgodnieniu wyciągu.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoices c WHERE c.related_invoice_id = p_invoice_id AND c.status <> 'cancelled') THEN
    RAISE EXCEPTION 'Do faktury wystawiono korektę lub dokument powiązany — nie anuluje się jej.';
  END IF;

  UPDATE public.invoices
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_employee,
      cancellation_reason = btrim(p_reason), updated_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.invoice_history (invoice_id, action, changed_by, changes)
  VALUES (p_invoice_id, 'cancelled', v_employee, jsonb_build_object(
    'previous_status', v_invoice.status, 'reason', btrim(p_reason),
    'not_delivered_confirmed', coalesce(p_not_delivered, false), 'cancelled_at', now()));

  RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice.invoice_number);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_local_invoice(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_local_invoice(uuid, text, boolean) TO authenticated, service_role;

-- 3. Usuwanie: tylko szkic i proforma -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_local_invoice_and_repair_numbering(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_invoice invoices%rowtype;
  v_synced_ksef_count int;
  v_year int;
  v_prefix text;
  v_counter_col text;
  v_last_number int;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'Faktura nie istnieje';
  end if;

  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.finance_company_manageable(v_invoice.my_company_id) THEN
    RAISE EXCEPTION 'Brak uprawnień do usunięcia faktury tej działalności.' USING ERRCODE = '42501';
  END IF;

  select count(*) into v_synced_ksef_count
  from ksef_invoices
  where invoice_id = p_invoice_id and (sync_status = 'synced' or ksef_reference_number is not null);

  if v_invoice.ksef_reference_number is not null or v_invoice.ksef_status in ('accepted', 'sent') or v_synced_ksef_count > 0 then
    raise exception 'Nie można usunąć faktury wysłanej do KSeF';
  end if;

  -- Wystawiona faktura zostaje w ewidencji: anulowanie (gdy nie trafiła do nabywcy) albo korekta.
  if v_invoice.status not in ('draft', 'proforma') and not coalesce(v_invoice.is_proforma, false)
     and v_invoice.invoice_type <> 'proforma' then
    raise exception 'Wystawionej faktury % nie usuwa się — anuluj ją (jeśli nie trafiła do nabywcy) albo wystaw korektę.',
      v_invoice.invoice_number;
  end if;

  v_year := extract(year from v_invoice.issue_date)::int;

  case v_invoice.invoice_type
    when 'proforma' then v_prefix := 'PRO'; v_counter_col := 'last_proforma_number';
    when 'advance' then v_prefix := 'ZAL'; v_counter_col := 'last_advance_number';
    when 'corrective' then v_prefix := 'KOR'; v_counter_col := 'last_corrective_number';
    when 'final' then v_prefix := 'FKO'; v_counter_col := 'last_final_number';
    else v_prefix := ''; v_counter_col := 'last_invoice_number';
  end case;

  delete from invoice_items where invoice_id = p_invoice_id;
  delete from invoice_history where invoice_id = p_invoice_id;
  delete from ksef_invoices where invoice_id = p_invoice_id;
  delete from invoices where id = p_invoice_id;

  if v_invoice.my_company_id is not null then
    select coalesce(max((regexp_match(invoice_number, '([0-9]+)/[0-9]{4}$'))[1]::int), 0)
    into v_last_number
    from invoices
    where my_company_id = v_invoice.my_company_id
      and invoice_type = v_invoice.invoice_type
      and extract(year from issue_date)::int = v_year
      and invoice_number ~ ('^' || case when v_prefix = '' then '' else v_prefix || '/' end || '[0-9]+/[0-9]{4}$');

    execute format('update my_companies set %I = $1 where id = $2', v_counter_col)
    using v_last_number, v_invoice.my_company_id;
  end if;

  return jsonb_build_object('success', true, 'deleted_invoice_number', v_invoice.invoice_number);
end;
$function$;

-- 4. Kontrola -------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_invoice_cancellation'
                   AND tgrelid = 'public.invoices'::regclass) THEN
    RAISE EXCEPTION 'Brak strażnika anulowania faktur.';
  END IF;
  IF has_function_privilege('anon', 'public.cancel_local_invoice(uuid, text, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anulowanie faktur dostępne bez logowania.';
  END IF;
END $$;

COMMIT;
