-- Narzut sprzedawcy jako należność do wypłaty na jego koncie prowizji.
--
-- Oferta z portalu rozliczana narzutem: narzut nie jest naszym przychodem. Gdy jest w naszej fakturze (rozliczenie
-- bezpośrednie), podsumowanie wydarzenia liczy go jako koszt (pozycja „Narzut sprzedawcy zewnętrznego”), ale nie było wpisu
-- do wypłaty — narzut nie trafiał na konto sprzedawcy, nie miał rejestru wypłat i można go było zapłacić dwa razy (np. jako
-- ręczną prowizję). Teraz podsumowanie tworzy dla niego wpis automatyczny `seller_markup` (jak prowizje sprzedawców):
-- planowany przed zatwierdzeniem podsumowania, do wypłaty po zatwierdzeniu, z rejestrem wypłat, dopłatą lub potrąceniem przy
-- ponownym rozliczeniu. Kosztem w podsumowaniu pozostaje pozycja narzutu — wpis nie pomniejsza zysku drugi raz (wpisy
-- automatyczne nie są pozycjami kosztów). Narzut poza naszą fakturą (rozliczenie przez hotel / agencję) — bez wpisu.
--
-- Zmiany: źródło `seller_markup` na liście źródeł automatycznych; wiersze docelowe silnika prowizji z pozycji narzutu;
-- kontrola „rozliczenie prowizyjne marki” nie dotyczy narzutu (sprzedawca z narzutem z definicji go nie ma); kalkulacja zysku
-- opiekuna pomija wpisy narzutu (narzut i tak nie jest przychodem). Fragmenty definicji są podmieniane dokładnie — inna
-- definicja zatrzymuje migrację, reszta funkcji zostaje bez zmian (CREATE OR REPLACE zachowuje uprawnienia).

CREATE OR REPLACE FUNCTION private.commission_auto_sources()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT ARRAY['sales_share', 'billing_contact', 'event_referral', 'partner_arrangement', 'seller_portal', 'manual_partner', 'seller_markup']::text[];
$function$;

DO $migration$
DECLARE
  def text;
  old_fragment text;
  new_fragment text;
