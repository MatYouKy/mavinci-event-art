-- Bezpieczeństwo P0 z audytu dostępu (docs/access-model.md, sekcja 6.1) — 2026-11-01.
--
-- CO I DLACZEGO
-- Publiczny klucz strony (rola anon) i konto portalu sprzedawcy rozmawiają z bazą bezpośrednio (PostgREST).
-- Audyt wykazał, że bez logowania można było wywołać setki funkcji SECURITY DEFINER (omijają RLS), zmieniać treści
-- strony WWW, tworzyć powiadomienia i dopisywać się jako ich odbiorca, czytać wszystkie kolumny pracowników ze strony
-- „Zespół”, zmieniać osoby kontaktowe wydarzeń i dodawać pojazdy, a każdy zalogowany (także konto portalu) — czytać
-- wszystkie powiadomienia, PDF-y ofert i tokeny KSeF. Ta migracja zamyka te dziury, nie zmieniając zasad biznesowych.
--
--  P0-1  Funkcje SECURITY DEFINER w public: odebrane EXECUTE rolom PUBLIC i anon, poza listą wyjątków potrzebnych
--        bez logowania (motyw strony, czas na stronie w analityce, urządzenia Mavinci View z sekretem urządzenia).
--        Nowe funkcje nie dostają już EXECUTE dla PUBLIC/anon automatycznie (ALTER DEFAULT PRIVILEGES).
--        Polityki RLS modułów Mavinci LIVE nadane „public” (anon i tak nic nie widział) — teraz „authenticated”.
--  P0-2  Funkcje bez kontroli, które zapisują lub ujawniają dane: wołane z CRM/aplikacji dostały kontrolę na początku
--        (pracownik CRM, finanse działalności, finanse wydarzenia, tożsamość zatwierdzającego); wołane tylko przez
--        Edge Functions, triggery i pg_cron — tylko service_role. Usunięte nieużywane przeciążenia
--        approve_absence(uuid,uuid) i reject_absence(uuid,uuid).
--  P0-3  17 tabel treści strony WWW i buckety site-images / conferences-gallery: zapis tylko zalogowany pracownik
--        z uprawnieniem website_edit / page_manage (lub administrator) — public.can_edit_website(). Wyjątek:
--        formularz „Dołącz do zespołu” nadal może bez logowania wgrać CV do site-images/cv-uploads/ (sam INSERT).
--  P0-4  RESTRICTIVE „bez konta portalu sprzedawcy” na tabelach, których portal nie używa (klienci, kontakty,
--        podwykonawcy, dane pracowników, sprzęt, lokalizacje, poziomy dostępu, dni wolne, szablony e-maili…).
--  P0-5  Powiadomienia: czyta i oznacza jako przeczytane wyłącznie odbiorca; tworzą je tylko funkcje serwera
--        i service_role (CRM, aplikacja i Edge Functions nie wstawiają powiadomień bezpośrednio).
--  P0-6  Pracownicy dla anon: zamiast polityki na tabeli — widok public.website_team_members z polami strony „Zespół”.
--  P0-7  event_contact_persons: odczyt jak wydarzenie (EV(v)), zapis jak zarządzanie wydarzeniem (EV(m));
--        vehicles: usunięte „vehicles_insert” dla public.
--  P0-8  ksef_credentials: tokeny, hasło i klucz certyfikatu niedostępne do odczytu z API (zapis bez zmian);
--        odczyt tokenu tylko serwer (service_role) po sprawdzeniu uprawnień.
--  P0-9  Bucket generated-offers: odczyt według widoczności oferty, zapis — właściciel oferty / offers_manage.
--        (external-invoices domknięte w 20261101165000.)
--  P0-10 (znalezione) employee_assignments: usunięte polityki anon do odczytu/zmiany zaproszeń po tokenie (strona
--        /invitation/* obsługuje token po stronie serwera kluczem service_role) — anon nie widzi już tokenów zaproszeń.
--  Folder „Faktury” w plikach wydarzenia: widoczny według poziomu finansów działalności wydarzenia
--        (≥ „invoices”, sprzedawca — własne wydarzenia przy poziomie „sales”) zamiast martwego invoices_manage.
--  D1    Płace (decyzja właściciela 01.11.2026): compensation_can_access() — odczyt administrator, personnel_view,
--        personnel_manage; zapis administrator, personnel_manage; pracownik widzi własny wiersz employee_compensation.
--
-- KOGO DOTYCZY: anon (strona WWW), konta portalu sprzedawcy, wszyscy zalogowani (powiadomienia, PDF ofert, folder
-- „Faktury”), osoby z employees_manage bez kadr (płace — dziś nikt), administrator i redaktorzy strony (bez zmian).
-- Wymaga: 20261101150000, 20261101165000 (wdrożone). Niezależna od 20261101171000 i 20261101180000.
-- Bez tabel tymczasowych. Plik można bezpiecznie uruchomić ponownie (idempotentny), w całości w SQL Editorze.
BEGIN;

-- 0. Warunki wstępne -------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('private.guard_employee_privileged_columns()') IS NULL THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261101150000_security_hotfixes.sql.';
  END IF;
  IF to_regprocedure('public.finance_company_level_at_least(uuid,text)') IS NULL
     OR to_regprocedure('private.require_finance_manage_for_transaction(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261101165000_finance_company_access.sql.';
  END IF;
END $$;

-- 1. Funkcje pomocnicze ---------------------------------------------------------------------------------------

-- Czy sesja może wywołać funkcję przeznaczoną dla pracowników CRM. Bez sesji API (pg_cron, migracje, service_role)
-- i wewnątrz triggerów — tak (zapis i tak podlega RLS tabeli, na której działa trigger). Sesja anon lub zalogowana:
-- aktywny pracownik CRM, który nie jest kontem portalu sprzedawcy.
CREATE OR REPLACE FUNCTION private.crm_employee_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
    OR pg_trigger_depth() > 0
    OR (public.current_crm_employee_id() IS NOT NULL AND NOT public.current_session_is_seller_portal());
$$;

CREATE OR REPLACE FUNCTION private.require_crm_employee()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT private.crm_employee_allowed() THEN
    RAISE EXCEPTION 'Brak dostępu: funkcja jest dostępna tylko dla pracowników CRM.' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.crm_employee_allowed(), private.require_crm_employee() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.crm_employee_allowed(), private.require_crm_employee() TO service_role;

-- Edycja strony WWW — ta sama reguła co w interfejsie (src/lib/permissions.ts → canEditWebsite): administrator CRM
-- albo uprawnienie website_edit / page_manage; nigdy konto portalu sprzedawcy.
CREATE OR REPLACE FUNCTION public.can_edit_website()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(NOT public.current_session_is_seller_portal() AND (
    public.current_employee_is_crm_admin()
    OR EXISTS (SELECT 1 FROM public.employees e
               WHERE e.id = public.current_crm_employee_id()
                 AND coalesce(e.permissions, '{}'::text[]) && ARRAY['website_edit', 'page_manage']::text[])), false);
$$;
COMMENT ON FUNCTION public.can_edit_website() IS
  'Edycja treści strony WWW: administrator CRM albo website_edit / page_manage (jak canEditWebsite w CRM); bez konta portalu.';

-- Folder plików wydarzenia z oznaczeniem uprawnienia. Dziś baza wymusza wyłącznie „finance:invoices” (folder
-- „Faktury”): poziom finansów działalności wydarzenia ≥ invoices albo sprzedawca tego wydarzenia z poziomem „sales”.
-- Pozostałe oznaczenia (events_manage, contracts_manage, offers_create) — bez dodatkowego warunku, jak dotąd.
CREATE OR REPLACE FUNCTION public.event_folder_permission_allows(p_required_permission text, p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN p_required_permission IS NULL
      OR p_required_permission NOT IN ('finance:invoices', 'invoices_manage', 'invoices_view') THEN true
    ELSE coalesce((
      SELECT public.finance_company_level_at_least(e.my_company_id, 'invoices')
        OR (public.finance_company_level_at_least(e.my_company_id, 'sales')
            AND (e.created_by = public.current_invoice_employee_id() OR public.current_employee_sells_event(e.id)))
      FROM public.events e WHERE e.id = p_event_id), false)
  END;
$$;

-- Folder (z folderami nadrzędnymi): czy żaden z nich nie wymaga uprawnienia, którego sesja nie ma.
CREATE OR REPLACE FUNCTION public.event_folder_id_allows(p_folder_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH RECURSIVE chain AS (
    SELECT f.id, f.parent_folder_id, f.required_permission, f.event_id, 1 AS depth
    FROM public.event_folders f WHERE f.id = p_folder_id
    UNION ALL
    SELECT p.id, p.parent_folder_id, p.required_permission, p.event_id, c.depth + 1
    FROM public.event_folders p JOIN chain c ON p.id = c.parent_folder_id
    WHERE c.depth < 20
  )
  SELECT coalesce(bool_and(public.event_folder_permission_allows(c.required_permission, c.event_id)), true) FROM chain c;
$$;

-- Plik w buckecie generated-offers → oferta: folder z identyfikatorem oferty (obecny format), offers.generated_pdf_url
-- albo historia wersji sales_document_files (starsze pliki). NULL = plik niepowiązany z ofertą.
CREATE OR REPLACE FUNCTION public.storage_generated_offer_id(p_name text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(
    (SELECT f.id FROM public.offers f
     WHERE f.id = CASE WHEN split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       THEN split_part(p_name, '/', 1)::uuid END),
    (SELECT f.id FROM public.offers f WHERE f.generated_pdf_url = p_name ORDER BY f.id LIMIT 1),
    (SELECT s.offer_id FROM public.sales_document_files s
     WHERE s.storage_bucket = 'generated-offers' AND s.storage_path = p_name AND s.offer_id IS NOT NULL
     ORDER BY s.offer_id LIMIT 1));
$$;

REVOKE EXECUTE ON FUNCTION public.can_edit_website(), public.event_folder_permission_allows(text, uuid),
  public.event_folder_id_allows(uuid), public.storage_generated_offer_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_website(), public.event_folder_permission_allows(text, uuid),
  public.event_folder_id_allows(uuid), public.storage_generated_offer_id(text) TO authenticated, service_role;

-- 2. P0-2: kontrola uprawnień w funkcjach wołanych z CRM / aplikacji mobilnej / aplikacji macOS ----------------
-- Treść z produkcji (pg_get_functiondef, 2026-11-01); zmieniona wyłącznie pierwsza instrukcja ciała (kontrola).
-- match_bank_transaction_to_documents(p_transaction_id uuid, p_documents jsonb): Rozliczenie operacji bankowej z wieloma dokumentami — tylko „Zarządzanie finansami” w działalności wyciągu.
CREATE OR REPLACE FUNCTION public.match_bank_transaction_to_documents(p_transaction_id uuid, p_documents jsonb)
 RETURNS SETOF bank_transaction_invoice_matches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb;
  v_source text;
  v_document_id uuid;
  v_amount numeric(14,2);
  v_ksef_payment_status text;
  v_result public.bank_transaction_invoice_matches%ROWTYPE;
BEGIN
  PERFORM private.require_finance_manage_for_transaction(p_transaction_id);  -- P0: finance_manage działalności wyciągu
  IF p_documents IS NULL
    OR jsonb_typeof(p_documents) <> 'array'
    OR jsonb_array_length(p_documents) < 1
    OR jsonb_array_length(p_documents) > 20
  THEN
    RAISE EXCEPTION 'Wybierz od 1 do 20 dokumentow';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT item->>'source' AS source, item->>'documentId' AS document_id, COUNT(*) AS item_count
      FROM jsonb_array_elements(p_documents) AS items(item)
      GROUP BY item->>'source', item->>'documentId'
    ) duplicates
    WHERE duplicates.item_count > 1
  ) THEN
    RAISE EXCEPTION 'Ten sam dokument zostal wybrany wiecej niz raz';
  END IF;

  PERFORM 1
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono transakcji'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_documents)
  LOOP
    v_source := v_item->>'source';
    IF v_source NOT IN ('invoice', 'ksef', 'external') THEN
      RAISE EXCEPTION 'Nieobslugiwane zrodlo dokumentu';
    END IF;

    BEGIN
      v_document_id := (v_item->>'documentId')::uuid;
      v_amount := ROUND((v_item->>'amount')::numeric, 2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Nieprawidlowe dane wybranego dokumentu';
    END;
    IF v_amount <= 0 THEN RAISE EXCEPTION 'Kwota dokumentu musi byc dodatnia'; END IF;

    IF v_source = 'ksef' THEN
      SELECT payment_status
      INTO v_ksef_payment_status
      FROM public.ksef_invoices
      WHERE id = v_document_id;

      IF v_ksef_payment_status = 'paid' THEN
        SELECT *
        INTO v_result
        FROM public.reconcile_paid_ksef_invoice_with_bank_transaction(
          p_transaction_id,
          v_document_id,
          v_amount,
          1,
          ARRAY['Zbiorcze dopasowanie zatwierdzone przez uzytkownika']
        );
      ELSE
        SELECT *
        INTO v_result
        FROM public.match_bank_transaction_to_document(
          p_transaction_id,
          v_source,
          v_document_id,
          v_amount,
          1,
          'manual',
          ARRAY['Zbiorcze dopasowanie zatwierdzone przez uzytkownika']
        );
      END IF;
    ELSE
      SELECT *
      INTO v_result
      FROM public.match_bank_transaction_to_document(
        p_transaction_id,
        v_source,
        v_document_id,
        v_amount,
        1,
        'manual',
        ARRAY['Zbiorcze dopasowanie zatwierdzone przez uzytkownika']
      );
    END IF;

    RETURN NEXT v_result;
  END LOOP;

  RETURN;
END;
$function$;

-- match_bank_transaction_to_documents_with_review(p_transaction_id uuid, p_documents jsonb, p_review_note text): Jak wyżej, z oznaczeniem do wyjaśnienia.
CREATE OR REPLACE FUNCTION public.match_bank_transaction_to_documents_with_review(p_transaction_id uuid, p_documents jsonb, p_review_note text)
 RETURNS SETOF bank_transaction_invoice_matches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result public.bank_transaction_invoice_matches%ROWTYPE;
BEGIN
  PERFORM private.require_finance_manage_for_transaction(p_transaction_id);  -- P0: finance_manage działalności wyciągu
  FOR v_result IN
    SELECT *
    FROM public.match_bank_transaction_to_documents(p_transaction_id, p_documents)
  LOOP
    PERFORM public.flag_bank_match_for_explanation(v_result.id, p_review_note);
    RETURN NEXT v_result;
  END LOOP;
  RETURN;
END;
$function$;

-- approve_absence(p_absence_id uuid, p_approver_id uuid, p_notes text): Zatwierdzający musi być zalogowanym pracownikiem (wcześniej dowolny identyfikator z klienta).
CREATE OR REPLACE FUNCTION public.approve_absence(p_absence_id uuid, p_approver_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_result json;
v_employee_id uuid;
v_employee_name text;
v_absence_type_pl text;
v_start_date timestamptz;
v_end_date timestamptz;
v_approver_name text;
v_notification_id uuid;
BEGIN
IF coalesce(auth.role(), '') IN ('anon', 'authenticated') AND (p_approver_id IS DISTINCT FROM public.current_crm_employee_id()
   OR public.current_session_is_seller_portal()) THEN  -- P0: zatwierdzający = zalogowany pracownik
  RAISE EXCEPTION 'Nieobecność zatwierdza zalogowany pracownik we własnym imieniu.' USING ERRCODE = '42501';
END IF;
-- Sprawdź czy użytkownik ma uprawnienia
IF NOT EXISTS (
SELECT 1 FROM employees 
WHERE id = p_approver_id 
AND ('employees_manage' = ANY(permissions) OR 'admin' = ANY(permissions))
) THEN
RETURN json_build_object(
'success', false,
'error', 'Brak uprawnień do zatwierdzania nieobecności'
);
END IF;

-- Aktualizuj nieobecność
UPDATE employee_absences
SET 
approval_status = 'approved',
approved_by = p_approver_id,
approved_at = NOW(),
notes = COALESCE(p_notes, notes),
updated_at = NOW()
WHERE id = p_absence_id
RETURNING employee_id, absence_type, start_date, end_date
INTO v_employee_id, v_absence_type_pl, v_start_date, v_end_date;

IF NOT FOUND THEN
RETURN json_build_object(
'success', false,
'error', 'Nieobecność nie została znaleziona'
);
END IF;

-- Pobierz dane pracownika
SELECT (name || ' ' || surname) INTO v_employee_name
FROM employees WHERE id = v_employee_id;

-- Pobierz dane zatwierdzającego
SELECT (name || ' ' || surname) INTO v_approver_name
FROM employees WHERE id = p_approver_id;

-- Przetłumacz typ
v_absence_type_pl := CASE v_absence_type_pl::text
WHEN 'vacation' THEN 'urlop wypoczynkowy'
WHEN 'sick_leave' THEN 'zwolnienie lekarskie'
WHEN 'unpaid_leave' THEN 'urlop bezpłatny'
WHEN 'training' THEN 'szkolenie'
WHEN 'remote_work' THEN 'praca zdalna'
ELSE 'nieobecność'
END;

-- Wyślij notyfikację do pracownika o zatwierdzeniu (FIXED)
INSERT INTO notifications (
category,
title,
message,
related_entity_type,
related_entity_id,
action_url,
created_at
)
VALUES (
'absence_approved',
'Zatwierdzono ' || v_absence_type_pl,
v_approver_name || ' zatwierdził Twoją prośbę o ' || v_absence_type_pl || 
' w terminie ' || TO_CHAR(v_start_date, 'DD.MM.YYYY') || ' - ' || 
TO_CHAR(v_end_date, 'DD.MM.YYYY') || '.' ||
CASE WHEN p_notes IS NOT NULL THEN ' Notatka: ' || p_notes ELSE '' END,
'absence',
p_absence_id::text,
'/crm/employees/' || v_employee_id::text || '?tab=timeline',
NOW()
)
RETURNING id INTO v_notification_id;

-- Dodaj odbiorcę - pracownika (FIXED: użyj user_id)
INSERT INTO notification_recipients (
notification_id,
user_id,
is_read,
created_at
)
VALUES (
v_notification_id,
v_employee_id,
false,
NOW()
);

RETURN json_build_object(
'success', true,
'message', 'Nieobecność została zatwierdzona'
);
END;
$function$;

-- reject_absence(p_absence_id uuid, p_rejector_id uuid, p_reason text): Odrzucający musi być zalogowanym pracownikiem.
CREATE OR REPLACE FUNCTION public.reject_absence(p_absence_id uuid, p_rejector_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_result json;
v_employee_id uuid;
v_employee_name text;
v_absence_type_pl text;
v_start_date timestamptz;
v_end_date timestamptz;
v_rejector_name text;
v_notification_id uuid;
BEGIN
IF coalesce(auth.role(), '') IN ('anon', 'authenticated') AND (p_rejector_id IS DISTINCT FROM public.current_crm_employee_id()
   OR public.current_session_is_seller_portal()) THEN  -- P0: odrzucający = zalogowany pracownik
  RAISE EXCEPTION 'Nieobecność odrzuca zalogowany pracownik we własnym imieniu.' USING ERRCODE = '42501';
END IF;
-- Sprawdź czy użytkownik ma uprawnienia
IF NOT EXISTS (
SELECT 1 FROM employees 
WHERE id = p_rejector_id 
AND ('employees_manage' = ANY(permissions) OR 'admin' = ANY(permissions))
) THEN
RETURN json_build_object(
'success', false,
'error', 'Brak uprawnień do odrzucania nieobecności'
);
END IF;

-- Aktualizuj nieobecność
UPDATE employee_absences
SET 
approval_status = 'rejected',
approved_by = p_rejector_id,
notes = COALESCE(p_reason, notes),
updated_at = NOW()
WHERE id = p_absence_id
RETURNING employee_id, absence_type, start_date, end_date
INTO v_employee_id, v_absence_type_pl, v_start_date, v_end_date;

IF NOT FOUND THEN
RETURN json_build_object(
'success', false,
'error', 'Nieobecność nie została znaleziona'
);
END IF;

-- Pobierz dane pracownika
SELECT (name || ' ' || surname) INTO v_employee_name
FROM employees WHERE id = v_employee_id;

-- Pobierz dane odrzucającego
SELECT (name || ' ' || surname) INTO v_rejector_name
FROM employees WHERE id = p_rejector_id;

-- Przetłumacz typ
v_absence_type_pl := CASE v_absence_type_pl::text
WHEN 'vacation' THEN 'urlop wypoczynkowy'
WHEN 'sick_leave' THEN 'zwolnienie lekarskie'
WHEN 'unpaid_leave' THEN 'urlop bezpłatny'
WHEN 'training' THEN 'szkolenie'
WHEN 'remote_work' THEN 'praca zdalna'
ELSE 'nieobecność'
END;

-- Wyślij notyfikację do pracownika o odrzuceniu
INSERT INTO notifications (
category,
title,
message,
related_entity_type,
related_entity_id,
action_url,
created_at
)
VALUES (
'absence_rejected',
'Odrzucono ' || v_absence_type_pl,
v_rejector_name || ' odrzucił Twoją prośbę o ' || v_absence_type_pl || 
' w terminie ' || TO_CHAR(v_start_date, 'DD.MM.YYYY') || ' - ' || 
TO_CHAR(v_end_date, 'DD.MM.YYYY') || 
CASE WHEN p_reason IS NOT NULL AND p_reason != '' THEN '. Powód: ' || p_reason ELSE '.' END,
'absence',
p_absence_id::text,
'/crm/employees/' || v_employee_id::text || '?tab=timeline',
NOW()
)
RETURNING id INTO v_notification_id;

-- Dodaj odbiorcę - pracownika
INSERT INTO notification_recipients (
notification_id,
user_id,
is_read,
created_at
)
VALUES (
v_notification_id,
v_employee_id,
false,
NOW()
);

RETURN json_build_object(
'success', true,
'message', 'Nieobecność została odrzucona'
);
END;
$function$;

-- get_contact_full_details(entity_id uuid): Pełne dane kontaktu/organizacji — tylko pracownik CRM (jak RLS tabel kontaktów).
CREATE OR REPLACE FUNCTION public.get_contact_full_details(entity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result jsonb;
entity_data jsonb;
entity_type text;
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
-- Sprawdź czy to organizacja
SELECT to_jsonb(o.*) INTO entity_data
FROM organizations o
WHERE o.id = entity_id;

IF entity_data IS NOT NULL THEN
entity_type := 'organization';
ELSE
-- Sprawdź czy to kontakt
SELECT to_jsonb(c.*) INTO entity_data
FROM contacts c
WHERE c.id = entity_id;

IF entity_data IS NOT NULL THEN
entity_type := 'contact';
ELSE
RETURN jsonb_build_object('error', 'Entity not found');
END IF;
END IF;

-- Buduj wynik
result := jsonb_build_object(
'entity_type', entity_type,
'entity_data', entity_data
);

-- Dla organizacji pobierz kontakty
IF entity_type = 'organization' THEN
result := result || jsonb_build_object(
'contacts', (
SELECT COALESCE(jsonb_agg(jsonb_build_object(
'id', co.id,
'contact_id', c.id,
'first_name', c.first_name,
'last_name', c.last_name,
'full_name', c.full_name,
'email', c.email,
'phone', c.phone,
'mobile', c.mobile,
'position', co.position,
'is_primary', co.is_primary
)), '[]'::jsonb)
FROM contact_organizations co
JOIN contacts c ON c.id = co.contact_id
WHERE co.organization_id = entity_id AND co.is_current = true
),
'notes', (
SELECT COALESCE(jsonb_agg(jsonb_build_object(
'id', n.id,
'note', n.note,
'created_at', n.created_at,
'created_by', n.created_by,
'employee_name', COALESCE(e.name || ' ' || e.surname, 'System')
) ORDER BY n.created_at DESC), '[]'::jsonb)
FROM organization_notes n
LEFT JOIN employees e ON e.id = n.created_by
WHERE n.organization_id = entity_id
),
'history', (
SELECT COALESCE(jsonb_agg(jsonb_build_object(
'id', h.id,
'contact_type', h.contact_type,
'subject', h.subject,
'description', h.description,
'contact_date', h.contact_date,
'outcome', h.outcome,
'next_action', h.next_action,
'contacted_by', h.contacted_by
) ORDER BY h.contact_date DESC), '[]'::jsonb)
FROM contact_history h
WHERE h.organization_id = entity_id
LIMIT 50
)
);
END IF;

-- Dla kontaktu pobierz organizacje
IF entity_type = 'contact' THEN
result := result || jsonb_build_object(
'organizations', (
SELECT COALESCE(jsonb_agg(jsonb_build_object(
'id', o.id,
'name', COALESCE(o.alias, o.name),
'email', o.email,
'phone', o.phone,
'city', o.city,
'position', co.position,
'is_primary', co.is_primary
)), '[]'::jsonb)
FROM contact_organizations co
JOIN organizations o ON o.id = co.organization_id
WHERE co.contact_id = entity_id AND co.is_current = true
)
);
END IF;

RETURN result;
END;
$function$;

-- get_business_clients(): Lista klientów do faktury — tylko pracownik CRM.
CREATE OR REPLACE FUNCTION public.get_business_clients()
 RETURNS TABLE(id uuid, client_type text, name text, nip text, email text, phone text, address text, city text, postal_code text, can_invoice boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
RETURN QUERY
SELECT 
o.id,
'organization'::text,
o.name,
o.nip,
o.email,
o.phone,
o.address,
o.city,
o.postal_code,
(o.nip IS NOT NULL AND length(trim(o.nip)) >= 10) as can_invoice
FROM organizations o
WHERE o.status = 'active'

UNION ALL

SELECT 
c.id,
'contact'::text,
COALESCE(c.company_name, c.first_name || ' ' || c.last_name),
c.nip,
c.email,
c.phone,
c.address,
c.city,
c.postal_code,
(c.nip IS NOT NULL AND length(trim(c.nip)) >= 10) as can_invoice
FROM contacts c
WHERE c.is_business_client = true AND c.status = 'active'

ORDER BY name;
END;
$function$;

-- get_event_financial_summary(p_event_id uuid): Podsumowanie finansowe wydarzenia — can_view_event_commercials (ta sama reguła co zakładka Finanse w CRM i aplikacji).
CREATE OR REPLACE FUNCTION public.get_event_financial_summary(p_event_id uuid)
 RETURNS TABLE(expected_revenue numeric, actual_revenue numeric, estimated_costs numeric, actual_costs numeric, expected_profit numeric, actual_profit numeric, profit_margin_expected numeric, profit_margin_actual numeric, invoices_count bigint, invoices_paid_count bigint, invoices_total numeric, costs_count bigint, costs_paid_count bigint, costs_total numeric, cash_budget numeric, actual_cash_revenue numeric, total_revenue numeric, client_type text, is_cash_only boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
 IF coalesce(auth.role(), '') IN ('anon', 'authenticated') AND NOT public.can_view_event_commercials(p_event_id, false) THEN
  RAISE EXCEPTION 'Brak dostępu do finansów tego wydarzenia.' USING ERRCODE = '42501';  -- P0: EVC(v), jak zakładka Finanse
 END IF;
 IF public.realization_operational_only(p_event_id) THEN RAISE EXCEPTION 'Dane rozliczeniowe nie należą do zakresu kierownika realizacji.' USING ERRCODE='42501'; END IF;
RETURN QUERY
SELECT 
e.expected_revenue,
e.actual_revenue,
e.estimated_costs,
e.actual_costs,
(e.expected_revenue - e.estimated_costs) as expected_profit,
(e.actual_revenue + e.actual_cash_revenue - e.actual_costs) as actual_profit,
CASE 
WHEN e.expected_revenue > 0 
THEN ((e.expected_revenue - e.estimated_costs) / e.expected_revenue * 100)
ELSE 0 
END as profit_margin_expected,
CASE 
WHEN (e.actual_revenue + e.actual_cash_revenue) > 0 
THEN ((e.actual_revenue + e.actual_cash_revenue - e.actual_costs) / (e.actual_revenue + e.actual_cash_revenue) * 100)
ELSE 0 
END as profit_margin_actual,
(SELECT COUNT(*) FROM invoices WHERE event_id = e.id)::bigint as invoices_count,
(SELECT COUNT(*) FROM invoices WHERE event_id = e.id AND status IN ('paid', 'partially_paid'))::bigint as invoices_paid_count,
COALESCE((SELECT SUM(total_gross) FROM invoices WHERE event_id = e.id), 0) as invoices_total,
(SELECT COUNT(*) FROM event_costs WHERE event_id = e.id)::bigint as costs_count,
(SELECT COUNT(*) FROM event_costs WHERE event_id = e.id AND status = 'paid')::bigint as costs_paid_count,
COALESCE((SELECT SUM(amount) FROM event_costs WHERE event_id = e.id), 0) as costs_total,
e.cash_budget,
e.actual_cash_revenue,
(e.actual_revenue + e.actual_cash_revenue) as total_revenue,
e.client_type::text,
(e.client_type = 'individual')::boolean as is_cash_only
FROM events e
WHERE e.id = p_event_id AND public.crm_record_id_scope_allows('events',e.id);
END;
$function$;

-- check_employee_availability(p_employee_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_exclude_event_id uuid, p_exclude_phase_id uuid): Konflikty pracownika (z rodzajem nieobecności) — tylko pracownik CRM; z triggera bez zmian.
CREATE OR REPLACE FUNCTION public.check_employee_availability(p_employee_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_exclude_event_id uuid DEFAULT NULL::uuid, p_exclude_phase_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(has_conflict boolean, conflict_type text, conflict_id uuid, conflict_title text, conflict_start timestamp with time zone, conflict_end timestamp with time zone, conflict_status text, conflict_details jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
RETURN QUERY
-- Sprawdź nieobecności (urlopy, zwolnienia)
SELECT
true as has_conflict,
'absence'::text as conflict_type,
ea.id as conflict_id,
CASE ea.absence_type
WHEN 'vacation' THEN 'Urlop wypoczynkowy'
WHEN 'sick_leave' THEN 'Zwolnienie lekarskie'
WHEN 'unpaid_leave' THEN 'Urlop bezpłatny'
WHEN 'parental_leave' THEN 'Urlop macierzyński/ojcowski'
WHEN 'training' THEN 'Szkolenie'
WHEN 'business_trip' THEN 'Wyjazd służbowy'
WHEN 'remote_work' THEN 'Praca zdalna'
ELSE 'Inna nieobecność'
END as conflict_title,
ea.start_date as conflict_start,
ea.end_date as conflict_end,
-- POPRAWKA: użyj approval_status zamiast status
ea.approval_status::text as conflict_status,
jsonb_build_object(
'absence_type', ea.absence_type,
'all_day', ea.all_day,
'notes', ea.notes
) as conflict_details
FROM employee_absences ea
WHERE ea.employee_id = p_employee_id
-- POPRAWKA: użyj approval_status zamiast status
AND ea.approval_status IN ('approved', 'pending')
AND (
(ea.start_date >= p_start_date AND ea.start_date < p_end_date)
OR (ea.end_date > p_start_date AND ea.end_date <= p_end_date)
OR (ea.start_date <= p_start_date AND ea.end_date >= p_end_date)
)

UNION ALL

-- Sprawdź przypisania do FAZ
SELECT
true as has_conflict,
'phase'::text as conflict_type,
epa.id as conflict_id,
(e.name || ' - ' || ep.name)::text as conflict_title,
epa.assignment_start as conflict_start,
epa.assignment_end as conflict_end,
epa.invitation_status::text as conflict_status,
jsonb_build_object(
'event_id', e.id,
'event_name', e.name,
'phase_id', ep.id,
'phase_name', ep.name,
'role', epa.role
) as conflict_details
FROM event_phase_assignments epa
JOIN event_phases ep ON ep.id = epa.phase_id
JOIN events e ON e.id = ep.event_id
WHERE epa.employee_id = p_employee_id
AND epa.invitation_status IN ('accepted', 'pending')
AND (p_exclude_phase_id IS NULL OR epa.phase_id != p_exclude_phase_id)
AND (p_exclude_event_id IS NULL OR ep.event_id != p_exclude_event_id)
AND (
(epa.assignment_start >= p_start_date AND epa.assignment_start < p_end_date)
OR (epa.assignment_end > p_start_date AND epa.assignment_end <= p_end_date)
OR (epa.assignment_start <= p_start_date AND epa.assignment_end >= p_end_date)
)

UNION ALL

-- Sprawdź przypisania do CAŁYCH WYDARZEŃ (tylko jeśli nie ma przypisań do faz)
SELECT
true as has_conflict,
'event'::text as conflict_type,
ea.id as conflict_id,
e.name as conflict_title,
e.event_date as conflict_start,
COALESCE(e.event_end_date, e.event_date) as conflict_end,
ea.status::text as conflict_status,
jsonb_build_object(
'event_id', e.id,
'event_name', e.name,
'role', ea.role
) as conflict_details
FROM employee_assignments ea
JOIN events e ON e.id = ea.event_id
WHERE ea.employee_id = p_employee_id
AND ea.status IN ('accepted', 'pending')
AND (p_exclude_event_id IS NULL OR ea.event_id != p_exclude_event_id)
-- Pokazuj tylko jeśli NIE MA przypisań do faz dla tego wydarzenia
AND NOT EXISTS (
SELECT 1 FROM event_phase_assignments epa
JOIN event_phases ep ON ep.id = epa.phase_id
WHERE ep.event_id = e.id
AND epa.employee_id = p_employee_id
)
AND (
(e.event_date >= p_start_date AND e.event_date < p_end_date)
OR (COALESCE(e.event_end_date, e.event_date) > p_start_date 
AND COALESCE(e.event_end_date, e.event_date) <= p_end_date)
OR (e.event_date <= p_start_date 
AND COALESCE(e.event_end_date, e.event_date) >= p_end_date)
);
END;
$function$;

-- check_employee_availability(p_employee_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_event_id uuid): Konflikty pracownika (z rodzajem nieobecności) — tylko pracownik CRM; z triggera bez zmian.
CREATE OR REPLACE FUNCTION public.check_employee_availability(p_employee_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_conflicts jsonb := '[]'::jsonb;
v_event record;
v_absence record;
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
-- Sprawdź konflikty z innymi wydarzeniami
FOR v_event IN (
SELECT 
ev.id,
ev.name,
eea.invitation_status,
COALESCE(ep.start_time, ev.start_date) as event_start,
COALESCE(ep.end_time, ev.end_date) as event_end
FROM employee_event_assignments eea
INNER JOIN events ev ON ev.id = eea.event_id
LEFT JOIN event_phases ep ON ep.event_id = ev.id
WHERE eea.employee_id = p_employee_id
AND ev.deleted_at IS NULL
AND eea.invitation_status != 'rejected'
AND (p_event_id IS NULL OR ev.id != p_event_id)
AND (
(COALESCE(ep.start_time, ev.start_date) <= p_start_date AND COALESCE(ep.end_time, ev.end_date) >= p_start_date)
OR (COALESCE(ep.start_time, ev.start_date) <= p_end_date AND COALESCE(ep.end_time, ev.end_date) >= p_end_date)
OR (COALESCE(ep.start_time, ev.start_date) >= p_start_date AND COALESCE(ep.end_time, ev.end_date) <= p_end_date)
)
) LOOP
v_conflicts := v_conflicts || jsonb_build_object(
'type', 'event',
'id', v_event.id,
'name', v_event.name,
'start', v_event.event_start,
'end', v_event.event_end,
'status', v_event.invitation_status
);
END LOOP;

-- Sprawdź konflikty z nieobecnościami (FIXED: użyj approval_status)
FOR v_absence IN (
SELECT 
id,
absence_type,
start_date,
end_date,
approval_status
FROM employee_absences
WHERE employee_id = p_employee_id
AND approval_status IN ('approved', 'pending')
AND (
(start_date <= p_start_date AND end_date >= p_start_date)
OR (start_date <= p_end_date AND end_date >= p_end_date)
OR (start_date >= p_start_date AND end_date <= p_end_date)
)
) LOOP
v_conflicts := v_conflicts || jsonb_build_object(
'type', 'absence',
'id', v_absence.id,
'absence_type', v_absence.absence_type,
'start', v_absence.start_date,
'end', v_absence.end_date,
'status', v_absence.approval_status
);
END LOOP;

RETURN jsonb_build_object(
'has_conflicts', jsonb_array_length(v_conflicts) > 0,
'conflicts', v_conflicts
);
END;
$function$;

-- check_employee_availability(p_employee_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone): Konflikty pracownika (z rodzajem nieobecności) — tylko pracownik CRM; z triggera bez zmian.
CREATE OR REPLACE FUNCTION public.check_employee_availability(p_employee_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_conflicts jsonb[];
v_conflict jsonb;
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
-- Check for event conflicts (using employee_assignments)
FOR v_conflict IN
SELECT jsonb_build_object(
'type', 'event',
'id', ev.id,
'name', ev.name,
'start_date', COALESCE(ep.phase_date + ep.start_time, ev.event_date),
'end_date', COALESCE(ep.phase_date + ep.end_time, ev.event_date + INTERVAL '1 day'),
'status', ea.invitation_status
)
FROM employee_assignments ea
INNER JOIN events ev ON ev.id = ea.event_id
LEFT JOIN event_phases ep ON ep.event_id = ev.id
WHERE ea.employee_id = p_employee_id
AND ev.deleted_at IS NULL
AND (
(COALESCE(ep.phase_date + ep.start_time, ev.event_date) <= p_end_date)
AND (COALESCE(ep.phase_date + ep.end_time, ev.event_date + INTERVAL '1 day') >= p_start_date)
)
LOOP
v_conflicts := array_append(v_conflicts, v_conflict);
END LOOP;

-- Check for absence conflicts
FOR v_conflict IN
SELECT jsonb_build_object(
'type', 'absence',
'id', ea.id,
'absence_type', ea.absence_type,
'start_date', ea.start_date,
'end_date', ea.end_date,
'approval_status', ea.approval_status
)
FROM employee_absences ea
WHERE ea.employee_id = p_employee_id
AND ea.approval_status IN ('pending', 'approved')
AND (
(ea.start_date <= p_end_date)
AND (ea.end_date >= p_start_date)
)
LOOP
v_conflicts := array_append(v_conflicts, v_conflict);
END LOOP;

RETURN jsonb_build_object(
'available', (array_length(v_conflicts, 1) IS NULL),
'conflicts', COALESCE(v_conflicts, ARRAY[]::jsonb[])
);
END;
$function$;

-- get_or_create_documents_subfolder(p_event_id uuid, p_subfolder_name text, p_required_permission text, p_created_by uuid): Folder dokumentów wydarzenia — pracownik widzący wydarzenie; „Faktury” oznaczone finance:invoices.
CREATE OR REPLACE FUNCTION public.get_or_create_documents_subfolder(p_event_id uuid, p_subfolder_name text, p_required_permission text, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_documents_folder_id uuid;
v_subfolder_id uuid;
BEGIN
IF coalesce(auth.role(), '') IN ('anon', 'authenticated') AND pg_trigger_depth() = 0
   AND NOT (private.crm_employee_allowed() AND public.current_employee_can_view_event(p_event_id)) THEN  -- P0
  RAISE EXCEPTION 'Brak dostępu do plików tego wydarzenia.' USING ERRCODE = '42501';
END IF;
-- Folder „Faktury”: widoczność według poziomu finansów działalności wydarzenia (dawne invoices_manage nic już nie nadaje).
IF p_required_permission IN ('invoices_manage', 'invoices_view') THEN p_required_permission := 'finance:invoices'; END IF;
-- Pobierz/utwórz główny folder Dokumenty
v_documents_folder_id := get_or_create_documents_folder(p_event_id, p_created_by);

-- Sprawdź czy podfolder już istnieje
SELECT id INTO v_subfolder_id
FROM event_folders
WHERE event_id = p_event_id
AND name = p_subfolder_name
AND parent_folder_id = v_documents_folder_id
AND is_system_folder = true;

-- Jeśli nie istnieje, utwórz
IF v_subfolder_id IS NULL THEN
INSERT INTO event_folders (
event_id,
parent_folder_id,
name,
path,
is_system_folder,
required_permission,
created_by
) VALUES (
p_event_id,
v_documents_folder_id,
p_subfolder_name,
'Dokumenty/' || p_subfolder_name,
true,
p_required_permission,
p_created_by
)
RETURNING id INTO v_subfolder_id;
END IF;

RETURN v_subfolder_id;
END;
$function$;

-- generate_vehicle_alerts(): Przeliczenie alertów floty — tylko pracownik CRM.
CREATE OR REPLACE FUNCTION public.generate_vehicle_alerts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
  PERFORM public.refresh_vehicle_compliance();
END;
$function$;

-- update_vehicle_status_from_alerts(): Status pojazdów z alertów — tylko pracownik CRM.
CREATE OR REPLACE FUNCTION public.update_vehicle_status_from_alerts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
  UPDATE public.vehicles v
  SET status = 'no_insurance'
  WHERE v.status NOT IN ('inactive', 'sold', 'scrapped')
    AND EXISTS (
      SELECT 1
      FROM public.vehicle_alerts va
      WHERE va.vehicle_id = v.id
        AND va.alert_type = 'insurance'
        AND va.is_active = true
        AND va.is_blocking = true
    );

  UPDATE public.vehicles v
  SET status = 'no_inspection'
  WHERE v.status NOT IN ('inactive', 'sold', 'scrapped')
    AND NOT EXISTS (
      SELECT 1
      FROM public.vehicle_alerts va
      WHERE va.vehicle_id = v.id
        AND va.alert_type = 'insurance'
        AND va.is_active = true
        AND va.is_blocking = true
    )
    AND EXISTS (
      SELECT 1
      FROM public.vehicle_alerts va
      WHERE va.vehicle_id = v.id
        AND va.alert_type = 'inspection'
        AND va.is_active = true
        AND va.is_blocking = true
    );

  UPDATE public.vehicles v
  SET status = 'available'
  WHERE v.status IN ('no_insurance', 'no_inspection')
    AND NOT EXISTS (
      SELECT 1
      FROM public.vehicle_alerts va
      WHERE va.vehicle_id = v.id
        AND va.is_active = true
        AND va.is_blocking = true
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_vehicles ev
      WHERE ev.vehicle_id = v.id
        AND ev.is_in_use = true
    );
END;
$function$;

-- get_employee_timeline_data(p_employee_ids uuid[], p_start_date timestamp with time zone, p_end_date timestamp with time zone): Grafik ludzi — tylko pracownik CRM.
CREATE OR REPLACE FUNCTION public.get_employee_timeline_data(p_employee_ids uuid[], p_start_date timestamp with time zone, p_end_date timestamp with time zone)
 RETURNS TABLE(employee_id uuid, employee_name text, item_type text, item_id uuid, item_title text, item_start timestamp with time zone, item_end timestamp with time zone, item_status text, item_color text, item_metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
RETURN QUERY
-- Wydarzenia
SELECT
e.id as employee_id,
(e.name || ' ' || e.surname)::text as employee_name,
'event'::text as item_type,
ev.id as item_id,
ev.name as item_title,
ev.event_date as item_start,
(ev.event_date + INTERVAL '1 day') as item_end,
COALESCE(ea.status, ev.status::text) as item_status,
COALESCE(ec.color, '#3b82f6') as item_color,
jsonb_build_object(
'category', ec.name,
'location', l.name,
'assignment_status', ea.status
) as item_metadata
FROM employees e
INNER JOIN employee_assignments ea ON ea.employee_id = e.id
INNER JOIN events ev ON ev.id = ea.event_id
LEFT JOIN event_categories ec ON ec.id = ev.category_id
LEFT JOIN locations l ON l.id = ev.location_id
WHERE e.id = ANY(p_employee_ids)
AND COALESCE(ea.status, 'accepted') != 'rejected'
AND (
(ev.event_date >= p_start_date AND ev.event_date <= p_end_date)
OR ((ev.event_date + INTERVAL '1 day') >= p_start_date AND (ev.event_date + INTERVAL '1 day') <= p_end_date)
OR (ev.event_date <= p_start_date AND (ev.event_date + INTERVAL '1 day') >= p_end_date)
)

UNION ALL

-- Phase assignments
SELECT
e.id as employee_id,
(e.name || ' ' || e.surname)::text as employee_name,
'phase'::text as item_type,
epa.id as item_id,
(ev.name || ' - ' || ep.name) as item_title,
ep.start_time as item_start,
ep.end_time as item_end,
epa.invitation_status::text as item_status,
COALESCE(ep.color, ec.color, '#3b82f6') as item_color,
jsonb_build_object(
'event_id', ev.id,
'phase_id', ep.id,
'phase_name', ep.name,
'event_name', ev.name,
'category', ec.name,
'location', l.name
) as item_metadata
FROM employees e
INNER JOIN event_phase_assignments epa ON epa.employee_id = e.id
INNER JOIN event_phases ep ON ep.id = epa.phase_id
INNER JOIN events ev ON ev.id = ep.event_id
LEFT JOIN event_categories ec ON ec.id = ev.category_id
LEFT JOIN locations l ON l.id = ev.location_id
WHERE e.id = ANY(p_employee_ids)
AND epa.invitation_status != 'rejected'
AND (
(ep.start_time >= p_start_date AND ep.start_time <= p_end_date)
OR (ep.end_time >= p_start_date AND ep.end_time <= p_end_date)
OR (ep.start_time <= p_start_date AND ep.end_time >= p_end_date)
)

UNION ALL

-- Nieobecności
SELECT
e.id as employee_id,
(e.name || ' ' || e.surname)::text as employee_name,
'absence'::text as item_type,
ea.id as item_id,
CASE ea.absence_type
WHEN 'vacation' THEN 'Urlop wypoczynkowy'
WHEN 'sick_leave' THEN 'Zwolnienie lekarskie'
WHEN 'unpaid_leave' THEN 'Urlop bezpłatny'
WHEN 'training' THEN 'Szkolenie'
WHEN 'remote_work' THEN 'Praca zdalna'
ELSE 'Nieobecność'
END as item_title,
ea.start_date as item_start,
ea.end_date as item_end,
ea.approval_status::text as item_status,
CASE ea.absence_type
WHEN 'vacation' THEN '#10b981'
WHEN 'sick_leave' THEN '#ef4444'
WHEN 'unpaid_leave' THEN '#6b7280'
WHEN 'training' THEN '#06b6d4'
WHEN 'remote_work' THEN '#14b8a6'
ELSE '#8b5cf6'
END as item_color,
jsonb_build_object(
'absence_type', ea.absence_type,
'all_day', ea.all_day,
'notes', ea.notes,
'approval_status', ea.approval_status,
'approved_by', COALESCE(approver.name || ' ' || approver.surname, '')
) as item_metadata
FROM employees e
INNER JOIN employee_absences ea ON ea.employee_id = e.id
LEFT JOIN employees approver ON approver.id = ea.approved_by
WHERE e.id = ANY(p_employee_ids)
AND ea.approval_status IN ('approved', 'pending')
AND (
(ea.start_date >= p_start_date AND ea.start_date <= p_end_date)
OR (ea.end_date >= p_start_date AND ea.end_date <= p_end_date)
OR (ea.start_date <= p_start_date AND ea.end_date >= p_end_date)
)

ORDER BY employee_id, item_start;
END;
$function$;

-- get_calendar_timeline_resources(p_start_date timestamp with time zone, p_end_date timestamp with time zone): Zasoby osi czasu kalendarza — tylko pracownik CRM.
CREATE OR REPLACE FUNCTION public.get_calendar_timeline_resources(p_start_date timestamp with time zone DEFAULT (now() - '30 days'::interval), p_end_date timestamp with time zone DEFAULT (now() + '90 days'::interval))
 RETURNS TABLE(resource_type text, resource_id uuid, resource_name text, resource_metadata jsonb, event_id uuid, event_name text, event_start timestamp with time zone, event_end timestamp with time zone, event_status text, assignment_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
RETURN QUERY

-- Pojazdy z przypisaniami do wydarzeń
SELECT
'vehicle'::text as resource_type,
v.id as resource_id,
v.name as resource_name,
jsonb_build_object(
'registration_number', v.registration_number,
'vehicle_type', v.vehicle_type,
'status', v.status
) as resource_metadata,
e.id as event_id,
e.name as event_name,
COALESCE(ep.start_time, e.event_date) as event_start,
COALESCE(ep.end_time, e.event_end_date, e.event_date) as event_end,
e.status::text as event_status,
ev.status::text as assignment_status
FROM vehicles v
LEFT JOIN event_vehicles ev ON ev.vehicle_id = v.id
LEFT JOIN events e ON e.id = ev.event_id AND e.status != 'cancelled'
LEFT JOIN event_phases ep ON ep.id = (
SELECT ep2.id FROM event_phases ep2
WHERE ep2.event_id = e.id
ORDER BY ep2.start_time ASC
LIMIT 1
)
WHERE v.status = 'active'
AND (
ev.id IS NULL
OR (
COALESCE(ep.end_time, e.event_end_date, e.event_date) >= p_start_date
AND COALESCE(ep.start_time, e.event_date) <= p_end_date
AND ev.status != 'cancelled'
)
)

UNION ALL

-- Pracownicy z przypisaniami do wydarzeń (event_employees - stary system)
SELECT
'employee'::text as resource_type,
emp.id as resource_id,
(emp.name || ' ' || emp.surname) as resource_name,
jsonb_build_object(
'nickname', emp.nickname,
'role', emp.role,
'email', emp.email
) as resource_metadata,
e.id as event_id,
e.name as event_name,
e.event_date as event_start,
COALESCE(e.event_end_date, e.event_date) as event_end,
e.status::text as event_status,
'assigned'::text as assignment_status
FROM employees emp
LEFT JOIN event_employees ee ON ee.employee_id = emp.id
LEFT JOIN events e ON e.id = ee.event_id AND e.status != 'cancelled'
WHERE emp.is_active = true
AND (
ee.id IS NULL
OR (
COALESCE(e.event_end_date, e.event_date) >= p_start_date
AND e.event_date <= p_end_date
)
)

UNION ALL

-- Pracownicy z przypisaniami (employee_assignments - nowy system z invitation_status)
SELECT
'employee'::text as resource_type,
emp.id as resource_id,
(emp.name || ' ' || emp.surname) as resource_name,
jsonb_build_object(
'nickname', emp.nickname,
'role', emp.role,
'email', emp.email
) as resource_metadata,
e.id as event_id,
e.name as event_name,
COALESCE(ep.start_time, e.event_date) as event_start,
COALESCE(ep.end_time, e.event_end_date, e.event_date) as event_end,
e.status::text as event_status,
COALESCE(ea.status, 'pending')::text as assignment_status
FROM employees emp
LEFT JOIN employee_assignments ea ON ea.employee_id = emp.id
LEFT JOIN events e ON e.id = ea.event_id AND e.status != 'cancelled'
LEFT JOIN event_phases ep ON ep.id = (
SELECT ep2.id FROM event_phases ep2
WHERE ep2.event_id = e.id
ORDER BY ep2.start_time ASC
LIMIT 1
)
WHERE emp.is_active = true
AND ea.id IS NOT NULL
AND COALESCE(ea.status, 'pending') IN ('pending', 'accepted')
AND (
COALESCE(ep.end_time, e.event_end_date, e.event_date) >= p_start_date
AND COALESCE(ep.start_time, e.event_date) <= p_end_date
)

UNION ALL

-- Sprzęt z przypisaniami do wydarzeń
SELECT
'equipment'::text as resource_type,
ei.id as resource_id,
ei.name as resource_name,
jsonb_build_object(
'warehouse_category_id', ei.warehouse_category_id,
'serial_number', ei.serial_number,
'barcode', ei.barcode
) as resource_metadata,
e.id as event_id,
e.name as event_name,
COALESCE(ep.start_time, e.event_date) as event_start,
COALESCE(ep.end_time, e.event_end_date, e.event_date) as event_end,
e.status::text as event_status,
COALESCE(eeq.status, 'reserved')::text as assignment_status
FROM equipment_items ei
LEFT JOIN event_equipment eeq ON eeq.equipment_id = ei.id
LEFT JOIN events e ON e.id = eeq.event_id AND e.status != 'cancelled'
LEFT JOIN event_phases ep ON ep.id = (
SELECT ep2.id FROM event_phases ep2
WHERE ep2.event_id = e.id
ORDER BY ep2.start_time ASC
LIMIT 1
)
WHERE ei.is_active = true
AND ei.deleted_at IS NULL
AND (
eeq.id IS NULL
OR (
COALESCE(ep.end_time, e.event_end_date, e.event_date) >= p_start_date
AND COALESCE(ep.start_time, e.event_date) <= p_end_date
AND COALESCE(eeq.status, 'reserved') != 'cancelled'
)
)

ORDER BY resource_type, resource_name, event_start;
END;
$function$;

-- get_vehicle_timeline(p_vehicle_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone): Oś czasu pojazdu — tylko pracownik CRM.
CREATE OR REPLACE FUNCTION public.get_vehicle_timeline(p_vehicle_id uuid, p_start_date timestamp with time zone DEFAULT (now() - '30 days'::interval), p_end_date timestamp with time zone DEFAULT (now() + '90 days'::interval))
 RETURNS TABLE(timeline_id uuid, timeline_type text, start_date timestamp with time zone, end_date timestamp with time zone, title text, description text, status text, color text, related_id uuid, event_name text, driver_name text, location text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
RETURN QUERY

-- Wydarzenia (event_vehicles) - wszystkie rezerwacje pojazdów (oprócz cancelled)
SELECT
ev.id as timeline_id,
'event'::text as timeline_type,
COALESCE(ep.start_time, e.event_date) as start_date,
COALESCE(ep.end_time, e.event_end_date) as end_date,
e.name as title,
CONCAT('Wydarzenie: ', e.name,
CASE
WHEN ev.driver_id IS NOT NULL THEN CONCAT(' - Kierowca: ', emp.name, ' ', emp.surname)
ELSE ''
END,
' [',
CASE e.status::text
WHEN 'inquiry' THEN 'Zapytanie'
WHEN 'offer_to_send' THEN 'Oferta do wysłania'
WHEN 'offer_sent' THEN 'Oferta wysłana'
WHEN 'offer_accepted' THEN 'Oferta zaakceptowana'
WHEN 'in_preparation' THEN 'Przygotowanie'
WHEN 'in_progress' THEN 'W trakcie'
WHEN 'completed' THEN 'Zakończone'
WHEN 'invoiced' THEN 'Zafakturowane'
WHEN 'cancelled' THEN 'Anulowane'
ELSE e.status::text
END,
']'
) as description,
COALESCE(e.status::text, 'inquiry') as status,
CASE e.status::text
WHEN 'inquiry' THEN '#3b82f6'
WHEN 'offer_to_send' THEN '#8b5cf6'
WHEN 'offer_sent' THEN '#8b5cf6'
WHEN 'offer_accepted' THEN '#22c55e'
WHEN 'in_preparation' THEN '#f59e0b'
WHEN 'in_progress' THEN '#10b981'
WHEN 'completed' THEN '#6b7280'
WHEN 'invoiced' THEN '#d3bb73'
WHEN 'cancelled' THEN '#ef4444'
ELSE '#d3bb73'
END as color,
e.id as related_id,
e.name as event_name,
CASE
WHEN emp.id IS NOT NULL THEN emp.name || ' ' || emp.surname
ELSE NULL
END as driver_name,
COALESCE(loc.name, e.location) as location
FROM event_vehicles ev
JOIN events e ON e.id = ev.event_id
LEFT JOIN event_phases ep ON ep.id = (
SELECT ep_sub.id FROM event_phases ep_sub
WHERE ep_sub.event_id = e.id
ORDER BY ep_sub.start_time ASC
LIMIT 1
)
LEFT JOIN employees emp ON emp.id = ev.driver_id
LEFT JOIN locations loc ON loc.id = e.location_id
WHERE ev.vehicle_id = p_vehicle_id
AND COALESCE(ep.end_time, e.event_end_date) >= p_start_date
AND COALESCE(ep.start_time, e.event_date) <= p_end_date
AND e.status != 'cancelled'
AND ev.status != 'cancelled'

UNION ALL

-- Naprawy i serwisy (maintenance_records)
SELECT
mr.id as timeline_id,
'maintenance'::text as timeline_type,
mr.date::timestamptz as start_date,
COALESCE(mr.next_service_date::timestamptz, mr.date::timestamptz + INTERVAL '1 day') as end_date,
COALESCE(mr.title, mr.type) as title,
CONCAT('Serwis: ', COALESCE(mr.title, mr.type),
CASE
WHEN mr.service_provider IS NOT NULL THEN CONCAT(' - ', mr.service_provider)
ELSE ''
END
) as description,
COALESCE(mr.status, 'completed')::text as status,
CASE
WHEN mr.status = 'in_progress' THEN '#f59e0b'
WHEN mr.status = 'completed' THEN '#10b981'
WHEN mr.status = 'scheduled' THEN '#3b82f6'
ELSE '#6b7280'
END as color,
mr.id as related_id,
NULL::text as event_name,
NULL::text as driver_name,
mr.service_provider as location
FROM maintenance_records mr
WHERE mr.vehicle_id = p_vehicle_id
AND mr.date >= p_start_date::date
AND mr.date <= p_end_date::date
AND mr.status IN ('in_progress', 'scheduled')

UNION ALL

-- Przeglądy okresowe (periodic_inspections) gdy są w trakcie
SELECT
pi.id as timeline_id,
'maintenance'::text as timeline_type,
pi.inspection_date::timestamptz as start_date,
(pi.inspection_date::timestamptz + INTERVAL '1 day') as end_date,
CASE
WHEN pi.inspection_type = 'technical_inspection' THEN 'Przegląd techniczny'
ELSE 'Przegląd okresowy'
END as title,
CONCAT(
CASE
WHEN pi.inspection_type = 'technical_inspection' THEN 'Przegląd techniczny'
ELSE 'Przegląd okresowy'
END,
CASE
WHEN pi.service_provider IS NOT NULL THEN CONCAT(' - ', pi.service_provider)
ELSE ''
END
) as description,
CASE
WHEN pi.passed THEN 'completed'
ELSE 'failed'
END::text as status,
CASE
WHEN pi.passed THEN '#10b981'
ELSE '#ef4444'
END as color,
pi.id as related_id,
NULL::text as event_name,
NULL::text as driver_name,
pi.service_provider as location
FROM periodic_inspections pi
WHERE pi.vehicle_id = p_vehicle_id
AND pi.inspection_date >= p_start_date::date
AND pi.inspection_date <= p_end_date::date

ORDER BY start_date ASC;
END;
$function$;

-- suggest_employees_for_event(p_event_id uuid): Sugestie obsady — tylko pracownik CRM.
CREATE OR REPLACE FUNCTION public.suggest_employees_for_event(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_result jsonb;
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
-- Pobierz wymagane umiejętności z eventu i zasugeruj pracowników
WITH event_equipment AS (
SELECT DISTINCT equipment_id
FROM event_equipment
WHERE event_id = p_event_id
AND equipment_id IS NOT NULL
),
required_skills AS (
SELECT DISTINCT
s.id as skill_id,
s.name as skill_name,
esr.minimum_proficiency
FROM event_equipment ee
JOIN equipment_skill_requirements esr ON ee.equipment_id = esr.equipment_item_id
JOIN skills s ON esr.skill_id = s.id
WHERE esr.is_required = true
),
suggested_employees AS (
SELECT DISTINCT
e.id as employee_id,
e.name || ' ' || e.surname as employee_name,
e.email,
e.avatar_url,
jsonb_agg(DISTINCT jsonb_build_object(
'skill_name', rs.skill_name,
'proficiency', es.proficiency_level,
'years_experience', es.years_of_experience,
'required_proficiency', rs.minimum_proficiency,
'meets_requirement', CASE
WHEN rs.minimum_proficiency = 'basic' THEN es.proficiency_level IN ('basic', 'intermediate', 'advanced', 'expert')
WHEN rs.minimum_proficiency = 'intermediate' THEN es.proficiency_level IN ('intermediate', 'advanced', 'expert')
WHEN rs.minimum_proficiency = 'advanced' THEN es.proficiency_level IN ('advanced', 'expert')
WHEN rs.minimum_proficiency = 'expert' THEN es.proficiency_level = 'expert'
ELSE false
END
)) as skills,
COUNT(DISTINCT rs.skill_id) as matching_skills_count,
(SELECT COUNT(DISTINCT skill_id) FROM required_skills) as total_required_skills
FROM required_skills rs
JOIN employee_skills es ON rs.skill_id = es.skill_id
JOIN employees e ON es.employee_id = e.id
WHERE e.is_active = true
AND CASE
WHEN rs.minimum_proficiency = 'basic' THEN es.proficiency_level IN ('basic', 'intermediate', 'advanced', 'expert')
WHEN rs.minimum_proficiency = 'intermediate' THEN es.proficiency_level IN ('intermediate', 'advanced', 'expert')
WHEN rs.minimum_proficiency = 'advanced' THEN es.proficiency_level IN ('advanced', 'expert')
WHEN rs.minimum_proficiency = 'expert' THEN es.proficiency_level = 'expert'
ELSE true
END
GROUP BY e.id, e.name, e.surname, e.email, e.avatar_url
)
SELECT jsonb_build_object(
'required_skills', (
SELECT jsonb_agg(jsonb_build_object(
'skill_id', skill_id,
'skill_name', skill_name,
'minimum_proficiency', minimum_proficiency
))
FROM required_skills
),
'suggested_employees', (
SELECT jsonb_agg(
jsonb_build_object(
'employee_id', employee_id,
'employee_name', employee_name,
'email', email,
'avatar_url', avatar_url,
'skills', skills,
'matching_skills_count', matching_skills_count,
'total_required_skills', total_required_skills,
'match_percentage', ROUND((matching_skills_count::numeric / NULLIF(total_required_skills, 0)) * 100, 0)
)
ORDER BY matching_skills_count DESC, employee_name
)
FROM suggested_employees
)
) INTO v_result;

RETURN COALESCE(v_result, jsonb_build_object('required_skills', '[]'::jsonb, 'suggested_employees', '[]'::jsonb));
END;
$function$;

-- get_product_required_skills(p_product_id uuid): Kompetencje produktu — tylko pracownik CRM.
CREATE OR REPLACE FUNCTION public.get_product_required_skills(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_result jsonb;
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
-- Pobierz wszystkie wymagane umiejętności ze sprzętu przypisanego do produktu
WITH product_equipment AS (
SELECT DISTINCT equipment_item_id
FROM offer_product_equipment
WHERE product_id = p_product_id
AND equipment_item_id IS NOT NULL
),
required_skills AS (
SELECT DISTINCT
s.id as skill_id,
s.name as skill_name,
s.description as skill_description,
sc.name as category_name,
sc.color as category_color,
esr.minimum_proficiency,
esr.is_required,
ei.name as equipment_name,
COUNT(*) OVER (PARTITION BY s.id) as equipment_count
FROM product_equipment pe
JOIN equipment_skill_requirements esr ON pe.equipment_item_id = esr.equipment_item_id
JOIN skills s ON esr.skill_id = s.id
LEFT JOIN skill_categories sc ON s.category_id = sc.id
LEFT JOIN equipment_items ei ON pe.equipment_item_id = ei.id
WHERE esr.is_required = true
)
SELECT jsonb_agg(
jsonb_build_object(
'skill_id', skill_id,
'skill_name', skill_name,
'skill_description', skill_description,
'category_name', category_name,
'category_color', category_color,
'minimum_proficiency', minimum_proficiency,
'equipment_count', equipment_count,
'equipment_names', (
SELECT jsonb_agg(DISTINCT ei2.name)
FROM product_equipment pe2
JOIN equipment_skill_requirements esr2 ON pe2.equipment_item_id = esr2.equipment_item_id
JOIN equipment_items ei2 ON pe2.equipment_item_id = ei2.id
WHERE esr2.skill_id = rs.skill_id
AND pe2.equipment_item_id IN (SELECT equipment_item_id FROM product_equipment)
)
)
ORDER BY equipment_count DESC, skill_name
) INTO v_result
FROM required_skills rs;

RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- reserve_selected_equipment(p_offer_id uuid, p_items jsonb, p_accepted_shortages jsonb): Rezerwacja sprzętu z oferty — tylko pracownik CRM.
CREATE OR REPLACE FUNCTION public.reserve_selected_equipment(p_offer_id uuid, p_items jsonb, p_accepted_shortages jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id uuid;
  v_item jsonb;
  v_shortage jsonb;
  v_inserted_count integer := 0;
  v_shortage_count integer := 0;
  v_rejected_count integer := 0;
  v_substitution_count integer := 0;
  v_substitution record;
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
  SELECT event_id
  INTO v_event_id
  FROM offers
  WHERE id = p_offer_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nie znaleziono oferty');
  END IF;

  DELETE FROM event_equipment
  WHERE event_id = v_event_id
    AND offer_id = p_offer_id;

  -- wybrane pozycje
  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    IF (v_item->>'item_type') = 'item' THEN
      INSERT INTO event_equipment (
        event_id,
        offer_id,
        equipment_id,
        quantity,
        reservation_status,
        status,
        auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_item->>'item_id')::uuid,
        COALESCE((v_item->>'qty')::integer, 0),
        'reserved_pending'::equipment_reservation_status,
        'reserved',
        true
      )
      ON CONFLICT (event_id, equipment_id, offer_id)
      WHERE equipment_id IS NOT NULL AND offer_id IS NOT NULL
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        reservation_status = EXCLUDED.reservation_status,
        status = EXCLUDED.status,
        auto_added = EXCLUDED.auto_added,
        updated_at = now();

      v_inserted_count := v_inserted_count + 1;

    ELSIF (v_item->>'item_type') = 'kit' THEN
      INSERT INTO event_equipment (
        event_id,
        offer_id,
        kit_id,
        quantity,
        reservation_status,
        status,
        auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_item->>'item_id')::uuid,
        COALESCE((v_item->>'qty')::integer, 0),
        'reserved_pending'::equipment_reservation_status,
        'reserved',
        true
      )
      ON CONFLICT (event_id, kit_id, offer_id)
      WHERE kit_id IS NOT NULL AND offer_id IS NOT NULL
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        reservation_status = EXCLUDED.reservation_status,
        status = EXCLUDED.status,
        auto_added = EXCLUDED.auto_added,
        updated_at = now();

      v_inserted_count := v_inserted_count + 1;
    END IF;
  END LOOP;

  -- substytuty
  FOR v_substitution IN
    SELECT
      oes.from_item_id,
      oes.to_item_id,
      oes.qty
    FROM offer_equipment_substitutions oes
    WHERE oes.offer_id = p_offer_id
  LOOP
    INSERT INTO event_equipment (
      event_id,
      offer_id,
      equipment_id,
      quantity,
      reservation_status,
      status,
      auto_added,
      notes
    )
    VALUES (
      v_event_id,
      p_offer_id,
      v_substitution.to_item_id,
      COALESCE(v_substitution.qty, 1),
      'reserved_pending'::equipment_reservation_status,
      'reserved',
      true,
      'Substytut'
    )
    ON CONFLICT (event_id, equipment_id, offer_id)
    WHERE equipment_id IS NOT NULL AND offer_id IS NOT NULL
    DO UPDATE SET
      quantity = event_equipment.quantity + EXCLUDED.quantity,
      updated_at = now(),
      notes = COALESCE(event_equipment.notes || E'\n', '') || COALESCE(EXCLUDED.notes, '');

    v_substitution_count := v_substitution_count + 1;
  END LOOP;

  -- zaakceptowane braki
  FOR v_shortage IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_accepted_shortages, '[]'::jsonb))
  LOOP
    IF (v_shortage->>'item_type') = 'item' THEN
      INSERT INTO event_equipment (
        event_id,
        offer_id,
        equipment_id,
        quantity,
        reservation_status,
        status,
        is_optional,
        auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_shortage->>'item_id')::uuid,
        COALESCE((v_shortage->>'shortage_qty')::integer, 0),
        'reserved_pending'::equipment_reservation_status,
        'draft',
        true,
        true
      )
      ON CONFLICT (event_id, equipment_id, offer_id)
      WHERE equipment_id IS NOT NULL AND offer_id IS NOT NULL
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        reservation_status = EXCLUDED.reservation_status,
        status = EXCLUDED.status,
        is_optional = EXCLUDED.is_optional,
        auto_added = EXCLUDED.auto_added,
        updated_at = now();

      v_shortage_count := v_shortage_count + 1;

    ELSIF (v_shortage->>'item_type') = 'kit' THEN
      INSERT INTO event_equipment (
        event_id,
        offer_id,
        kit_id,
        quantity,
        reservation_status,
        status,
        is_optional,
        auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_shortage->>'item_id')::uuid,
        COALESCE((v_shortage->>'shortage_qty')::integer, 0),
        'reserved_pending'::equipment_reservation_status,
        'draft',
        true,
        true
      )
      ON CONFLICT (event_id, kit_id, offer_id)
      WHERE kit_id IS NOT NULL AND offer_id IS NOT NULL
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        reservation_status = EXCLUDED.reservation_status,
        status = EXCLUDED.status,
        is_optional = EXCLUDED.is_optional,
        auto_added = EXCLUDED.auto_added,
        updated_at = now();

      v_shortage_count := v_shortage_count + 1;
    END IF;
  END LOOP;

  UPDATE offers
  SET status = 'accepted'
  WHERE id = p_offer_id;

  UPDATE offers
  SET status = 'rejected'
  WHERE event_id = v_event_id
    AND id != p_offer_id
    AND status != 'rejected';

  GET DIAGNOSTICS v_rejected_count = ROW_COUNT;

  DELETE FROM event_equipment
  WHERE event_id = v_event_id
    AND offer_id IN (
      SELECT id
      FROM offers
      WHERE event_id = v_event_id
        AND id != p_offer_id
        AND status = 'rejected'
    );

  UPDATE events
  SET has_equipment_shortage = (v_shortage_count > 0)
  WHERE id = v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'reserved_count', v_inserted_count,
    'substitution_count', v_substitution_count,
    'shortage_count', v_shortage_count,
    'rejected_offers_count', v_rejected_count
  );
END;
$function$;

-- reserve_selected_equipment(p_offer_id uuid, p_items jsonb, p_accepted_shortages jsonb, p_package_id uuid): Rezerwacja sprzętu z oferty — tylko pracownik CRM.
CREATE OR REPLACE FUNCTION public.reserve_selected_equipment(p_offer_id uuid, p_items jsonb, p_accepted_shortages jsonb, p_package_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id uuid;
  v_item jsonb;
  v_shortage jsonb;
  v_inserted_count integer := 0;
  v_shortage_count integer := 0;
  v_rejected_count integer := 0;
  v_snapshot jsonb;
  inquiry_uuid uuid; selected_uuid uuid; amendment_source uuid; source_offer public.offers;
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
  IF NOT public.sales_can_manage_offer(p_offer_id) THEN RAISE EXCEPTION 'Brak uprawnień do akceptacji oferty'; END IF;
  SELECT inquiry_id INTO inquiry_uuid FROM public.offers WHERE id=p_offer_id;
  IF inquiry_uuid IS NOT NULL THEN
    SELECT accepted_offer_id INTO selected_uuid FROM public.tasks WHERE id=inquiry_uuid FOR UPDATE;
    SELECT source_offer_id INTO amendment_source FROM public.offer_amendments WHERE offer_id=p_offer_id;
    IF amendment_source IS NOT NULL AND selected_uuid=amendment_source THEN
      -- The pointer and reservations switch in this same transaction; any error rolls both back.
      UPDATE public.tasks SET accepted_offer_id=p_offer_id WHERE id=inquiry_uuid;
      selected_uuid:=p_offer_id;
    END IF;
    IF selected_uuid IS NOT NULL AND selected_uuid<>p_offer_id THEN RAISE EXCEPTION 'Wybrano inny wariant. Otwórz negocjacje ponownie przed zmianą.'; END IF;
  END IF;
  SELECT source_offer_id INTO amendment_source FROM public.offer_amendments WHERE offer_id=p_offer_id;
  IF amendment_source IS NOT NULL THEN
    SELECT * INTO STRICT source_offer FROM public.offers WHERE id=amendment_source FOR UPDATE;
    IF NOT public.sales_can_manage_offer(amendment_source) THEN RAISE EXCEPTION 'Brak uprawnień do zmiany oferty'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.offers WHERE id=p_offer_id AND status='accepted') THEN
      IF source_offer.status<>'accepted' OR NOT EXISTS(
        SELECT 1 FROM public.offers WHERE id=p_offer_id AND event_id=source_offer.event_id
        AND inquiry_id IS NOT DISTINCT FROM source_offer.inquiry_id
      ) THEN RAISE EXCEPTION 'Poprzednia oferta lub jej powiązanie uległy zmianie. Odśwież ofertę.'; END IF;
      IF EXISTS(SELECT 1 FROM public.event_equipment WHERE offer_id=amendment_source AND reservation_status::text NOT IN ('planned','reserved_pending')) THEN
        RAISE EXCEPTION 'Sprzęt został już przyjęty do przygotowania lub wydany. Uzgodnij zmianę rezerwacji z magazynem.';
      END IF;
    END IF;
  END IF;
  PERFORM 1 FROM public.offers WHERE id=p_offer_id FOR UPDATE;
  PERFORM set_config('mavinci.sales_decision','yes',true);
  SELECT event_id
  INTO v_event_id
  FROM public.offers
  WHERE id = p_offer_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono wydarzenia oferty';
  END IF;

  IF p_package_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.offer_packages
    WHERE id = p_package_id AND offer_id = p_offer_id
  ) THEN
    RAISE EXCEPTION 'Wybrany pakiet nie należy do oferty';
  END IF;

  IF p_package_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'package_id', package.id,
      'package_name', package.name,
      'product_id', item.product_id,
      'product_variant_id', item.product_variant_id,
      'variant_name', variant.name,
      'quantity', item.quantity
    ) ORDER BY item.display_order), '[]'::jsonb)
    INTO v_snapshot
    FROM public.offer_packages package
    JOIN public.offer_package_items item ON item.package_id = package.id
    LEFT JOIN public.offer_product_variants variant ON variant.id = item.product_variant_id
    WHERE package.id = p_package_id;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'offer_item_id', item.id,
      'product_id', item.product_id,
      'product_variant_id', item.product_variant_id,
      'variant_name', variant.name,
      'quantity', item.quantity
    ) ORDER BY item.display_order), '[]'::jsonb)
    INTO v_snapshot
    FROM public.offer_items item
    LEFT JOIN public.offer_product_variants variant ON variant.id = item.product_variant_id
    WHERE item.offer_id = p_offer_id;
  END IF;

  DELETE FROM public.event_equipment
  WHERE event_id = v_event_id AND offer_id = p_offer_id;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    IF v_item->>'item_type' = 'item' THEN
      INSERT INTO public.event_equipment(
        event_id, offer_id, equipment_id, quantity, reservation_status, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_item->>'item_id')::uuid,
        (v_item->>'qty')::integer,
        'reserved_pending',
        true
      );
    ELSE
      INSERT INTO public.event_equipment(
        event_id, offer_id, kit_id, quantity, reservation_status, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_item->>'item_id')::uuid,
        (v_item->>'qty')::integer,
        'reserved_pending',
        true
      );
    END IF;
    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  FOR v_shortage IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_accepted_shortages, '[]'::jsonb))
  LOOP
    IF v_shortage->>'item_type' = 'item' THEN
      INSERT INTO public.event_equipment(
        event_id, offer_id, equipment_id, quantity, reservation_status, is_optional, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_shortage->>'item_id')::uuid,
        (v_shortage->>'shortage_qty')::integer,
        'planned',
        true,
        true
      );
    ELSE
      INSERT INTO public.event_equipment(
        event_id, offer_id, kit_id, quantity, reservation_status, is_optional, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_shortage->>'item_id')::uuid,
        (v_shortage->>'shortage_qty')::integer,
        'planned',
        true,
        true
      );
    END IF;
    v_shortage_count := v_shortage_count + 1;
  END LOOP;

  UPDATE public.offers
  SET status = 'accepted',
      accepted_at = now(),
      accepted_package_id = p_package_id,
      accepted_variant_selections = v_snapshot
  WHERE id = p_offer_id;

  UPDATE public.offers
  SET status = 'rejected'
  WHERE event_id = v_event_id
    AND id <> p_offer_id
    AND status = 'accepted';
  GET DIAGNOSTICS v_rejected_count = ROW_COUNT;

  DELETE FROM public.event_equipment
  WHERE event_id = v_event_id
    AND offer_id IN (
      SELECT id
      FROM public.offers
      WHERE event_id = v_event_id AND status = 'rejected'
    );

  UPDATE public.events
  SET has_equipment_shortage = (v_shortage_count > 0)
  WHERE id = v_event_id;

  IF inquiry_uuid IS NOT NULL THEN
    UPDATE public.tasks SET accepted_offer_id=p_offer_id,inquiry_stage='won',next_action_at=NULL WHERE id=inquiry_uuid;
    PERFORM public.sales_log(inquiry_uuid,'acceptance','Zaakceptowano ofertę i zapisano rezerwacje',jsonb_build_object('offer_id',p_offer_id));
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'reserved_count', v_inserted_count,
    'shortage_count', v_shortage_count,
    'rejected_offers_count', v_rejected_count,
    'accepted_package_id', p_package_id,
    'variant_selections', v_snapshot
  );
END;
$function$;

-- sync_offer_equipment_to_event(p_offer_id uuid): Synchronizacja sprzętu oferty — tylko pracownik CRM (z triggera bez zmian).
CREATE OR REPLACE FUNCTION public.sync_offer_equipment_to_event(p_offer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_event_id uuid;
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
SELECT event_id INTO v_event_id
FROM public.offers
WHERE id = p_offer_id;

IF v_event_id IS NULL THEN
RETURN;
END IF;

-- Delete equipment from this offer
DELETE FROM public.event_equipment
WHERE event_id = v_event_id
AND offer_id = p_offer_id;

-- Insert equipment items
INSERT INTO public.event_equipment (
event_id,
equipment_id,
quantity,
status,
offer_id,
auto_added,
auto_quantity,
removed_from_offer,
offer_quantity
)
SELECT
v_event_id,
x.equipment_item_id,
x.qty::int,
'reserved',
p_offer_id,
true,
x.qty::int,
false,
x.qty::int
FROM public.get_offer_equipment_final(p_offer_id) x
WHERE x.equipment_item_id IS NOT NULL;

-- Insert kits
INSERT INTO public.event_equipment (
event_id,
kit_id,
quantity,
status,
offer_id,
auto_added,
auto_quantity,
removed_from_offer,
offer_quantity
)
SELECT
v_event_id,
x.equipment_kit_id,
x.qty::int,
'reserved',
p_offer_id,
true,
x.qty::int,
false,
x.qty::int
FROM public.get_offer_equipment_final(p_offer_id) x
WHERE x.equipment_kit_id IS NOT NULL;
END;
$function$;

-- sync_equipment_bookings_for_event(p_event_id uuid): Przeliczenie rezerwacji sprzętu — tylko pracownik CRM (z triggera bez zmian).
CREATE OR REPLACE FUNCTION public.sync_equipment_bookings_for_event(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_start timestamptz;
v_end timestamptz;
BEGIN
  PERFORM private.require_crm_employee();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
SELECT event_date, event_end_date INTO v_start, v_end
FROM public.events
WHERE id = p_event_id;

IF v_start IS NULL THEN
RETURN;
END IF;

-- Delete existing bookings for this event
DELETE FROM public.equipment_bookings
WHERE event_id = p_event_id;

-- Insert bookings for equipment_items (not kits), aggregated to avoid duplicates
INSERT INTO public.equipment_bookings (event_id, equipment_id, quantity, start_date, end_date, notes)
SELECT
p_event_id,
ee.equipment_id,
SUM(ee.quantity),
v_start,
v_end,
string_agg(ee.notes, E'\n') FILTER (WHERE ee.notes IS NOT NULL)
FROM public.event_equipment ee
WHERE ee.event_id = p_event_id
AND ee.equipment_id IS NOT NULL
AND ee.quantity > 0
AND ee.status NOT IN ('released', 'cancelled')
GROUP BY ee.equipment_id
ON CONFLICT (event_id, equipment_id) DO UPDATE
SET quantity = EXCLUDED.quantity,
notes = EXCLUDED.notes;

-- Expand kits into individual items and create bookings, aggregated
INSERT INTO public.equipment_bookings (event_id, equipment_id, quantity, start_date, end_date, notes)
SELECT
p_event_id,
eki.equipment_id,
SUM(ee.quantity * eki.quantity),
v_start,
v_end,
string_agg('Z kitu: ' || COALESCE(ek.name, ''), E'\n')
FROM public.event_equipment ee
JOIN public.equipment_kits ek ON ek.id = ee.kit_id
JOIN public.equipment_kit_items eki ON eki.kit_id = ee.kit_id
WHERE ee.event_id = p_event_id
AND ee.kit_id IS NOT NULL
AND eki.equipment_id IS NOT NULL
AND ee.quantity > 0
AND ee.status NOT IN ('released', 'cancelled')
GROUP BY eki.equipment_id
ON CONFLICT (event_id, equipment_id) DO UPDATE
SET quantity = equipment_bookings.quantity + EXCLUDED.quantity,
notes = CASE
WHEN equipment_bookings.notes IS NULL THEN EXCLUDED.notes
WHEN EXCLUDED.notes IS NULL THEN equipment_bookings.notes
ELSE equipment_bookings.notes || E'\n' || EXCLUDED.notes
END;
END;
$function$;

-- employees_public_list(): lista aktywnych pracowników (imię, nazwisko, avatar) — tylko pracownik CRM.
CREATE OR REPLACE FUNCTION public.employees_public_list()
 RETURNS TABLE(id uuid, name text, surname text, nickname text, avatar_url text, avatar_metadata jsonb, is_active boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    e.id,
    e.name,
    e.surname,
    e.nickname,
    e.avatar_url,
    e.avatar_metadata,
    e.is_active
  from public.employees e
  where e.is_active = true
    and private.crm_employee_allowed();  -- P0: tylko pracownik CRM (bez anon i konta portalu)
$function$;

-- Nieużywane przeciążenia z dowolnym „zatwierdzającym” podanym przez klienta (CRM woła wersje 3-argumentowe).
DROP FUNCTION IF EXISTS public.approve_absence(uuid, uuid);
DROP FUNCTION IF EXISTS public.reject_absence(uuid, uuid);

-- 3. P0-2: funkcje wołane wyłącznie przez Edge Functions (service_role), triggery, pg_cron lub inne funkcje
--    SECURITY DEFINER — bez dostępu z API dla anon i authenticated. Żadna nie jest wołana z CRM, aplikacji mobilnej,
--    aplikacji macOS ani z funkcji SECURITY INVOKER / polityk (sprawdza to kontrola końcowa).
DO $$
DECLARE
  v_name text;
  v_fn regprocedure;
  v_list text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    -- ❌ z audytu (4.4)
    'delete_offer_with_cleanup', 'persist_ksef_send_result_atomic', 'reconcile_local_invoice_with_ksef_atomic',
    'confirm_equipment_reservation', 'replace_wedding_card_people', 'create_event_operational_notification',
    'create_fleet_compliance_notification', 'get_organization_invoices', 'get_event_invoices', 'get_event_cash_summary',
    'get_employee_conflicts', 'get_employee_phase_conflicts', 'claim_email_ai_qualification',
    -- zadania harmonogramu (pg_cron działa jako właściciel funkcji)
    'process_crm_system_health_alerts', 'process_event_operational_alerts', 'process_due_inquiry_followups',
    'notify_overdue_event_workflows', 'check_fleet_notifications', 'check_unreturned_vehicles',
    'refresh_vehicle_compliance', 'invoke_ai_email_qualification', 'invoke_scheduled_tender_scan', 'update_overdue_invoices',
    -- ⚠️ z audytu (4.4): numeracja, sprzęt, flota, foldery, grafiki, kompetencje, ceny, koszty
    'reserve_invoice_number_atomic', 'reserve_equipment_for_event', 'reserve_equipment_from_offer',
    'unreserve_equipment_from_offer', 'sync_event_equipment_from_offer', 'override_event_equipment',
    'remove_event_equipment_from_offer', 'restore_event_equipment_to_offer', 'restore_event_equipment_from_offer',
    'save_offer_conflicts', 'resolve_conflict_with_external_rental', 'resolve_conflict_with_substitution',
    'pickup_vehicle', 'return_vehicle', 'sync_event_vehicle_to_phases', 'create_product_from_subcontractor_service',
    'claim_seller_offer_email', 'record_seller_offer_document', 'mark_bank_ai_reports_stale_for_statement_period',
    'ensure_contracts_folder', 'ensure_event_workflow_instance', 'get_or_create_documents_folder',
    'refresh_event_mavinci_live_modules', 'get_employee_timeline', 'get_event_preflight_core',
    'find_employees_with_skills', 'check_event_skill_requirements', 'get_event_required_skills',
    'employees_public_by_ids', 'calculate_product_staff_costs', 'resolve_seller_product_price',
    'get_vehicle_cost_report', 'check_absence_overlap'
  ] LOOP
    FOR v_fn IN SELECT p.oid::regprocedure FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_name LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    END LOOP;
    -- Kontrola: funkcji nie woła żadna funkcja SECURITY INVOKER (w tym trigger) ani polityka — tam działałaby
    -- z uprawnieniami użytkownika i kończyła się błędem „permission denied for function”.
    SELECT string_agg(DISTINCT caller.oid::regprocedure::text, ', ') INTO v_list
    FROM pg_proc caller
    WHERE caller.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
      AND caller.prokind = 'f' AND NOT caller.prosecdef AND caller.proname <> v_name
      AND caller.prolang IN (SELECT l.oid FROM pg_language l WHERE l.lanname IN ('plpgsql', 'sql'))
      AND pg_get_functiondef(caller.oid) ~ ('(^|[^a-z0-9_])' || v_name || '\s*\(');
    IF v_list IS NOT NULL THEN
      RAISE EXCEPTION 'Funkcję % wołają funkcje SECURITY INVOKER (%), nie można jej odebrać zalogowanym.', v_name, v_list;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies pol
               WHERE (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ~ ('(^|[^a-z0-9_])' || v_name || '\(')) THEN
      RAISE EXCEPTION 'Funkcja % jest używana w polityce RLS, nie można jej odebrać zalogowanym.', v_name;
    END IF;
  END LOOP;
END $$;

-- 4. P0-3: treści strony WWW — zapis tylko redaktor strony (can_edit_website) ------------------------------------
-- Usuwane są wszystkie polityki zapisu (INSERT/UPDATE/DELETE/ALL) nadane rolom public/anon; odczyt opublikowanych
-- wierszy dla anon zostaje bez zmian. Redaktor dostaje jedną politykę FOR ALL (widzi też wiersze ukryte).
DO $$
DECLARE
  v_table text;
  v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'casino_content_items', 'casino_content_sections', 'casino_content_separators', 'conferences_related_services',
    'dj_related_services', 'seo_city_content', 'site_images', 'technical_stage_related_services',
    'integracje_page_images', 'kasyno_page_images', 'konferencje_page_images', 'naglosnienie_page_images',
    'quizy-teleturnieje_page_images', 'streaming_page_images', 'symulatory-vr_page_images',
    'technika-sceniczna_page_images', 'wieczory-tematyczne_page_images'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN CONTINUE; END IF;
    FOR v_policy IN SELECT policyname FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = v_table AND permissive = 'PERMISSIVE'
                      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') AND roles && ARRAY['public', 'anon']::name[] LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;
    EXECUTE format('DROP POLICY IF EXISTS website_editors_write ON public.%I', v_table);
    EXECUTE format('CREATE POLICY website_editors_write ON public.%I FOR ALL TO authenticated '
                   'USING (public.can_edit_website()) WITH CHECK (public.can_edit_website())', v_table);
  END LOOP;
END $$;

-- Buckety strony. conferences-gallery: zapis tylko redaktor strony. site-images służy też CRM (zdjęcia sprzętu,
-- zestawów, avatary skrzynek, oferty — src/lib/storage.ts → uploadImage), więc zapis: pracownik CRM (bez konta
-- portalu); bez logowania wyłącznie wgranie CV z formularza „Dołącz do zespołu” do folderu cv-uploads/.
DROP POLICY IF EXISTS "Anyone can delete conferences gallery images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update conferences gallery images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload conferences gallery images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete site images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update site images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload site images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete site images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update site images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload site images" ON storage.objects;
DROP POLICY IF EXISTS conferences_gallery_editors_insert ON storage.objects;
DROP POLICY IF EXISTS conferences_gallery_editors_update ON storage.objects;
DROP POLICY IF EXISTS conferences_gallery_editors_delete ON storage.objects;
DROP POLICY IF EXISTS site_images_staff_insert ON storage.objects;
DROP POLICY IF EXISTS site_images_staff_update ON storage.objects;
DROP POLICY IF EXISTS site_images_staff_delete ON storage.objects;
DROP POLICY IF EXISTS site_images_public_cv_upload ON storage.objects;
CREATE POLICY conferences_gallery_editors_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'conferences-gallery' AND public.can_edit_website());
CREATE POLICY conferences_gallery_editors_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'conferences-gallery' AND public.can_edit_website())
  WITH CHECK (bucket_id = 'conferences-gallery' AND public.can_edit_website());
CREATE POLICY conferences_gallery_editors_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'conferences-gallery' AND public.can_edit_website());
CREATE POLICY site_images_staff_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-images' AND public.current_crm_employee_id() IS NOT NULL
              AND NOT public.current_session_is_seller_portal());
CREATE POLICY site_images_staff_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'site-images' AND public.current_crm_employee_id() IS NOT NULL
         AND NOT public.current_session_is_seller_portal())
  WITH CHECK (bucket_id = 'site-images' AND public.current_crm_employee_id() IS NOT NULL
              AND NOT public.current_session_is_seller_portal());
CREATE POLICY site_images_staff_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'site-images' AND public.current_crm_employee_id() IS NOT NULL
         AND NOT public.current_session_is_seller_portal());
CREATE POLICY site_images_public_cv_upload ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'site-images' AND (storage.foldername(name))[1] = 'cv-uploads');

-- 5. P0-4: konto portalu sprzedawcy nie ma dostępu do tabel bez logiki portalu ----------------------------------
-- Portal czyta dane wyłącznie przez funkcje seller_* / get_seller_* (SECURITY DEFINER) oraz bezpośrednio: offers,
-- sales_partner_*, seller_* i notification_recipients (własne powiadomienia) — tych tabel lista nie obejmuje.
-- notifications i notification_recipients zawęża sekcja 6 do odbiorcy (portal widzi tylko swoje).
DO $$
DECLARE
  v_table text;
  v_policy text;
BEGIN
  FOR v_table IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      AND (c.relname = ANY (ARRAY[
             'clients', 'contact_history', 'contact_organizations', 'contact_persons', 'contact_reminders',
             'organization_decision_makers', 'organization_notes', 'employee_absences', 'employee_certifications',
             'employee_driving_licenses', 'employee_signatures', 'employee_skills', 'employee_assignments',
             'event_vehicles', 'event_audit_log', 'task_assignees', 'locations', 'access_levels', 'public_holidays'])
           OR c.relname ~ '^subcontractor' OR c.relname ~ '^email_.*template' OR c.relname ~ '^equipment_')
    ORDER BY c.relname
  LOOP
    v_policy := left('seller_portal_deny_' || v_table, 63);
    -- Tabela ma już restrykcyjną blokadę portalu pod inną nazwą (np. equipment_items) — pomijamy.
    IF EXISTS (SELECT 1 FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = v_table AND p.permissive = 'RESTRICTIVE'
                 AND p.policyname <> v_policy AND p.cmd = 'ALL'
                 AND coalesce(p.qual, '') ~ 'NOT current_session_is_seller_portal\(\)') THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy, v_table);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
                   'USING (NOT public.current_session_is_seller_portal()) '
                   'WITH CHECK (NOT public.current_session_is_seller_portal())', v_policy, v_table);
  END LOOP;
END $$;

-- 6. P0-5: powiadomienia — tylko odbiorca ------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public to create event notifications" ON public.notifications;
DROP POLICY IF EXISTS "Allow public to update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Everyone can view notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update notifications" ON public.notifications;
-- Zostaje: „Authenticated users can view notifications” (odbiorca) i restrykcyjna mailbox_notification_membership.
DROP POLICY IF EXISTS "Allow public to add notification recipients" ON public.notification_recipients;
DROP POLICY IF EXISTS "System can insert notification recipients" ON public.notification_recipients;
-- Zostaje: odczyt, oznaczenie jako przeczytane i usunięcie własnego wpisu (user_id = auth.uid()).
-- Odbiorca może zmienić wyłącznie is_read / read_at — nie przepnie swojego wpisu na cudze powiadomienie.
REVOKE ALL ON public.notifications, public.notification_recipients FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.notifications FROM authenticated;
REVOKE INSERT, UPDATE, TRUNCATE ON public.notification_recipients FROM authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT SELECT, DELETE ON public.notification_recipients TO authenticated;
GRANT UPDATE (is_read, read_at) ON public.notification_recipients TO authenticated;

-- 7. P0-6: pracownicy na stronie WWW — widok z polami strony „Zespół” zamiast polityki anon na tabeli -------------
-- Widok działa z prawami właściciela (security_invoker = false — świadomy wyjątek od zasady 7.6): stała lista
-- kolumn i warunek show_on_website. Pełny rekord pracownika (telefon prywatny, adres, NIP, notatki, uprawnienia)
-- nie jest już dostępny bez logowania.
CREATE OR REPLACE VIEW public.website_team_members WITH (security_invoker = false) AS
  SELECT e.id, e.name, e.surname, e.nickname, e.email, e.avatar_url, e.avatar_metadata, e.team_page_metadata,
         e.occupation, e.website_bio, e.linkedin_url, e.instagram_url, e.facebook_url, e.order_index, e.created_at
  FROM public.employees e
  WHERE e.show_on_website = true;
COMMENT ON VIEW public.website_team_members IS
  'Pracownicy pokazywani na stronie „Zespół” — wyłącznie pola publiczne (bez danych prywatnych i uprawnień).';
REVOKE ALL ON public.website_team_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_team_members TO anon, authenticated, service_role;
DROP POLICY IF EXISTS "Public can view website employees" ON public.employees;

-- 8. P0-7: osoby kontaktowe wydarzeń i pojazdy ---------------------------------------------------------------------
DROP POLICY IF EXISTS allow_all_event_contact_persons ON public.event_contact_persons;
DROP POLICY IF EXISTS event_contact_persons_read ON public.event_contact_persons;
DROP POLICY IF EXISTS event_contact_persons_insert ON public.event_contact_persons;
DROP POLICY IF EXISTS event_contact_persons_update ON public.event_contact_persons;
DROP POLICY IF EXISTS event_contact_persons_delete ON public.event_contact_persons;
CREATE POLICY event_contact_persons_read ON public.event_contact_persons FOR SELECT TO authenticated
  USING (public.current_employee_can_view_event(event_id));
CREATE POLICY event_contact_persons_insert ON public.event_contact_persons FOR INSERT TO authenticated
  WITH CHECK (public.current_employee_can_manage_event(event_id));
CREATE POLICY event_contact_persons_update ON public.event_contact_persons FOR UPDATE TO authenticated
  USING (public.current_employee_can_manage_event(event_id))
  WITH CHECK (public.current_employee_can_manage_event(event_id));
CREATE POLICY event_contact_persons_delete ON public.event_contact_persons FOR DELETE TO authenticated
  USING (public.current_employee_can_manage_event(event_id));
REVOKE ALL ON public.event_contact_persons FROM anon;
DROP POLICY IF EXISTS vehicles_insert ON public.vehicles;

-- 9. P0-10 (znalezione): zaproszenia do wydarzeń bez polityk anon (token obsługuje serwer kluczem service_role) -----
DROP POLICY IF EXISTS "Allow public to read invitations by token" ON public.employee_assignments;
DROP POLICY IF EXISTS "Allow public to update invitation status by token" ON public.employee_assignments;

-- 10. P0-8: dane dostępowe KSeF — sekrety bez odczytu z API ----------------------------------------------------------
-- Zapis (INSERT/UPDATE) dla finance_manage działalności zostaje (polityki z 20261101165000), odczyt tylko kolumn
-- bez sekretów. Token, tokeny dostępu/odświeżania, token sesji, klucz i hasło certyfikatu czyta wyłącznie
-- service_role (bridge KSeF, Edge Functions ksef-api i sync-ksef-daily).
REVOKE ALL ON public.ksef_credentials FROM anon;
REVOKE SELECT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ksef_credentials FROM authenticated;
GRANT INSERT, UPDATE ON public.ksef_credentials TO authenticated;
GRANT SELECT (id, organization_id, nip, is_test_environment, session_expires_at, is_active, created_at, updated_at,
  my_company_id, certificate_uploaded_at, access_token_valid_until, refresh_token_valid_until,
  last_auth_reference_number, last_authenticated_at, auto_sync_enabled, auto_sync_last_attempt_at,
  auto_sync_last_success_at, auto_sync_last_error) ON public.ksef_credentials TO authenticated;
DO $$
DECLARE v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['token', 'session_token', 'certificate_key', 'certificate_password', 'access_token', 'refresh_token'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'ksef_credentials' AND column_name = v_col) THEN
      EXECUTE format('REVOKE SELECT (%I) ON public.ksef_credentials FROM authenticated', v_col);
    END IF;
  END LOOP;
END $$;

-- 11. P0-9: PDF-y ofert (bucket generated-offers) ---------------------------------------------------------------------
-- Generowanie i wysyłka działają kluczem service_role (bez zmian). Z przeglądarki: odczyt i podpisany link — kto widzi
-- ofertę (RLS tabeli offers); usunięcie/zapis — właściciel oferty / offers_manage (sales_can_manage_offer);
-- pliki niepowiązane z ofertą — administrator. Konto portalu: brak (PDF-y portalu są w seller-offer-documents).
DROP POLICY IF EXISTS "Authenticated can manage generated offers" ON storage.objects;
DROP POLICY IF EXISTS generated_offers_read ON storage.objects;
DROP POLICY IF EXISTS generated_offers_insert ON storage.objects;
DROP POLICY IF EXISTS generated_offers_update ON storage.objects;
DROP POLICY IF EXISTS generated_offers_delete ON storage.objects;
CREATE POLICY generated_offers_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'generated-offers' AND NOT public.current_session_is_seller_portal() AND (
    public.current_employee_is_crm_admin()
    OR EXISTS (SELECT 1 FROM public.offers f WHERE f.id = public.storage_generated_offer_id(objects.name))));
CREATE POLICY generated_offers_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'generated-offers' AND (public.current_employee_is_crm_admin()
    OR public.sales_can_manage_offer(public.storage_generated_offer_id(name))));
CREATE POLICY generated_offers_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'generated-offers' AND (public.current_employee_is_crm_admin()
    OR public.sales_can_manage_offer(public.storage_generated_offer_id(name))))
  WITH CHECK (bucket_id = 'generated-offers' AND (public.current_employee_is_crm_admin()
    OR public.sales_can_manage_offer(public.storage_generated_offer_id(name))));
CREATE POLICY generated_offers_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'generated-offers' AND (public.current_employee_is_crm_admin()
    OR public.sales_can_manage_offer(public.storage_generated_offer_id(name))));

-- 12. Folder „Faktury” w plikach wydarzenia — poziom finansów działalności wydarzenia ---------------------------------
-- Dotąd folder miał oznaczenie invoices_manage, którego od 20261101165000 nic nie nadaje, a baza go nie sprawdzała:
-- folder i faktury widział każdy z can_view_private_event_content (administrator, rola manager, autor wydarzenia).
UPDATE public.event_folders SET required_permission = 'finance:invoices'
WHERE required_permission IN ('invoices_manage', 'invoices_view');
COMMENT ON COLUMN public.event_folders.required_permission IS
  'Oznaczenie dostępu do folderu. Baza wymusza „finance:invoices” (folder „Faktury”: poziom finansów działalności wydarzenia ≥ invoices albo sprzedawca wydarzenia z poziomem sales — public.event_folder_permission_allows). Pozostałe wartości są informacyjne.';
DROP POLICY IF EXISTS event_folders_required_permission ON public.event_folders;
CREATE POLICY event_folders_required_permission ON public.event_folders AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.event_folder_id_allows(id))
  WITH CHECK (public.event_folder_permission_allows(required_permission, event_id)
              AND (parent_folder_id IS NULL OR public.event_folder_id_allows(parent_folder_id)));
DROP POLICY IF EXISTS event_files_folder_required_permission ON public.event_files;
CREATE POLICY event_files_folder_required_permission ON public.event_files AS RESTRICTIVE FOR ALL TO authenticated
  USING (folder_id IS NULL OR public.event_folder_id_allows(folder_id))
  WITH CHECK (folder_id IS NULL OR public.event_folder_id_allows(folder_id));

-- 13. D1 (decyzja właściciela 01.11.2026): płace i stawki — kadry -------------------------------------------------------
-- Odczyt: administrator, personnel_view, personnel_manage; zapis: administrator, personnel_manage. admin_only (wspólne
-- parametry kosztów — compensation_settings) bez zmian: tylko administrator. Konto portalu i zakres finansów „sales”
-- — brak (jak dotąd; restrykcyjna sales_finance_private zostaje). employees_manage i finances_* nic tu nie nadają.
CREATE OR REPLACE FUNCTION public.compensation_can_access(manage boolean DEFAULT false, admin_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.invoice_finance_scope() <> 'sales' AND coalesce(NOT public.current_session_is_seller_portal()
    AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
      AND (public.invoice_finance_is_admin() OR (NOT admin_only AND (
        'personnel_manage' = ANY(coalesce(e.permissions, '{}'::text[]))
        OR (NOT manage AND 'personnel_view' = ANY(coalesce(e.permissions, '{}'::text[]))))))), false);
$$;
COMMENT ON FUNCTION public.compensation_can_access(boolean, boolean) IS
  'Płace i stawki pracowników (D1, 01.11.2026): odczyt administrator / personnel_view / personnel_manage, zapis administrator / personnel_manage; admin_only — tylko administrator.';
DROP POLICY IF EXISTS employee_compensation_read_own ON public.employee_compensation;
CREATE POLICY employee_compensation_read_own ON public.employee_compensation FOR SELECT TO authenticated
  USING (employee_id = public.current_crm_employee_id() AND NOT public.current_session_is_seller_portal());

-- 14. P0-1: EXECUTE funkcji SECURITY DEFINER w public tylko dla zalogowanych -------------------------------------------
-- Polityki modułów Mavinci LIVE nadane rolom public/anon wołają predykaty sesji (dla anon zawsze fałsz) — nadajemy je
-- authenticated, żeby anon nie potrzebował EXECUTE na tych funkcjach (wynik dla anon bez zmian: brak wierszy).
DO $$
DECLARE v_policy record;
BEGIN
  FOR v_policy IN
    SELECT p.tablename, p.policyname FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.roles && ARRAY['public', 'anon']::name[]
      AND (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~
          '(can_access_mavinci_event|can_manage_mavinci_event|can_use_mavinci_global_module|can_use_mavinci_hub|can_use_mavinci_module|current_mavinci_employee_id)\('
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', v_policy.policyname, v_policy.tablename);
  END LOOP;
END $$;

-- Wyjątki: funkcje potrzebne bez logowania (strona WWW, analityka, urządzenia Mavinci View uwierzytelniane sekretem
-- urządzenia — mavinci_view_device_*). Formularze kontaktowe i zaproszenia nie używają funkcji (INSERT do tabel /
-- serwer z service_role). Funkcje triggerów też tracą EXECUTE dla anon (trigger nie sprawdza EXECUTE przy wywołaniu).
DO $$
DECLARE
  v_public_functions text[] := ARRAY[
    'get_public_brand_theme', 'update_page_analytics_duration',
    'mavinci_view_device_sync', 'mavinci_view_device_pending_commands',
    'mavinci_view_device_claim_command', 'mavinci_view_device_finish_command'];
  v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
      AND pg_has_role(current_user, p.proowner, 'MEMBER')
      AND NOT (p.proname = ANY (v_public_functions))
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
           OR p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
  LOOP
    -- Zalogowani i service_role zachowują EXECUTE, jeśli mieli je dotąd (choćby przez PUBLIC).
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
    END IF;
    IF has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', v_fn);
  END LOOP;
  -- Wyjątki: jawne uprawnienia (bez polegania na PUBLIC).
  FOR v_fn IN SELECT p.oid::regprocedure FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_public_functions) LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', v_fn);
  END LOOP;
END $$;

-- Nowe funkcje (tworzone przez właściciela schematu, w Supabase: postgres) nie dostają EXECUTE dla PUBLIC ani anon.
-- Domyślne EXECUTE dla PUBLIC jest globalne (ustawienie per schemat go nie odbiera) — stąd ALTER DEFAULT PRIVILEGES
-- bez IN SCHEMA; authenticated i service_role dostają EXECUTE w public jak dotąd. Funkcja dla strony (anon) wymaga
-- odtąd jawnego GRANT EXECUTE … TO anon; pomocnicza w private używana w politykach — jawnego GRANT … TO authenticated.
DO $$
DECLARE v_role name;
BEGIN
  FOR v_role IN
    SELECT DISTINCT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.pronamespace = 'public'::regnamespace AND pg_has_role(current_user, r.oid, 'MEMBER')
    UNION SELECT current_user::name
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', v_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon', v_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role', v_role);
  END LOOP;
END $$;

-- 15. Kontrola końcowa ------------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_list text;
  v_public_functions text[] := ARRAY[
    'get_public_brand_theme', 'update_page_analytics_duration',
    'mavinci_view_device_sync', 'mavinci_view_device_pending_commands',
    'mavinci_view_device_claim_command', 'mavinci_view_device_finish_command'];
BEGIN
  -- a) Żadna funkcja SECURITY DEFINER w public poza wyjątkami nie jest wykonywalna przez anon.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO v_list
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
    AND NOT (p.proname = ANY (v_public_functions)) AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'Funkcje SECURITY DEFINER wykonywalne przez anon: %', v_list; END IF;

  -- b) Żadna polityka dla public/anon nie woła funkcji SECURITY DEFINER, której anon nie może wykonać
  --    (zapytanie anon kończyłoby się błędem „permission denied for function”).
  SELECT string_agg(DISTINCT pol.schemaname || '.' || pol.tablename || ' „' || pol.policyname || '” → ' || p.proname, ', ') INTO v_list
  FROM pg_policies pol
  JOIN pg_proc p ON p.pronamespace = 'public'::regnamespace AND p.prosecdef
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ~ ('(^|[^a-z0-9_.])(public\.)?' || p.proname || '\(')
  WHERE pol.schemaname IN ('public', 'storage') AND pol.roles && ARRAY['public', 'anon']::name[];
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'Polityki dla anon wołają funkcje bez EXECUTE dla anon: %', v_list; END IF;

  -- c) Funkcje „tylko serwer” (próbka z sekcji 3): brak EXECUTE dla anon/authenticated, jest dla service_role.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_list
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('delete_offer_with_cleanup', 'persist_ksef_send_result_atomic',
      'reconcile_local_invoice_with_ksef_atomic', 'confirm_equipment_reservation', 'replace_wedding_card_people',
      'create_event_operational_notification', 'create_fleet_compliance_notification', 'claim_email_ai_qualification',
      'process_crm_system_health_alerts', 'process_event_operational_alerts', 'get_organization_invoices', 'get_event_invoices',
      'get_event_cash_summary', 'reserve_invoice_number_atomic', 'record_seller_offer_document')
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')
         OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'));
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'Funkcje tylko dla serwera mają złe uprawnienia: %', v_list; END IF;
  -- d) Treści strony: brak polityk zapisu dla public/anon.
  SELECT string_agg(tablename || ' „' || policyname || '”', ', ') INTO v_list FROM pg_policies
  WHERE schemaname = 'public' AND permissive = 'PERMISSIVE' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    AND roles && ARRAY['public', 'anon']::name[]
    AND (tablename LIKE '%page_images' OR tablename IN ('casino_content_items', 'casino_content_sections',
      'casino_content_separators', 'conferences_related_services', 'dj_related_services', 'seo_city_content',
      'site_images', 'technical_stage_related_services', 'notifications', 'notification_recipients', 'vehicles',
      'event_contact_persons', 'employee_assignments'));
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'Pozostały polityki zapisu dla anon/public: %', v_list; END IF;
  SELECT string_agg(policyname, ', ') INTO v_list FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    AND roles && ARRAY['public', 'anon']::name[] AND policyname <> 'site_images_public_cv_upload'
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '(site-images|conferences-gallery)';
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'Pozostały polityki zapisu storage dla anon/public: %', v_list; END IF;

  -- e) Powiadomienia: zalogowany nie wstawia ani nie zmienia notifications; nie dopisuje odbiorców.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
               AND ((tablename = 'notifications' AND cmd <> 'SELECT') OR (tablename = 'notification_recipients' AND cmd = 'INSERT')))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications'
                  AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND qual = 'true') THEN
    RAISE EXCEPTION 'Powiadomienia nadal mają polityki zapisu lub odczytu dla wszystkich.';
  END IF;

  -- f) employees: żadnej polityki dla anon; widok strony istnieje.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'employees'
               AND roles && ARRAY['public', 'anon']::name[]) OR to_regclass('public.website_team_members') IS NULL THEN
    RAISE EXCEPTION 'employees: nadal dostępne dla anon albo brak widoku website_team_members.';
  END IF;

  -- g) ksef_credentials: zalogowany nie czyta sekretów.
  IF has_column_privilege('authenticated', 'public.ksef_credentials', 'token', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ksef_credentials', 'certificate_password', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ksef_credentials', 'refresh_token', 'SELECT') THEN
    RAISE EXCEPTION 'ksef_credentials: sekrety nadal czytelne dla authenticated.';
  END IF;

  -- h) Domyślne uprawnienia: nowe funkcje bez EXECUTE dla PUBLIC/anon.
  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
             WHERE d.defaclobjtype = 'f' AND pg_has_role(current_user, d.defaclrole, 'MEMBER')
               AND (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace)
               AND a.privilege_type = 'EXECUTE'
               AND (a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon'))) THEN
    RAISE EXCEPTION 'Domyślne uprawnienia nadal nadają EXECUTE nowym funkcjom dla PUBLIC/anon.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_default_acl d WHERE d.defaclobjtype = 'f' AND d.defaclnamespace = 0
                   AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION 'Brak globalnego wpisu domyślnych uprawnień funkcji (EXECUTE dla PUBLIC nie został odebrany).';
  END IF;
END $$;

COMMIT;
