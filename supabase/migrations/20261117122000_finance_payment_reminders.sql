-- Finanse: przypomnienia o płatnościach faktur KSeF — 2026-11-17.
--
-- CO I DLACZEGO
-- public.check_and_notify_invoice_payments() istniała, ale nikt jej nie uruchamiał i nie mogła zadziałać: szukała
-- administratorów po nieużywanym polu, zapisywała odbiorców do nieistniejącej kolumny employee_id i kategorię
-- spoza listy dozwolonych, a każdą fakturę po terminie zgłaszałaby osobno codziennie. Teraz, codziennie o 8:05
-- czasu polskiego, dla każdej aktywnej działalności i osób z „Zarządzaniem finansami” tej działalności
-- (w tym administratorów) — jedno zbiorcze powiadomienie zamiast lawiny:
--  1. „Do zapłaty w ciągu 3 dni” — faktury kosztowe z terminem od dziś do +3 dni, nieopłacone.
--  2. „Minął termin płatności” — faktury, którym termin minął w ostatnich 7 dniach i o których jeszcze nie
--     przypominaliśmy: koszty do zapłaty i sprzedaż do otrzymania od klientów (każda faktura raz).
--  3. W poniedziałki „Przegląd płatności po terminie” — wszystkie należności i zobowiązania po terminie oraz faktury
--     kosztowe bez terminu płatności (bez terminu nie ma przypomnień).
-- „Po terminie” liczone z daty (termin < dziś, status nieopłacona / po terminie) — bez zmiany statusu w bazie: zmiana
-- statusu odświeżałaby cykl faktur wydarzeń i unieważniała raporty AI uzgodnienia wyciągów. Lista KSeF w CRM też liczy
-- „po terminie” z daty. Status płatności pochodzi z KSeF i uzgodnienia wyciągów — faktura opłacona, ale
-- niedopasowana do wyciągu, nadal wygląda na nieopłaconą.
-- Dziennik przypomnień (finance_reminder_log) pilnuje, by nic nie wysłać dwa razy; tylko serwer (service_role).
-- Plik można uruchomić ponownie.
BEGIN;