BEGIN
  -- 1. Wiersze docelowe silnika prowizji: narzut z oferty z narzutem, gdy pozycja narzutu liczy się w podsumowaniu.
  def := pg_get_functiondef('private.commission_target_rows(uuid,jsonb)'::regprocedure);
  old_fragment := E'   WHERE (x->>''enabled'')::boolean AND x->>''blocked_reason'' IS NULL;';
  new_fragment := E'   WHERE (x->>''enabled'')::boolean AND x->>''blocked_reason'' IS NULL\n'
    || E'  UNION ALL\n'
    || E'  -- Narzut sprzedawcy z oferty z narzutem w naszej fakturze: należność sprzedawcy do wypłaty (kwota = narzut netto,\n'
    || E'  -- stawka 100% od narzutu). Kosztem w podsumowaniu pozostaje pozycja narzutu.\n'
    || E'  SELECT private.commission_uuid(''mavinci:seller-markup:'' || p_event_id::text || '':'' || (l->>''source_id'')),\n'
    || E'         ''salesperson'',\n'
    || E'         coalesce(nullif(btrim(c.full_name), ''''), nullif(btrim(concat_ws('' '', c.first_name, c.last_name)), ''''),\n'
    || E'                  nullif(btrim(concat_ws('' '', emp.name, emp.surname)), ''''), ''Sprzedawca''),\n'
    || E'         p.id, p.employee_id, p.contact_id, p.organization_id, 100::numeric, (l->>''net_amount'')::numeric,\n'
    || E'         coalesce(t.default_payment_method, ''invoice''), coalesce(t.dividend_tax_rate, 19), ''seller_markup'',\n'
    || E'         format(''Narzut w ofercie %s rozliczanej narzutem: %s zł — w naszej fakturze, należy się sprzedawcy'',\n'
    || E'           coalesce(nullif(btrim(o.offer_number), ''''), ''bez numeru''), private.pl_money((l->>''net_amount'')::numeric)),\n'
    || E'         ''Narzut sprzedawcy (oferta z narzutem)'', NULL::numeric, NULL::boolean, (l->>''net_amount'')::numeric, NULL::numeric\n'
    || E'    FROM jsonb_array_elements(coalesce(ctx->''lines'', ''[]''::jsonb)) l\n'
    || E'    JOIN public.events ev ON ev.id = p_event_id\n'
    || E'    JOIN public.offers o ON o.id = (l->>''source_id'')::uuid AND o.event_id = p_event_id\n'
    || E'    JOIN public.sales_partner_profiles p ON p.id = o.sales_partner_id\n'
    || E'    LEFT JOIN public.contacts c ON c.id = p.contact_id\n'
    || E'    LEFT JOIN public.employees emp ON emp.id = p.employee_id\n'
    || E'    LEFT JOIN public.sales_partner_brand_terms t ON t.sales_partner_id = p.id AND t.my_company_id = ev.my_company_id\n'
    || E'   WHERE l->>''source_type'' = ''markup'' AND coalesce((l->>''included'')::boolean, false)\n'
    || E'     AND coalesce((l->>''net_amount'')::numeric, 0) > 0 AND ev.status::text <> ''cancelled'';';
  IF position('mavinci:seller-markup:' IN def) = 0 THEN
    IF (length(def) - length(replace(def, old_fragment, ''))) / length(old_fragment) <> 1 THEN
      RAISE EXCEPTION 'commission_target_rows: nieoczekiwana definicja — sprawdź funkcję przed migracją.';
    END IF;
    EXECUTE replace(def, old_fragment, new_fragment);
  END IF;

  -- 2. Sprzedawca z narzutem nie ma rozliczenia prowizyjnego marki — kontrola dotyczy tylko prowizji, nie narzutu.
  def := pg_get_functiondef('public.enforce_sales_partner_event_commission()'::regprocedure);
  old_fragment := 'IF NEW.sales_partner_id IS NULL OR NEW.entry_kind <> ''accrual'' THEN RETURN NEW; END IF;';
  new_fragment := 'IF NEW.sales_partner_id IS NULL OR NEW.entry_kind <> ''accrual'' OR NEW.automatic_source IS NOT DISTINCT FROM ''seller_markup'' THEN RETURN NEW; END IF;';
  IF position(new_fragment IN def) = 0 THEN
    IF (length(def) - length(replace(def, old_fragment, ''))) / length(old_fragment) <> 1 THEN
      RAISE EXCEPTION 'enforce_sales_partner_event_commission: nieoczekiwana definicja — sprawdź funkcję przed migracją.';
    END IF;
    EXECUTE replace(def, old_fragment, new_fragment);
  END IF;

  -- 3. Kalkulacja zysku opiekuna: narzut nie jest przychodem firmy, więc jego wypłata nie jest kosztem ani „drugą prowizją”.
  def := pg_get_functiondef('public.seller_owner_profit_context(uuid)'::regprocedure);
  old_fragment := 'c.event_id=o.event_id AND c.owner_profit_review_id IS NULL';
  new_fragment := 'c.event_id=o.event_id AND c.owner_profit_review_id IS NULL AND c.automatic_source IS DISTINCT FROM ''seller_markup''';
  IF position(new_fragment IN def) = 0 THEN
    IF (length(def) - length(replace(def, old_fragment, ''))) / length(old_fragment) <> 4 THEN
      RAISE EXCEPTION 'seller_owner_profit_context: nieoczekiwana definicja — sprawdź funkcję przed migracją.';
    END IF;
    EXECUTE replace(def, old_fragment, new_fragment);
  END IF;
END
$migration$;
