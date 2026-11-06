-- Prowizja sprzedawcy zewnętrznego od zysku wydarzenia; sprzedawca wskazany w podsumowaniu; podsumowanie w portalu
-- ===============================================================================================================
-- Wymaga 20261105130000_event_settlement_commissions.sql i 20261105150000_seller_manager_cockpit.sql.
-- Można uruchomić ponownie. Zatwierdzone podsumowania zostają bez zmian (nowa zasada działa przy ponownym otwarciu).
--
-- Zasada: prowizja sprzedawcy zewnętrznego (hotel, agencja) = stawka × zysk netto, gdzie zysk netto jest już
-- pomniejszony o koszt tej prowizji dla firmy (gotówka z zysku: kwota / (1 − podatek)). Przykład: zysk przed
-- prowizją 3 400 zł, stawka 10%, gotówka z podatkiem 19% → podstawa 3 026,37 zł, prowizja 302,64 zł, koszt firmy
-- 373,63 zł (3 400 − 373,63 = 3 026,37). Prowizja pracownika (5% / 10%) liczy się od tego samego zysku netto.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Stawka sprzedawcy ustalona dla jednego wydarzenia (z powodem); zwykle obowiązuje stawka z karty sprzedawcy
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_external_seller_rates (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id) ON DELETE CASCADE,
  rate numeric(6,3) NOT NULL,
  reason text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, sales_partner_id),
  CONSTRAINT event_external_seller_rates_rate_check CHECK (rate > 0 AND rate <= 100),
  CONSTRAINT event_external_seller_rates_reason_check CHECK (length(btrim(reason)) BETWEEN 3 AND 500)
);
COMMENT ON TABLE public.event_external_seller_rates IS
  'Stawka prowizji sprzedawcy zewnętrznego ustalona dla jednego wydarzenia (pierwszeństwo przed kartą sprzedawcy). Zapis tylko przez RPC podsumowania.';
ALTER TABLE public.event_external_seller_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_external_seller_rates FROM PUBLIC, anon, authenticated;