-- 1. Dziennik przypomnień -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_reminder_log (
  reminder_key text PRIMARY KEY,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_reminder_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_reminder_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.finance_reminder_log TO service_role;
COMMENT ON TABLE public.finance_reminder_log IS
  'Wysłane przypomnienia o płatnościach (klucz: rodzaj:działalność:dzień albo overdue-invoice:faktura) — bez powtórek.';

-- 2. Kwota po polsku: „12 345,67 zł” -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.format_pln(p_amount numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE WHEN p_amount < 0 THEN '−' ELSE '' END
    || regexp_replace(replace(to_char(round(abs(coalesce(p_amount, 0)), 2), 'FM999999999990.00'), '.', ','),
                      '(\d)(?=(\d{3})+,)', '\1 ', 'g')
    || ' zł';
$$;
REVOKE ALL ON FUNCTION private.format_pln(numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.invoice_count_label(p_count bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT p_count::text || ' ' || CASE
    WHEN p_count = 1 THEN 'faktura'
    WHEN p_count % 10 BETWEEN 2 AND 4 AND p_count % 100 NOT BETWEEN 12 AND 14 THEN 'faktury'
    ELSE 'faktur' END;
$$;
REVOKE ALL ON FUNCTION private.invoice_count_label(bigint) FROM PUBLIC, anon, authenticated;

-- 3. Przypomnienia ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_and_notify_invoice_payments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_company record;
  v_recipients uuid[];
  v_summary record;
  v_key text;
  v_message text;
  v_notification uuid;
BEGIN
  FOR v_company IN SELECT c.id, c.name FROM public.my_companies c WHERE c.is_active ORDER BY c.name LOOP
    SELECT coalesce(array_agg(DISTINCT auth_user.id), '{}') INTO v_recipients
    FROM public.employees employee
    JOIN auth.users auth_user ON auth_user.id = coalesce(employee.auth_user_id, employee.id)
    WHERE employee.is_active = true
      AND private.employee_finance_company_level(employee.id, v_company.id) = 'finance_manage';
    CONTINUE WHEN cardinality(v_recipients) = 0;

    -- 3.1 Faktury kosztowe do zapłaty w ciągu 3 dni.
    v_key := format('payables-due:%s:%s', v_company.id, v_today);
    IF NOT EXISTS (SELECT 1 FROM public.finance_reminder_log WHERE reminder_key = v_key) THEN
      SELECT count(*) AS invoices, coalesce(sum(x.amount), 0) AS total,
             string_agg(x.label, '; ' ORDER BY x.position) FILTER (WHERE x.position <= 5) AS items,
             coalesce(jsonb_agg(x.id), '[]'::jsonb) AS ids
      INTO v_summary
      FROM (
        SELECT k.id, coalesce(k.amount_to_pay_gross, k.gross_amount) AS amount,
          format('%s, %s — %s, %s', coalesce(nullif(btrim(k.seller_name), ''), 'dostawca'),
            coalesce(nullif(btrim(k.invoice_number), ''), k.ksef_reference_number), to_char(k.payment_due_date, 'DD.MM'),
            private.format_pln(coalesce(k.amount_to_pay_gross, k.gross_amount))) AS label,
          row_number() OVER (ORDER BY k.payment_due_date, coalesce(k.amount_to_pay_gross, k.gross_amount) DESC, k.id) AS position
        FROM public.ksef_invoices k
        WHERE k.my_company_id = v_company.id AND k.invoice_type = 'received'
          AND k.payment_status IN ('unpaid', 'overdue')
          AND coalesce(k.amount_to_pay_gross, k.gross_amount, 0) > 0
          AND k.payment_due_date BETWEEN v_today AND v_today + 3
      ) x;

      IF v_summary.invoices > 0 THEN
        v_message := format('%s na %s: %s%s', private.invoice_count_label(v_summary.invoices),
          private.format_pln(v_summary.total), v_summary.items,
          CASE WHEN v_summary.invoices > 5 THEN format(' i %s więcej', v_summary.invoices - 5) ELSE '' END);
        INSERT INTO public.notifications(title, message, type, category, action_url, metadata, created_at)
        VALUES ('Do zapłaty w ciągu 3 dni — ' || v_company.name, v_message, 'warning', 'system', '/crm/invoices?tab=ksef',
          jsonb_build_object('kind', 'finance_payment_reminder', 'reminder', 'payables_due', 'company_id', v_company.id,
            'invoice_ids', v_summary.ids), now())
        RETURNING id INTO v_notification;
        INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
        SELECT v_notification, recipient, false FROM unnest(v_recipients) recipient
        ON CONFLICT (notification_id, user_id) DO NOTHING;
        INSERT INTO public.finance_reminder_log(reminder_key, notification_id, details)
        VALUES (v_key, v_notification, jsonb_build_object('invoices', v_summary.invoices, 'total', v_summary.total));
      END IF;
    END IF;

    -- 3.2 Termin minął w ostatnich 7 dniach — każda faktura raz (koszty i sprzedaż w jednym powiadomieniu).
    v_key := format('overdue-new:%s:%s', v_company.id, v_today);
    IF NOT EXISTS (SELECT 1 FROM public.finance_reminder_log WHERE reminder_key = v_key) THEN
      SELECT
        count(*) FILTER (WHERE x.invoice_type = 'received') AS payables,
        coalesce(sum(x.amount) FILTER (WHERE x.invoice_type = 'received'), 0) AS payables_total,
        string_agg(x.label, '; ' ORDER BY x.position) FILTER (WHERE x.invoice_type = 'received' AND x.position <= 3) AS payable_items,
        count(*) FILTER (WHERE x.invoice_type = 'issued') AS receivables,
        coalesce(sum(x.amount) FILTER (WHERE x.invoice_type = 'issued'), 0) AS receivables_total,
        string_agg(x.label, '; ' ORDER BY x.position) FILTER (WHERE x.invoice_type = 'issued' AND x.position <= 3) AS receivable_items,
        coalesce(array_agg(x.id), '{}') AS ids
      INTO v_summary
      FROM (
        SELECT k.id, k.invoice_type, coalesce(k.amount_to_pay_gross, k.gross_amount) AS amount,
          format('%s, %s — termin %s, %s',
            coalesce(nullif(btrim(CASE WHEN k.invoice_type = 'received' THEN k.seller_name ELSE k.buyer_name END), ''),
              CASE WHEN k.invoice_type = 'received' THEN 'dostawca' ELSE 'klient' END),
            coalesce(nullif(btrim(k.invoice_number), ''), k.ksef_reference_number), to_char(k.payment_due_date, 'DD.MM'),
            private.format_pln(coalesce(k.amount_to_pay_gross, k.gross_amount))) AS label,
          row_number() OVER (PARTITION BY k.invoice_type
                             ORDER BY coalesce(k.amount_to_pay_gross, k.gross_amount) DESC, k.id) AS position
        FROM public.ksef_invoices k
        WHERE k.my_company_id = v_company.id AND k.invoice_type IN ('received', 'issued')
          AND k.payment_status IN ('unpaid', 'overdue')
          AND coalesce(k.amount_to_pay_gross, k.gross_amount, 0) > 0
          AND k.payment_due_date BETWEEN v_today - 7 AND v_today - 1
          AND NOT EXISTS (SELECT 1 FROM public.finance_reminder_log l WHERE l.reminder_key = 'overdue-invoice:' || k.id)
      ) x;

      IF cardinality(v_summary.ids) > 0 THEN
        v_message := concat_ws(' ',
          CASE WHEN v_summary.payables > 0 THEN format('Do zapłaty: %s na %s (%s%s).',
            private.invoice_count_label(v_summary.payables), private.format_pln(v_summary.payables_total), v_summary.payable_items,
            CASE WHEN v_summary.payables > 3 THEN format(' i %s więcej', v_summary.payables - 3) ELSE '' END) END,
          CASE WHEN v_summary.receivables > 0 THEN format('Do otrzymania od klientów: %s na %s (%s%s).',
            private.invoice_count_label(v_summary.receivables), private.format_pln(v_summary.receivables_total), v_summary.receivable_items,
            CASE WHEN v_summary.receivables > 3 THEN format(' i %s więcej', v_summary.receivables - 3) ELSE '' END) END);
        INSERT INTO public.notifications(title, message, type, category, action_url, metadata, created_at)
        VALUES ('Minął termin płatności — ' || v_company.name, v_message, 'warning', 'system', '/crm/invoices?tab=ksef',
          jsonb_build_object('kind', 'finance_payment_reminder', 'reminder', 'overdue_new', 'company_id', v_company.id,
            'invoice_ids', to_jsonb(v_summary.ids)), now())
        RETURNING id INTO v_notification;
        INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
        SELECT v_notification, recipient, false FROM unnest(v_recipients) recipient
        ON CONFLICT (notification_id, user_id) DO NOTHING;
        INSERT INTO public.finance_reminder_log(reminder_key, notification_id, details)
        VALUES (v_key, v_notification, jsonb_build_object('payables', v_summary.payables, 'receivables', v_summary.receivables));
        INSERT INTO public.finance_reminder_log(reminder_key, notification_id, details)
        SELECT 'overdue-invoice:' || invoice_id, v_notification, jsonb_build_object('company_id', v_company.id)
        FROM unnest(v_summary.ids) invoice_id
        ON CONFLICT (reminder_key) DO NOTHING;
      END IF;
    END IF;

    -- 3.3 Poniedziałek: przegląd wszystkiego po terminie i faktur kosztowych bez terminu.
    v_key := format('overdue-weekly:%s:%s', v_company.id, v_today);
    IF extract(isodow FROM v_today) = 1
       AND NOT EXISTS (SELECT 1 FROM public.finance_reminder_log WHERE reminder_key = v_key) THEN
      SELECT
        count(*) FILTER (WHERE k.invoice_type = 'issued' AND k.payment_due_date < v_today) AS receivables,
        coalesce(sum(coalesce(k.amount_to_pay_gross, k.gross_amount))
          FILTER (WHERE k.invoice_type = 'issued' AND k.payment_due_date < v_today), 0) AS receivables_total,
        count(*) FILTER (WHERE k.invoice_type = 'received' AND k.payment_due_date < v_today) AS payables,
        coalesce(sum(coalesce(k.amount_to_pay_gross, k.gross_amount))
          FILTER (WHERE k.invoice_type = 'received' AND k.payment_due_date < v_today), 0) AS payables_total,
        count(*) FILTER (WHERE k.invoice_type = 'received' AND k.payment_due_date IS NULL) AS without_due_date
      INTO v_summary
      FROM public.ksef_invoices k
      WHERE k.my_company_id = v_company.id AND k.invoice_type IN ('received', 'issued')
        AND k.payment_status IN ('unpaid', 'overdue')
        AND coalesce(k.amount_to_pay_gross, k.gross_amount, 0) > 0;

      IF v_summary.receivables > 0 OR v_summary.payables > 0 OR v_summary.without_due_date > 0 THEN
        v_message := format('Należności po terminie: %s na %s. Zobowiązania po terminie: %s na %s.',
          private.invoice_count_label(v_summary.receivables), private.format_pln(v_summary.receivables_total),
          private.invoice_count_label(v_summary.payables), private.format_pln(v_summary.payables_total))
          || CASE WHEN v_summary.without_due_date > 0
               THEN format(' Faktury kosztowe bez terminu płatności (bez przypomnień): %s.', v_summary.without_due_date)
               ELSE '' END
          || ' Status płatności wynika z KSeF i uzgodnienia wyciągów — brakujący wyciąg zawyża te liczby.';
        INSERT INTO public.notifications(title, message, type, category, action_url, metadata, created_at)
        VALUES ('Przegląd płatności po terminie — ' || v_company.name, v_message, 'info', 'system', '/crm/invoices?tab=ksef',
          jsonb_build_object('kind', 'finance_payment_reminder', 'reminder', 'overdue_weekly', 'company_id', v_company.id,
            'receivables', v_summary.receivables, 'payables', v_summary.payables,
            'without_due_date', v_summary.without_due_date), now())
        RETURNING id INTO v_notification;
        INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
        SELECT v_notification, recipient, false FROM unnest(v_recipients) recipient
        ON CONFLICT (notification_id, user_id) DO NOTHING;
        INSERT INTO public.finance_reminder_log(reminder_key, notification_id, details)
        VALUES (v_key, v_notification, to_jsonb(v_summary));
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_notify_invoice_payments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_notify_invoice_payments() TO service_role;
COMMENT ON FUNCTION public.check_and_notify_invoice_payments() IS
  'Przypomnienia o płatnościach faktur KSeF dla „Zarządzania finansami” działalności (pg_cron 8:05 czasu polskiego): do zapłaty w 3 dni, nowe po terminie, przegląd w poniedziałki.';

-- 4. Harmonogram: 8:05 czasu polskiego (pg_cron działa w UTC — z dwóch godzin wykonuje się ta, która jest 8:xx) -------
DO $$
DECLARE v_job_id bigint;
BEGIN
  FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname = 'finance-payment-reminders' LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule('finance-payment-reminders', '5 6,7 * * *',
    $cron$SELECT public.check_and_notify_invoice_payments() WHERE to_char(now() AT TIME ZONE 'Europe/Warsaw', 'HH24') = '08';$cron$);
END $$;

COMMIT;