-- Koszt firmy prowizji sprzedawcy zewnętrznego (jak calculate_event_commission_cost dla wpisu bez składek).
CREATE OR REPLACE FUNCTION private.external_commission_cost(p_amount numeric, p_method text, p_tax numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_method = 'cash_dividend'
              THEN round(coalesce(p_amount, 0) / (1 - least(99.99, greatest(0, coalesce(p_tax, 19))) / 100), 2)
              ELSE round(coalesce(p_amount, 0), 2) END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Podsumowanie: prowizja sprzedawcy zewnętrznego od zysku netto po koszcie tej prowizji; stawka dla wydarzenia
--    (zawiera też poprawki 20261105150000 §21: prowizja z „Ustaleń” i kontaktu rozliczeniowego tylko dla osoby,
--    która pracowała w organizacji w dniu wydarzenia).
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
  v_profit_before numeric := 0; v_rk numeric := 0; v_cand numeric; v_try numeric; v_gap numeric; v_best_gap numeric;
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

  -- Podstawę prowizji sprzedawców zewnętrznych (zysk netto po koszcie ich prowizji) liczymy po pozycjach
  -- prowizji ręcznych i narzutów (krok 4).

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
         -- Osoba pracowała w tej organizacji w dniu wydarzenia (odejście po wydarzeniu nie odbiera prowizji).
         AND EXISTS (SELECT 1 FROM public.contact_organizations r
                      WHERE r.contact_id = b.contact_id AND r.organization_id = b.organization_id
                        AND (r.is_current OR r.ended_at::date >= e.event_date::date))
      UNION ALL
      SELECT p.id, 'partner_arrangement', 4, NULL, a.organization_id, NULL
        FROM public.event_partner_arrangements a
        JOIN public.sales_partner_profiles p ON p.contact_id = a.contact_id
       WHERE a.event_id = p_event_id AND a.enabled AND a.contact_id IS NOT NULL
         -- Tylko osoba, która pracowała w tej organizacji w dniu wydarzenia (jak przy kontakcie rozliczeniowym).
         AND (a.organization_id IS NULL OR EXISTS (SELECT 1 FROM public.contact_organizations r
                WHERE r.contact_id = a.contact_id AND r.organization_id = a.organization_id
                  AND (r.is_current OR r.ended_at::date >= e.event_date::date)))
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
             coalesce(lc.rate, cur.rate) AS cur_rate, cur.payment_method AS cur_payment, cur.dividend_tax_rate AS cur_dividend,
             ov.rate AS ov_rate, ov.reason AS ov_reason
        FROM picked pk
        JOIN public.sales_partner_profiles p ON p.id = pk.pid
        LEFT JOIN public.contacts c ON c.id = p.contact_id
        LEFT JOIN public.employees emp ON emp.id = p.employee_id
        LEFT JOIN public.sales_partner_brand_terms t ON t.sales_partner_id = p.id AND t.my_company_id = e.my_company_id
        -- Stawka ustalona dla tego wydarzenia (z powodem) ma pierwszeństwo przed kartą sprzedawcy.
        LEFT JOIN public.event_external_seller_rates ov ON ov.event_id = p_event_id AND ov.sales_partner_id = pk.pid
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
             CASE WHEN r.ov_rate IS NOT NULL THEN r.ov_rate
                  WHEN r.retained AND NOT v_refresh_rates THEN r.cur_rate
                  WHEN r.src = 'seller_portal' AND r.commercial_model = 'commission' THEN coalesce(r.offer_rate, r.default_commission_rate)
                  ELSE r.default_commission_rate END AS rate,
             CASE WHEN r.ov_rate IS NOT NULL THEN 'Stawka ustalona dla tego wydarzenia: ' || r.ov_reason
                  WHEN r.retained AND NOT v_refresh_rates THEN 'Stawka z zatwierdzonego rozliczenia'
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
             coalesce(j.skip_reason, CASE WHEN coalesce(j.rate, 0) <= 0 THEN 'Stawka prowizji wynosi 0%.' END) AS reason
        FROM judged j
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'partner_id', c.pid, 'contact_id', c.contact_id, 'employee_id', c.employee_id, 'organization_id', c.org_id,
             'name', coalesce(c.person, 'Sprzedawca'), 'source', c.src, 'eligible', c.reason IS NULL,
             'skip_reason', c.reason, 'rate', c.rate, 'rate_reason', c.rate_reason, 'retained', c.retained,
             -- Kwoty uzupełnia krok 4a (podstawa od zysku po koszcie prowizji).
             'base', 0, 'amount', 0, 'company_cost', 0,
             'card_rate', c.default_commission_rate, 'rate_override', c.ov_rate IS NOT NULL,
             'previous_rate', CASE WHEN c.retained AND v_refresh_rates AND c.cur_rate IS DISTINCT FROM c.rate THEN c.cur_rate END,
             'payment_method', c.payment_method,
             'dividend_tax_rate', c.dividend,
             'commission_id', private.commission_uuid('mavinci:event-commission:' || p_event_id::text || ':' || c.pid::text))
             ORDER BY c.prio, c.person), '[]'::jsonb)
      INTO v_external
      FROM calc c;
  END IF;

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

  -- 4a. Prowizja sprzedawcy zewnętrznego jest kosztem firmy, więc liczymy ją od zysku netto po jej własnym koszcie
  --     (wypłata gotówką z zysku: kwota / (1 − podatek)). Podstawa B = P − Σ koszt_i, koszt_i = B × stawka_i × k_i,
  --     czyli B = P / (1 + Σ stawka_i × k_i); P = zysk przed prowizjami sprzedawców zewnętrznych.
  v_profit_before := round(v_revenue - v_sub - v_direct - v_team - v_ext_lines, 2);
  SELECT coalesce(sum((x->>'rate')::numeric / 100
           * CASE WHEN x->>'payment_method' = 'cash_dividend'
                  THEN 1 / (1 - least(99.99, greatest(0, coalesce((x->>'dividend_tax_rate')::numeric, 19))) / 100)
                  ELSE 1 END), 0)
    INTO v_rk FROM jsonb_array_elements(v_external) x WHERE (x->>'eligible')::boolean;
  IF v_profit_before <= 0 THEN
    v_partner_base := 0;
  ELSIF v_rk <= 0 THEN
    v_partner_base := v_profit_before;
  ELSE
    -- Grosze: z sąsiednich kwot wybieramy tę, przy której zysk − koszt prowizji = podstawa co do grosza.
    v_cand := round(v_profit_before / (1 + v_rk), 2);
    v_partner_base := v_cand; v_best_gap := NULL;
    FOREACH v_try IN ARRAY ARRAY[v_cand, v_cand - 0.01, v_cand + 0.01, v_cand - 0.02, v_cand + 0.02] LOOP
      CONTINUE WHEN v_try < 0;
      SELECT abs(v_profit_before - v_try - coalesce(sum(private.external_commission_cost(
               round(v_try * (x->>'rate')::numeric / 100, 2), x->>'payment_method', (x->>'dividend_tax_rate')::numeric)), 0))
        INTO v_gap FROM jsonb_array_elements(v_external) x WHERE (x->>'eligible')::boolean;
      IF v_best_gap IS NULL OR v_gap < v_best_gap THEN v_best_gap := v_gap; v_partner_base := v_try; END IF;
      EXIT WHEN v_gap = 0;
    END LOOP;
  END IF;

  SELECT coalesce(jsonb_agg(x || jsonb_build_object(
           'base', v_partner_base,
           'amount', CASE WHEN (x->>'eligible')::boolean THEN round(v_partner_base * (x->>'rate')::numeric / 100, 2) ELSE 0 END,
           'company_cost', CASE WHEN (x->>'eligible')::boolean
                                THEN private.external_commission_cost(round(v_partner_base * (x->>'rate')::numeric / 100, 2),
                                       x->>'payment_method', (x->>'dividend_tax_rate')::numeric)
                                ELSE 0 END)
           ORDER BY ord), '[]'::jsonb)
    INTO v_external FROM jsonb_array_elements(v_external) WITH ORDINALITY AS t(x, ord);

  SELECT coalesce(sum((x->>'company_cost')::numeric) FILTER (WHERE (x->>'eligible')::boolean), 0)
    INTO v_ext_auto FROM jsonb_array_elements(v_external) x;

  v_profit := round(v_profit_before - v_ext_auto, 2);

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
      'profit_before_external', v_profit_before,
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

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Wpisy w ewidencji prowizji: opis podstawy sprzedawcy zewnętrznego (zysk netto po koszcie prowizji)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.commission_target_rows(p_event_id uuid, ctx jsonb)
RETURNS TABLE(commission_id uuid, beneficiary_type text, beneficiary_name text, sales_partner_id uuid, employee_id uuid,
              contact_id uuid, organization_id uuid, rate numeric, base_amount numeric, payment_method text,
              dividend_tax_rate numeric, automatic_source text, base_description text, rate_reason text,
              share_percent numeric, client_owned boolean, amount numeric, employer_social_rate numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT (x->>'commission_id')::uuid, 'salesperson', x->>'name', (x->>'partner_id')::uuid, (x->>'employee_id')::uuid,
         (x->>'contact_id')::uuid, (x->>'organization_id')::uuid, (x->>'rate')::numeric, (x->>'base')::numeric,
         x->>'payment_method', (x->>'dividend_tax_rate')::numeric, x->>'source',
         format('Zysk netto %s zł − koszt prowizji sprzedawców zewnętrznych %s zł = %s zł%s',
           private.pl_money(coalesce((ctx#>>'{totals,profit_before_external}')::numeric, 0)),
           private.pl_money(coalesce((ctx#>>'{totals,external_commission_auto}')::numeric, 0)),
           private.pl_money((x->>'base')::numeric),
           -- Stawka × podstawa i koszt prowizji zaokrąglane do grosza nie zawsze dają równość co do grosza.
           CASE WHEN round(coalesce((ctx#>>'{totals,profit_before_external}')::numeric, 0)
                           - coalesce((ctx#>>'{totals,external_commission_auto}')::numeric, 0), 2) <> (x->>'base')::numeric
                  AND (x->>'base')::numeric > 0
                THEN ' (różnica do 2 gr z zaokrągleń)' ELSE '' END),
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

-- ---------------------------------------------------------------------------------------------------------------
-- 4. CRM: sprzedawca zewnętrzny w podsumowaniu wydarzenia (dodanie, stawka dla wydarzenia, usunięcie)
--    Zmienia sprzedawca wydarzenia, finanse lub administrator — w wersji roboczej. Każda funkcja zwraca pełne
--    podsumowanie (get_event_settlement), tak jak pozostałe zapisy podsumowania.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.settlement_seller_reason(p_reason text, p_label text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 3 OR length(btrim(p_reason)) > 500 THEN
    RAISE EXCEPTION '%', p_label USING ERRCODE = '22023';
  END IF;
  RETURN btrim(p_reason);
END $$;

-- Podpowiedzi do „Dodaj sprzedawcę”: bez wyszukiwania — osoby związane z wydarzeniem (osoba kontaktowa, kontakt
-- rozliczeniowy, pracownicy klienta), z wyszukiwaniem — aktywni sprzedawcy zewnętrzni po nazwisku lub organizacji.
CREATE OR REPLACE FUNCTION public.list_event_seller_candidates(p_event_id uuid, p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE e public.events%ROWTYPE; ctx jsonb; v_rows jsonb; v_q text;
BEGIN
  IF NOT coalesce(private.event_settlement_can_fill(p_event_id), false) THEN
    RAISE EXCEPTION 'Brak uprawnień do podsumowania tego wydarzenia.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono wydarzenia.'; END IF;
  v_q := nullif(btrim(coalesce(p_search, '')), '');
  IF v_q IS NOT NULL THEN
    v_q := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;
  ctx := private.event_settlement_compute(p_event_id);

  WITH base AS (
    SELECT p.id, p.contact_id, p.organization_id,
           coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
                    nullif(btrim(concat_ws(' ', emp.name, emp.surname)), ''), 'Sprzedawca') AS person,
           coalesce(nullif(btrim(o.alias), ''), o.name) AS org_name,
           t.is_active AS terms_active, t.commission_enabled, t.default_commission_rate AS rate,
           t.default_payment_method AS payment_method,
           CASE WHEN p.contact_id IS NOT NULL AND p.contact_id = e.contact_person_id THEN 'Osoba kontaktowa wydarzenia'
                WHEN p.contact_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.event_billing_contacts b
                                                           WHERE b.event_id = e.id AND b.contact_id = p.contact_id)
                  THEN 'Kontakt rozliczeniowy wydarzenia'
                WHEN p.organization_id IS NOT NULL AND p.organization_id IN (e.organization_id, e.billing_organization_id)
                  THEN 'Pracuje u klienta wydarzenia'
           END AS suggestion
      FROM public.sales_partner_profiles p
      LEFT JOIN public.contacts c ON c.id = p.contact_id
      LEFT JOIN public.employees emp ON emp.id = p.employee_id
      LEFT JOIN public.organizations o ON o.id = p.organization_id
      LEFT JOIN public.sales_partner_brand_terms t ON t.sales_partner_id = p.id AND t.my_company_id = e.my_company_id
     WHERE p.status = 'active' AND p.partner_type <> 'internal_employee'
  ),
  picked AS (
    SELECT * FROM base b
     WHERE (v_q IS NULL AND b.suggestion IS NOT NULL)
        OR (v_q IS NOT NULL AND (b.person ILIKE v_q OR coalesce(b.org_name, '') ILIKE v_q))
     ORDER BY (b.suggestion IS NULL), b.person
     LIMIT 20
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'partner_id', b.id, 'name', b.person, 'organization', b.org_name,
           'rate', b.rate, 'payment_method', b.payment_method,
           'ready', coalesce(b.terms_active AND b.commission_enabled, false),
           'suggestion', b.suggestion,
           'in_event', EXISTS (SELECT 1 FROM jsonb_array_elements(ctx->'external') x WHERE x->>'partner_id' = b.id::text))
           ORDER BY (b.suggestion IS NULL), b.person), '[]'::jsonb)
    INTO v_rows FROM picked b;
  RETURN v_rows;
END $$;

-- Dodaje sprzedawcę zewnętrznego do podsumowania (źródło „dodany ręcznie”). p_rate = stawka tylko dla tego
-- wydarzenia (wymaga powodu); bez niej obowiązuje % od zysku z karty sprzedawcy.
CREATE OR REPLACE FUNCTION public.add_event_settlement_seller(p_event_id uuid, p_sales_partner_id uuid,
  p_rate numeric DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_prev text := coalesce(current_setting('mavinci.commission_engine', true), ''); e public.events%ROWTYPE;
  p public.sales_partner_profiles%ROWTYPE; t public.sales_partner_brand_terms%ROWTYPE; v_id uuid; v_name text;
  ctx jsonb; v_reason text; v_actor uuid := public.current_invoice_employee_id(); v_rate numeric;
BEGIN
  PERFORM private.lock_event_settlement(p_event_id);
  IF NOT coalesce(private.event_settlement_can_edit(p_event_id), false) THEN
    RAISE EXCEPTION 'Sprzedawcę dodasz w wersji roboczej podsumowania (sprzedawca wydarzenia, finanse lub administrator).'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF e.status::text = 'cancelled' THEN RAISE EXCEPTION 'Wydarzenie jest anulowane — nie ma czego rozliczać.'; END IF;
  IF e.my_company_id IS NULL THEN RAISE EXCEPTION 'Wydarzenie nie ma marki — ustaw markę, aby naliczyć prowizję sprzedawcy.'; END IF;
  SELECT * INTO p FROM public.sales_partner_profiles WHERE id = p_sales_partner_id;
  IF NOT FOUND OR p.status <> 'active' OR p.partner_type = 'internal_employee' THEN
    RAISE EXCEPTION 'Wybierz aktywnego sprzedawcę zewnętrznego z kartoteki.';
  END IF;
  SELECT * INTO t FROM public.sales_partner_brand_terms
   WHERE sales_partner_id = p.id AND my_company_id = e.my_company_id;
  IF NOT FOUND OR NOT (t.is_active AND t.commission_enabled) THEN
    RAISE EXCEPTION 'Sprzedawca nie ma włączonej prowizji dla marki wydarzenia. Ustaw jego %% od zysku na karcie sprzedawcy.';
  END IF;
  v_rate := round(p_rate, 3);
  IF v_rate IS NOT NULL THEN
    IF v_rate <= 0 OR v_rate > 100 THEN RAISE EXCEPTION 'Stawka dla wydarzenia musi być większa od 0%% i nie większa niż 100%%.'; END IF;
    v_reason := private.settlement_seller_reason(p_reason, 'Podaj powód stawki dla tego wydarzenia (od 3 do 500 znaków).');
  ELSIF coalesce(t.default_commission_rate, 0) <= 0 THEN
    RAISE EXCEPTION 'Stawka sprzedawcy wynosi 0%% — ustaw %% od zysku na karcie sprzedawcy albo podaj stawkę dla tego wydarzenia.';
  END IF;

  ctx := private.event_settlement_compute(p_event_id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(ctx->'external') x WHERE x->>'partner_id' = p.id::text) THEN
    RAISE EXCEPTION 'Ten sprzedawca jest już w podsumowaniu wydarzenia — stawkę zmienisz przy jego prowizji.';
  END IF;
  v_id := private.commission_uuid('mavinci:event-commission:' || p_event_id::text || ':' || p.id::text);
  IF EXISTS (SELECT 1 FROM public.event_commissions c
              WHERE c.event_id = p_event_id AND c.status <> 'cancelled' AND c.id <> v_id AND c.entry_kind = 'accrual'
                AND (c.sales_partner_id = p.id OR (p.contact_id IS NOT NULL AND c.contact_id = p.contact_id))) THEN
    RAISE EXCEPTION 'Ten sprzedawca ma już wpis prowizji w tym wydarzeniu — sprawdź „Zapisane prowizje”.';
  END IF;

  SELECT coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''))
    INTO v_name FROM public.contacts c WHERE c.id = p.contact_id;
  PERFORM set_config('mavinci.commission_engine', 'on', true);
  INSERT INTO public.event_commissions (id, event_id, beneficiary_type, beneficiary_name, sales_partner_id, employee_id, contact_id,
    organization_id, calculation_type, rate, base_amount, amount, status, created_by, automatic_source, automatic_company_id,
    automatic_waiting_for_offer, entry_kind, base_description)
  VALUES (v_id, p_event_id, 'salesperson', coalesce(v_name, 'Sprzedawca'), p.id, p.employee_id, p.contact_id, p.organization_id,
    'percent', 0, 0, 0, 'planned', v_actor, 'manual_partner', e.my_company_id, false, 'accrual',
    'Dodany w podsumowaniu wydarzenia — kwota według podsumowania')
  ON CONFLICT (id) DO UPDATE SET status = 'planned', auto_cancelled = false, cancel_reason = NULL, automatic_source = 'manual_partner'
    WHERE event_commissions.status = 'cancelled' AND event_commissions.automatic_source = ANY (private.commission_auto_sources());
  IF NOT EXISTS (SELECT 1 FROM public.event_commissions c WHERE c.id = v_id AND c.status <> 'cancelled') THEN
    PERFORM set_config('mavinci.commission_engine', v_prev, true);
    RAISE EXCEPTION 'Tej prowizji nie da się przywrócić automatycznie — sprawdź „Zapisane prowizje” albo poproś finanse.';
  END IF;
  PERFORM set_config('mavinci.commission_engine', v_prev, true);

  IF v_rate IS NOT NULL THEN
    INSERT INTO public.event_external_seller_rates (event_id, sales_partner_id, rate, reason, created_by, updated_by)
    VALUES (p_event_id, p.id, v_rate, v_reason, v_actor, v_actor)
    ON CONFLICT (event_id, sales_partner_id) DO UPDATE
      SET rate = EXCLUDED.rate, reason = EXCLUDED.reason, updated_by = v_actor, updated_at = now();
  ELSE
    DELETE FROM public.event_external_seller_rates WHERE event_id = p_event_id AND sales_partner_id = p.id;
  END IF;

  PERFORM private.refresh_event_commissions(p_event_id);

  -- Sprzedawca z widocznym wynagrodzeniem dostaje informację, że wydarzenie jest w jego rozliczeniach.
  IF public.seller_commissions_visible(p.id, e.my_company_id) THEN
    PERFORM private.notify_seller_portal(p.id, e.my_company_id, 'Nowe wydarzenie w Twoich rozliczeniach',
      format('%s · prowizja %s%% od zysku — podsumowanie wydarzenia zobaczysz w „Moje wynagrodzenie”.',
             coalesce(e.name, 'Wydarzenie'), private.pl_number(coalesce(v_rate, t.default_commission_rate))),
      '/seller/commissions?event=' || p_event_id::text, 'seller_commission', 'event', p_event_id,
      jsonb_build_object('event_id', p_event_id, 'kind', 'seller_added'));
  END IF;
  RETURN public.get_event_settlement(p_event_id);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('mavinci.commission_engine', v_prev, true);
  RAISE;
END $$;

-- Stawka sprzedawcy tylko dla tego wydarzenia (p_rate NULL = wróć do stawki z karty sprzedawcy).
CREATE OR REPLACE FUNCTION public.set_event_settlement_seller_rate(p_event_id uuid, p_sales_partner_id uuid,
  p_rate numeric, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ctx jsonb; v_reason text; v_rate numeric := round(p_rate, 3); v_actor uuid := public.current_invoice_employee_id();
BEGIN
  PERFORM private.lock_event_settlement(p_event_id);
  IF NOT coalesce(private.event_settlement_can_edit(p_event_id), false) THEN
    RAISE EXCEPTION 'Stawkę zmienisz w wersji roboczej podsumowania (sprzedawca wydarzenia, finanse lub administrator).'
      USING ERRCODE = '42501';
  END IF;
  ctx := private.event_settlement_compute(p_event_id);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ctx->'external') x WHERE x->>'partner_id' = p_sales_partner_id::text) THEN
    RAISE EXCEPTION 'Tego sprzedawcy nie ma w podsumowaniu wydarzenia — najpierw go dodaj.';
  END IF;
  IF v_rate IS NULL THEN
    DELETE FROM public.event_external_seller_rates WHERE event_id = p_event_id AND sales_partner_id = p_sales_partner_id;
  ELSE
    IF v_rate <= 0 OR v_rate > 100 THEN RAISE EXCEPTION 'Stawka dla wydarzenia musi być większa od 0%% i nie większa niż 100%%.'; END IF;
    v_reason := private.settlement_seller_reason(p_reason, 'Podaj powód stawki dla tego wydarzenia (od 3 do 500 znaków).');
    INSERT INTO public.event_external_seller_rates (event_id, sales_partner_id, rate, reason, created_by, updated_by)
    VALUES (p_event_id, p_sales_partner_id, v_rate, v_reason, v_actor, v_actor)
    ON CONFLICT (event_id, sales_partner_id) DO UPDATE
      SET rate = EXCLUDED.rate, reason = EXCLUDED.reason, updated_by = v_actor, updated_at = now();
  END IF;
  PERFORM private.refresh_event_commissions(p_event_id);
  RETURN public.get_event_settlement(p_event_id);
END $$;

-- Usuwa z podsumowania sprzedawcę dodanego ręcznie (z powodem). Sprzedawców wynikających z danych wydarzenia
-- (portal, polecenie, kontakt rozliczeniowy, „Ustalenia”) się nie usuwa — ich prowizję anuluje finanse / administrator.
CREATE OR REPLACE FUNCTION public.remove_event_settlement_seller(p_event_id uuid, p_sales_partner_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_prev text := coalesce(current_setting('mavinci.commission_engine', true), ''); ctx jsonb; v_reason text;
  v_src text; v_id uuid;
BEGIN
  PERFORM private.lock_event_settlement(p_event_id);
  IF NOT coalesce(private.event_settlement_can_edit(p_event_id), false) THEN
    RAISE EXCEPTION 'Sprzedawcę usuniesz w wersji roboczej podsumowania (sprzedawca wydarzenia, finanse lub administrator).'
      USING ERRCODE = '42501';
  END IF;
  v_reason := private.settlement_seller_reason(p_reason, 'Podaj powód usunięcia sprzedawcy z podsumowania (od 3 do 500 znaków).');
  ctx := private.event_settlement_compute(p_event_id);
  SELECT x->>'source' INTO v_src FROM jsonb_array_elements(ctx->'external') x WHERE x->>'partner_id' = p_sales_partner_id::text;
  IF v_src IS NULL THEN RAISE EXCEPTION 'Tego sprzedawcy nie ma w podsumowaniu wydarzenia.'; END IF;
  IF v_src <> 'manual_partner' THEN
    RAISE EXCEPTION 'Tego sprzedawcę wskazują dane wydarzenia — nie usuwa się go z podsumowania. Jego prowizję może anulować finanse lub administrator.';
  END IF;
  v_id := private.commission_uuid('mavinci:event-commission:' || p_event_id::text || ':' || p_sales_partner_id::text);
  IF EXISTS (SELECT 1 FROM public.event_commission_payouts po WHERE po.commission_id = v_id) THEN
    RAISE EXCEPTION 'Prowizja tego sprzedawcy ma wypłaty — zmiana wymaga ponownego zatwierdzenia podsumowania.';
  END IF;
  PERFORM set_config('mavinci.commission_engine', 'on', true);
  UPDATE public.event_commissions SET status = 'cancelled', auto_cancelled = false, cancel_reason = 'Usunięty z podsumowania: ' || v_reason
   WHERE id = v_id AND status <> 'cancelled';
  -- Wpis anulowany automatycznie (kwota 0) — oznacz jako decyzję osoby, żeby nie wrócił sam.
  UPDATE public.event_commissions SET auto_cancelled = false, cancel_reason = 'Usunięty z podsumowania: ' || v_reason
   WHERE id = v_id AND status = 'cancelled' AND auto_cancelled;
  PERFORM set_config('mavinci.commission_engine', v_prev, true);
  DELETE FROM public.event_external_seller_rates WHERE event_id = p_event_id AND sales_partner_id = p_sales_partner_id;
  PERFORM private.refresh_event_commissions(p_event_id);
  RETURN public.get_event_settlement(p_event_id);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('mavinci.commission_engine', v_prev, true);
  RAISE;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Portal: prowizje tylko z marek z widocznym wynagrodzeniem (jak 20261105150000 §19–20 — w bazie jest starsza
--    wersja bez tego filtra)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_seller_portal_commissions()
RETURNS TABLE(id uuid, event_id uuid, event_name text, event_date timestamp with time zone, amount numeric, status text, due_date date, paid_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT commission.id, commission.event_id, event.name, event.event_date::timestamptz,
         CASE WHEN commission.entry_kind = 'deduction' THEN -commission.amount ELSE commission.amount END,
         commission.status, commission.due_date, commission.paid_at
  FROM public.event_commissions commission
  JOIN public.events event ON event.id = commission.event_id
  WHERE commission.sales_partner_id = public.current_sales_partner_id()
    AND commission.status <> 'cancelled'
    AND EXISTS (
      SELECT 1 FROM public.sales_partner_brand_terms term
      WHERE term.sales_partner_id = commission.sales_partner_id AND term.my_company_id = event.my_company_id
        AND term.is_active = true AND term.commission_enabled = true AND term.commissions_visible = true)
  ORDER BY event.event_date DESC NULLS LAST, commission.created_at DESC;
$function$;

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
      IF NOT ((account_type = 'partner' AND public.seller_partner_is_mine(account_id))
           OR (account_type = 'contact' AND (EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = account_id AND c.owner_id = public.current_invoice_employee_id())
               OR EXISTS (SELECT 1 FROM public.sales_partner_profiles p WHERE p.contact_id = account_id AND public.seller_partner_is_mine(p.id))))) THEN
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
    'base_amount', c.base_amount, 'rate', c.rate,
    -- Portal: stawka i kwota podstawy, bez rozbicia kosztów Mavinci i bez opisów z CRM.
    'base_description', CASE WHEN p_mode = 'seller' THEN NULL ELSE c.base_description END,
    'rate_reason', CASE WHEN p_mode = 'seller' THEN NULL ELSE c.rate_reason END,
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
  WHERE ((p_mode = 'seller' AND public.seller_commissions_visible(coalesce(c.sales_partner_id, account_id), e.my_company_id)) OR (own_account AND c.employee_id = account_id AND c.beneficiary_type = 'employee') OR CASE WHEN sales_scope THEN public.sales_commission_visible(c.id)
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

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Portal: podsumowanie wydarzenia dla sprzedawcy zewnętrznego (przejrzystość: od czego liczy się jego prowizja)
--    Tylko własne wydarzenia (sprzedawca jest w podsumowaniu albo ma wpis prowizji) i tylko marki z widocznym
--    wynagrodzeniem. Wysłane / zatwierdzone — wersja z chwili wysłania / zatwierdzenia; wersja robocza — prognoza.
--    Pozycje z kwotą netto; ekipa jedną kwotą (bez nazwisk i stawek); bez prowizji pracowników, notatek i opisów
--    wewnętrznych; prowizje innych sprzedawców bez nazwisk.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_seller_event_summary(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_partner uuid := public.current_sales_partner_id(); e public.events%ROWTYPE; st public.event_settlements%ROWTYPE;
  ctx jsonb; v_source text; v_at timestamptz; mine jsonb; v_lines jsonb; v_commissions jsonb; tot jsonb;
  v_profit_before numeric; v_ext_auto numeric; v_rule text;
BEGIN
  IF auth.uid() IS NULL OR v_partner IS NULL THEN
    RAISE EXCEPTION 'Brak dostępu do portalu sprzedawcy.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR NOT public.seller_commissions_visible(v_partner, e.my_company_id) THEN
    RAISE EXCEPTION 'Podsumowanie tego wydarzenia nie jest dostępne.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO st FROM public.event_settlements WHERE event_id = p_event_id;
  IF st.status IN ('submitted', 'approved') THEN
    SELECT v.snapshot, v.created_at INTO ctx, v_at
      FROM public.event_settlement_versions v
     WHERE v.event_id = p_event_id AND v.action = st.status
     ORDER BY v.created_at DESC LIMIT 1;
    v_source := st.status;
  END IF;
  IF ctx IS NULL THEN
    ctx := private.event_settlement_compute(p_event_id);
    v_source := 'forecast';
    v_at := now();
  END IF;

  SELECT x INTO mine FROM jsonb_array_elements(ctx->'external') x
   WHERE x->>'partner_id' = v_partner::text AND (x->>'eligible')::boolean LIMIT 1;
  IF mine IS NULL AND NOT EXISTS (
       SELECT 1 FROM public.event_commissions c
        WHERE c.event_id = p_event_id AND c.sales_partner_id = v_partner AND c.status <> 'cancelled') THEN
    RAISE EXCEPTION 'Podsumowanie tego wydarzenia nie jest dostępne.' USING ERRCODE = '42501';
  END IF;

  WITH l AS (
    SELECT x, ord FROM jsonb_array_elements(ctx->'lines') WITH ORDINALITY AS t(x, ord)
     WHERE coalesce((x->>'included')::boolean, false) AND coalesce((x->>'net_amount')::numeric, 0) <> 0
  ),
  shown AS (
    SELECT l.ord, x->>'kind' AS kind, x->>'category' AS category,
           CASE WHEN x->>'category' = 'external_commission' THEN 'Prowizja lub narzut sprzedawcy zewnętrznego'
                ELSE coalesce(nullif(btrim(x->>'name'), ''), 'Pozycja') END AS name,
           (x->>'net_amount')::numeric AS net, x->>'date' AS line_date,
           coalesce((x->>'needs_confirmation')::boolean, false) AS to_confirm
      FROM l WHERE x->>'category' <> 'team'
    UNION ALL
    SELECT min(l.ord), 'cost', 'team', 'Ekipa MAVINCI (ewidencja czasu pracy)', sum((x->>'net_amount')::numeric), NULL,
           bool_or(coalesce((x->>'needs_confirmation')::boolean, false))
      FROM l WHERE x->>'category' = 'team' HAVING count(*) > 0
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', s.kind, 'category', s.category, 'name', s.name,
           'net_amount', round(s.net, 2), 'date', s.line_date, 'to_confirm', s.to_confirm)
           ORDER BY CASE WHEN s.kind = 'revenue' THEN 0 ELSE 1 END, s.ord), '[]'::jsonb)
    INTO v_lines FROM shown s;

  -- Wersje zatwierdzone przed zmianą zasady (20261106) nie mają „zysku przed prowizjami sprzedawców”.
  v_rule := CASE WHEN ctx->'totals' ? 'profit_before_external' THEN 'profit' ELSE 'revenue_minus_subcontractors' END;
  v_ext_auto := coalesce((ctx#>>'{totals,external_commission_auto}')::numeric, 0);
  v_profit_before := coalesce((ctx#>>'{totals,profit_before_external}')::numeric,
    round(coalesce((ctx#>>'{totals,revenue_net}')::numeric, 0) - coalesce((ctx#>>'{totals,subcontractor_net}')::numeric, 0)
          - coalesce((ctx#>>'{totals,direct_cost_net}')::numeric, 0) - coalesce((ctx#>>'{totals,team_net}')::numeric, 0)
          - coalesce((ctx#>>'{totals,external_commission_lines}')::numeric, 0), 2));
  tot := jsonb_build_object(
    'revenue_net', coalesce((ctx#>>'{totals,revenue_net}')::numeric, 0),
    'subcontractor_net', coalesce((ctx#>>'{totals,subcontractor_net}')::numeric, 0),
    'direct_cost_net', coalesce((ctx#>>'{totals,direct_cost_net}')::numeric, 0),
    'team_net', coalesce((ctx#>>'{totals,team_net}')::numeric, 0),
    'external_commission_lines', coalesce((ctx#>>'{totals,external_commission_lines}')::numeric, 0),
    'profit_before_external', v_profit_before,
    'external_commission_auto', v_ext_auto,
    'own_commission_cost', coalesce((mine->>'company_cost')::numeric, 0),
    'other_sellers_cost', greatest(0, round(v_ext_auto - coalesce((mine->>'company_cost')::numeric, 0), 2)),
    'profit_net', coalesce((ctx#>>'{totals,profit_net}')::numeric, 0),
    'partner_base', coalesce((ctx#>>'{totals,partner_base}')::numeric, 0),
    'event_costs_net', round(coalesce((ctx#>>'{totals,revenue_net}')::numeric, 0) - v_profit_before, 2),
    -- Stawka × podstawa i koszt prowizji zaokrąglane do grosza: różnica (zwykle 0) do pokazania wprost.
    'rounding_difference', CASE WHEN v_rule = 'profit' AND coalesce((mine->>'base')::numeric, 0) > 0
                                THEN round(v_profit_before - v_ext_auto - (mine->>'base')::numeric, 2) ELSE 0 END);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'entry_kind', c.entry_kind, 'status', c.status, 'amount', c.amount, 'rate', c.rate,
           'base_amount', c.base_amount, 'payment_method', c.payment_method,
           'paid_amount', coalesce((SELECT sum(po.amount) FROM public.event_commission_payouts po
                                     WHERE po.commission_id = c.id AND NOT po.is_offset), 0),
           'offset_amount', coalesce((SELECT sum(po.amount) FROM public.event_commission_payouts po
                                       WHERE po.commission_id = c.id AND po.is_offset), 0))
           ORDER BY c.created_at), '[]'::jsonb)
    INTO v_commissions
    FROM public.event_commissions c
   WHERE c.event_id = p_event_id AND c.sales_partner_id = v_partner AND c.status <> 'cancelled';

  RETURN jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'name', e.name, 'date', e.event_date, 'end_date', e.event_end_date,
                                'location', nullif(btrim(coalesce(e.location, '')), ''), 'cancelled', e.status::text = 'cancelled'),
    'source', v_source,
    'as_of', v_at,
    'base_rule', v_rule,
    'forecast', coalesce((ctx->>'forecast')::boolean, false),
    'lines', v_lines,
    'totals', tot,
    'mine', CASE WHEN mine IS NULL THEN NULL ELSE jsonb_build_object(
      'rate', (mine->>'rate')::numeric,
      'rate_label', CASE WHEN coalesce((mine->>'rate_override')::boolean, false) THEN 'Stawka ustalona dla tego wydarzenia'
                         WHEN mine->>'rate_reason' = 'Stawka uzgodniona w ofercie sprzedawcy' THEN 'Stawka uzgodniona w Twojej ofercie'
                         WHEN mine->>'rate_reason' = 'Stawka z zatwierdzonego rozliczenia' THEN 'Stawka z zatwierdzonego rozliczenia'
                         ELSE 'Stawka z Twoich warunków współpracy' END,
      'base', (mine->>'base')::numeric, 'amount', (mine->>'amount')::numeric,
      'company_cost', (mine->>'company_cost')::numeric,
      'payment_method', mine->>'payment_method', 'dividend_tax_rate', (mine->>'dividend_tax_rate')::numeric) END,
    'commissions', v_commissions);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Prognoza prowizji według nowej zasady dla trwających wydarzeń w wersji roboczej (zatwierdzone bez zmian)
-- ---------------------------------------------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT e.id FROM public.events e
      LEFT JOIN public.event_settlements s ON s.event_id = e.id
     WHERE e.status::text IN ('offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress', 'completed', 'invoiced')
       AND coalesce(s.status, 'draft') = 'draft'
       AND private.event_settlement_tracked(e.id)
  LOOP
    PERFORM private.refresh_event_commissions_safe(r.id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Uprawnienia
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION private.external_commission_cost(numeric, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.settlement_seller_reason(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.event_settlement_compute(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.commission_target_rows(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_event_seller_candidates(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_event_settlement_seller(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_event_settlement_seller_rate(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_event_settlement_seller(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_seller_event_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_event_seller_candidates(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_event_settlement_seller(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_settlement_seller_rate(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_event_settlement_seller(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_event_summary(uuid) TO authenticated;
